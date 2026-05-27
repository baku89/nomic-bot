import { z } from 'zod';

export const startGameActionSchema = z.object({
  type: z.literal('start_game'),
  name: z.string().min(1).regex(/^[a-zA-Z0-9_-]+$/, {
    message: 'ゲーム名は英数字・ハイフン・アンダースコアのみ使用可',
  }),
  participantMentions: z.array(z.string()).min(1),
});

export const postMessageActionSchema = z.object({
  type: z.literal('post_message'),
  content: z.string(),
});

export const mentionPlayerActionSchema = z.object({
  type: z.literal('mention_player'),
  discordId: z.string(),
  reason: z.string(),
});

export const noopActionSchema = z.object({
  type: z.literal('noop'),
  reason: z.string(),
});

export const proposeGameEndActionSchema = z.object({
  type: z.literal('propose_game_end'),
  winner_mention: z.string().nullable(),
  reason: z.string(),
});

export const amendActiveProposalActionSchema = z.object({
  type: z.literal('amend_active_proposal'),
  op: z.enum(['enact', 'modify', 'repeal']),
  target_rule_number: z.number().int().nullable(),
  new_rule_text: z.string().nullable(),
  interpretation: z.string(),
  reason: z.string(),
});

export const raiseDisputeActionSchema = z.object({
  type: z.literal('raise_dispute'),
  reason: z.string(),
});

export const actionSchema = z.discriminatedUnion('type', [
  startGameActionSchema,
  postMessageActionSchema,
  mentionPlayerActionSchema,
  noopActionSchema,
  proposeGameEndActionSchema,
  amendActiveProposalActionSchema,
  raiseDisputeActionSchema,
]);

export const llmResponseSchema = z.object({
  actions: z.array(actionSchema),
  narration: z.string().optional(),
});

export type LLMResponse = z.infer<typeof llmResponseSchema>;
export type Action = z.infer<typeof actionSchema>;
