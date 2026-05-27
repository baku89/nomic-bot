import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  unlinkSync,
} from 'node:fs';
import { join } from 'node:path';
import type { ActiveProposal, PendingEnd } from './frontmatter.js';

const CACHE_DIR = join(process.cwd(), '.cache', 'games');

export type CachedParticipant = { username: string; discordId: string };

export type GameRuntimeCache = {
  participants: CachedParticipant[];
  current_turn: string | null;
  current_turn_username: string | null;
  active_proposal: ActiveProposal | null;
  pending_end: PendingEnd | null;
};

const EMPTY: GameRuntimeCache = {
  participants: [],
  current_turn: null,
  current_turn_username: null,
  active_proposal: null,
  pending_end: null,
};

function cachePath(fileStem: string): string {
  return join(CACHE_DIR, `${fileStem}.json`);
}

function loadFile(fileStem: string): GameRuntimeCache {
  const p = cachePath(fileStem);
  if (!existsSync(p)) return { ...EMPTY };
  try {
    const data = JSON.parse(readFileSync(p, 'utf-8')) as Partial<GameRuntimeCache>;
    return {
      participants: Array.isArray(data?.participants) ? data.participants : [],
      current_turn: data?.current_turn ?? null,
      current_turn_username: data?.current_turn_username ?? null,
      active_proposal: data?.active_proposal ?? null,
      pending_end: data?.pending_end ?? null,
    };
  } catch {
    return { ...EMPTY };
  }
}

function saveFile(fileStem: string, data: GameRuntimeCache): void {
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(cachePath(fileStem), JSON.stringify(data, null, 2));
}

export function loadRuntimeCache(fileStem: string): GameRuntimeCache {
  return loadFile(fileStem);
}

export function saveRuntimeCache(fileStem: string, data: GameRuntimeCache): void {
  saveFile(fileStem, data);
}

export function getParticipantsCache(fileStem: string): CachedParticipant[] {
  return loadFile(fileStem).participants;
}

export function clearGameCache(fileStem: string): void {
  const p = cachePath(fileStem);
  if (existsSync(p)) unlinkSync(p);
}

export function resolveDiscordId(
  cached: CachedParticipant[],
  username: string,
): string {
  return cached.find((p) => p.username === username)?.discordId ?? '';
}

export function resolveUsername(
  cached: CachedParticipant[],
  discordId: string,
): string {
  return cached.find((p) => p.discordId === discordId)?.username ?? '';
}
