import type { ChatInputCommandInteraction, Message, SendableChannels } from 'discord.js';
import type { Config } from '../../config.js';
import { findGameByChannel, endGame, writeGame, mentionOf } from '../../game/state.js';
import { GitGameRepo } from '../../git/commit.js';
import { createLLMProvider } from '../../llm/index.js';
import { interpretProposal } from '../../llm/propose-interpreter.js';
import { formatDeadlineJST, hoursFromNow } from '../../utils/time.js';
import { VOTE_YES, VOTE_NO, VOTE_ABSTAIN } from '../reactions.js';
import { startGameAndAnnounce } from '../game-start.js';

export async function handleInteraction(
  interaction: ChatInputCommandInteraction,
  config: Config,
): Promise<void> {
  switch (interaction.commandName) {
    case 'start':
      await handleStart(interaction, config);
      break;
    case 'rules':
      await handleRules(interaction, config);
      break;
    case 'status':
      await handleStatus(interaction, config);
      break;
    case 'end':
      await handleEnd(interaction, config);
      break;
    case 'propose':
      await handlePropose(interaction, config);
      break;
    default:
      await interaction.reply({ content: '不明なコマンドです', ephemeral: true });
  }
}

async function handleStart(
  interaction: ChatInputCommandInteraction,
  config: Config,
): Promise<void> {
  if (!config.allowlist.includes(interaction.user.id)) {
    await interaction.reply({
      content: 'ゲーム開始は allowlist に登録されたアカウントだけが行えます。',
      ephemeral: true,
    });
    return;
  }
  const name = interaction.options.getString('name', true);
  const playersStr = interaction.options.getString('players', true);
  const mentions = playersStr.match(/<@!?\d+>/g) ?? [];

  if (!interaction.channel?.isSendable()) {
    await interaction.reply({ content: 'このチャンネルには送信できません。', ephemeral: true });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  const result = await startGameAndAnnounce({
    channel: interaction.channel as SendableChannels,
    name,
    participantMentions: mentions,
    starterUserId: interaction.user.id,
    botUserId: interaction.client.user.id,
    guildId: interaction.guildId ?? '',
    config,
  });

  if (!result.ok) {
    await interaction.editReply(result.error);
  } else {
    await interaction.editReply(`ゲーム「${result.game.name}」を開始しました。`);
  }
}

async function handlePropose(
  interaction: ChatInputCommandInteraction,
  config: Config,
): Promise<void> {
  const text = interaction.options.getString('text', true);
  const game = findGameByChannel(config.gamesDir, interaction.channelId);
  if (!game) {
    await interaction.reply({
      content: 'このチャンネルにはアクティブなゲームがありません。',
      ephemeral: true,
    });
    return;
  }
  if (!game.participants.some((p) => p.discordId === interaction.user.id)) {
    await interaction.reply({
      content: 'あなたはこのゲームの参加者ではありません。',
      ephemeral: true,
    });
    return;
  }
  if (game.frontmatter.current_turn !== interaction.user.id) {
    const currentMention = game.frontmatter.current_turn
      ? `<@${game.frontmatter.current_turn}>`
      : '不明';
    await interaction.reply({
      content: `今はあなたの手番ではありません。現在の手番: ${currentMention}`,
      ephemeral: true,
    });
    return;
  }
  if (game.frontmatter.active_proposal) {
    await interaction.reply({
      content: '既に進行中の提案があります。投票が確定するまで待ってください。',
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply();

  const llm = createLLMProvider(config);
  const interp = await interpretProposal(llm, text, game.rules);

  const voteDeadline = hoursFromNow(24);
  const deadlineStr = formatDeadlineJST(voteDeadline);

  const opLabel = interp.op === 'enact' ? '制定' : interp.op === 'modify' ? '修正' : '廃止';
  const targetPart = interp.target_rule_number !== null ? ` Rule ${interp.target_rule_number}` : '';
  const newTextPart = interp.new_rule_text ? `\n新本文: ${interp.new_rule_text}` : '';

  const proposalContent = [
    `📝 **提案** by <@${interaction.user.id}>`,
    '',
    `> ${text.split('\n').join('\n> ')}`,
    '',
    `**解釈**: ${interp.interpretation}`,
    `操作: ${opLabel}${targetPart}${newTextPart}`,
    '',
    `参加者全員が ${VOTE_YES} (yes) / ${VOTE_NO} (no) / ${VOTE_ABSTAIN} (棄権) で投票してください。`,
    `**24時間以内 (${deadlineStr} まで)** に全員の投票が揃えば即時集計、全員一致 (棄権は除外) で採択されます。`,
    `(意図と異なる場合は管理者に \`/end\` での介入を依頼してください)`,
  ].join('\n');

  const reply = await interaction.editReply({ content: proposalContent });
  const proposalMsg = reply as Message;

  await proposalMsg.react(VOTE_YES);
  await proposalMsg.react(VOTE_NO);
  await proposalMsg.react(VOTE_ABSTAIN);

  game.frontmatter.active_proposal = {
    id: `P-${Date.now()}`,
    proposer_id: interaction.user.id,
    op: interp.op,
    target_rule_number: interp.target_rule_number,
    new_rule_text: interp.new_rule_text,
    interpretation: interp.interpretation,
    raw_text: text,
    proposed_at: new Date().toISOString(),
    vote_deadline: voteDeadline.toISOString(),
    vote_message_id: proposalMsg.id,
  };
  writeGame(config.gamesDir, game);
}

async function handleEnd(
  interaction: ChatInputCommandInteraction,
  config: Config,
): Promise<void> {
  if (!config.allowlist.includes(interaction.user.id)) {
    await interaction.reply({
      content: 'ゲームの強制終了は allowlist に登録されたアカウントだけが行えます。',
      ephemeral: true,
    });
    return;
  }

  const game = findGameByChannel(config.gamesDir, interaction.channelId);
  if (!game) {
    await interaction.reply({
      content: 'このチャンネルにはアクティブなゲームがありません。',
      ephemeral: true,
    });
    return;
  }

  const winner = interaction.options.getUser('winner', false);
  const reason = interaction.options.getString('reason', false);
  const winnerMention = winner ? `<@${winner.id}>` : undefined;

  endGame(config.gamesDir, game, {
    winnerMention,
    reason: reason ?? undefined,
  });

  const repo = new GitGameRepo(config.gamesDir);
  await repo.ensureRepo();
  const commitMsg = winner
    ? `[${game.name}] ゲーム終了: <@${winner.id}> の勝利${reason ? ` — ${reason}` : ''}`
    : `[${game.name}] ゲーム強制終了${reason ? `: ${reason}` : ''}`;
  await repo.commit(commitMsg);

  const lines = [
    `**ゲーム「${game.name}」が終了しました。** (強制終了 by <@${interaction.user.id}>)`,
    winner ? `🏆 勝者: <@${winner.id}>` : '勝者: なし',
  ];
  if (reason) lines.push(`理由: ${reason}`);
  lines.push(`最終ルール数: ${game.rules.length} 条`);
  lines.push(`アーカイブ: \`archive/${game.name}.md\``);

  await interaction.reply(lines.join('\n'));
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
  const activeText = game.frontmatter.active_proposal
    ? `あり (${game.frontmatter.active_proposal.interpretation})`
    : 'なし';
  const lines = [
    `**ゲーム: ${game.name}**`,
    `ステータス: ${game.frontmatter.status}`,
    `参加者: ${game.participants.map((p) => mentionOf(p)).join(' ')}`,
    `現在の手番: ${game.frontmatter.current_turn ? `<@${game.frontmatter.current_turn}>` : 'なし'}`,
    `進行中の提案: ${activeText}`,
    `ルール数: ${game.rules.length}`,
  ];
  await interaction.reply({ content: lines.join('\n') });
}
