import { applyRoll } from '../src/shared/rules.js';
import { assertTurn, mutate, run } from './_lib/game.js';
import { parseRequest } from './_lib/http.js';
import { newSeed } from './_lib/store.js';
import { ApiError, roomIdOf, tokenOf } from './_lib/validate.js';

export default async function handler(req: unknown, res: unknown) {
  await run(res, async () => {
    const request = await parseRequest(req);
    if (request.method !== 'POST') throw new ApiError(405, 'Use POST /api/roll.');
    const room = roomIdOf(request);
    const token = tokenOf(request);

    const { state } = await mutate(room, token, (record, color) => {
      assertTurn(record.state, color);
      const value = 1 + Math.floor(Math.random() * 6);
      return applyRoll(record.state, value, newSeed());
    });

    return { ok: true, state, die: state.die };
  });
}
