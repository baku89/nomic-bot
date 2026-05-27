import type { Message } from 'discord.js';
import type { Config } from '../config.js';
import { createLLMProvider } from '../llm/index.js';
import { llmResponseSchema, type Action } from '../llm/actions.js';
import { buildMentionSystemPrompt } from '../llm/prompts.js';
import {
  findGameByChannel,
  judgeForFallback,
  participantById,
  writeGame,
  type Game,
} from '../game/state.js';
import { evaluateJudge, evaluateEligibleVoters } from '../llm/rule-engine.js';
import { postEndConfirmation } from './end-confirmation.js';
import { startGameAndAnnounce } from './game-start.js';
import { buildProposalMessageContent } from './proposal-message.js';
import { VOTE_YES, VOTE_NO, VOTE_ABSTAIN } from './reactions.js';
import { formatDeadlineJST } from '../utils/time.js';
import { postDispute } from './dispute.js';

export async function handleMention(message: Message, config: Config): Promise<void> {
  const existingGame = findGameByChannel(config.gamesDir, message.channelId);
  const llm = createLLMProvider(config);
  const gameContext = existingGame ? await buildGameContext(existingGame, llm) : null;
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
    case 'amend_active_proposal':
      await handleAmendProposal(action, message, ctx.existingGame, config);
      break;
    case 'raise_dispute':
      await handleRaiseDispute(action, message, ctx.existingGame, config);
      break;
  }
}

async function buildGameContext(
  game: Game,
  llm: import('../llm/provider.js').LLMProvider,
): Promise<string> {
  const lines = [
    `ゲーム名: ${game.name}`,
    `ステータス: ${game.frontmatter.status}`,
    `参加者数: ${game.participants.length}`,
    `現在の手番: ${game.frontmatter.current_turn ? `<@${game.frontmatter.current_turn}>` : 'なし'}`,
  ];
  let judgeId: string | null = null;
  try {
    const res = await evaluateJudge(llm, game);
    if (res.player_id && participantById(game, res.player_id)) judgeId = res.player_id;
  } catch {
    /* fallback below */
  }
  if (!judgeId) {
    const fb = judgeForFallback(game);
    if (fb) judgeId = fb.discordId;
  }
  if (judgeId) lines.push(`現在の裁定者: <@${judgeId}>`);
  if (game.frontmatter.active_proposal) {
    const p = game.frontmatter.active_proposal;
    lines.push('進行中の提案:');
    lines.push(`  提案者: <@${p.proposer_id}>`);
    lines.push(`  操作: ${p.op}`);
    lines.push(`  対象ルール番号: ${p.target_rule_number ?? '(新規)'}`);
    lines.push(`  新本文: ${p.new_rule_text ?? '(なし)'}`);
    lines.push(`  解釈: ${p.interpretation}`);
    lines.push(`  原文: ${p.raw_text}`);
  }
  lines.push('');
  lines.push('現在のルール:');
  for (const r of game.rules) lines.push(`- ${r}`);
  return lines.join('\n');
}

async function handleAmendProposal(
  action: Extract<Action, { type: 'amend_active_proposal' }>,
  message: Message,
  existingGame: Game | null,
  config: Config,
): Promise<void> {
  if (!message.channel.isSendable()) return;
  if (!existingGame || !existingGame.frontmatter.active_proposal) {
    await message.channel.send('進行中の提案がありません。');
    return;
  }
  const proposal = existingGame.frontmatter.active_proposal;
  if (message.author.id !== proposal.proposer_id) {
    await message.channel.send(
      `提案の修正は提案者のみが行えます (現在の提案者: <@${proposal.proposer_id}>)。`,
    );
    return;
  }

  const errors: string[] = [];
  if ((action.op === 'modify' || action.op === 'repeal') && action.target_rule_number == null) {
    errors.push('修正/廃止の対象ルール番号が特定できません。');
  }
  if ((action.op === 'enact' || action.op === 'modify') && !action.new_rule_text) {
    errors.push('制定/修正の新本文が空です。');
  }
  if (action.op !== 'enact' && action.target_rule_number !== null) {
    const prefix = `${action.target_rule_number}.`;
    if (!existingGame.rules.some((r) => r.trimStart().startsWith(prefix))) {
      errors.push(`Rule ${action.target_rule_number} は現行ルールに存在しません。`);
    }
  }
  if (errors.length) {
    await message.channel.send(
      ['提案の修正を反映できませんでした:', ...errors.map((e) => `- ${e}`)].join('\n'),
    );
    return;
  }

  proposal.op = action.op;
  proposal.target_rule_number = action.target_rule_number;
  proposal.new_rule_text = action.new_rule_text;
  proposal.interpretation = action.interpretation;

  try {
    const oldMsg = await message.channel.messages.fetch(proposal.vote_message_id);
    await oldMsg.edit(
      `${oldMsg.content}\n\n*— この提案は修正されました。下記の新メッセージに再投票してください —*`,
    );
  } catch {
    // ignore
  }

  const deadlineStr = formatDeadlineJST(new Date(proposal.vote_deadline));
  const llm = createLLMProvider(config);
  let eligibleIds: string[] | null = null;
  try {
    const res = await evaluateEligibleVoters(llm, existingGame, proposal.proposer_id);
    const valid = new Set(existingGame.participants.map((p) => p.discordId));
    eligibleIds = res.eligible_player_ids.filter((id) => valid.has(id));
    if (eligibleIds.length === 0) eligibleIds = null;
  } catch {
    /* fallback below */
  }
  const voterMentions = (eligibleIds
    ? existingGame.participants.filter((p) => eligibleIds!.includes(p.discordId))
    : existingGame.participants.length === 1
      ? existingGame.participants
      : existingGame.participants.filter((p) => p.discordId !== proposal.proposer_id)
  ).map((p) => `<@${p.discordId}>`);

  const newContent = buildProposalMessageContent({
    proposerId: proposal.proposer_id,
    rawText: proposal.raw_text,
    interpretation: proposal.interpretation,
    op: proposal.op,
    targetRuleNumber: proposal.target_rule_number,
    newRuleText: proposal.new_rule_text,
    deadlineStr,
    voterMentions,
    amendedFromOriginal: true,
    amendReason: action.reason,
  });
  const newMsg = await message.channel.send(newContent);
  await newMsg.react(VOTE_YES);
  await newMsg.react(VOTE_NO);
  await newMsg.react(VOTE_ABSTAIN);
  proposal.vote_message_id = newMsg.id;

  writeGame(config.gamesDir, existingGame);
}

async function handleRaiseDispute(
  action: Extract<Action, { type: 'raise_dispute' }>,
  message: Message,
  existingGame: Game | null,
  config: Config,
): Promise<void> {
  if (!message.channel.isSendable()) return;
  if (!existingGame) {
    await message.channel.send('このチャンネルにはゲームがありません。');
    return;
  }
  await postDispute({
    channel: message.channel,
    game: existingGame,
    initiator: { mention: `<@${message.author.id}>` },
    reason: action.reason,
    llm: createLLMProvider(config),
  });
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
