import { GoogleGenerativeAI } from '@google/generative-ai';
import type { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { LLMProvider } from './provider.js';

const GEMINI_UNSUPPORTED_KEYS = new Set([
  'additionalProperties',
  '$schema',
  '$ref',
  'definitions',
  '$defs',
]);

function sanitizeForGemini(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(sanitizeForGemini);
  if (schema && typeof schema === 'object') {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(schema)) {
      if (GEMINI_UNSUPPORTED_KEYS.has(k)) continue;
      result[k] = sanitizeForGemini(v);
    }
    return result;
  }
  return schema;
}

export class GeminiProvider implements LLMProvider {
  private client: GoogleGenerativeAI;
  private modelName: string;

  constructor(apiKey: string, modelName: string) {
    this.client = new GoogleGenerativeAI(apiKey);
    this.modelName = modelName;
  }

  async generate<T>(opts: {
    systemPrompt: string;
    userMessage: string;
    schema: z.ZodSchema<T>;
    cacheable?: string;
  }): Promise<T> {
    const rawSchema = zodToJsonSchema(opts.schema, { target: 'openApi3' });
    const jsonSchema = sanitizeForGemini(rawSchema);

    const model = this.client.getGenerativeModel({
      model: this.modelName,
      systemInstruction: opts.systemPrompt,
      generationConfig: {
        responseMimeType: 'application/json',
        // SDKのSchema型は厳しいがランタイムはJSON Schemaを受け付ける
        responseSchema: jsonSchema as never,
      },
    });

    const cacheable = opts.cacheable ? `${opts.cacheable}\n\n---\n\n` : '';
    const result = await withRetry(() => model.generateContent(`${cacheable}${opts.userMessage}`));
    const text = result.response.text();
    const parsed = JSON.parse(text);
    return opts.schema.parse(parsed);
  }
}

async function withRetry<T>(fn: () => Promise<T>, maxRetries = 2): Promise<T> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const status = (err as { status?: number } | null)?.status;
      const transient = typeof status === 'number' && status >= 500 && status < 600;
      if (!transient || attempt === maxRetries) throw err;
      const delay = 1000 * Math.pow(2, attempt);
      console.log(`[gemini] HTTP ${status}, retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries})`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw new Error('unreachable');
}
