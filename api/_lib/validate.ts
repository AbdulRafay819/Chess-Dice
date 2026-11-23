import type { ApiRequest } from './http';

export function roomIdOf(req: ApiRequest): string {
  const room = String(req.body.room ?? req.query.room ?? '')
    .trim()
    .toUpperCase();
  if (!/^[A-Z0-9]{6}$/.test(room)) throw new ApiError(400, 'Enter a six-character room code.');
  return room;
}

export function tokenOf(req: ApiRequest): string {
  const header = req.headers['x-player-token'];
  const token = String(req.body.token ?? req.query.token ?? header ?? '').trim();
  if (token.length < 8) throw new ApiError(401, 'Missing player token.');
  return token;
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = 'ApiError';
  }
}
