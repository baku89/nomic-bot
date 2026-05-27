import type { ChatInputCommandInteraction, Message, SendableChannels } from 'discord.js';
import type { Config } from '../../config.js';
import { findGameByChannel, endGame, writeGame, mentionOf } from '../../game/state.js';
import { GitGameRepo } from '../../git/commit.js';
import { getGamesRepoUrl, gameFileUrl } from '../../game/repo-url.js';
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
  const providedName = interaction.options.getString('name', false);
  const playersStr = interaction.options.getString('players', true);
  const mentions = playersStr.match(/<@!?\d+>/g) ?? [];
  const name = providedName?.trim() || autoGameName();

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

  const errors: string[] = [];
  if ((interp.op === 'modify' || interp.op === 'repeal') && interp.target_rule_number == null) {
    errors.push('修正/廃止の対象ルール番号を特定できませんでした (LLMの解釈が「全て」「100番台」など複数や曖昧な対象を含んだ可能性があります)。');
  }
  if ((interp.op === 'enact' || interp.op === 'modify') && !interp.new_rule_text) {
    errors.push('制定/修正の新しいルール本文を読み取れませんでした。');
  }
  if (interp.op !== 'enact' && interp.target_rule_number !== null) {
    const prefix = `${interp.target_rule_number}.`;
    const exists = game.rules.some((r) => r.trimStart().startsWith(prefix));
    if (!exists) {
      errors.push(`Rule ${interp.target_rule_number} は現行ルールに存在しません。`);
    }
  }
  if (errors.length) {
    await interaction.editReply({
      content: [
        '提案を解釈できませんでした:',
        ...errors.map((e) => `- ${e}`),
        '',
        '対象ルール番号と新しい本文を明示して `/propose` を再実行してください。',
      ].join('\n'),
    });
    return;
  }

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
    proposer_username: interaction.user.username,
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
      content: '`/end` はこのゲームの参加者のみ実行できます。',
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
  const enderName = `\`@${interaction.user.username}\``;
  const commitMsg = winner
    ? `[${game.name}] ゲーム終了 by ${enderName}: \`@${winner.username}\` の勝利${reason ? ` — ${reason}` : ''}`
    : `[${game.name}] ゲーム強制終了 by ${enderName}${reason ? `: ${reason}` : ''}`;
  await repo.commit(commitMsg);

  const repoUrl = await getGamesRepoUrl(config.gamesDir);
  const url = repoUrl ? gameFileUrl(repoUrl, game.name, true) : null;
  const lines = [
    `**ゲーム「${game.name}」が終了しました。** (強制終了 by <@${interaction.user.id}>)`,
    winner ? `🏆 勝者: <@${winner.id}>` : '勝者: なし',
  ];
  if (reason) lines.push(`理由: ${reason}`);
  lines.push(`最終ルール数: ${game.rules.length} 条`);
  if (url) lines.push(`📄 アーカイブ: <${url}>`);

  await interaction.reply(lines.join('\n'));
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
  const repoUrl = await getGamesRepoUrl(config.gamesDir);
  const url = repoUrl ? gameFileUrl(repoUrl, game.name, false) : null;
  const activeText = game.frontmatter.active_proposal
    ? `あり (${game.frontmatter.active_proposal.interpretation})`
    : 'なし';

  const header = [
    `**ゲーム: ${game.name}**`,
    ...(url ? [`📄 <${url}>`] : []),
    `ステータス: ${game.frontmatter.status}`,
    `参加者: ${game.participants.map((p) => mentionOf(p)).join(' ')}`,
    `現在の手番: ${game.frontmatter.current_turn ? `<@${game.frontmatter.current_turn}>` : 'なし'}`,
    `進行中の提案: ${activeText}`,
    '',
    `**ルール (全 ${game.rules.length} 条)**`,
  ].join('\n');
  const ruleBody = game.rules.map((r) => `- ${r}`).join('\n');
  const full = `${header}\n${ruleBody}`;

  const MAX = 1900;
  if (full.length <= MAX) {
    await interaction.reply({ content: full });
    return;
  }
  const chunks = splitByLines(full, MAX);
  await interaction.reply({ content: chunks[0] });
  for (let i = 1; i < chunks.length; i++) {
    await interaction.followUp({ content: chunks[i] });
  }
}

function autoGameName(): string {
  const d = new Date();
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `game-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

function splitByLines(content: string, max: number): string[] {
  const chunks: string[] = [];
  let buf = '';
  for (const line of content.split('\n')) {
    if ((buf + '\n' + line).length > max) {
      chunks.push(buf);
      buf = line;
    } else {
      buf = buf ? `${buf}\n${line}` : line;
    }
  }
  if (buf) chunks.push(buf);
  return chunks;
}
