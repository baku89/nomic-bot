import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import {
  parseGameFile,
  serializeGameFile,
  type GameFrontmatter,
} from './frontmatter.js';
import { MINIMUM_NOMIC_RULES, INITIAL_BOT_INSTRUCTIONS } from '../initial-rules.js';

export type Participant = {
  mention: string;
  discordId: string;
};

export type Game = {
  name: string;
  frontmatter: GameFrontmatter;
  participants: Participant[];
  rules: string[];
  botInstructions: string[];
};

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
  for (const file of listActiveGames(gamesDir)) {
    const name = file.replace(/\.md$/, '');
    const game = readGame(gamesDir, name);
    if (game.frontmatter.discord_channel_id === channelId) return game;
  }
  return null;
}

function parseBody(body: string): {
  participants: Participant[];
  rules: string[];
  botInstructions: string[];
} {
  const sections = splitSections(body);
  return {
    participants: parseParticipants(sections['参加者'] ?? ''),
    rules: parseListItems(sections['ルール'] ?? ''),
    botInstructions: parseListItems(sections['Botへの指示'] ?? ''),
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
    const match = /^(\S+)\s*\(([^)]+)\)/.exec(line);
    if (match) return { mention: match[1], discordId: match[2] };
    return { mention: line, discordId: '' };
  });
}

function renderBody(game: Game): string {
  const participantLines = game.participants
    .map((p) => `- ${p.mention} (${p.discordId})`)
    .join('\n');
  const ruleLines = game.rules.map((r) => `- ${r}`).join('\n');
  const instructionLines = game.botInstructions.map((i) => `- ${i}`).join('\n');

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
    '## Botへの指示',
    '',
    instructionLines,
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

export function createNewGame(opts: {
  name: string;
  channelId: string;
  guildId: string;
  participants: Participant[];
}): Game {
  return {
    name: opts.name,
    frontmatter: {
      discord_channel_id: opts.channelId,
      discord_guild_id: opts.guildId,
      status: 'active',
      started_at: new Date().toISOString(),
      current_turn: opts.participants[0]?.discordId ?? null,
      active_proposal: null,
    },
    participants: opts.participants,
    rules: [...MINIMUM_NOMIC_RULES],
    botInstructions: [...INITIAL_BOT_INSTRUCTIONS],
  };
}
