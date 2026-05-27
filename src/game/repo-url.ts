import { simpleGit } from 'simple-git';

export async function getGamesRepoUrl(gamesDir: string): Promise<string | null> {
  try {
    const git = simpleGit(gamesDir);
    const remotes = await git.getRemotes(true);
    const origin = remotes.find((r) => r.name === 'origin');
    if (!origin) return null;
    const raw = origin.refs.fetch || origin.refs.push;
    if (!raw) return null;
    return normalizeGitUrl(raw);
  } catch {
    return null;
  }
}

function normalizeGitUrl(url: string): string {
  let n = url;
  if (n.startsWith('git@')) {
    n = n.replace(/^git@([^:]+):/, 'https://$1/');
  }
  if (n.endsWith('.git')) n = n.slice(0, -4);
  return n;
}

export function gameFileUrl(
  repoUrl: string,
  gameName: string,
  archived: boolean,
): string {
  const path = archived ? `archive/${gameName}.md` : `${gameName}.md`;
  return `${repoUrl}/blob/main/${path}`;
}
