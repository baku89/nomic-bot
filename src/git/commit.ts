import { simpleGit, type SimpleGit } from 'simple-git';
import { existsSync, mkdirSync } from 'node:fs';

export class GitGameRepo {
  private git: SimpleGit;

  constructor(gamesDir: string) {
    if (!existsSync(gamesDir)) {
      mkdirSync(gamesDir, { recursive: true });
    }
    this.git = simpleGit(gamesDir);
  }

  async ensureRepo(): Promise<void> {
    const isRepo = await this.git.checkIsRepo();
    if (!isRepo) {
      await this.git.init(['-b', 'main']);
      await this.git.addConfig('user.email', 'nomic-bot@localhost');
      await this.git.addConfig('user.name', 'Nomic Bot');
    }
  }

  async commit(message: string, files: string[] = ['.']): Promise<void> {
    await this.git.add(files);
    await this.git.commit(message);
    await this.tryPush();
  }

  private async tryPush(): Promise<void> {
    try {
      const remotes = await this.git.getRemotes(true);
      const hasOrigin = remotes.some((r) => r.name === 'origin' && r.refs?.push);
      if (!hasOrigin) return;
      await this.git.push();
      console.log('[git] pushed to origin');
    } catch (err) {
      console.warn('[git] push failed (continuing):', (err as Error).message);
    }
  }
}
