import type { Client, SendableChannels } from 'discord.js';
import type { Config } from '../config.js';
import {
  findGameByChannel,
  gameNameTaken,
  createNewGame,
  writeGame,
  mentionOf,
  judgeFor,
  type Participant,
  type Game,
} from '../game/state.js';
import { GitGameRepo } from '../git/commit.js';
import { getGamesRepoUrl, gameFileUrl } from '../game/repo-url.js';
import { setChannelGame } from '../game/channel-cache.js';
import { formatDeadlineJST, hoursFromNow } from '../utils/time.js';

export type StartGameResult =
  | { ok: true; game: Game }
  | { ok: false; error: string };

export async function startGameAndAnnounce(opts: {
  channel: SendableChannels;
  name: string;
  participantMentions: string[];
  starterUserId: string;
  botUserId: string;
  config: Config;
}): Promise<StartGameResult> {
  if (gameNameTaken(opts.config.gamesDir, opts.name)) {
    return {
      ok: false,
      error: `ゲーム名「${opts.name}」は既に存在します。別の名前を指定してください。`,
    };
  }
  if (findGameByChannel(opts.config.gamesDir, opts.channel.id)) {
    return {
      ok: false,
      error: 'このチャンネルでは既にゲームが進行中です。1チャンネル1ゲームの制限があります。',
    };
  }

  const participants = await resolveParticipants(
    opts.channel.client,
    opts.participantMentions,
    opts.botUserId,
  );
  if (participants.length === 0) {
    return {
      ok: false,
      error: '参加者が見つかりませんでした。`<@ユーザ>` の形式で1人以上の参加者をメンションしてください (Bot自身は参加者に含められません)。',
    };
  }

  console.log(`[start] creating game "${opts.name}" with ${participants.length} participant(s)`);

  const game = createNewGame({
    name: opts.name,
    participants,
  });
  writeGame(opts.config.gamesDir, game);
  setChannelGame(opts.channel.id, game.fileStem);
  console.log(`[start] wrote ${game.fileStem}.md and cached channel mapping`);

  let starterUsername = '';
  try {
    starterUsername = (await opts.channel.client.users.fetch(opts.starterUserId)).username;
  } catch {
    starterUsername = opts.starterUserId;
  }

  const repo = new GitGameRepo(opts.config.gamesDir);
  await repo.ensureRepo();
  await repo.commit(
    `新規ゲーム ${game.name} 開始 by \`@${starterUsername}\` (参加者: ${participants
      .map((p) => `\`@${p.username || p.discordId}\``)
      .join(', ')})`,
  );
  console.log(`[start] committed`);

  const repoUrl = await getGamesRepoUrl(opts.config.gamesDir);
  const gameUrl = repoUrl ? gameFileUrl(repoUrl, game.fileStem, false) : null;

  const judge = judgeFor(game);
  const judgeMention = judge ? mentionOf(judge) : null;

  const announcement = buildOpeningAnnouncement({
    gameName: game.name,
    participantMentions: participants.map((p) => mentionOf(p)),
    firstPlayerMention: participants[0] ? mentionOf(participants[0]) : '(参加者未指定)',
    judgeMention,
    proposalDeadline: formatDeadlineJST(hoursFromNow(24)),
    rules: game.rules,
    gameUrl,
    repoUrl,
  });
  console.log(`[start] announcement built (${announcement.length} chars), sending...`);
  try {
    await sendLongMessage(opts.channel, announcement);
    console.log(`[start] announcement sent`);
  } catch (err) {
    console.error(`[start] announcement send failed:`, err);
    throw err;
  }

  return { ok: true, game };
}

async function resolveParticipants(
  client: Client,
  mentions: string[],
  botUserId: string,
): Promise<Participant[]> {
  const result: Participant[] = [];
  for (const mention of mentions) {
    const idMatch = /<@!?(\d+)>/.exec(mention);
    if (!idMatch) continue;
    const id = idMatch[1];
    if (id === botUserId) continue;
    let username = '';
    try {
      const user = await client.users.fetch(id);
      username = user.username;
    } catch {
      // fallback: leave username empty
    }
    result.push({ discordId: id, username });
  }
  return result;
}

function buildOpeningAnnouncement(opts: {
  gameName: string;
  participantMentions: string[];
  firstPlayerMention: string;
  judgeMention: string | null;
  proposalDeadline: string;
  rules: string[];
  gameUrl: string | null;
  repoUrl: string | null;
}): string {
  const repoLink = opts.repoUrl ? `<${opts.repoUrl}>` : '公開リポジトリ';
  return [
    `**ゲーム「${opts.gameName}」を開始しました。** (ミニマムノミック / 全 9 条)`,
    ...(opts.gameUrl ? [`📄 進行状況: <${opts.gameUrl}>`] : []),
    'ℹ️ ノミックについて: <https://ja.wikipedia.org/wiki/%E3%83%8E%E3%83%9F%E3%83%83%E3%82%AF>',
    `⚠️ **このゲームの全記録 (Discord ユーザ名・全提案・全採決・全ルール改変) は公開リポジトリ ${repoLink} に保存されます。** 参加に同意した時点でこれらを公開することに同意したとみなします。`,
    '',
    'ノミックは「ルールを変えていくゲーム」です。プレイヤーは順番にルール改変を提案し、**全員一致**で採択されます。採択されたルールは即座に発効するため、ゲームのあり方そのものが変わっていきます。勝利条件すら最初は定められていません — それも今後の議論で決まります。',
    '',
    '**初期条件**',
    `- 参加者 (この順で手番): ${opts.participantMentions.join(' → ')}`,
    `- 最初の手番: ${opts.firstPlayerMention}`,
    ...(opts.judgeMention ? [`- 現在の裁定者 (Rule 109): ${opts.judgeMention}`] : []),
    '- 採択要件: 全員一致 (Rule 105)',
    '- 勝利条件: 未定 (ルール改変で設定可能)',
    '',
    '**初期ルール (全 9 条)**',
    ...opts.rules.map((r) => `- ${r}`),
    '',
    '以降は `/status` でゲーム状態とルール一覧を再表示できます。',
    '',
    `${opts.firstPlayerMention} さん、あなたの手番です。**24時間以内 (${opts.proposalDeadline} まで)** に \`/propose <提案文>\` で提案してください。`,
  ].join('\n');
}

async function sendLongMessage(channel: SendableChannels, content: string): Promise<void> {
  const MAX = 1900;
  if (content.length <= MAX) {
    await channel.send(content);
    return;
  }
  const chunks: string[] = [];
  let buf = '';
  for (const line of content.split('\n')) {
    if ((buf + '\n' + line).length > MAX) {
      chunks.push(buf);
      buf = line;
    } else {
      buf = buf ? `${buf}\n${line}` : line;
    }
  }
  if (buf) chunks.push(buf);
  for (const chunk of chunks) {
    await channel.send(chunk);
  }
}
