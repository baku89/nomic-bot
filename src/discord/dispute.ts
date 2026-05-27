import type { SendableChannels } from 'discord.js';
import { judgeFor, type Game } from '../game/state.js';

export async function postDispute(opts: {
  channel: SendableChannels;
  game: Game;
  initiator: 'bot' | { mention: string };
  reason: string;
  conflictsBlock?: string;
}): Promise<void> {
  const judge = judgeFor(opts.game);
  const initiatorLabel =
    opts.initiator === 'bot' ? '**🤖 Bot 自動検出**' : `by ${opts.initiator.mention}`;
  const lines = [`🚨 **異議申し立て** ${initiatorLabel}`, `> ${opts.reason}`, ''];
  if (opts.conflictsBlock) {
    lines.push(opts.conflictsBlock);
    lines.push('');
  }
  if (judge) {
    lines.push(`<@${judge.discordId}> さん、Rule 109 に基づき裁定をお願いします。`);
    lines.push('裁定者の判断は、裁定者を除く全プレイヤーの一致でのみ覆すことができます。');
  } else {
    lines.push('裁定者を特定できませんでした (参加者が不足)。');
  }
  await opts.channel.send(lines.join('\n'));
}
