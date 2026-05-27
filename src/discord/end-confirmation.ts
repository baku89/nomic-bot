import type { Message, SendableChannels } from 'discord.js';
import { writeGame, type Game } from '../game/state.js';
import { VOTE_YES, VOTE_NO } from './reactions.js';

export async function postEndConfirmation(opts: {
  channel: SendableChannels;
  game: Game;
  gamesDir: string;
  initiatedBy: string;
  reason: string;
}): Promise<void> {
  if (opts.game.frontmatter.pending_end) {
    await opts.channel.send('既に終了確認が進行中です。');
    return;
  }

  const lines = [
    '🏁 **ゲーム終了の確認**',
    '',
    `理由: ${opts.reason}`,
    '',
    `参加者全員が ${VOTE_YES} で同意すれば終了します。誰か一人でも ${VOTE_NO} を付ければ続行します。`,
    `(発議者: <@${opts.initiatedBy}>)`,
  ];

  const sent = (await opts.channel.send(lines.join('\n'))) as Message;
  await sent.react(VOTE_YES);
  await sent.react(VOTE_NO);

  const initiatorUsername =
    opts.game.participants.find((p) => p.discordId === opts.initiatedBy)?.username ?? '';
  opts.game.frontmatter.pending_end = {
    initiated_by: opts.initiatedBy,
    initiated_by_username: initiatorUsername,
    reason: opts.reason,
    confirm_message_id: sent.id,
    initiated_at: new Date().toISOString(),
  };
  writeGame(opts.gamesDir, opts.game);
}
