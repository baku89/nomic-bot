import { z } from 'zod';
import type { LLMProvider } from './provider.js';
import type { Game } from '../game/state.js';

export const winCheckSchema = z.object({
  game_should_end: z.boolean(),
  winner_mention: z.string().nullable(),
  reason: z.string(),
});

export type WinCheck = z.infer<typeof winCheckSchema>;

export async function checkForWinner(llm: LLMProvider, game: Game): Promise<WinCheck> {
  const systemPrompt = `あなたはノミック (Nomic) ゲームの状態を確認する役割です。
現在のルール条文と参加者リストを見て、ゲームが終了すべき状況にあるか判定してください。

- game_should_end: 終了すべきなら true、まだ継続中なら false
- winner_mention: 勝者が明確なら Discord メンション (例: "<@123456789>")。勝者なしや不明なら null
- reason: 判定根拠 (どのルール条文に基づくか)

注意:
- 「特定プレイヤーが勝ち」「ゲーム終了条件 (得点 X 以上で勝利など) が満たされた」などの明らかな終了状況だけ true にする
- ルールが存在するだけでは終了判定しない。実際にその条件が満たされた状態かを判断する
- 迷う場合は false にする (誤判定で勝手にゲームを終わらせるより、継続のほうがリスクが低い)

参加者: ${game.participants.map((p) => `@${p.username} (id: ${p.discordId})`).join(', ')}

現在のルール (全 ${game.rules.length} 条):
${game.rules.map((r) => `- ${r}`).join('\n')}`;

  return llm.generate({
    systemPrompt,
    userMessage: '現在の状態でゲームは終了すべきですか?',
    schema: winCheckSchema,
  });
}
