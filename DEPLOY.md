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
ssh user@vps

# (1) Node.js 20+, yarn, git, pm2
sudo apt update && sudo apt install -y nodejs npm git
sudo npm install -g yarn pm2

# (2) CI 用 SSH key (LOCAL から受け取る)
# LOCAL で `ssh-keygen -t ed25519 -f ~/.ssh/nomic-deploy -N "" -C "nomic-deploy"`
# その公開鍵を以下に追記
$EDITOR ~/.ssh/authorized_keys  # ~/.ssh/nomic-deploy.pub の中身を貼る
chmod 600 ~/.ssh/authorized_keys

# (3) nomic-games 書き込み用 SSH key (VPS → GitHub)
ssh-keygen -t ed25519 -f ~/.ssh/nomic-games -N "" -C "nomic-bot@vps"
cat ~/.ssh/nomic-games.pub
# → この公開鍵を GitHub の nomic-games リポの
#   Settings → Deploy keys → "Add deploy key"
#   - Title: "vps-write"
#   - Key: 上記公開鍵
#   - ✅ Allow write access  ← 重要
#
# ssh config で github 接続にこの鍵を使うよう設定
cat >> ~/.ssh/config <<'EOF'
Host github.com
  IdentityFile ~/.ssh/nomic-games
  StrictHostKeyChecking accept-new
EOF
chmod 600 ~/.ssh/config

# (4) Bot コードを clone (パスは GitHub Secrets の VPS_PATH と一致させる)
git clone https://github.com/baku89/nomic-bot.git ~/nomic-bot
cd ~/nomic-bot

# (5) .env を設定
cp .env.example .env
$EDITOR .env
# 必須: DISCORD_BOT_TOKEN, DISCORD_CLIENT_ID, GEMINI_API_KEY
# 必須: GAMES_DIR=/var/lib/nomic-games
# 推奨: MAINTAINER_DISCORD_ID=<自分の Discord User ID>
# 推奨: CACHE_DIR=/var/lib/nomic-bot-cache  ← bot 配下の .cache から切り離すと
#                                              再デプロイ時に絶対に消えない
sudo mkdir -p /var/lib/nomic-bot-cache
sudo chown $USER:$USER /var/lib/nomic-bot-cache

# (6) ゲーム保管用リポを GitHub から SSH で clone (deploy key が効く)
sudo mkdir -p /var/lib/nomic-games
sudo chown $USER:$USER /var/lib/nomic-games
git clone git@github.com:baku89/nomic-games.git /var/lib/nomic-games
cd /var/lib/nomic-games
git config user.email "nomic-bot@vps"
git config user.name "Nomic Bot"

# 動作確認: 空コミットして push が通れば deploy key OK
git commit --allow-empty -m "VPS 接続テスト"
git push origin main
cd ~/nomic-bot

# (7) 中央 pm2 ecosystem (~/pm2/ecosystem.config.js) に nomic-bot を追加
# 既に他のアプリで使っている場合は apps 配列に以下のエントリを追記:
#
# {
#   name: 'nomic-bot',
#   script: '/home/baku/nomic-bot/dist/index.js',
#   cwd: '/home/baku/nomic-bot',
#   autorestart: true,
#   max_memory_restart: '256M',
#   env: { NODE_ENV: 'production' },
#   out_file: '/home/baku/nomic-bot/logs/out.log',
#   error_file: '/home/baku/nomic-bot/logs/err.log',
#   time: true,
# }
#
# 中央 ecosystem を使わず単独で動かしたい場合は、リポ直下の
# ecosystem.config.cjs をそのまま使ってよい:
# pm2 start ecosystem.config.cjs   # 初回のみ

# (8) ビルドして初回起動 (中央 ecosystem 採用時)
yarn install --frozen-lockfile
yarn build
pm2 reload ~/pm2/ecosystem.config.js --only nomic-bot
pm2 save

# (9) pm2 を OS 起動時に自動再開 (まだなら)
pm2 startup                    # 出力された sudo コマンドを実行
# 以後の更新は CI に任せる (次節)
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
4. `pm2 reload ~/pm2/ecosystem.config.js --only nomic-bot --update-env`
5. `pm2 save`

初回起動は (8) で済ませる前提なので、以後の `git push` は無停止リロード。

進捗は GitHub の **Actions** タブで見える。手動実行したいときは Actions タブ → "Deploy" → "Run workflow"。

## 永続化の前提

進行中ゲームの runtime 状態 (誰の手番か、進行中の提案、投票の reaction メッセージ ID など) は **`CACHE_DIR` 配下**に JSON で持っています。再デプロイ時の `git reset --hard` は **追跡ファイルだけ**を上書きするので、`.cache/` (gitignore 済み) は**生き残ります**。

ただし以下を避ければ常に安全:

- `rm -rf .cache/` を打たない
- bot ディレクトリを clone し直す前に `.cache/` をバックアップする (or `CACHE_DIR` を `/var/lib/nomic-bot-cache` のような外部パスにしておく)
- VPS_PATH を変更しない (もし変えるなら旧 `.cache/` を新パスにコピー)

`CACHE_DIR` を bot ディレクトリの外に置けば、デプロイ・clone・rm 全部から物理的に分離されて事故が起きにくい。

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
