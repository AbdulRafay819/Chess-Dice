import type { Color, PublicGameState } from '../shared/types';

export interface RoomSession {
  room: string;
  token: string;
  color: Color;
}

interface StateResponse {
  ok: boolean;
  changed: boolean;
  color: Color | null;
  players: Color[];
  state: PublicGameState | null;
}

const storageKey = (room: string) => `dicechess:token:${room}`;
export const LAST_ROOM_KEY = 'dicechess:room';

/**
 * Stable per-browser id for the realtime connection. Ably treats two
 * connections with the same client id as one client and closes the older one,
 * so each player needs their own.
 */
function clientIdFor(room: string): string {
  const key = 'dicechess:client';
  let suffix = '';
  try {
    suffix = localStorage.getItem(key) ?? '';
  } catch {
    /* private mode */
  }
  if (!suffix) {
    suffix = Math.random().toString(36).slice(2, 10);
    try {
      localStorage.setItem(key, suffix);
    } catch {
      /* private mode */
    }
  }
  return `p-${room}-${suffix}`.replace(/[^A-Za-z0-9_-]/g, '');
}

async function request<T>(path: string, body?: unknown, method = 'POST'): Promise<T> {
  const response = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = (await response.json().catch(() => ({}))) as T & { ok?: boolean; error?: string };
  if (!response.ok || data.ok === false) {
    throw new Error(data.error || `Request failed (${response.status})`);
  }
  return data;
}

/**
 * Talks to the serverless room API. State arrives either over Ably (when the
 * server has a key) or by polling; both call the same onState callback, so the
 * game behaves identically either way.
 */
export class Net {
  session: RoomSession | null = null;
  onState: (state: PublicGameState) => void = () => {};
  onStatus: (status: 'offline' | 'polling' | 'realtime' | 'error', detail?: string) => void =
    () => {};
  onPresence: (players: Color[]) => void = () => {};

  lastState: PublicGameState | null = null;

  private pollTimer: number | null = null;
  private version = -1;
  private realtime: { close: () => void } | null = null;
  private polling = false;
  private started = false;
  private transport: 'polling' | 'realtime' = 'polling';

  get hasSession() {
    return this.session !== null;
  }

  private persistToken(room: string, token: string) {
    try {
      localStorage.setItem(storageKey(room), token);
      localStorage.setItem(LAST_ROOM_KEY, room);
    } catch {
      /* private mode */
    }
  }

  storedToken(room: string): string {
    try {
      return localStorage.getItem(storageKey(room)) ?? '';
    } catch {
      return '';
    }
  }

  async createRoom(): Promise<RoomSession> {
    const data = await request<{ room: string; token: string; color: Color; state: PublicGameState }>(
      '/api/room',
      {},
    );
    this.persistToken(data.room, data.token);
    this.session = { room: data.room, token: data.token, color: data.color };
    this.version = data.state.version;
    this.lastState = data.state;
    this.onState(data.state);
    this.startSync();
    return this.session;
  }

  async joinRoom(code: string): Promise<RoomSession> {
    const room = code.trim().toUpperCase();
    const token = this.storedToken(room);
    const data = await request<{
      room: string;
      token: string;
      color: Color;
      state: PublicGameState;
    }>('/api/join', { room, token });
    this.persistToken(data.room, data.token);
    this.session = { room: data.room, token: data.token, color: data.color };
    this.version = data.state.version;
    this.lastState = data.state;
    this.onState(data.state);
    this.startSync();
    return this.session;
  }

  private async call(path: string, body: Record<string, unknown>) {
    if (!this.session) throw new Error('Join a room first.');
    return request<{ state: PublicGameState; [key: string]: unknown }>(path, {
      ...body,
      room: this.session.room,
      token: this.session.token,
    });
  }

  async roll() {
    return this.call('/api/roll', {});
  }

  async choose(choice: 'move' | 'snipe') {
    return this.call('/api/choice', { choice });
  }

  async move(from: string, to: string) {
    return this.call('/api/move', { from, to });
  }

  async snipe(from: string, angle: number, power: number) {
    return this.call('/api/snipe', { from, angle, power });
  }

  /** Fetch once; used on resume and as a safety net. */
  async fetchState(): Promise<StateResponse> {
    if (!this.session) throw new Error('No room');
    const url = `/api/state?room=${encodeURIComponent(this.session.room)}&token=${encodeURIComponent(
      this.session.token,
    )}&since=${this.version}`;
    return request<StateResponse>(url);
  }

  private async refresh() {
    if (!this.session || this.polling) return;
    this.polling = true;
    try {
      const data = await this.fetchState();
      this.onPresence(data.players ?? []);
      if (data.changed && data.state) {
        this.version = data.state.version;
        this.lastState = data.state;
        this.onState(data.state);
      }
      this.onStatus(this.transport);
    } catch {
      this.onStatus('error', 'Connection lost — retrying.');
    } finally {
      this.polling = false;
    }
  }

  private startPolling() {
    if (this.pollTimer !== null) return;
    this.transport = 'polling';
    this.onStatus('polling');
    this.pollTimer = window.setInterval(() => void this.refresh(), 1200);
  }

  private async startRealtime() {
    if (!this.session) return;
    const room = this.session.room;
    try {
      const config = await request<{ realtime: boolean }>('/api/config', undefined, 'GET');
      if (!config.realtime) {
        this.startPolling();
        return;
      }
      // Ably's account-level MAU pricing rejects the legacy `ably` package from
      // devices with error 40168; the device SDK (createClient) is the supported
      // browser client and sends the clientId the connection requires.
      const { createClient } = await import('@ably/pubsub-device');
      const clientId = clientIdFor(room);
      const client = createClient({
        authUrl: `/api/realtime?room=${encodeURIComponent(room)}&clientId=${encodeURIComponent(
          clientId,
        )}`,
        authMethod: 'POST',
        clientId,
        echoMessages: false,
      });
      const channel = client.channels.get(`room-${room}`);
      channel.subscribe('state', (message) => {
        const payload = message.data as PublicGameState | undefined;
        if (!payload) return;
        this.version = payload.version ?? this.version;
        this.lastState = payload;
        this.onState(payload);
      });
      client.connection.on('connected', () => {
        this.transport = 'realtime';
        this.onStatus('realtime');
        void this.refresh();
      });
      client.connection.on('failed', () => {
        this.startPolling();
      });
      client.connection.on('suspended', () => {
        this.onStatus('polling', 'Realtime paused — polling for updates.');
      });
      this.realtime = client as unknown as { close: () => void };
      // Polling stays on in the background as the documented fallback.
      this.pollTimer = window.setInterval(() => void this.refresh(), 4000);
    } catch {
      this.startPolling();
    }
  }

  startSync() {
    if (this.started) {
      void this.refresh();
      return;
    }
    this.started = true;
    // Ask for pushes, but never depends on them: a slow poll runs regardless.
    void this.startRealtime();
    if (this.pollTimer === null) this.startPolling();
    window.setInterval(() => {
      if (document.visibilityState === 'visible') void this.refresh();
    }, 2500);
  }

  stop() {
    if (this.pollTimer !== null) window.clearInterval(this.pollTimer);
    this.pollTimer = null;
    this.realtime?.close();
    this.realtime = null;
    this.started = false;
  }

  async probe(): Promise<{ realtime: boolean; redis: boolean } | null> {
    try {
      return await request<{ realtime: boolean; redis: boolean }>('/api/config', undefined, 'GET');
    } catch {
      return null;
    }
  }
}
