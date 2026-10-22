import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ZodError, type ZodTypeAny, type z } from 'zod';

export class HttpError extends Error {
  constructor(public status: number, message: string, public code?: string) {
    super(message);
  }
}

export const badRequest = (m: string) => new HttpError(400, m, 'bad_request');
export const unauthorized = (m = 'Please log in') => new HttpError(401, m, 'unauthorized');
export const forbidden = (m = 'You are not allowed to do that') => new HttpError(403, m, 'forbidden');
export const notFound = (m = 'Not found') => new HttpError(404, m, 'not_found');
export const conflict = (m: string) => new HttpError(409, m, 'conflict');

export function parse<S extends ZodTypeAny>(schema: S, value: unknown): z.infer<S> {
  const r = schema.safeParse(value);
  if (!r.success) {
    const first = r.error.issues[0];
    throw new HttpError(400, first ? `${first.path.join('.') || 'input'}: ${first.message}` : 'Invalid input', 'validation');
  }
  return r.data;
}

type Handler = (req: Request, res: Response, next: NextFunction) => Promise<unknown>;

/** Lets async route handlers throw; errors go to the error middleware. */
export const h = (fn: Handler): RequestHandler => (req, res, next) => {
  fn(req, res, next).catch(next);
};

export function errorMessage(err: unknown): { status: number; body: { error: string; code?: string } } {
  if (err instanceof HttpError) return { status: err.status, body: { error: err.message, code: err.code } };
  if (err instanceof ZodError) return { status: 400, body: { error: err.issues[0]?.message ?? 'Invalid input', code: 'validation' } };
  return { status: 500, body: { error: 'Something went wrong', code: 'internal' } };
}
