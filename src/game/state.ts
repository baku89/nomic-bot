import {
  readFileSync,
  writeFileSync,
  readdirSync,
  existsSync,
  mkdirSync,
  unlinkSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import {
  parseGameFile,
  serializeGameFile,
  type GameFrontmatter,
} from './frontmatter.js';
import { getInitialRules } from '../initial-rules.js';
import { getGameByChannel, clearGameFromCache } from './channel-cache.js';
import {
  getParticipantsCache,
  setParticipantsCache,
  getRuntimeIds,
  setRuntimeIds,
  clearGameCache,
  resolveDiscordId,
  resolveUsername,
  type CachedParticipant,
} from './participants-cache.js';

export type Participant = {
  discordId: string;
  username: string;
};

export type Game = {
  name: string;       // user-facing short name (e.g., "myname")
  fileStem: string;   // file stem on disk (e.g., "2026-05-27-myname"); always used for I/O
  frontmatter: GameFrontmatter;
  participants: Participant[];
  rules: string[];
};

export function mentionOf(p: Participant): string {
  return `<@${p.discordId}>`;
}

export function displayOf(p: Participant): string {
  return p.username ? `@${p.username}` : `<@${p.discordId}>`;
}

function gamePath(gamesDir: string, fileStem: string): string {
  return join(gamesDir, `${fileStem}.md`);
}

function extractShortName(fileStem: string): string {
  const m = /^\d{4}-\d{2}-\d{2}-(.+)$/.exec(fileStem);
  return m ? m[1] : fileStem;
}

export function gameNameTaken(gamesDir: string, name: string): boolean {
  if (!existsSync(gamesDir)) return false;
  return readdirSync(gamesDir).some(
    (f) => f === `${name}.md` || f.endsWith(`-${name}.md`),
  );
}

export function listActiveStems(gamesDir: string): string[] {
  if (!existsSync(gamesDir)) return [];
  return readdirSync(gamesDir)
    .filter((f) => f.endsWith('.md') && f !== 'README.md')
    .map((f) => f.replace(/\.md$/, ''));
}

export function readGame(gamesDir: string, fileStem: string): Game {
  const path = gamePath(gamesDir, fileStem);
  const content = readFileSync(path, 'utf-8');
  const { frontmatter, body } = parseGameFile(content);
  const bodyParts = parseBody(body);

  // Merge cached participants (which have discordId) with body's usernames
  const cached = getParticipantsCache(fileStem);
  const participants = enrichParticipants(bodyParts.participants, cached);

  // Resolve IDs in frontmatter from usernames if needed
  const enrichedFrontmatter = resolveFrontmatterIds(frontmatter, participants, fileStem);

  return {
    name: extractShortName(fileStem),
    fileStem,
    frontmatter: enrichedFrontmatter,
    participants,
    rules: bodyParts.rules,
  };
}

export function writeGame(gamesDir: string, game: Game): void {
  // Persist participants cache (full username + discordId)
  setParticipantsCache(
    game.fileStem,
    game.participants.map((p) => ({ username: p.username, discordId: p.discordId })),
  );

  // Persist message IDs to cache (not to disk frontmatter)
  setRuntimeIds(game.fileStem, {
    vote_message_id: game.frontmatter.active_proposal?.vote_message_id ?? null,
    confirm_message_id: game.frontmatter.pending_end?.confirm_message_id ?? null,
  });

  // Build a public-only frontmatter (no Discord IDs, no message IDs)
  const publicFrontmatter = scrubFrontmatterForDisk(game);

  const body = renderBody(game);
  const content = serializeGameFile(publicFrontmatter, body);
  const path = gamePath(gamesDir, game.fileStem);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function enrichParticipants(
  bodyParticipants: Participant[],
  cached: CachedParticipant[],
): Participant[] {
  return bodyParticipants.map((p) => {
    if (p.discordId) return p; // already has it (legacy format)
    const id = resolveDiscordId(cached, p.username);
    return { username: p.username, discordId: id };
  });
}

function resolveFrontmatterIds(
  fm: GameFrontmatter,
  participants: Participant[],
  fileStem: string,
): GameFrontmatter {
  const usernameToId = new Map(participants.map((p) => [p.username, p.discordId]));
  const runtimeIds = getRuntimeIds(fileStem);
  const next: GameFrontmatter = { ...fm };

  // current_turn: prefer current_turn_username, else legacy current_turn
  if (next.current_turn_username) {
    next.current_turn = usernameToId.get(next.current_turn_username) ?? next.current_turn ?? null;
  }

  if (next.active_proposal) {
    const ap = { ...next.active_proposal };
    if (!ap.proposer_id && ap.proposer_username) {
      ap.proposer_id = usernameToId.get(ap.proposer_username) ?? '';
    }
    if (!ap.vote_message_id && runtimeIds.vote_message_id) {
      ap.vote_message_id = runtimeIds.vote_message_id;
    }
    next.active_proposal = ap;
  }

  if (next.pending_end) {
    const pe = { ...next.pending_end };
    if (!pe.initiated_by && pe.initiated_by_username) {
      pe.initiated_by = usernameToId.get(pe.initiated_by_username) ?? '';
    }
    if (!pe.winner_id && pe.winner_username) {
      pe.winner_id = usernameToId.get(pe.winner_username) ?? null;
    }
    if (!pe.confirm_message_id && runtimeIds.confirm_message_id) {
      pe.confirm_message_id = runtimeIds.confirm_message_id;
    }
    next.pending_end = pe;
  }

  return next;
}

function scrubFrontmatterForDisk(game: Game): Record<string, unknown> {
  const fm = game.frontmatter;
  const usernameOf = (id: string | null) =>
    id ? resolveUsername(
      game.participants.map((p) => ({ username: p.username, discordId: p.discordId })),
      id,
    ) || null : null;

  const out: Record<string, unknown> = {
    status: fm.status,
    started_at: fm.started_at,
    current_turn_username: usernameOf(fm.current_turn),
    active_proposal: null,
    pending_end: null,
  };

  if (fm.active_proposal) {
    const ap = fm.active_proposal;
    out.active_proposal = {
      id: ap.id,
      proposer_username: ap.proposer_username || usernameOf(ap.proposer_id) || '',
      op: ap.op,
      target_rule_number: ap.target_rule_number,
      new_rule_text: ap.new_rule_text,
      interpretation: ap.interpretation,
      raw_text: ap.raw_text,
      proposed_at: ap.proposed_at,
      vote_deadline: ap.vote_deadline,
      // vote_message_id intentionally excluded (stored in cache)
    };
  }

  if (fm.pending_end) {
    const pe = fm.pending_end;
    out.pending_end = {
      initiated_by_username:
        pe.initiated_by_username || usernameOf(pe.initiated_by) || '',
      winner_username: pe.winner_username || usernameOf(pe.winner_id) || '',
      winner_mention: pe.winner_mention,
      reason: pe.reason,
      initiated_at: pe.initiated_at,
      // confirm_message_id intentionally excluded (stored in cache)
    };
  }

  return out;
}

export function findGameByChannel(gamesDir: string, channelId: string): Game | null {
  const stem = getGameByChannel(channelId);
  if (!stem) return null;
  if (!existsSync(gamePath(gamesDir, stem))) return null;
  return readGame(gamesDir, stem);
}

function parseBody(body: string): {
  participants: Participant[];
  rules: string[];
} {
  const sections = splitSections(body);
  return {
    participants: parseParticipants(sections['参加者'] ?? ''),
    rules: parseListItems(sections['ルール'] ?? ''),
  };
}

function splitSections(body: string): Record<string, string> {
  const result: Record<string, string> = {};
  const lines = body.split('\n');
  let currentHeading: string | null = null;
  let buffer: string[] = [];
  for (const line of lines) {
    const headingMatch = /^##\s+(.+)$/.exec(line);
    if (headingMatch) {
      if (currentHeading) result[currentHeading] = buffer.join('\n');
      currentHeading = headingMatch[1].trim();
      buffer = [];
    } else {
      buffer.push(line);
    }
  }
  if (currentHeading) result[currentHeading] = buffer.join('\n');
  return result;
}

function parseListItems(text: string): string[] {
  return text
    .split('\n')
    .map((line) => /^[-*]\s+(.*)$/.exec(line)?.[1])
    .filter((x): x is string => !!x);
}

function parseParticipants(text: string): Participant[] {
  return parseListItems(text).map((line) => {
    // Legacy format: "@username (123456789)"
    const legacy = /^(@?\S+?)\s*\((\d+)\)\s*$/.exec(line);
    if (legacy) {
      let username = legacy[1];
      if (username.startsWith('@')) username = username.slice(1);
      if (username.startsWith('<@')) username = '';
      return { username, discordId: legacy[2] };
    }
    // New format: "@username" (no ID; discordId resolved from cache later)
    const stripped = line.trim().replace(/^@/, '');
    return { username: stripped, discordId: '' };
  });
}

function renderBody(game: Game): string {
  const participantLines = game.participants
    .map((p) => `- @${p.username || 'unknown'}`)
    .join('\n');
  const ruleLines = game.rules.map((r) => `- ${r}`).join('\n');

  return [
    `# ${game.name}`,
    '',
    '## 参加者',
    '',
    participantLines,
    '',
    '## ルール',
    '',
    ruleLines,
    '',
  ].join('\n');
}

export function findParticipantIndex(game: Game, discordId: string | null): number {
  if (!discordId) return -1;
  return game.participants.findIndex((p) => p.discordId === discordId);
}

export function rightNeighborOfFallback(game: Game, discordId: string): Participant | null {
  const i = findParticipantIndex(game, discordId);
  if (i === -1 || game.participants.length === 0) return null;
  return game.participants[(i + 1) % game.participants.length] ?? null;
}

export function judgeForFallback(game: Game): Participant | null {
  if (!game.frontmatter.current_turn) return null;
  return rightNeighborOfFallback(game, game.frontmatter.current_turn);
}

export function nextTurnPlayerFallback(game: Game): Participant | null {
  if (!game.frontmatter.current_turn) return null;
  return rightNeighborOfFallback(game, game.frontmatter.current_turn);
}

export function setNextTurn(game: Game, nextPlayerId: string | null): void {
  game.frontmatter.current_turn = nextPlayerId;
  game.frontmatter.current_turn_username = nextPlayerId
    ? game.participants.find((p) => p.discordId === nextPlayerId)?.username ?? null
    : null;
  game.frontmatter.active_proposal = null;
}

export function participantById(game: Game, discordId: string): Participant | null {
  return game.participants.find((p) => p.discordId === discordId) ?? null;
}

export function endGame(
  gamesDir: string,
  game: Game,
  opts: { winnerMention?: string; reason?: string },
): { archivePath: string } {
  const endedAt = new Date().toISOString();
  game.frontmatter.status = 'completed';
  game.frontmatter.current_turn = null;
  game.frontmatter.current_turn_username = null;
  game.frontmatter.active_proposal = null;

  const baseBody = renderBody(game);
  const endingSection = [
    '## 勝者',
    '',
    opts.winnerMention
      ? `- ${opts.winnerMention} の勝利${opts.reason ? ` — ${opts.reason}` : ''}`
      : `- 勝者なし (強制終了)${opts.reason ? ` — ${opts.reason}` : ''}`,
    `- 終了日時: ${endedAt}`,
    `- 最終ルール数: ${game.rules.length} 条`,
    '',
  ].join('\n');

  const fullBody = `${baseBody}\n${endingSection}`;
  const content = serializeGameFile(game.frontmatter, fullBody);

  const archiveDir = join(gamesDir, 'archive');
  mkdirSync(archiveDir, { recursive: true });
  const archivePath = join(archiveDir, `${game.fileStem}.md`);
  writeFileSync(archivePath, content);

  const activePath = gamePath(gamesDir, game.fileStem);
  if (existsSync(activePath)) unlinkSync(activePath);

  clearGameFromCache(game.fileStem);
  // Note: we intentionally keep the participants cache for archived games so
  // historical reads (e.g., regenerating mentions in the archived file) still
  // work. Use clearGameCache() if you want to fully wipe.
  void clearGameCache;

  return { archivePath };
}

export function createNewGame(opts: {
  name: string;
  participants: Participant[];
}): Game {
  const startedAt = new Date().toISOString();
  const datePrefix = startedAt.slice(0, 10);
  return {
    name: opts.name,
    fileStem: `${datePrefix}-${opts.name}`,
    frontmatter: {
      status: 'active',
      started_at: startedAt,
      current_turn: opts.participants[0]?.discordId ?? null,
      current_turn_username: opts.participants[0]?.username ?? null,
      active_proposal: null,
      pending_end: null,
    },
    participants: opts.participants,
    rules: getInitialRules(opts.participants.length),
  };
}
