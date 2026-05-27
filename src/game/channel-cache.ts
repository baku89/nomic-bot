import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import matter from 'gray-matter';

const CACHE_PATH = join(process.cwd(), '.cache', 'channels.json');

type ChannelMap = Record<string, string>;

function load(): ChannelMap {
  if (!existsSync(CACHE_PATH)) return {};
  try {
    return JSON.parse(readFileSync(CACHE_PATH, 'utf-8'));
  } catch {
    return {};
  }
}

function save(m: ChannelMap): void {
  mkdirSync(dirname(CACHE_PATH), { recursive: true });
  writeFileSync(CACHE_PATH, JSON.stringify(m, null, 2));
}

export function setChannelGame(channelId: string, gameName: string): void {
  const m = load();
  m[channelId] = gameName;
  save(m);
}

export function getGameByChannel(channelId: string): string | null {
  return load()[channelId] ?? null;
}

export function clearGameFromCache(gameName: string): void {
  const m = load();
  let changed = false;
  for (const [ch, n] of Object.entries(m)) {
    if (n === gameName) {
      delete m[ch];
      changed = true;
    }
  }
  if (changed) save(m);
}

// One-time migration: read legacy frontmatter discord_channel_id and populate the cache.
// Safe to call on every boot — idempotent.
export function primeCacheFromLegacy(gamesDir: string): void {
  if (!existsSync(gamesDir)) return;
  const files = readdirSync(gamesDir).filter(
    (f) => f.endsWith('.md') && f !== 'README.md',
  );
  const m = load();
  let added = 0;
  for (const file of files) {
    const name = file.replace(/\.md$/, '');
    const path = join(gamesDir, file);
    try {
      const { data } = matter(readFileSync(path, 'utf-8'));
      const channelId = data.discord_channel_id;
      if (typeof channelId === 'string' && channelId && !m[channelId]) {
        m[channelId] = name;
        added += 1;
      }
    } catch {
      // ignore malformed
    }
  }
  if (added > 0) {
    save(m);
    console.log(`[channel-cache] migrated ${added} legacy mapping(s) from frontmatter`);
  }
}
