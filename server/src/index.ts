import { createApp } from './app.js';
import { dbPath } from './db.js';

const PORT = Number(process.env.PORT ?? 8521);
const HOST = process.env.HOST ?? '127.0.0.1';

const server = createApp({ dbPath: dbPath() });

server.listen(PORT, HOST, () => {
  console.log(`[cabbage] listening on http://${HOST}:${PORT}`);
});

const stop = (signal: string) => {
  console.log(`[cabbage] ${signal}, shutting down`);
  void server.shutdown().then(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
};
process.on('SIGINT', () => stop('SIGINT'));
process.on('SIGTERM', () => stop('SIGTERM'));
