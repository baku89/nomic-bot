import 'dotenv/config';
import { loadConfig } from './config.js';
import { createDiscordClient } from './discord/client.js';
import { primeCacheFromLegacy } from './game/channel-cache.js';

const config = loadConfig();
primeCacheFromLegacy(config.gamesDir);
const client = createDiscordClient(config);

await client.login(config.discordBotToken);

const shutdown = async (signal: string) => {
  console.log(`[nomic-bot] ${signal} received, shutting down`);
  await client.destroy();
  process.exit(0);
};

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
