import type { Client } from 'discord.js';
import type { Config } from '../config.js';
import { listChannelMappings } from '../game/channel-cache.js';
import { readGame } from '../game/state.js';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tallyFromIds } from './reactions.js';

function logSchedulerError(tag: string, err: unknown): void {
  if (err instanceof Error) {
    console.error(`${tag} error: ${err.message}`);
    if (err.stack) console.error(err.stack);
  } else {
    console.error(`${tag} error:`, err);
  }
}

const SETTIMEOUT_MAX = 2_147_483_647;

const timers = new Map<string, NodeJS.Timeout>();

export function cancelVoteTally(voteMessageId: string): void {
  const t = timers.get(voteMessageId);
  if (t) {
    clearTimeout(t);
    timers.delete(voteMessageId);
  }
}

export function scheduleVoteTally(
  client: Client,
  config: Config,
  channelId: string,
  voteMessageId: string,
  voteDeadlineRaw: string,
): void {
  cancelVoteTally(voteMessageId);
  if (!voteMessageId) return;
  const d = new Date(voteDeadlineRaw);
  if (isNaN(d.getTime())) {
    console.log(
      `[vote-scheduler] skip (condition deadline): channel=${channelId} msg=${voteMessageId} cond=${voteDeadlineRaw}`,
    );
    return;
  }
  const delay = Math.min(Math.max(d.getTime() - Date.now(), 0), SETTIMEOUT_MAX);
  console.log(
    `[vote-scheduler] schedule: channel=${channelId} msg=${voteMessageId} deadline=${d.toISOString()} delay=${delay}ms`,
  );
  const handle = setTimeout(() => {
    timers.delete(voteMessageId);
    console.log(`[vote-scheduler] firing: channel=${channelId} msg=${voteMessageId}`);
    tallyFromIds(client, config, channelId, voteMessageId, { force: true }).catch((err) =>
      logSchedulerError('[vote-scheduler]', err),
    );
  }, delay);
  timers.set(voteMessageId, handle);
}

export async function rescheduleAllPending(client: Client, config: Config): Promise<void> {
  let scheduled = 0;
  for (const { channelId, fileStem } of listChannelMappings()) {
    if (!existsSync(join(config.gamesDir, `${fileStem}.md`))) continue;
    try {
      const game = readGame(config.gamesDir, fileStem);
      const proposal = game.frontmatter.active_proposal;
      if (!proposal || !proposal.vote_message_id) continue;
      scheduleVoteTally(client, config, channelId, proposal.vote_message_id, proposal.vote_deadline);
      scheduled += 1;
    } catch (err) {
      logSchedulerError(`[vote-scheduler] failed to reschedule ${fileStem}`, err);
    }
  }
  console.log(`[vote-scheduler] startup reschedule: ${scheduled} pending proposal(s)`);
}
