import { run } from './_lib/game';
import { parseRequest } from './_lib/http';
import { realtimeEnabled } from './_lib/publish';
import { usingRedis } from './_lib/store';

/** Tells the client whether to open a realtime channel or just poll. */
export default async function handler(req: unknown, res: unknown) {
  await run(res, async () => {
    await parseRequest(req);
    return {
      ok: true,
      realtime: realtimeEnabled(),
      redis: usingRedis(),
      // Which store is actually in use. "memory" means the deployment is
      // missing UPSTASH_* and rooms will not survive a different function
      // instance, which breaks online play between two browsers.
      store: usingRedis() ? 'redis' : 'memory',
    };
  });
}
