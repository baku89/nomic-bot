import { Client, GatewayIntentBits, Events } from 'discord.js';
import type { Config } from '../config.js';
import { handleMention } from './mention-handler.js';
import { handleInteraction } from './commands/index.js';

export function createDiscordClient(config: Config): Client {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });

  client.once(Events.ClientReady, (c) => {
    console.log(`[nomic-bot] Logged in as ${c.user.tag}`);
  });

  client.on(Events.MessageCreate, async (message) => {
    if (message.author.bot) return;
    if (!client.user || !message.mentions.has(client.user.id)) return;
    try {
      await handleMention(message, config);
    } catch (err) {
      console.error('[mention-handler] error:', err);
    }
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    try {
      await handleInteraction(interaction, config);
    } catch (err) {
      console.error('[interaction-handler] error:', err);
      if (interaction.replied || interaction.deferred) return;
      await interaction.reply({ content: 'エラーが発生しました', ephemeral: true });
    }
  });

  return client;
}
