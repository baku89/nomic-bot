import type { Message } from 'discord.js';
import type { Config } from '../config.js';

type ErrorKind = 'rate_limit' | 'overloaded' | 'auth' | 'unknown';

function classifyError(err: unknown): ErrorKind {
  if (!err || typeof err !== 'object') return 'unknown';
  const e = err as { status?: number; statusCode?: number; message?: string };
  const status = e.status ?? e.statusCode;
  if (status === 429) return 'rate_limit';
  if (status === 401 || status === 403) return 'auth';
  if (typeof status === 'number' && status >= 500 && status < 600) return 'overloaded';
  const msg = String(e.message ?? '').toLowerCase();
  if (msg.includes('quota') || msg.includes('rate limit') || msg.includes('429')) return 'rate_limit';
  if (msg.includes('unauthorized') || msg.includes('api key')) return 'auth';
  if (msg.includes('overload') || msg.includes('unavailable') || msg.includes('high demand')) return 'overloaded';
  return 'unknown';
}

export async function reportHandlerError(err: unknown, message: Message, config: Config): Promise<void> {
  if (!message.channel.isSendable()) return;

  const kind = classifyError(err);
  const maintainer = config.maintainerDiscordId ? `<@${config.maintainerDiscordId}> ` : '';

  if (kind === 'rate_limit') {
    await message.channel.send(
      `⚠️ ${maintainer}LLM API のレート制限/クォータに達しました。しばらく時間をおくか、API キーの状況を確認してください。`,
    );
    return;
  }

  if (kind === 'overloaded') {
    await message.channel.send(
      `⚠️ ${maintainer}LLM API のサーバが現在過負荷です (5xx)。自動リトライ後も復帰しませんでした。少し時間を置いてからもう一度試してみてください。`,
    );
    return;
  }

  if (kind === 'auth') {
    await message.channel.send(
      `⚠️ ${maintainer}LLM API の認証エラーです。API キーが無効か期限切れの可能性があります。`,
    );
    return;
  }

  await message.channel.send(
    `⚠️ ${maintainer}処理中にエラーが発生しました。ログを確認してください。`,
  );
}
