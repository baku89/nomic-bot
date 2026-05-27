import type { z } from 'zod';

export interface LLMProvider {
  generate<T>(opts: {
    systemPrompt: string;
    userMessage: string;
    schema: z.ZodSchema<T>;
    cacheable?: string;
  }): Promise<T>;
}
