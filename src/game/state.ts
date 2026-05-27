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
  name: string;
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

function gamePath(gamesDir: string, name: string): string {
  return join(gamesDir, `${name}.md`);
}

export function gameExists(gamesDir: string, name: string): boolean {
  return existsSync(gamePath(gamesDir, name));
}

export function listActiveGames(gamesDir: string): string[] {
  if (!existsSync(gamesDir)) return [];
  return readdirSync(gamesDir).filter(
    (f) => f.endsWith('.md') && f !== 'README.md',
  );
}

export function readGame(gamesDir: string, name: string): Game {
  const path = gamePath(gamesDir, name);
  const content = readFileSync(path, 'utf-8');
  const { frontmatter, body } = parseGameFile(content);
  return {
    name,
    frontmatter,
    ...parseBody(body),
  };
}

export function writeGame(gamesDir: string, game: Game): void {
  const body = renderBody(game);
  const content = serializeGameFile(game.frontmatter, body);
  const path = gamePath(gamesDir, game.name);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

export function findGameByChannel(gamesDir: string, channelId: string): Game | null {
  const name = getGameByChannel(channelId);
  if (!name) return null;
  if (!gameExists(gamesDir, name)) return null;
  return readGame(gamesDir, name);
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
    // Format: "@username (123456789)" or "<@123> (123)" (legacy)
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

export function rightNeighborOf(game: Game, discordId: string): Participant | null {
  const i = findParticipantIndex(game, discordId);
  if (i === -1 || game.participants.length === 0) return null;
  return game.participants[(i + 1) % game.participants.length] ?? null;
}

export function judgeFor(game: Game): Participant | null {
  if (!game.frontmatter.current_turn) return null;
  return rightNeighborOf(game, game.frontmatter.current_turn);
}

export function nextTurnPlayer(game: Game): Participant | null {
  if (!game.frontmatter.current_turn) return null;
  return rightNeighborOf(game, game.frontmatter.current_turn);
}

export function advanceTurn(game: Game): void {
  const next = nextTurnPlayer(game);
  game.frontmatter.current_turn = next?.discordId ?? null;
  game.frontmatter.active_proposal = null;
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
  const archivePath = join(archiveDir, `${game.name}.md`);
  writeFileSync(archivePath, content);

  const activePath = join(gamesDir, `${game.name}.md`);
  if (existsSync(activePath)) unlinkSync(activePath);

  clearGameFromCache(game.name);

  return { archivePath };
}

export function createNewGame(opts: {
  name: string;
  participants: Participant[];
}): Game {
  return {
    name: opts.name,
    frontmatter: {
      status: 'active',
      started_at: new Date().toISOString(),
      current_turn: opts.participants[0]?.discordId ?? null,
      active_proposal: null,
      pending_end: null,
    },
    participants: opts.participants,
    rules: [...MINIMUM_NOMIC_RULES],
  };
}
