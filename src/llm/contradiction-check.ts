import { z } from 'zod';
import type { LLMProvider } from './provider.js';
import type { Game } from '../game/state.js';

export const contradictionCheckSchema = z.object({
  has_contradiction: z.boolean(),
  conflicts: z.array(
    z.object({
      rule_numbers: z.array(z.number().int()),
      description: z.string(),
    }),
  ),
  notes: z.string(),
});

export type ContradictionCheck = z.infer<typeof contradictionCheckSchema>;

export async function checkForContradictions(llm: LLMProvider, game: Game): Promise<ContradictionCheck> {
  const systemPrompt = `あなたはノミック (Nomic) のルールセットの整合性を確認する役割です。
現在の全ルール条文を読み、互いに**客観的に両立しない矛盾**があるか判定してください。

- has_contradiction: 矛盾が存在するなら true
- conflicts: 矛盾する組み合わせの配列。各要素は { rule_numbers: 関係するルール番号, description: 矛盾の説明 }
- notes: 全体所見 (例: Rule 108 により若い番号が優先されるが明確化が望ましい、など)

判定基準:
- 「曖昧」(複数解釈の余地がある) は矛盾ではない (false)
- 「意見が分かれそう」も矛盾ではない (false)
- 両立しない (例: 同じ事象についてXとnot Xを命じる、循環参照で挙動が定まらない) なら矛盾 (true)
- 自明な冗長や不明瞭は矛盾ではない
- **迷う場合は false にする** (誤検知で勝手に異議を立てるより、見逃すほうがコストが低い)

現在のルール (全 ${game.rules.length} 条):
${game.rules.map((r) => `- ${r}`).join('\n')}`;

  return llm.generate({
    systemPrompt,
    userMessage: '現在のルールセットに客観的な矛盾はありますか?',
    schema: contradictionCheckSchema,
  });
}
