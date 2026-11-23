import { defineConfig, type Plugin } from 'vite';

/**
 * Mounts the Vercel Functions in `api/` inside the Vite dev server, so
 * `npm run dev` gives you the real room API (in-memory store, polling
 * transport) without any external service. On Vercel the same files are
 * compiled as serverless functions.
 */
function devApi(): Plugin {
  return {
    name: 'dice-chess-dev-api',
    apply: 'serve',
    configureServer(server) {
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

export default defineConfig({
  plugins: [devApi()],
  server: { host: '127.0.0.1', port: 5173, strictPort: false },
  build: { target: 'es2022', chunkSizeWarningLimit: 1600 },
});
