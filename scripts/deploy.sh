#!/usr/bin/env bash
# VPS-side deploy script. Idempotent; runs as part of CI or manually.
set -euo pipefail

cd "$(dirname "$0")/.."

git fetch origin main
git reset --hard origin/main
yarn install --frozen-lockfile
yarn build
yarn register-commands
pm2 reload ~/pm2/ecosystem.config.js --only nomic-bot --update-env
pm2 save
echo "Deploy complete."
