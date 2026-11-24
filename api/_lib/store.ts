import type { GameState, PublicGameState, Color } from '../../src/shared/types.js';
import { publicState } from '../../src/shared/types.js';

export type { ApiRequest } from './http.js';

export interface RoomRecord {
  id: string;
  seq: number;
  players: { token: string; color: Color }[];
  state: GameState;
  createdAt: number;
}

const TTL_SECONDS = 60 * 60 * 6;
const ROOM_KEY = (id: string) => `dicechess:room:${id}`;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

type MemoryStore = Map<string, string>;
const globalCache = globalThis as typeof globalThis & { __diceChessMemory?: MemoryStore };
const memory: MemoryStore = (globalCache.__diceChessMemory ??= new Map());

interface UpstashConfig {
  url: string;
  token: string;
}

function upstash(): UpstashConfig | null {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return { url: url.replace(/\/$/, ''), token };
}

export function usingRedis(): boolean {
  return upstash() !== null;
}

async function command<T>(args: (string | number)[]): Promise<T | null> {
  const config = upstash();
  if (!config) {
    // Local development / preview: in-process map, no external service needed.
    const [op, key, value, ex, ttl] = args as string[];
    if (op === 'GET') return (memory.get(key) ?? null) as T | null;
    if (op === 'SET') {
      memory.set(key, value);
      void ex;
      void ttl;
      return 'OK' as unknown as T;
    }
    if (op === 'DEL') {
      memory.delete(key);
      return 1 as unknown as T;
    }
    return null;
  }

  const response = await fetch(config.url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args),
  });
  if (!response.ok) {
    throw new Error(`Redis command failed (${response.status}): ${await response.text()}`);
  }
  const payload = (await response.json()) as { result?: T; error?: string };
  if (payload.error) throw new Error(payload.error);
  return payload.result ?? null;
}

export async function getRoom(id: string): Promise<RoomRecord | null> {
  const raw = await command<string>(['GET', ROOM_KEY(id.toUpperCase())]);
  if (!raw) return null;
  try {
    return typeof raw === 'string' ? (JSON.parse(raw) as RoomRecord) : (raw as RoomRecord);
  } catch {
    return null;
  }
}

export async function saveRoom(record: RoomRecord): Promise<void> {
  await command([
    'SET',
    ROOM_KEY(record.id.toUpperCase()),
    JSON.stringify(record),
    'EX',
    TTL_SECONDS,
  ]);
}

export function newRoomCode(): string {
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return code;
}

export function newToken(): string {
  const bytes = new Uint8Array(24);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Public snapshot: strips the server RNG seed, which must not reach clients. */
export function snapshot(state: GameState): PublicGameState {
  return publicState(state);
}

export function newSeed(): number {
  if (globalThis.crypto?.getRandomValues) {
    return globalThis.crypto.getRandomValues(new Uint32Array(1))[0];
  }
  return Math.floor(Math.random() * 0xffffffff);
}
