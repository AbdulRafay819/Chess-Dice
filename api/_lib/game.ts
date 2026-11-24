import { RulesError } from '../../src/shared/rules.js';
import type { Color, GameState, PublicGameState } from '../../src/shared/types.js';
import { send } from './http.js';
import { publishState } from './publish.js';
import { getRoom, saveRoom, snapshot, type RoomRecord } from './store.js';
import { ApiError } from './validate.js';

export async function run(res: unknown, fn: () => Promise<unknown>): Promise<void> {
  try {
    send(res, 200, await fn());
  } catch (error) {
    if (error instanceof ApiError) {
      send(res, error.status, { ok: false, error: error.message });
      return;
    }
    if (error instanceof RulesError) {
      send(res, 400, { ok: false, error: error.message });
      return;
    }
    console.error('Unhandled API error', error);
    send(res, 500, { ok: false, error: 'The server could not complete that action.' });
  }
}

export async function requireRoom(room: string): Promise<RoomRecord> {
  const record = await getRoom(room);
  if (!record) throw new ApiError(404, 'Room not found. Check the code.');
  return record;
}

export function colorOf(record: RoomRecord, token: string): Color {
  const player = record.players.find((p) => p.token === token);
  if (!player) throw new ApiError(403, 'This browser is not a player in that room.');
  return player.color;
}

export function assertTurn(state: GameState, color: Color): void {
  if (state.turn !== color) throw new ApiError(409, 'It is not your turn.');
}

/** Read, validate, apply the shared rules, bump the version, persist, publish. */
export async function mutate(
  room: string,
  token: string,
  apply: (record: RoomRecord, color: Color) => GameState,
): Promise<{ state: PublicGameState; result?: unknown }> {
  const record = await requireRoom(room);
  const color = colorOf(record, token);
  if (record.players.length < 2) throw new ApiError(409, 'Waiting for an opponent to join.');
  if (record.state.status === 'finished') throw new ApiError(409, 'This game is already over.');

  const next = apply(record, color);
  record.seq += 1;
  record.state = { ...next, version: record.seq };
  await saveRoom(record);
  await publishState(record.id, snapshot(record.state));
  return { state: snapshot(record.state) };
}
