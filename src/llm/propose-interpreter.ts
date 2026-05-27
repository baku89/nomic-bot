import { z } from 'zod';
import type { LLMProvider } from './provider.js';

export const proposalInterpretationSchema = z.object({
  op: z.enum(['enact', 'modify', 'repeal']),
  target_rule_number: z.number().int().nullable(),
  new_rule_text: z.string().nullable(),
  interpretation: z.string(),
});

export type ProposalInterpretation = z.infer<typeof proposalInterpretationSchema>;

export async function interpretProposal(
  llm: LLMProvider,
  proposalText: string,
  currentRules: string[],
): Promise<ProposalInterpretation> {
  const systemPrompt = `あなたはノミック (Nomic) ゲームのルール改変提案を解釈する役割です。
プレイヤーの自由テキストによる提案を以下の構造に変換してください。

- op: "enact" (新規ルールの制定), "modify" (既存ルールの修正), "repeal" (既存ルールの廃止) のいずれか
- target_rule_number: modify/repeal の場合は対象ルール番号 (整数)。enact の場合は null
- new_rule_text: enact/modify の場合は新しいルール本文。repeal の場合は null
- interpretation: 提案内容の1〜2文の自然な日本語要約 (例: 「ルール103を反時計回りに変更する」)

現在有効なルール:
${currentRules.map((r) => `- ${r}`).join('\n')}

提案テキストが既存ルールに言及している場合、上記リストの番号を target_rule_number に入れてください。
新本文を書く際は、既存のルール番号を含めず、本文のみを書いてください。`;

  return llm.generate({
    systemPrompt,
    userMessage: proposalText,
    schema: proposalInterpretationSchema,
  });
}
