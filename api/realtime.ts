import { run } from './_lib/game';
import { parseRequest, send } from './_lib/http';
import { ApiError } from './_lib/validate';

/**
 * Mints a short-lived Ably subscribe-only token for one room, so the browser
 * never sees the API key. Ably's JS client calls this endpoint automatically
 * via `authUrl`, because it answers with an Ably TokenRequest.
 */
export default async function handler(req: unknown, res: unknown) {
  const key = process.env.ABLY_API_KEY;
  if (!key) {
    send(res, 503, { ok: false, error: 'Realtime is not configured; polling is active.' });
    return;
  }

  await run(res, async () => {
    const request = await parseRequest(req);
    const room = String(request.query.room ?? request.body.room ?? '')
      .trim()
      .toUpperCase();
    if (!/^[A-Z0-9]{6}$/.test(room)) throw new ApiError(400, 'Send a valid room code.');

    const [keyName, secret] = key.split(':');
    if (!keyName || !secret) throw new ApiError(500, 'ABLY_API_KEY is malformed.');

    const response = await fetch(
      `https://rest.ably.io/keys/${encodeURIComponent(keyName)}/requestToken`,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(`${keyName}:${secret}`).toString('base64')}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          capability: JSON.stringify({ [`room-${room}`]: ['subscribe'] }),
          ttl: 60 * 60 * 1000,
          clientId: `player-${room}`,
        }),
      },
    );

    if (!response.ok) {
      throw new ApiError(502, `Ably token request failed (${response.status}).`);
    }
    // Ably accepts a TokenRequest object returned from authUrl.
    send(res, 200, await response.json());
  });
}
