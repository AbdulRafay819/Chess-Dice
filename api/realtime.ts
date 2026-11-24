import { createHmac, randomBytes } from 'node:crypto';
import { run } from './_lib/game';
import { parseRequest, send } from './_lib/http';
import { ablyCredentials } from './_lib/publish';
import { ApiError } from './_lib/validate';

/**
 * Hands the browser a short-lived, subscribe-only Ably TokenRequest for one
 * room, so the API key never leaves the server.
 *
 * The request is signed locally with the key secret, which means this function
 * makes no outbound call at all. Ably's client posts it back (via `authUrl`) to
 * exchange it for the actual token.
 *
 * Two things this endpoint gets right that used to break online play:
 * - It returns the value from `run` instead of calling `send` itself; double
 *   sending a response makes Vercel fail the invocation with a 500.
 * - A TokenRequest needs `keyName`, `capability`, `timestamp`, `nonce` and a
 *   `mac` over exactly those fields. Without them Ably rejects the request.
 *
 * Environment variables on Vercel are set per project and read at function
 * runtime; a local `.env` file is not deployed.
 */
export default async function handler(req: unknown, res: unknown) {
  const credentials = ablyCredentials();
  if (!credentials) {
    // Nothing to read from the body without a key, and this endpoint is called
    // with an empty POST, so answer before touching the request stream.
    send(res, 503, {
      ok: false,
      error:
        'Realtime is not configured on this deployment. Add ABLY_API_KEY to the project environment variables and redeploy; the game keeps working over polling.',
    });
    return;
  }

  await run(res, async () => {
    const request = await parseRequest(req);
    const room = String(request.query.room ?? request.body.room ?? '')
      .trim()
      .toUpperCase();
    if (!/^[A-Z0-9]{6}$/.test(room)) throw new ApiError(400, 'Send a valid room code.');

    const { name, secret } = credentials;
    const capability = JSON.stringify({ [`room-${room}`]: ['subscribe'] });
    const ttl = 60 * 60 * 1000;
    // Both players used to share `player-<room>`, and Ably drops the older
    // connection when a second one claims the same client id — exactly the
    // "online stops working for one side" symptom. Each browser now sends its
    // own id; it is only used to label a subscribe-only connection, so the
    // strict shape check is all the validation it needs.
    const requested = String(request.query.clientId ?? request.body.clientId ?? '')
      .trim()
      .replace(/[^A-Za-z0-9_-]/g, '')
      .slice(0, 40);
    const clientId = requested.length >= 8 ? requested : `player-${room}`;
    const timestamp = Date.now();
    // At least 16 random characters, unquoted, so a request cannot be replayed.
    const nonce = randomBytes(16).toString('hex');
    const mac = createHmac('sha256', secret)
      .update(`${name}\n${ttl}\n${capability}\n${clientId}\n${timestamp}\n${nonce}\n`)
      .digest('base64');

    return { keyName: name, capability, clientId, ttl, timestamp, nonce, mac };
  });
}
