import 'dotenv/config';
import { REST, Routes, SlashCommandBuilder } from 'discord.js';

const commands = [
  new SlashCommandBuilder()
    .setName('propose')
    .setDescription('ルール改変の提案を行う')
    .addStringOption((o) =>
      o.setName('text').setDescription('提案文 (自由テキスト)').setRequired(true),
    ),
  new SlashCommandBuilder()
    .setName('vote')
    .setDescription('進行中の提案に投票する')
    .addStringOption((o) =>
      o
        .setName('choice')
        .setDescription('yes / no / abstain')
        .setRequired(true)
        .addChoices(
          { name: 'yes', value: 'yes' },
          { name: 'no', value: 'no' },
          { name: 'abstain', value: 'abstain' },
        ),
    ),
  new SlashCommandBuilder().setName('rules').setDescription('現在のルールブックを表示'),
  new SlashCommandBuilder().setName('status').setDescription('現在のゲーム状態を表示'),
  new SlashCommandBuilder().setName('leave').setDescription('ゲームから離脱する'),
  new SlashCommandBuilder().setName('cancel').setDescription('自分の進行中の提案を取り消す'),
].map((c) => c.toJSON());

const token = process.env.DISCORD_BOT_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID;
if (!token || !clientId) {
  console.error('DISCORD_BOT_TOKEN と DISCORD_CLIENT_ID が必要です');
  process.exit(1);
}

const rest = new REST({ version: '10' }).setToken(token);

console.log('スラッシュコマンドを登録中...');
await rest.put(Routes.applicationCommands(clientId), { body: commands });
console.log(`${commands.length} 個のコマンドを登録しました`);
