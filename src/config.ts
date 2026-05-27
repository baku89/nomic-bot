import { z } from 'zod';

const envSchema = z.object({
  DISCORD_BOT_TOKEN: z.string().min(1),
  DISCORD_CLIENT_ID: z.string().min(1),
  LLM_PROVIDER: z.enum(['gemini', 'claude', 'openai']).default('gemini'),
  LLM_MODEL: z.string().default('gemini-2.5-flash'),
  GEMINI_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  GAMES_DIR: z.string().min(1),
  BOT_DISPLAY_NAME: z.string().default('Nomic'),
  MAINTAINER_DISCORD_ID: z.string().optional(),
});

export type Config = {
  discordBotToken: string;
  discordClientId: string;
  llmProvider: 'gemini' | 'claude' | 'openai';
  llmModel: string;
  geminiApiKey?: string;
  anthropicApiKey?: string;
  openaiApiKey?: string;
  gamesDir: string;
  botDisplayName: string;
  maintainerDiscordId?: string;
};

export function loadConfig(): Config {
  const env = envSchema.parse(process.env);
  return {
    discordBotToken: env.DISCORD_BOT_TOKEN,
    discordClientId: env.DISCORD_CLIENT_ID,
    llmProvider: env.LLM_PROVIDER,
    llmModel: env.LLM_MODEL,
    geminiApiKey: env.GEMINI_API_KEY,
    anthropicApiKey: env.ANTHROPIC_API_KEY,
    openaiApiKey: env.OPENAI_API_KEY,
    gamesDir: env.GAMES_DIR,
    botDisplayName: env.BOT_DISPLAY_NAME,
    maintainerDiscordId: env.MAINTAINER_DISCORD_ID,
  };
}
