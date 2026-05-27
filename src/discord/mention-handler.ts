import type { Message } from 'discord.js';
import type { Config } from '../config.js';
import { createLLMProvider } from '../llm/index.js';
import { llmResponseSchema, type Action } from '../llm/actions.js';
import { buildMentionSystemPrompt } from '../llm/prompts.js';
import {
  createNewGame,
  gameExists,
  writeGame,
  findGameByChannel,
  type Game,
  type Participant,
} from '../game/state.js';
import { GitGameRepo } from '../git/commit.js';
import { formatDeadlineJST, hoursFromNow } from '../utils/time.js';

export async function handleMention(message: Message, config: Config): Promise<void> {
  if (!config.allowlist.includes(message.author.id)) {
    console.log(`[mention] ignored from non-allowlisted user ${message.author.id} (${message.author.username})`);
    return;
  }

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

  console.log(`[mention] from ${message.author.username}: ${result.actions.length} action(s)`, result.actions.map(a => a.type));

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
        await message.channel.send(buildHelpMessage(ctx.existingGame, action.reason, config.botDisplayName));
      }
      break;
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
      '`/status` で現在の状態、`/rules` でルール一覧を確認できます。',
    ].join('\n');
  }
  return [
    'こんにちは。このチャンネルではまだゲームが始まっていません。',
    'ゲームを始めるには、私にメンションしつつ、**参加者をメンション**して**ゲーム名**を含めて以下のように伝えてください:',
    '',
    `> @${botDisplayName} <@参加者1> <@参加者2> 「myname」というゲームを始めましょう。`,
    '',
    '※ ゲーム開始は allowlist に登録されたアカウントのみが実行できます。',
  ].join('\n');
}

async function handleStartGame(
  action: Extract<Action, { type: 'start_game' }>,
  message: Message,
  config: Config,
): Promise<void> {
  if (gameExists(config.gamesDir, action.name)) {
    await message.reply(
      `ゲーム名「${action.name}」は既に存在します。別の名前を指定してください。`,
    );
    return;
  }

  const existingInChannel = findGameByChannel(config.gamesDir, message.channelId);
  if (existingInChannel) {
    await message.reply(
      `このチャンネルでは既にゲーム「${existingInChannel.name}」が進行中です。1チャンネル1ゲームの制限があります。`,
    );
    return;
  }

  const participants: Participant[] = action.participantMentions.map((mention) => {
    const idMatch = /<@!?(\d+)>/.exec(mention);
    return { mention, discordId: idMatch ? idMatch[1] : '' };
  });

  const game = createNewGame({
    name: action.name,
    channelId: message.channelId,
    guildId: message.guildId ?? '',
    participants,
  });

  writeGame(config.gamesDir, game);

  const repo = new GitGameRepo(config.gamesDir);
  await repo.ensureRepo();
  await repo.commit(
    `新規ゲーム ${game.name} 開始 by <@${message.author.id}> (参加者: ${participants
      .map((p) => p.mention)
      .join(', ')})`,
  );

  const firstPlayer = participants[0]?.mention ?? '(参加者未指定)';
  const proposalDeadline = formatDeadlineJST(hoursFromNow(24));

  if (message.channel.isSendable()) {
    await message.channel.send(buildOpeningAnnouncement({
      gameName: game.name,
      participants: participants.map((p) => p.mention),
      firstPlayer,
      proposalDeadline,
    }));
  }
}

function buildOpeningAnnouncement(opts: {
  gameName: string;
  participants: string[];
  firstPlayer: string;
  proposalDeadline: string;
}): string {
  return [
    `**ゲーム「${opts.gameName}」を開始しました。** (ミニマムノミック / 全 9 条)`,
    '',
    'ノミックは「ルールを変えていくゲーム」です。プレイヤーは順番にルール改変を提案し、**全員一致**で採択されます。採択されたルールは即座に発効するため、ゲームのあり方そのものが変わっていきます。勝利条件すら最初は定められていません — それも今後の議論で決まります。',
    '',
    '**初期条件**',
    `- 参加者 (この順で手番): ${opts.participants.join(' → ')}`,
    `- 最初の手番: ${opts.firstPlayer}`,
    '- 採択要件: 全員一致 (Rule 105)',
    '- 矛盾解決: 番号の小さいルールを優先 (Rule 108)',
    '- 裁定者: 手番プレイヤーの直後 (Rule 109)',
    '- 勝利条件: 未定 (ルール改変で設定可能)',
    '',
    '全 9 条は `/rules`、現在の状態は `/status` で確認できます。',
    '',
    `${opts.firstPlayer} さん、あなたの手番です。**24時間以内 (${opts.proposalDeadline} まで)** に \`/propose <提案文>\` で提案してください。`,
  ].join('\n');
}
