import { Router } from 'express';
import { LIMITS, kindOf, uploadRequestInput } from '@baatcheet/shared';
import { prisma } from '../../db.js';
import { randomToken } from '../../lib/crypto.js';
import { HttpError, badRequest, h, parse } from '../../lib/errors.js';
import { limit } from '../../lib/rate.js';
import { extFor, uploadTarget } from '../../lib/storage.js';
import { me } from '../session.js';

export const uploads = Router();

/**
 * Step 1 of an upload: the server checks type and size and hands out a signed URL for one new
 * object. Step 2 the browser PUTs the file there. Step 3 the key is used in a message / profile,
 * which checks the object really exists with that size.
 */
uploads.post('/', limit(60 * 60_000, 300), h(async (req, res) => {
  const input = parse(uploadRequestInput, req.body);
  const kind = kindOf(input.mime);
  if (!kind) throw badRequest('This file type is not allowed');
  const avatar = input.purpose !== 'attachment';
  if (avatar && kind !== 'image') throw badRequest('Pictures must be JPEG, PNG, GIF or WebP');
  const max = avatar ? LIMITS.fileSize.avatar : LIMITS.fileSize[kind];
  if (input.size > max) throw new HttpError(413, `File is too large (max ${Math.round(max / 1024 / 1024)} MB)`, 'too_large');
  const user = me(req);
  // The key never contains the user's file name, so it can't be used for path tricks.
  const key = `${input.purpose === 'attachment' ? 'att' : 'avatars'}/${user.id}/${randomToken(18)}.${extFor(input.mime)}`;
  await prisma.upload.create({ data: { key, userId: user.id, purpose: input.purpose, mime: input.mime, size: input.size, name: input.name } });
  res.status(201).json({ key, upload: await uploadTarget(key, input.mime, input.size) });
}));
