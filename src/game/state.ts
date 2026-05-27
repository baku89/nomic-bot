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
import { MINIMUM_NOMIC_RULES } from '../initial-rules.js';
import { getGameByChannel, clearGameFromCache } from './channel-cache.js';

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
  return {
    name: extractShortName(fileStem),
    fileStem,
    frontmatter,
    ...parseBody(body),
  };
}

export function writeGame(gamesDir: string, game: Game): void {
  const body = renderBody(game);
  const content = serializeGameFile(game.frontmatter, body);
  const path = gamePath(gamesDir, game.fileStem);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
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
    const m = /^(@?\S+?)\s*\((\d+)\)\s*$/.exec(line);
    if (m) {
      let username = m[1];
      if (username.startsWith('@')) username = username.slice(1);
      if (username.startsWith('<@')) username = '';
      return { username, discordId: m[2] };
    }
    return { username: '', discordId: '' };
  });
}

function renderBody(game: Game): string {
  const participantLines = game.participants
    .map((p) => `- @${p.username || 'unknown'} (${p.discordId})`)
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
      active_proposal: null,
      pending_end: null,
    },
    participants: opts.participants,
    rules: [...MINIMUM_NOMIC_RULES],
  };
}
