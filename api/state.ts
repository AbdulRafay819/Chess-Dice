import { run } from './_lib/game';
import { parseRequest } from './_lib/http';
import { getRoom, snapshot } from './_lib/store';
import { ApiError, roomIdOf } from './_lib/validate';

/** Polling fallback and reconnect: cheap, cache-less, safe to call often. */
export default async function handler(req: unknown, res: unknown) {
  await run(res, async () => {
    const request = await parseRequest(req);
    const room = roomIdOf(request);
    const record = await getRoom(room);
    if (!record) throw new ApiError(404, 'Room not found.');
    const since = Number(request.query.since ?? request.body.since ?? -1);
    const changed = !Number.isFinite(since) || since !== record.state.version;
    const token = String(request.query.token ?? request.body.token ?? '');
    const me = record.players.find((p) => p.token === token);
    return {
      ok: true,
      changed,
      color: me?.color ?? null,
      players: record.players.map((p) => p.color),
      state: changed ? snapshot(record.state) : null,
    };
  });
}
