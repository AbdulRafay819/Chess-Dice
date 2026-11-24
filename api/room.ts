import { initialState } from '../src/shared/rules.js';
import { run } from './_lib/game.js';
import { parseRequest } from './_lib/http.js';
import { newRoomCode, newToken, saveRoom, snapshot, getRoom, type RoomRecord } from './_lib/store.js';
import { ApiError } from './_lib/validate.js';
import { publishState } from './_lib/publish.js';

export default async function handler(req: unknown, res: unknown) {
  await run(res, async () => {
    const request = await parseRequest(req);
    if (request.method !== 'POST') throw new ApiError(405, 'Use POST /api/room.');

    let code = newRoomCode();
    for (let attempt = 0; attempt < 6 && (await getRoom(code)); attempt++) code = newRoomCode();

    const token = newToken();
    const record: RoomRecord = {
      id: code,
      seq: 1,
      players: [{ token, color: 'w' }],
      state: { ...initialState(), status: 'waiting', version: 1 },
      createdAt: Date.now(),
    };
    await saveRoom(record);
    await publishState(code, snapshot(record.state));

    return { ok: true, room: code, token, color: 'w', state: snapshot(record.state) };
  });
}
