import type { ChatInputCommandInteraction } from 'discord.js';
import type { Config } from '../../config.js';
import { findGameByChannel } from '../../game/state.js';

export async function handleInteraction(
  interaction: ChatInputCommandInteraction,
  config: Config,
): Promise<void> {
  switch (interaction.commandName) {
    case 'rules':
      await handleRules(interaction, config);
      break;
    case 'status':
      await handleStatus(interaction, config);
      break;
    case 'propose':
    case 'vote':
    case 'leave':
    case 'cancel':
      await interaction.reply({
        content: `\`/${interaction.commandName}\` はまだ実装されていません (TODO)。`,
        ephemeral: true,
      });
      break;
    default:
      await interaction.reply({ content: '不明なコマンドです', ephemeral: true });
  }
}

async function handleRules(
  interaction: ChatInputCommandInteraction,
  config: Config,
): Promise<void> {
  const game = findGameByChannel(config.gamesDir, interaction.channelId);
  if (!game) {
    await interaction.reply({
      content: 'このチャンネルにはまだゲームがありません。',
      ephemeral: true,
    });
    return;
  }
  const body = game.rules.map((r) => `- ${r}`).join('\n');
  await interaction.reply({ content: `**${game.name} のルール**\n${body}` });
}

async function handleStatus(
  interaction: ChatInputCommandInteraction,
  config: Config,
): Promise<void> {
  const game = findGameByChannel(config.gamesDir, interaction.channelId);
  if (!game) {
    await interaction.reply({
      content: 'このチャンネルにはまだゲームがありません。',
      ephemeral: true,
    });
    return;
  }
  const lines = [
    `**ゲーム: ${game.name}**`,
    `ステータス: ${game.frontmatter.status}`,
    `参加者: ${game.participants.map((p) => p.mention).join(' ')}`,
    `現在の手番: ${game.frontmatter.current_turn ? `<@${game.frontmatter.current_turn}>` : 'なし'}`,
    `進行中の提案: ${game.frontmatter.active_proposal ?? 'なし'}`,
    `ルール数: ${game.rules.length}`,
  ];
  await interaction.reply({ content: lines.join('\n') });
}
