/** Request/response helpers that work both inside Vercel Functions and in the
 *  local Vite dev middleware. */

export interface ApiRequest {
  method: string;
  path: string;
  query: Record<string, string>;
  body: Record<string, unknown>;
  headers: Record<string, string>;
}

function readStream(req: unknown): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    let data = '';
    const stream = req as NodeJS.ReadableStream;
    stream.on('data', (chunk: unknown) => {
      data += String(chunk);
    });
    stream.on('end', () => {
      try {
        resolve(data ? (JSON.parse(data) as Record<string, unknown>) : {});
      } catch {
        resolve({});
      }
    });
    stream.on('error', () => resolve({}));
  });
}

export async function parseRequest(req: unknown): Promise<ApiRequest> {
  const raw = req as {
    method?: string;
    url?: string;
    query?: Record<string, string | string[]>;
    body?: unknown;
    headers?: Record<string, string | string[] | undefined>;
  };
  const url = new URL(raw.url ?? '/', 'http://localhost');
  const query: Record<string, string> = {};
  for (const [key, value] of url.searchParams.entries()) query[key] = value;
  for (const [key, value] of Object.entries(raw.query ?? {})) {
    query[key] = Array.isArray(value) ? String(value[0]) : String(value);
  }

  let body: Record<string, unknown> = {};
  if (raw.body && typeof raw.body === 'object') {
    body = raw.body as Record<string, unknown>;
  } else if (typeof raw.body === 'string' && raw.body.length) {
    try {
      body = JSON.parse(raw.body) as Record<string, unknown>;
    } catch {
      body = {};
    }
  } else if (raw.method && raw.method !== 'GET' && raw.method !== 'HEAD') {
    body = await readStream(req);
  }

  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw.headers ?? {})) {
    headers[key.toLowerCase()] = Array.isArray(value) ? String(value[0]) : String(value ?? '');
  }

  return {
    method: (raw.method ?? 'GET').toUpperCase(),
    path: url.pathname,
    query,
    body,
    headers,
  };
}

export function send(res: unknown, status: number, data: unknown): void {
  const target = res as {
    status?: (code: number) => { json: (body: unknown) => void };
    statusCode?: number;
    setHeader?: (name: string, value: string) => void;
    end?: (body?: string) => void;
  };
  if (typeof target.status === 'function') {
    target.status(status).json(data);
    return;
  }
  const body = JSON.stringify(data);
  if (target.setHeader) {
    target.setHeader('content-type', 'application/json; charset=utf-8');
    target.setHeader('cache-control', 'no-store');
  }
  if (target.statusCode !== undefined) target.statusCode = status;
  target.end?.(body);
}
