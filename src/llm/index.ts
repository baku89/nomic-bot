import type { Config } from '../config.js';
import { GeminiProvider } from './gemini.js';
import type { LLMProvider } from './provider.js';

export function createLLMProvider(config: Config): LLMProvider {
  switch (config.llmProvider) {
    case 'gemini': {
      if (!config.geminiApiKey) {
        throw new Error('GEMINI_API_KEY is required when LLM_PROVIDER=gemini');
      }
      return new GeminiProvider(config.geminiApiKey, config.llmModel);
    }
    case 'claude':
      throw new Error('Claude provider not yet implemented');
    case 'openai':
      throw new Error('OpenAI provider not yet implemented');
  }
}

export type { LLMProvider } from './provider.js';
