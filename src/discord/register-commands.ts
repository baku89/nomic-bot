import 'dotenv/config';
import { REST, Routes, SlashCommandBuilder } from 'discord.js';

const commands = [
  new SlashCommandBuilder()
    .setName('start')
    .setDescription('新規ゲームを開始する (allowlist権限が必要)')
    .addStringOption((o) =>
      o.setName('name').setDescription('ゲーム名 (英数字・ハイフン・アンダースコア)').setRequired(true),
    )
    .addStringOption((o) =>
      o.setName('players').setDescription('参加者のメンション (@user1 @user2 ...)').setRequired(true),
    ),
  new SlashCommandBuilder()
    .setName('propose')
    .setDescription('ルール改変の提案を行う')
    .addStringOption((o) =>
      o.setName('text').setDescription('提案文 (自由テキスト)').setRequired(true),
    ),
  new SlashCommandBuilder().setName('rules').setDescription('現在のルールブックを表示'),
  new SlashCommandBuilder().setName('status').setDescription('現在のゲーム状態を表示'),
  new SlashCommandBuilder()
    .setName('end')
    .setDescription('ゲームを強制終了する (allowlist権限が必要)')
    .addUserOption((o) =>
      o.setName('winner').setDescription('勝者 (任意)').setRequired(false),
    )
    .addStringOption((o) =>
      o.setName('reason').setDescription('終了理由 (任意)').setRequired(false),
    ),
].map((c) => c.toJSON());

const token = process.env.DISCORD_BOT_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID;
if (!token || !clientId) {
  console.error('DISCORD_BOT_TOKEN と DISCORD_CLIENT_ID が必要です');
  process.exit(1);
}

const rest = new REST({ version: '10' }).setToken(token);

console.log('スラッシュコマンドをグローバル登録中 (反映まで最大1時間)...');
await rest.put(Routes.applicationCommands(clientId), { body: commands });
console.log(`${commands.length} 個のコマンドを登録しました`);
