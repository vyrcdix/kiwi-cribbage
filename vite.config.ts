import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// Dev: vite serves the SPA and proxies /api + /ws to the node server.
// Prod: Caddy serves dist/ and reverse-proxies the same two paths (see ops/).
//   CABBAGE_API_PORT — backend port (server default 8521)
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  const apiPort = Number(env.CABBAGE_API_PORT ?? 8521);
  const proxy = {
    '/api': { target: `http://127.0.0.1:${apiPort}`, changeOrigin: true },
    '/ws': { target: `ws://127.0.0.1:${apiPort}`, ws: true },
  };
  return {
    plugins: [react()],
    // host: true so a phone on the same wifi can join a dev game.
    server: { host: true, proxy },
    preview: { host: true, proxy },
  };
});
