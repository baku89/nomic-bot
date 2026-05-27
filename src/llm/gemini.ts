import { GoogleGenerativeAI } from '@google/generative-ai';
import type { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { LLMProvider } from './provider.js';

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
    const jsonSchema = zodToJsonSchema(opts.schema, { target: 'openApi3' });

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
    const result = await model.generateContent(`${cacheable}${opts.userMessage}`);
    const text = result.response.text();
    const parsed = JSON.parse(text);
    return opts.schema.parse(parsed);
  }
}
