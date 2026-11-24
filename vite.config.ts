import { defineConfig, loadEnv, type Plugin } from 'vite';

/**
 * Mounts the Vercel Functions in `api/` inside the Vite dev server, so
 * `npm run dev` gives you the real room API (Upstash if configured, otherwise
 * the in-memory store) without any external service. On Vercel the same files
 * are compiled as serverless functions.
 *
 * The functions read `process.env`, which Vite does not populate from `.env`
 * on its own, so the dev server copies the project env in once. Deployments
 * ignore `.env` entirely — those values must exist in Vercel's project
 * environment variables.
 */
function devApi(env: Record<string, string>): Plugin {
  return {
    name: 'dice-chess-dev-api',
    apply: 'serve',
    configureServer(server) {
      for (const [key, value] of Object.entries(env)) {
        if (!(key in process.env)) process.env[key] = value;
      }
      server.middlewares.use('/api', async (req, res, next) => {
        const name = (req.url ?? '/').split('?')[0].replace(/^\/+|\/+$/g, '');
        if (!/^[a-z0-9-]+$/.test(name)) {
          next();
          return;
        }
        try {
          const module = (await server.ssrLoadModule(`/api/${name}.ts`)) as {
            default?: (request: unknown, response: unknown) => unknown;
          };
          if (typeof module.default !== 'function') {
            next();
            return;
          }
          await module.default(req, res);
        } catch (error) {
          console.error(`[dev api] ${name}`, error);
          if (!res.headersSent) {
            res.statusCode = 500;
            res.setHeader('content-type', 'application/json');
            res.end(
              JSON.stringify({
                ok: false,
                error: `Dev API failed: ${(error as Error).message}`,
              }),
            );
          }
        }
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [devApi(env)],
    server: { host: '127.0.0.1', port: 5173, strictPort: false },
    build: { target: 'es2022', chunkSizeWarningLimit: 1600 },
  };
});
