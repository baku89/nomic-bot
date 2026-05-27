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

export const actionSchema = z.discriminatedUnion('type', [
  startGameActionSchema,
  postMessageActionSchema,
  mentionPlayerActionSchema,
  noopActionSchema,
]);

export const llmResponseSchema = z.object({
  actions: z.array(actionSchema),
  narration: z.string().optional(),
});

export type LLMResponse = z.infer<typeof llmResponseSchema>;
export type Action = z.infer<typeof actionSchema>;
