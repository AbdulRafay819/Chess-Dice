/**
 * Publishes the authoritative state to an Ably channel so both browsers get a
 * push the instant something changes. Clients that cannot hold the realtime
 * connection simply poll GET /api/state.
 *
 * Uses Ably's REST API directly: one fetch, no SDK, no cold-start cost.
 */

export interface AblyCredentials {
  name: string;
  secret: string;
  basic: string;
}

/**
 * Parse ABLY_API_KEY (`name:secret`). Copy-pasting from a dashboard easily
 * brings quotes, trailing newlines or spaces along; those used to look like a
 * malformed key to the runtime, so normalise before splitting.
 */
export function ablyCredentials(): AblyCredentials | null {
  const raw = process.env.ABLY_API_KEY;
  if (!raw) return null;
  const cleaned = raw.trim().replace(/^['"`]+|['"`]+$/g, '').trim();
  const split = cleaned.indexOf(':');
  if (split <= 0 || split === cleaned.length - 1) return null;
  const name = cleaned.slice(0, split).trim();
  const secret = cleaned.slice(split + 1).trim();
  if (!name || !secret) return null;
  return {
    name,
    secret,
    basic: Buffer.from(`${name}:${secret}`).toString('base64'),
  };
}

export function realtimeEnabled(): boolean {
  return ablyCredentials() !== null;
}

export async function publishState(room: string, state: unknown): Promise<boolean> {
  const credentials = ablyCredentials();
  if (!credentials) return false;
  const channel = encodeURIComponent(`room-${room.toUpperCase()}`);
  try {
    const response = await fetch(`https://rest.ably.io/channels/${channel}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${credentials.basic}`,
        'Content-Type': 'application/json',
        // Ably refuses a publish from an unidentified client (error 40161).
        // When the id travels in a header it must be base64 encoded (40012),
        // so a plain `clientId` would only work as a query parameter.
        'X-Ably-ClientId': Buffer.from(`server-${room.toUpperCase()}`).toString('base64'),
      },
      body: JSON.stringify({ name: 'state', data: state }),
    });
    return response.ok;
  } catch {
    // Realtime is best-effort; polling is the guaranteed transport.
    return false;
  }
}
