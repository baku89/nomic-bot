import type { SendableChannels } from 'discord.js';
import { judgeForFallback, participantById, type Game } from '../game/state.js';
import type { LLMProvider } from '../llm/provider.js';
import { evaluateJudge } from '../llm/rule-engine.js';

export async function postDispute(opts: {
  channel: SendableChannels;
  game: Game;
  initiator: 'bot' | { mention: string };
  reason: string;
  conflictsBlock?: string;
  llm: LLMProvider;
}): Promise<void> {
  let judgeMention: string | null = null;
  let judgeReason = '';
  try {
    const res = await evaluateJudge(opts.llm, opts.game);
    if (res.player_id && participantById(opts.game, res.player_id)) {
      judgeMention = `<@${res.player_id}>`;
      judgeReason = res.reason;
    }
  } catch (err) {
    console.error('[rule-engine] evaluateJudge failed, falling back:', err);
  }
  if (!judgeMention) {
    const fb = judgeForFallback(opts.game);
    if (fb) {
      judgeMention = `<@${fb.discordId}>`;
      judgeReason = 'fallback (LLM failed): リスト順で手番プレイヤーの直後';
    }
  }
  const initiatorLabel =
    opts.initiator === 'bot' ? '**🤖 Bot 自動検出**' : `by ${opts.initiator.mention}`;
  const lines = [`🚨 **異議申し立て** ${initiatorLabel}`, `> ${opts.reason}`, ''];
  if (opts.conflictsBlock) {
    lines.push(opts.conflictsBlock);
    lines.push('');
  }
  if (judgeMention) {
    lines.push(`${judgeMention} さん、現行ルールに基づき裁定をお願いします。`);
    if (judgeReason) lines.push(`(裁定者の根拠: ${judgeReason})`);
    lines.push('裁定者の判断は、裁定者を除く全プレイヤーの一致でのみ覆すことができます (初期 Rule 109)。');
  } else {
    lines.push('裁定者を特定できませんでした (参加者が不足、またはルールが裁定制度を撤廃)。');
  }
  await opts.channel.send(lines.join('\n'));
}
