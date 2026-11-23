import { applyChoice } from '../src/shared/rules';
import { assertTurn, mutate, run } from './_lib/game';
import { parseRequest } from './_lib/http';
import { ApiError, roomIdOf, tokenOf } from './_lib/validate';

export default async function handler(req: unknown, res: unknown) {
  await run(res, async () => {
    const request = await parseRequest(req);
    if (request.method !== 'POST') throw new ApiError(405, 'Use POST /api/choice.');
    const room = roomIdOf(request);
    const token = tokenOf(request);
    const choice = String(request.body.choice ?? '');
    if (choice !== 'move' && choice !== 'snipe') {
      throw new ApiError(400, 'Choose either "move" or "snipe".');
    }

    const { state } = await mutate(room, token, (record, color) => {
      assertTurn(record.state, color);
      return applyChoice(record.state, choice);
    });

    return { ok: true, state };
  });
}
