import { Client, GatewayIntentBits, Events, Partials } from 'discord.js';
import type { Config } from '../config.js';
import { handleMention } from './mention-handler.js';
import { handleInteraction } from './commands/index.js';
import { reportHandlerError } from './error-handler.js';
import { handleVoteReaction } from './reactions.js';

export function createDiscordClient(config: Config): Client {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.GuildMessageReactions,
    ],
    partials: [Partials.Message, Partials.Channel, Partials.Reaction],
  });

  client.once(Events.ClientReady, (c) => {
    console.log(`[nomic-bot] Logged in as ${c.user.tag} (id: ${c.user.id})`);
  });

  client.on(Events.MessageCreate, async (message) => {
    const mentionsBot = client.user ? message.mentions.has(client.user.id) : false;
    const channelName = 'name' in message.channel ? message.channel.name : message.channelId;
    console.log(
      `[debug] msg from=${message.author.username}(${message.author.id}) bot=${message.author.bot} mentions_bot=${mentionsBot} channel=#${channelName} content=${JSON.stringify(message.content.slice(0, 100))}`,
    );

    if (message.author.bot) return;
    if (!mentionsBot) return;

    console.log(
      `[mention] received from ${message.author.username} (${message.author.id}) in #${channelName}`,
    );

    try {
      await handleMention(message, config);
    } catch (err) {
      console.error('[mention-handler] error:', err);
      await reportHandlerError(err, message, config);
    }
  });

  const onReaction = async (reaction: Parameters<typeof handleVoteReaction>[0], user: Parameters<typeof handleVoteReaction>[1]) => {
    try {
      await handleVoteReaction(reaction, user, config);
    } catch (err) {
      console.error('[reaction-handler] error:', err);
    }
  };
  client.on(Events.MessageReactionAdd, onReaction);
  client.on(Events.MessageReactionRemove, onReaction);

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
