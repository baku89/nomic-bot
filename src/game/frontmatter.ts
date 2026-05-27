import matter from 'gray-matter';
import { z } from 'zod';

export const activeProposalSchema = z.object({
  id: z.string(),
  proposer_id: z.string(),
  proposer_username: z.string().default(''),
  op: z.enum(['enact', 'modify', 'repeal']),
  target_rule_number: z.number().int().nullable(),
  new_rule_text: z.string().nullable(),
  interpretation: z.string(),
  raw_text: z.string(),
  proposed_at: z.string(),
  vote_deadline: z.string(),
  vote_message_id: z.string(),
});

export type ActiveProposal = z.infer<typeof activeProposalSchema>;

export const pendingEndSchema = z.object({
  initiated_by: z.string(),
  winner_id: z.string().nullable(),
  winner_mention: z.string().nullable(),
  winner_username: z.string().default(''),
  reason: z.string(),
  confirm_message_id: z.string(),
  initiated_at: z.string(),
});

export type PendingEnd = z.infer<typeof pendingEndSchema>;

export const gameFrontmatterSchema = z.object({
  status: z.enum(['active', 'completed', 'paused']),
  started_at: z.string(),
  current_turn: z.string().nullable(),
  active_proposal: activeProposalSchema.nullable(),
  pending_end: pendingEndSchema.nullable().optional(),
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
