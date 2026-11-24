import { applyMove } from '../src/shared/rules.js';
import { assertTurn, mutate, run } from './_lib/game.js';
import { parseRequest } from './_lib/http.js';
import { ApiError, roomIdOf, tokenOf } from './_lib/validate.js';

const SQUARE = /^[a-h][1-8]$/;

export default async function handler(req: unknown, res: unknown) {
  await run(res, async () => {
    const request = await parseRequest(req);
    if (request.method !== 'POST') throw new ApiError(405, 'Use POST /api/move.');
    const room = roomIdOf(request);
    const token = tokenOf(request);
    const from = String(request.body.from ?? '');
    const to = String(request.body.to ?? '');
    if (!SQUARE.test(from) || !SQUARE.test(to)) throw new ApiError(400, 'Send from/to squares.');

    const { state } = await mutate(room, token, (record, color) => {
      assertTurn(record.state, color);
      return applyMove(record.state, from, to);
    });

    return { ok: true, state };
  });
}
