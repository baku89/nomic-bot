import type {
  MessageReaction,
  PartialMessageReaction,
  User,
  PartialUser,
  Message,
} from 'discord.js';
import type { Config } from '../config.js';
import {
  findGameByChannel,
  readGame,
  writeGame,
  advanceTurn,
  endGame,
  judgeFor,
  type Game,
} from '../game/state.js';
import { applyProposal } from '../game/rule-mutations.js';
import { GitGameRepo } from '../git/commit.js';
import { formatDeadlineJST, hoursFromNow } from '../utils/time.js';
import { createLLMProvider } from '../llm/index.js';
import { checkForWinner } from '../llm/win-check.js';
import { checkForContradictions } from '../llm/contradiction-check.js';
import { postEndConfirmation } from './end-confirmation.js';
import { postDispute } from './dispute.js';
import { getGamesRepoUrl, gameFileUrl } from '../game/repo-url.js';

export const VOTE_YES = '✅';
export const VOTE_NO = '❌';
export const VOTE_ABSTAIN = '🤷';
export const VOTE_EMOJIS = [VOTE_YES, VOTE_NO, VOTE_ABSTAIN];

type Vote = 'yes' | 'no' | 'abstain' | 'not_voted';

export async function handleVoteReaction(
  reaction: MessageReaction | PartialMessageReaction,
  user: User | PartialUser,
  config: Config,
): Promise<void> {
  if (user.bot) return;
  if (reaction.partial) {
    try {
      await reaction.fetch();
    } catch {
      return;
    }
  }

  const emoji = reaction.emoji.name;
  if (!emoji || !VOTE_EMOJIS.includes(emoji)) return;

  const channelId = reaction.message.channelId;
  const game = findGameByChannel(config.gamesDir, channelId);
  if (!game) return;
  if (!game.participants.some((p) => p.discordId === user.id)) return;

  if (game.frontmatter.pending_end?.confirm_message_id === reaction.message.id) {
    await tallyEndConfirmation(reaction.message as Message, game, config);
    return;
  }

  if (game.frontmatter.active_proposal?.vote_message_id === reaction.message.id) {
    await tallyAndMaybeFinalize(reaction.message as Message, game, config);
    return;
  }
}

async function tallyAndMaybeFinalize(
  message: Message,
  game: Game,
  config: Config,
): Promise<void> {
  const votes = await collectVotes(message, game);

  const allVoted = Object.values(votes).every((v) => v !== 'not_voted');
  if (!allVoted) {
    return;
  }

  const noCount = Object.values(votes).filter((v) => v === 'no').length;
  const yesCount = Object.values(votes).filter((v) => v === 'yes').length;
  const abstainCount = Object.values(votes).filter((v) => v === 'abstain').length;

  const approved = noCount === 0 && yesCount > 0;
  const proposal = game.frontmatter.active_proposal!;

  let updatedGame = readGame(config.gamesDir, game.fileStem);
  let commitMessage = '';
  let appliedRuleNumber: number | null = null;

  if (approved) {
    try {
      const result = applyProposal(updatedGame, proposal);
      updatedGame = result.game;
      appliedRuleNumber = result.ruleNumber;
      commitMessage = formatCommitMessage(proposal, votes, true, appliedRuleNumber);
    } catch (err) {
      if (message.channel.isSendable()) {
        await message.channel.send(
          `⚠️ 提案を採択しようとしましたがルール変更に失敗しました: ${(err as Error).message}`,
        );
      }
      return;
    }
  } else {
    commitMessage = formatCommitMessage(proposal, votes, false, null);
  }

  advanceTurn(updatedGame);
  writeGame(config.gamesDir, updatedGame);

  const repo = new GitGameRepo(config.gamesDir);
  await repo.ensureRepo();
  await repo.commit(commitMessage);

  if (message.channel.isSendable()) {
    const tallyText = `(${VOTE_YES} 賛成 ${yesCount} / ${VOTE_NO} 反対 ${noCount} / ${VOTE_ABSTAIN} 棄権 ${abstainCount})`;
    const lines: string[] = [];
    if (approved && appliedRuleNumber !== null) {
      const opVerb = proposal.op === 'enact' ? '制定' : proposal.op === 'modify' ? '修正' : '廃止';
      lines.push(`✅ **採択** — ${proposal.interpretation} ${tallyText}`);
      lines.push(`Rule ${appliedRuleNumber} を${opVerb}しました (Rule 106 により即時発効)。`);
    } else {
      lines.push(`❌ **否決** — ${proposal.interpretation} ${tallyText}`);
    }
    const nextPlayerId = updatedGame.frontmatter.current_turn;
    if (nextPlayerId) {
      const nextDeadline = formatDeadlineJST(hoursFromNow(24));
      const judge = judgeFor(updatedGame);
      lines.push('');
      lines.push(
        `<@${nextPlayerId}> さん、あなたの手番です。**24時間以内 (${nextDeadline} まで)** に \`/propose <提案文>\` で提案してください。`,
      );
      if (judge) {
        lines.push(`今手番の裁定者 (Rule 109): <@${judge.discordId}>`);
      }
    }
    await message.channel.send(lines.join('\n'));
  }

  if (approved && message.channel.isSendable()) {
    const llm = createLLMProvider(config);

    try {
      const winCheck = await checkForWinner(llm, updatedGame);
      if (winCheck.game_should_end) {
        await postEndConfirmation({
          channel: message.channel,
          game: updatedGame,
          gamesDir: config.gamesDir,
          initiatedBy: message.client.user!.id,
          winnerMention: winCheck.winner_mention,
          reason: winCheck.reason,
        });
        return;
      }
    } catch (err) {
      console.error('[win-check] error:', err);
    }

    try {
      const contradiction = await checkForContradictions(llm, updatedGame);
      if (contradiction.has_contradiction && contradiction.conflicts.length > 0) {
        const conflictsBlock = contradiction.conflicts
          .map((c) => `- Rule ${c.rule_numbers.join(', ')}: ${c.description}`)
          .join('\n');
        await postDispute({
          channel: message.channel,
          game: updatedGame,
          initiator: 'bot',
          reason: '直近のルール改変により、ルールセットに矛盾が生じている可能性を検出しました。',
          conflictsBlock: `**検出された矛盾**:\n${conflictsBlock}${contradiction.notes ? `\n\n所見: ${contradiction.notes}` : ''}`,
        });
      }
    } catch (err) {
      console.error('[contradiction-check] error:', err);
    }
  }
}

async function tallyEndConfirmation(message: Message, game: Game, config: Config): Promise<void> {
  const yesUsers = await fetchReactors(message, VOTE_YES);
  const noUsers = await fetchReactors(message, VOTE_NO);

  const anyNo = game.participants.some((p) => noUsers.has(p.discordId));
  if (anyNo) {
    const refreshed = readGame(config.gamesDir, game.fileStem);
    refreshed.frontmatter.pending_end = null;
    writeGame(config.gamesDir, refreshed);
    if (message.channel.isSendable()) {
      await message.channel.send('ゲーム終了が棄却されました。続行します。');
    }
    return;
  }

  const allYes = game.participants.every((p) => yesUsers.has(p.discordId));
  if (!allYes) return;

  const refreshed = readGame(config.gamesDir, game.fileStem);
  const pending = refreshed.frontmatter.pending_end;
  if (!pending) return;

  endGame(config.gamesDir, refreshed, {
    winnerMention: pending.winner_mention ?? undefined,
    reason: pending.reason,
  });

  const repo = new GitGameRepo(config.gamesDir);
  await repo.ensureRepo();
  const winnerName = pending.winner_username
    ? `\`@${pending.winner_username}\``
    : pending.winner_id
      ? `\`@${pending.winner_id}\``
      : '';
  const commitMsg = winnerName
    ? `[${refreshed.name}] ゲーム終了 (参加者合意): ${winnerName} の勝利 — ${pending.reason}`
    : `[${refreshed.name}] ゲーム終了 (参加者合意): ${pending.reason}`;
  await repo.commit(commitMsg);

  if (message.channel.isSendable()) {
    const repoUrl = await getGamesRepoUrl(config.gamesDir);
    const url = repoUrl ? gameFileUrl(repoUrl, refreshed.fileStem, true) : null;
    const lines = [
      `🏁 **ゲーム「${refreshed.name}」が終了しました。** (参加者全員合意)`,
      pending.winner_mention ? `🏆 勝者: ${pending.winner_mention}` : '勝者: なし',
      `理由: ${pending.reason}`,
      `最終ルール数: ${refreshed.rules.length} 条`,
    ];
    if (url) lines.push(`📄 アーカイブ: <${url}>`);
    await message.channel.send(lines.join('\n'));
  }
}

async function collectVotes(
  message: Message,
  game: Game,
): Promise<Record<string, Vote>> {
  const yesUsers = await fetchReactors(message, VOTE_YES);
  const noUsers = await fetchReactors(message, VOTE_NO);
  const abstainUsers = await fetchReactors(message, VOTE_ABSTAIN);

  const result: Record<string, Vote> = {};
  for (const p of game.participants) {
    if (noUsers.has(p.discordId)) result[p.discordId] = 'no';
    else if (yesUsers.has(p.discordId)) result[p.discordId] = 'yes';
    else if (abstainUsers.has(p.discordId)) result[p.discordId] = 'abstain';
    else result[p.discordId] = 'not_voted';
  }
  return result;
}

async function fetchReactors(message: Message, emoji: string): Promise<Set<string>> {
  const reaction = message.reactions.cache.find((r) => r.emoji.name === emoji);
  if (!reaction) return new Set();
  const users = await reaction.users.fetch();
  return new Set(users.filter((u) => !u.bot).map((u) => u.id));
}

function formatCommitMessage(
  proposal: { interpretation: string; raw_text: string; op: string; target_rule_number: number | null; proposer_id: string; proposer_username: string },
  votes: Record<string, Vote>,
  approved: boolean,
  appliedRuleNumber: number | null,
): string {
  const yes = Object.values(votes).filter((v) => v === 'yes').length;
  const no = Object.values(votes).filter((v) => v === 'no').length;
  const abs = Object.values(votes).filter((v) => v === 'abstain').length;
  const verb = approved ? '採択' : '否決';
  const opLabel = proposal.op === 'enact' ? '制定' : proposal.op === 'modify' ? '修正' : '廃止';
  const ruleNum = appliedRuleNumber ?? proposal.target_rule_number;
  const rulePart = ruleNum !== null ? ` Rule ${ruleNum}` : '';
  const proposer = `\`@${proposal.proposer_username || proposal.proposer_id}\``;
  return [
    `提案 ${verb} by ${proposer}: ${proposal.interpretation}`,
    '',
    `操作: ${opLabel}${rulePart}`,
    `投票: ✅ 賛成 ${yes} / ❌ 反対 ${no} / 🤷 棄権 ${abs}`,
    '',
    `原文: ${proposal.raw_text}`,
  ].join('\n');
}
