const JST_FORMATTER = new Intl.DateTimeFormat('ja-JP', {
  timeZone: 'Asia/Tokyo',
  month: 'long',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

export function formatDeadlineJST(date: Date): string {
  return `${JST_FORMATTER.format(date)} JST`;
}

export function hoursFromNow(hours: number): Date {
  return new Date(Date.now() + hours * 60 * 60 * 1000);
}

export function formatRelativeFromNow(deadline: Date): string {
  const diffMs = deadline.getTime() - Date.now();
  if (diffMs < 0) return '期限超過';
  const totalMin = Math.round(diffMs / 60000);
  if (totalMin < 60) return `約${totalMin}分後`;
  const totalH = totalMin / 60;
  if (totalH < 24) {
    const h = Math.round(totalH * 10) / 10;
    return `約${h}時間後`;
  }
  const days = Math.round(totalH / 24);
  return `約${days}日後`;
}

export async function evaluateDeadlineSafe(
  llmEval: () => Promise<{ deadline_iso: string | null; reason: string }>,
  fallbackHours = 24,
): Promise<{ deadline: Date; reason: string }> {
  try {
    const res = await llmEval();
    if (res.deadline_iso) {
      const d = new Date(res.deadline_iso);
      if (!isNaN(d.getTime()) && d.getTime() > Date.now()) {
        return { deadline: d, reason: res.reason };
      }
    }
  } catch (err) {
    console.error('[rule-engine] deadline evaluation failed, fallback:', err);
  }
  return {
    deadline: hoursFromNow(fallbackHours),
    reason: `(fallback) ${fallbackHours}時間後`,
  };
}
