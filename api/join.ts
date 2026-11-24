import type { Color } from '../src/shared/types.js';
import { run } from './_lib/game.js';
import { parseRequest } from './_lib/http.js';
import { publishState } from './_lib/publish.js';
import { getRoom, newToken, saveRoom, snapshot } from './_lib/store.js';
import { ApiError, roomIdOf } from './_lib/validate.js';

export default async function handler(req: unknown, res: unknown) {
  await run(res, async () => {
    const request = await parseRequest(req);
    if (request.method !== 'POST') throw new ApiError(405, 'Use POST /api/join.');
    const room = roomIdOf(request);
    const record = await getRoom(room);
    if (!record) throw new ApiError(404, 'Room not found. Check the code.');

    const token = String(request.body.token ?? '').trim();
    const existing = token ? record.players.find((p) => p.token === token) : undefined;
    if (existing) {
      // Reconnect after a refresh or a dropped connection.
      return { ok: true, room, token: existing.token, color: existing.color, state: snapshot(record.state) };
    }

    if (record.players.length >= 2) throw new ApiError(409, 'Room is full.');
    if (record.state.status === 'finished') throw new ApiError(409, 'This game is already over.');

    const color: Color = 'b';
    const fresh = newToken();
    record.players.push({ token: fresh, color });
    record.seq += 1;
    record.state = { ...record.state, status: 'playing', version: record.seq };
    await saveRoom(record);
    await publishState(room, snapshot(record.state));

    return { ok: true, room, token: fresh, color, state: snapshot(record.state) };
  });
}
