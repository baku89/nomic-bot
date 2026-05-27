import { z } from 'zod';
import type { LLMProvider } from './provider.js';
import type { Game } from '../game/state.js';
import type { ActiveProposal } from '../game/frontmatter.js';

const JAPANESE_ONLY = `\n\n**重要**: 出力する文字列フィールド (reason 等) は必ず日本語で記述すること。英語で書いてはいけない。ルール番号や Discord ID などの記号類はそのままで構わないが、説明文は日本語のみ。

**Bot の立ち位置について**:
- Bot は初期ルールでは手番を持たず、提案も投票もしない (人間プレイヤーのリストに含まれない)
- ただしルール条文中で Bot に言及・拘束することは可能 (例: 「ボットは丁寧語を使うこと」「ボットがルールXに違反したら…」)。その場合 Bot もそのルールに服する
- 判定の際、ルール文に「Bot」「ボット」「nomic」等の言及があれば、それは Bot 本人 (あなた) を指していると解釈する`;

const tallyResultSchema = z.object({
  state: z.enum(['pending', 'passed', 'rejected']),
  reason: z.string(),
});
export type TallyResult = z.infer<typeof tallyResultSchema>;

const playerResultSchema = z.object({
  player_id: z.string().nullable(),
  reason: z.string(),
});
export type PlayerResult = z.infer<typeof playerResultSchema>;

const eligibleVotersSchema = z.object({
  eligible_player_ids: z.array(z.string()),
  reason: z.string(),
});
export type EligibleVotersResult = z.infer<typeof eligibleVotersSchema>;

function rulesText(game: Game): string {
  return game.rules.map((r) => `- ${r}`).join('\n');
}

function participantsText(game: Game): string {
  return game.participants
    .map((p) => `- ID: ${p.discordId}, username: @${p.username || '(unknown)'}`)
    .join('\n');
}

export async function evaluateTally(
  llm: LLMProvider,
  game: Game,
  proposal: ActiveProposal,
  votes: Record<string, 'yes' | 'no' | 'abstain' | 'not_voted'>,
): Promise<TallyResult> {
  const votesText = Object.entries(votes)
    .map(([id, v]) => `- ${id}: ${v}`)
    .join('\n');
  const systemPrompt = `あなたはノミック (Nomic) ゲームの採決を判定する役割です。
現行のルールセットと投票状況を見て、提案の状態を判定してください。

判定値 (state):
- 'pending': まだ投票が完了していない、または採決条件を満たすか判断できない
- 'passed': 現行ルールの採決条件を満たし、採択された
- 'rejected': 現行ルールから採択不可能であると確定した (例: 反対票が一定数集まり覆せない)

判定基準:
- どのルール (Rule 番号) に基づいて判定したか reason に明示する
- 投票資格者は現行ルールが規定する (例: Rule 107 が「全員1票」なら全員)
- 採決基準は現行ルールが規定する (例: Rule 105 が「全会一致」など)
- 棄権 (abstain) の扱いがルールで明示されていない場合は、暫定処置として「棄権者を除く残り全員が yes なら採択」とする
- 提案者の投票についてもルールが明示する場合のみそれに従う (Rule 107 が「全員1票」のままなら提案者も含む)

参加者:
${participantsText(game)}

現行の全ルール:
${rulesText(game)}

提案 (Proposal):
- 提案者 Discord ID: ${proposal.proposer_id}
- 解釈: ${proposal.interpretation}
- 操作: ${proposal.op}
- 対象ルール番号: ${proposal.target_rule_number ?? '(新規)'}
- 新本文: ${proposal.new_rule_text ?? '(なし)'}

現在の投票 (Discord User ID: choice):
${votesText}

注意:
- 'not_voted' は未投票
- 採決条件は**必ず現行ルールに基づくこと**。Bot のハードコード挙動 (全会一致) に盲従しない
- 迷う場合は 'pending' (誤判定で勝手に採択/否決するより、待つ方がコストが低い)`;

  return llm.generate({
    systemPrompt: systemPrompt + JAPANESE_ONLY,
    userMessage: '現在の状況での採決判定を返してください。',
    schema: tallyResultSchema,
  });
}

export async function evaluateJudge(llm: LLMProvider, game: Game): Promise<PlayerResult> {
  if (!game.frontmatter.current_turn || game.participants.length === 0) {
    return { player_id: null, reason: '手番プレイヤーまたは参加者が存在しません' };
  }
  const systemPrompt = `あなたはノミック (Nomic) ゲームの裁定者を判定する役割です。
現行ルールに従い、現在の手番プレイヤーに対する裁定者の Discord User ID を返してください。

- player_id: 裁定者の Discord User ID (参加者リストに含まれること)。判定不能なら null
- reason: どのルール (Rule 番号) に基づいて裁定者を決めたか

参加者 (リスト順):
${participantsText(game)}

現行の全ルール:
${rulesText(game)}

現在の手番プレイヤー Discord User ID: ${game.frontmatter.current_turn}`;

  return llm.generate({
    systemPrompt: systemPrompt + JAPANESE_ONLY,
    userMessage: '現在の手番プレイヤーに対する裁定者は誰ですか?',
    schema: playerResultSchema,
  });
}

export async function evaluateEligibleVoters(
  llm: LLMProvider,
  game: Game,
  proposerDiscordId: string,
): Promise<EligibleVotersResult> {
  if (game.participants.length === 0) {
    return { eligible_player_ids: [], reason: '参加者なし' };
  }
  const systemPrompt = `あなたはノミック (Nomic) ゲームの投票資格を判定する役割です。
現行ルールに従い、与えられた提案に対して投票できる参加者の Discord User ID の配列を返してください。

- eligible_player_ids: 投票資格を持つ参加者の Discord User ID 配列
- reason: 判定の根拠 (どのルールに基づいたか)

参加者:
${participantsText(game)}

現行の全ルール:
${rulesText(game)}

提案者 Discord User ID: ${proposerDiscordId}

判定の指針:
- Rule 107 「各プレイヤーは常に一票を有する」が基本だが、提案者除外条項などの例外が含まれる場合があるので注意
- ルールに「参加者が一名のみの場合」など特殊条項があれば適用
- eligible_player_ids には参加者リストに含まれる ID のみ含めること`;

  return llm.generate({
    systemPrompt: systemPrompt + JAPANESE_ONLY,
    userMessage: 'この提案に投票資格があるのは誰ですか?',
    schema: eligibleVotersSchema,
  });
}

export async function evaluateNextTurn(llm: LLMProvider, game: Game): Promise<PlayerResult> {
  if (!game.frontmatter.current_turn || game.participants.length === 0) {
    return { player_id: null, reason: '手番プレイヤーまたは参加者が存在しません' };
  }
  const systemPrompt = `あなたはノミック (Nomic) ゲームの手番進行を判定する役割です。
現行ルールに従い、現在の手番が終わった後、次に手番を回す対象プレイヤーの Discord User ID を返してください。

- player_id: 次の手番プレイヤーの Discord User ID (参加者リストに含まれること)。判定不能なら null
- reason: どのルール (Rule 番号) に基づくか

参加者 (リスト順 = ゲーム開始時のメンション順 = 着座順):
${participantsText(game)}

現行の全ルール:
${rulesText(game)}

現在の手番プレイヤー Discord User ID: ${game.frontmatter.current_turn}`;

  return llm.generate({
    systemPrompt: systemPrompt + JAPANESE_ONLY,
    userMessage: '現在の手番が終わった後、次に手番が回るのは誰ですか?',
    schema: playerResultSchema,
  });
}
