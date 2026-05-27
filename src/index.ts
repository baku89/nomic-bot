import 'dotenv/config';
import { loadConfig } from './config.js';
import { createDiscordClient, logError } from './discord/client.js';
import { primeCacheFromLegacy } from './game/channel-cache.js';

process.on('unhandledRejection', (reason) => {
  logError('[unhandledRejection]', reason);
});
process.on('uncaughtException', (err) => {
  logError('[uncaughtException]', err);
});

const config = loadConfig();
primeCacheFromLegacy(config.gamesDir);
const client = createDiscordClient(config);

client.on('error', (err) => logError('[discord-client]', err));

await client.login(config.discordBotToken);

const shutdown = async (signal: string) => {
  console.log(`[nomic-bot] ${signal} received, shutting down`);
  await client.destroy();
  process.exit(0);
};

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
