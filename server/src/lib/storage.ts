// File storage: S3-compatible (production, MinIO in docker) or a local folder (development / tests).
// Clients never get storage credentials: they get short-lived signed URLs for one object.
import { mkdir, rm, stat } from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { CreateBucketCommand, DeleteObjectCommand, GetObjectCommand, HeadBucketCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Request, Response } from 'express';
import { config } from '../config.js';
import { hmac, safeEqual } from './crypto.js';
import { HttpError } from './errors.js';

export interface UploadTarget {
  url: string;
  method: 'PUT';
  headers: Record<string, string>;
}

const UPLOAD_TTL = 10 * 60;
export const DOWNLOAD_TTL = 60 * 60;

function s3(endpoint?: string) {
  return new S3Client({
    region: config.S3_REGION,
    endpoint,
    forcePathStyle: config.S3_FORCE_PATH_STYLE,
    credentials: { accessKeyId: config.S3_ACCESS_KEY_ID ?? '', secretAccessKey: config.S3_SECRET_ACCESS_KEY ?? '' },
  });
}
const internal = config.STORAGE_DRIVER === 's3' ? s3(config.S3_ENDPOINT) : null;
// Signed URLs must use the host the browser can reach (e.g. localhost:9000, not the docker service name).
const signer = config.STORAGE_DRIVER === 's3' ? s3(config.S3_PUBLIC_ENDPOINT ?? config.S3_ENDPOINT) : null;

/** Creates the bucket on first start if it doesn't exist (e.g. a fresh MinIO). */
export async function ensureBucket() {
  if (!internal) return;
  try {
    await internal.send(new HeadBucketCommand({ Bucket: config.S3_BUCKET }));
  } catch {
    await internal.send(new CreateBucketCommand({ Bucket: config.S3_BUCKET }));
  }
}

function sign(action: string, key: string, exp: number, extra = ''): string {
  return hmac(config.SESSION_SECRET, `${action}\n${key}\n${exp}\n${extra}`).toString('base64url');
}

function localPath(key: string): string {
  const root = path.resolve(config.LOCAL_UPLOAD_DIR);
  const full = path.resolve(root, key);
  if (!full.startsWith(root + path.sep)) throw new HttpError(400, 'Bad file key');
  return full;
}

export async function uploadTarget(key: string, mime: string, size: number): Promise<UploadTarget> {
  if (signer) {
    const cmd = new PutObjectCommand({ Bucket: config.S3_BUCKET, Key: key, ContentType: mime, ContentLength: size });
    const url = await getSignedUrl(signer, cmd, { expiresIn: UPLOAD_TTL, signableHeaders: new Set(['content-type', 'content-length']) });
    return { url, method: 'PUT', headers: { 'Content-Type': mime } };
  }
  const exp = Math.floor(Date.now() / 1000) + UPLOAD_TTL;
  const extra = `${mime}\n${size}`;
  const q = new URLSearchParams({ key, exp: String(exp), mime, size: String(size), sig: sign('put', key, exp, extra) });
  return { url: `${config.API_URL}/files/upload?${q}`, method: 'PUT', headers: { 'Content-Type': mime } };
}

export async function downloadUrl(key: string, name?: string, ttl = DOWNLOAD_TTL): Promise<string> {
  // Round expiry up so the same URL is reused for a while (browser caching works).
  const exp = Math.ceil((Date.now() / 1000 + ttl) / 600) * 600;
  if (signer) {
    const cmd = new GetObjectCommand({
      Bucket: config.S3_BUCKET,
      Key: key,
      ResponseContentDisposition: name ? `inline; filename*=UTF-8''${encodeURIComponent(name)}` : undefined,
    });
    return getSignedUrl(signer, cmd, { expiresIn: Math.max(60, exp - Math.floor(Date.now() / 1000)) });
  }
  const q = new URLSearchParams({ key, exp: String(exp), sig: sign('get', key, exp) });
  if (name) q.set('name', name);
  return `${config.API_URL}/files/get?${q}`;
}

/** Size of a stored object, or null if it was never uploaded. */
export async function objectSize(key: string): Promise<number | null> {
  try {
    if (internal) {
      const head = await internal.send(new HeadObjectCommand({ Bucket: config.S3_BUCKET, Key: key }));
      return head.ContentLength ?? null;
    }
    return (await stat(localPath(key))).size;
  } catch {
    return null;
  }
}

export async function deleteObject(key: string): Promise<void> {
  try {
    if (internal) await internal.send(new DeleteObjectCommand({ Bucket: config.S3_BUCKET, Key: key }));
    else await rm(localPath(key), { force: true });
  } catch {
    // Missing objects are fine.
  }
}

function checkSig(action: string, q: Request['query'], extra = '') {
  const key = String(q.key ?? '');
  const exp = Number(q.exp);
  const sig = String(q.sig ?? '');
  if (!key || !exp || exp < Date.now() / 1000 || !safeEqual(sig, sign(action, key, exp, extra))) {
    throw new HttpError(403, 'Link expired or invalid');
  }
  return key;
}

/** PUT /files/upload — local driver only. */
export async function handleLocalUpload(req: Request, res: Response) {
  const mime = String(req.query.mime ?? '');
  const size = Number(req.query.size);
  const key = checkSig('put', req.query, `${mime}\n${size}`);
  const sentType = (req.headers['content-type'] ?? '').split(';')[0].trim();
  if (sentType !== mime) throw new HttpError(400, 'Content-Type does not match the upload request');
  const file = localPath(key);
  await mkdir(path.dirname(file), { recursive: true });
  let written = 0;
  const limit = new Transform({
    transform(chunk: Buffer, _e, cb) {
      written += chunk.length;
      if (written > size) cb(new HttpError(413, 'File is larger than announced'));
      else cb(null, chunk);
    },
  });
  try {
    await pipeline(req, limit, createWriteStream(file));
  } catch (e) {
    await rm(file, { force: true });
    throw e instanceof HttpError ? e : new HttpError(400, 'Upload failed');
  }
  if (written !== size) {
    await rm(file, { force: true });
    throw new HttpError(400, 'File size does not match the upload request');
  }
  res.status(200).end();
}

/** GET /files/get — local driver only. Supports Range so audio/video can seek. */
export async function handleLocalDownload(req: Request, res: Response) {
  const key = checkSig('get', req.query);
  const file = localPath(key);
  let size: number;
  try {
    size = (await stat(file)).size;
  } catch {
    throw new HttpError(404, 'File not found');
  }
  const name = typeof req.query.name === 'string' ? req.query.name : path.basename(key);
  const mime = mimeFromKey(key);
  res.setHeader('Content-Type', mime);
  res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(name)}`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // Uploaded files never run as pages on our origin.
  res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Cache-Control', 'private, max-age=600');
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
  if (range) {
    const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (start >= size || start > end) {
      res.status(416).setHeader('Content-Range', `bytes */${size}`).end();
      return;
    }
    res.status(206).setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
    res.setHeader('Content-Length', String(end - start + 1));
    await pipeline(createReadStream(file, { start, end }), res);
    return;
  }
  res.setHeader('Content-Length', String(size));
  await pipeline(createReadStream(file), res);
}

// Keys end in an extension chosen by the server from the validated MIME type.
const EXT: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp',
  'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov',
  'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/ogg': 'ogg', 'audio/webm': 'weba', 'audio/wav': 'wav',
  'application/pdf': 'pdf', 'text/plain': 'txt', 'application/zip': 'zip',
  'application/msword': 'doc', 'application/vnd.ms-excel': 'xls', 'application/vnd.ms-powerpoint': 'ppt',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
};
const MIME = Object.fromEntries(Object.entries(EXT).map(([m, e]) => [e, m]));

export function extFor(mime: string): string {
  return EXT[mime] ?? 'bin';
}
function mimeFromKey(key: string): string {
  const m = /\.([a-z0-9]+)$/.exec(key);
  return (m && MIME[m[1]]) || 'application/octet-stream';
}
