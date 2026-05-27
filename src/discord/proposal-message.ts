import { VOTE_YES, VOTE_NO, VOTE_ABSTAIN } from './reactions.js';

export function buildProposalMessageContent(opts: {
  proposerId: string;
  rawText: string;
  interpretation: string;
  op: 'enact' | 'modify' | 'repeal';
  targetRuleNumber: number | null;
  newRuleText: string | null;
  deadlineStr: string;
  amendedFromOriginal?: boolean;
  amendReason?: string;
}): string {
  const opLabel = opts.op === 'enact' ? '制定' : opts.op === 'modify' ? '修正' : '廃止';
  const targetPart = opts.targetRuleNumber !== null ? ` Rule ${opts.targetRuleNumber}` : '';
  const newTextPart = opts.newRuleText ? `\n新本文: ${opts.newRuleText}` : '';
  const headerLabel = opts.amendedFromOriginal ? '📝 **提案 (修正版)** by' : '📝 **提案** by';
  const lines = [
    `${headerLabel} <@${opts.proposerId}>`,
    '',
    `> ${opts.rawText.split('\n').join('\n> ')}`,
    '',
  ];
  if (opts.amendedFromOriginal && opts.amendReason) {
    lines.push(`(修正理由: ${opts.amendReason})`);
    lines.push('');
  }
  lines.push(`**解釈**: ${opts.interpretation}`);
  lines.push(`操作: ${opLabel}${targetPart}${newTextPart}`);
  lines.push('');
  lines.push(
    `参加者全員が ${VOTE_YES} 賛成 / ${VOTE_NO} 反対 / ${VOTE_ABSTAIN} 棄権 で投票してください。`,
  );
  lines.push(
    `**${opts.deadlineStr} まで**に全員の投票が揃えば即時集計、全員一致 (棄権は除外) で採択されます。`,
  );
  return lines.join('\n');
}
