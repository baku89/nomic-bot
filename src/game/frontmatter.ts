import matter from 'gray-matter';
import { z } from 'zod';

export const gameFrontmatterSchema = z.object({
  discord_channel_id: z.string(),
  discord_guild_id: z.string(),
  status: z.enum(['active', 'completed', 'paused']),
  started_at: z.string(),
  current_turn: z.string().nullable(),
  active_proposal: z.string().nullable(),
});

export type GameFrontmatter = z.infer<typeof gameFrontmatterSchema>;

export function parseGameFile(content: string): { frontmatter: GameFrontmatter; body: string } {
  const parsed = matter(content);
  return {
    frontmatter: gameFrontmatterSchema.parse(parsed.data),
    body: parsed.content,
  };
}

export function serializeGameFile(frontmatter: GameFrontmatter, body: string): string {
  return matter.stringify(body, frontmatter);
}
