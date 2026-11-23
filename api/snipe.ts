import { applySnipe } from '../src/shared/rules';
import { assertTurn, mutate, run } from './_lib/game';
import { parseRequest } from './_lib/http';
import { ApiError, roomIdOf, tokenOf } from './_lib/validate';

const SQUARE = /^[a-h][1-8]$/;

export default async function handler(req: unknown, res: unknown) {
  await run(res, async () => {
    const request = await parseRequest(req);
    if (request.method !== 'POST') throw new ApiError(405, 'Use POST /api/snipe.');
    const room = roomIdOf(request);
    const token = tokenOf(request);
    const from = String(request.body.from ?? '');
    const angle = Number(request.body.angle);
    const power = Number(request.body.power);
    if (!SQUARE.test(from)) throw new ApiError(400, 'Send a valid origin square.');
    if (!Number.isFinite(angle) || !Number.isFinite(power)) {
      throw new ApiError(400, 'Send a numeric aim angle and power.');
    }

    const { state } = await mutate(room, token, (record, color) => {
      assertTurn(record.state, color);
      return applySnipe(record.state, from, angle, Math.max(0, Math.min(1, power)), record.state.seed)
        .state;
    });

    return {
      ok: true,
      state,
      result: state.lastAction?.type === 'snipe' ? state.lastAction.result : null,
    };
  });
}
