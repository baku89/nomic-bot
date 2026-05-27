# nomic-bot

ノミック ([Nomic](https://ja.wikipedia.org/wiki/%E3%83%8E%E3%83%9F%E3%83%83%E3%82%AF), ルール改変ゲーム) を Discord 上で進行する Bot。

ノミックは Peter Suber が考案した「プレイヤーがルールを自己改変できるゲーム」。
このBotは Discord 上で複数人ノミックを進行する役割を LLM ベースで自動化する。
初期ルールには [ミニマムノミック](https://ja.wikipedia.org/wiki/%E3%83%8E%E3%83%9F%E3%83%83%E3%82%AF) (9条) を採用 (`src/initial-rules.ts`)。

## 主な機能

- **ゲーム開始**: 自然言語メンション (`@Nomic <@参加者> 「foo」というゲームを始めましょう`) または `/start name:foo players:@a @b`
- **状態確認**: `/status` でゲーム状態・参加者・ルール一覧 + GitHub URL を一括表示
- **提案**: `/propose <自由テキスト>` で LLM が op (制定/廃止/修正)・対象ルール番号・新本文を解釈
- **採決**: 提案メッセージの ✅ / ❌ / 🤷 リアクションで全会一致採決 (Rule 105)
- **自動勝者検出**: ルール採択後に LLM が「勝者出てる?」をチェック、参加者全員の絵文字合意で `/end` 相当を実行
- **強制終了**: `/end winner:<user> reason:<text>` (チャンネルに居れば誰でも実行可)
- **記録**: 全ルール改変は別リポ ([baku89/nomic-games](https://github.com/baku89/nomic-games)) に 1 コミット = 1 改変として残る (コミットメッセージ = 提案文)

## アーキテクチャ

- **ハイブリッド設計**: 決定論的コア (投票記録・ルールブック保管・git commit) が信頼性を担保、LLM は解釈と告知を担当
- **LLM プロバイダ抽象化**: デフォルト Gemini 2.5 Flash、env で Claude/OpenAI に切替可能 (`src/llm/`)
- **永続化**: 1 ゲーム = 1 Markdown ファイル (YAML frontmatter + 本文)、別 git リポで履歴管理
- **常駐**: pm2、VPS への完全自動デプロイは GitHub Actions

## セットアップ

[DEPLOY.md](./DEPLOY.md) を参照。Discord App 登録、API キー取得、VPS 初期化、CI 連携まで一通り書いてある。

## 開発

```bash
yarn install
cp .env.example .env          # トークン・キー・GAMES_DIR を記入
yarn register-commands         # スラッシュコマンドを Discord に登録 (グローバル、反映に最大1h)
yarn dev                       # tsx watch でホットリロード
yarn typecheck
```

## ライセンス

[MIT](./LICENSE)
