import { initialState } from '../src/shared/rules';
import { run } from './_lib/game';
import { parseRequest } from './_lib/http';
import { newRoomCode, newToken, saveRoom, snapshot, getRoom, type RoomRecord } from './_lib/store';
import { ApiError } from './_lib/validate';
import { publishState } from './_lib/publish';

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
