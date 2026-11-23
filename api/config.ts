import { run } from './_lib/game';
import { parseRequest } from './_lib/http';
import { realtimeEnabled } from './_lib/publish';
import { usingRedis } from './_lib/store';

/** Tells the client whether to open a realtime channel or just poll. */
export default async function handler(req: unknown, res: unknown) {
  await run(res, async () => {
    await parseRequest(req);
    return { ok: true, realtime: realtimeEnabled(), redis: usingRedis() };
  });
}
