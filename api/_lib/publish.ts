/**
 * Publishes the authoritative state to an Ably channel so both browsers get a
 * push the instant something changes. Clients that cannot hold the realtime
 * connection simply poll GET /api/state.
 *
 * Uses Ably's REST API directly: one fetch, no SDK, no cold-start cost.
 */

export function realtimeEnabled(): boolean {
  return Boolean(process.env.ABLY_API_KEY);
}

export async function publishState(room: string, state: unknown): Promise<boolean> {
  const key = process.env.ABLY_API_KEY;
  if (!key) return false;
  const [keyName, secret] = key.split(':');
  if (!keyName || !secret) return false;
  const auth = `Basic ${Buffer.from(`${keyName}:${secret}`).toString('base64')}`;
  const channel = encodeURIComponent(`room-${room.toUpperCase()}`);
  try {
    const response = await fetch(`https://rest.ably.io/channels/${channel}/messages`, {
      method: 'POST',
      headers: { Authorization: auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'state', data: state }),
    });
    return response.ok;
  } catch {
    // Realtime is best-effort; polling is the guaranteed transport.
    return false;
  }
}
