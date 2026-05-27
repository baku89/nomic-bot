# Deploy

CIで自動デプロイされる構成。初回だけVPSとGitHubの設定が必要。

## あなたが手動でやる登録作業

### 1. Discord Developer Portal
https://discord.com/developers/applications

- 「New Application」でアプリ作成
- **Bot** タブ:
  - 「Reset Token」でトークンを発行 → `DISCORD_BOT_TOKEN`
  - **Privileged Gateway Intents** で **MESSAGE CONTENT INTENT** をオン (必須)
- **General Information** で **APPLICATION ID** をコピー → `DISCORD_CLIENT_ID`
- **OAuth2 → URL Generator**:
  - Scopes: `bot`, `applications.commands`
  - Bot Permissions: `Send Messages`, `Read Message History`, `Embed Links`
  - 生成URLでBotを自分のサーバーに招待

### 2. Gemini API key
https://aistudio.google.com/app/apikey

「Create API key」 → `GEMINI_API_KEY` (無料枠でこのBot規模なら十分)

### 3. メンテナの Discord User ID (任意、推奨)
LLM API のレート超過などエラー時に Bot がメンションする宛先。
- 設定 → 詳細設定 → **開発者モード** をオン
- 自分の名前を右クリック → 「ユーザーIDをコピー」
- `.env` の `MAINTAINER_DISCORD_ID` に設定

### 4. GitHub
このコードをpushするrepoを用意 (private/publicどちらでも)。

**Repo Settings → Secrets and variables → Actions** で以下を登録:

| Secret | 内容 |
|---|---|
| `VPS_HOST` | VPSのIP or ホスト名 |
| `VPS_USER` | SSHユーザ名 |
| `VPS_SSH_KEY` | デプロイ用秘密鍵 (PEM形式の全文) |
| `VPS_PATH` | VPS上のbotコード配置先 (例: `/home/baku/nomic-bot`) |
| `VPS_PORT` | (任意) 22以外なら指定 |

デプロイ用SSH鍵は新規に作るのを推奨:
```bash
ssh-keygen -t ed25519 -f ~/.ssh/nomic-deploy -C "nomic-deploy"
# 公開鍵 ~/.ssh/nomic-deploy.pub を VPS の ~/.ssh/authorized_keys に追記
# 秘密鍵 ~/.ssh/nomic-deploy を VPS_SSH_KEY に登録 (全文コピー)
```

### 5. VPS初回セットアップ (これだけ手動)

```bash
# 1. Node.js 20+, yarn, git, pm2
sudo apt update && sudo apt install -y nodejs npm git
sudo npm install -g yarn pm2

# 2. botコードをclone (パスはVPS_PATHと一致させる)
git clone <github-repo-url> ~/nomic-bot
cd ~/nomic-bot

# 3. .env を設定
cp .env.example .env
$EDITOR .env                   # トークン・キー・パスを記入

# 4. ゲーム保管用ディレクトリ (別gitリポ)
sudo mkdir -p /var/lib/nomic-games
sudo chown $USER:$USER /var/lib/nomic-games
cd /var/lib/nomic-games
git init -b main
git config user.email "nomic-bot@localhost"
git config user.name "Nomic Bot"
cd ~/nomic-bot

# 5. pm2 を OS起動時に自動再開させる準備
pm2 startup                    # 出てきたコマンドをsudoで実行
# ※ Bot 自体の最初の起動は CI に任せて OK (次節)
```

## 自動デプロイ (これ以降は手動操作不要)

`main` ブランチに push するだけ:

```bash
git push origin main
```

→ GitHub Actions が:
1. typecheck + build (CI環境で検証)
2. VPS に SSH → `git reset --hard origin/main` → `yarn install --frozen-lockfile` → `yarn build`
3. `yarn register-commands` (スラッシュコマンドの登録/更新)
4. `pm2 reload nomic-bot` (起動していなければ初回 `pm2 start`)
5. `pm2 save`

初回pushでBotが自動起動する。以後の更新もpushだけ。

進捗は GitHub の **Actions** タブで見える。手動実行したいときは Actions タブ → "Deploy" → "Run workflow"。

## 運用コマンド

```bash
pm2 logs nomic-bot                 # ライブログ
pm2 logs nomic-bot --lines 200
pm2 restart nomic-bot
pm2 status

# ゲーム状態を見る
cd /var/lib/nomic-games
git log --oneline                  # 全ゲームの変更履歴
git log -p alpha.md                # 特定ゲームの進化
ls *.md                            # 進行中ゲーム
ls archive/                        # 終了/中断ゲーム
```
