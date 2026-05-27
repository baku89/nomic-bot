import type { Message } from 'discord.js';
import type { Config } from '../config.js';
import { createLLMProvider } from '../llm/index.js';
import { llmResponseSchema, type Action } from '../llm/actions.js';
import { buildMentionSystemPrompt } from '../llm/prompts.js';
import { findGameByChannel, type Game } from '../game/state.js';
import { postEndConfirmation } from './end-confirmation.js';
import { startGameAndAnnounce } from './game-start.js';

export async function handleMention(message: Message, config: Config): Promise<void> {
  const existingGame = findGameByChannel(config.gamesDir, message.channelId);
  const gameContext = existingGame
    ? `ゲーム名: ${existingGame.name}\nステータス: ${existingGame.frontmatter.status}\n参加者数: ${existingGame.participants.length}`
    : null;

  const llm = createLLMProvider(config);
  const result = await llm.generate({
    systemPrompt: buildMentionSystemPrompt({
      botDisplayName: config.botDisplayName,
      gameContext,
    }),
    userMessage: message.content,
    schema: llmResponseSchema,
  });

  console.log(
    `[mention] from ${message.author.username}: ${result.actions.length} action(s)`,
    result.actions.map((a) => a.type),
  );

  for (const action of result.actions) {
    await executeAction(action, message, config, { existingGame });
  }
}

async function executeAction(
  action: Action,
  message: Message,
  config: Config,
  ctx: { existingGame: Game | null },
): Promise<void> {
  switch (action.type) {
    case 'start_game':
      await handleStartGame(action, message, config);
      break;
    case 'post_message':
      if (message.channel.isSendable()) {
        await message.channel.send(action.content);
      }
      break;
    case 'mention_player':
      if (message.channel.isSendable()) {
        await message.channel.send(`<@${action.discordId}> ${action.reason}`);
      }
      break;
    case 'noop':
      if (message.channel.isSendable()) {
        await message.channel.send(
          buildHelpMessage(ctx.existingGame, action.reason, config.botDisplayName),
        );
      }
      break;
    case 'propose_game_end':
      if (ctx.existingGame && message.channel.isSendable()) {
        await postEndConfirmation({
          channel: message.channel,
          game: ctx.existingGame,
          gamesDir: config.gamesDir,
          initiatedBy: message.author.id,
          winnerMention: action.winner_mention,
          reason: action.reason,
        });
      } else if (message.channel.isSendable()) {
        await message.channel.send('このチャンネルにはアクティブなゲームがありません。');
      }
      break;
  }
}

async function handleStartGame(
  action: Extract<Action, { type: 'start_game' }>,
  message: Message,
  config: Config,
): Promise<void> {
  if (!message.channel.isSendable()) return;
  const result = await startGameAndAnnounce({
    channel: message.channel,
    name: action.name,
    participantMentions: action.participantMentions,
    starterUserId: message.author.id,
    botUserId: message.client.user?.id ?? '',
    config,
  });
  if (!result.ok) {
    await message.reply(result.error);
  }
}

function buildHelpMessage(
  existingGame: Game | null,
  reason: string,
  botDisplayName: string,
): string {
  if (existingGame) {
    return [
      `指示として解釈できませんでした。(理由: ${reason})`,
      `現在このチャンネルではゲーム「${existingGame.name}」が進行中です。`,
      '`/status` で現在の状態とルール一覧を確認できます。',
    ].join('\n');
  }
  return [
    'こんにちは。このチャンネルではまだゲームが始まっていません。',
    'ゲームを始めるには、私にメンションしつつ、**参加者をメンション**して**ゲーム名**を含めて以下のように伝えてください:',
    '',
    `> @${botDisplayName} <@参加者1> <@参加者2> 「myname」というゲームを始めましょう。`,
    '',
    'または \`/start name:<名前> players:@参加者...\` でも開始できます。',
  ].join('\n');
}
