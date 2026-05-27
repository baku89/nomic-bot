import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  unlinkSync,
} from 'node:fs';
import { join } from 'node:path';

const CACHE_DIR = join(process.cwd(), '.cache', 'games');

export type CachedParticipant = { username: string; discordId: string };

type GameCacheFile = {
  participants: CachedParticipant[];
  active_proposal_runtime?: { vote_message_id?: string };
  pending_end_runtime?: { confirm_message_id?: string };
};

function cachePath(fileStem: string): string {
  return join(CACHE_DIR, `${fileStem}.json`);
}

function load(fileStem: string): GameCacheFile {
  const p = cachePath(fileStem);
  if (!existsSync(p)) return { participants: [] };
  try {
    const data = JSON.parse(readFileSync(p, 'utf-8'));
    return {
      participants: Array.isArray(data?.participants) ? data.participants : [],
      active_proposal_runtime: data?.active_proposal_runtime,
      pending_end_runtime: data?.pending_end_runtime,
    };
  } catch {
    return { participants: [] };
  }
}

function save(fileStem: string, data: GameCacheFile): void {
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(cachePath(fileStem), JSON.stringify(data, null, 2));
}

export function getParticipantsCache(fileStem: string): CachedParticipant[] {
  return load(fileStem).participants;
}

export function setParticipantsCache(
  fileStem: string,
  participants: CachedParticipant[],
): void {
  const cur = load(fileStem);
  save(fileStem, { ...cur, participants });
}

export function getRuntimeIds(fileStem: string): {
  vote_message_id?: string;
  confirm_message_id?: string;
} {
  const c = load(fileStem);
  return {
    vote_message_id: c.active_proposal_runtime?.vote_message_id,
    confirm_message_id: c.pending_end_runtime?.confirm_message_id,
  };
}

export function setRuntimeIds(
  fileStem: string,
  ids: { vote_message_id?: string | null; confirm_message_id?: string | null },
): void {
  const cur = load(fileStem);
  const ap = cur.active_proposal_runtime ?? {};
  const pe = cur.pending_end_runtime ?? {};
  if (ids.vote_message_id !== undefined) {
    if (ids.vote_message_id === null) delete ap.vote_message_id;
    else ap.vote_message_id = ids.vote_message_id;
  }
  if (ids.confirm_message_id !== undefined) {
    if (ids.confirm_message_id === null) delete pe.confirm_message_id;
    else pe.confirm_message_id = ids.confirm_message_id;
  }
  save(fileStem, {
    participants: cur.participants,
    active_proposal_runtime: Object.keys(ap).length ? ap : undefined,
    pending_end_runtime: Object.keys(pe).length ? pe : undefined,
  });
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
