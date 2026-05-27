import type { Game } from './state.js';
import type { ActiveProposal } from './frontmatter.js';

export type ApplyResult = {
  game: Game;
  ruleNumber: number;
};

export function applyProposal(game: Game, proposal: ActiveProposal): ApplyResult {
  const next = { ...game, rules: [...game.rules] };

  if (proposal.op === 'enact') {
    if (!proposal.new_rule_text) throw new Error('enact requires new_rule_text');
    const nextNumber = computeNextRuleNumber(next.rules);
    next.rules.push(`${nextNumber}. ${proposal.new_rule_text}`);
    return { game: next, ruleNumber: nextNumber };
  }
  if (proposal.op === 'modify') {
    if (proposal.target_rule_number == null || !proposal.new_rule_text) {
      throw new Error('modify requires target_rule_number and new_rule_text');
    }
    const prefix = `${proposal.target_rule_number}.`;
    const idx = next.rules.findIndex((r) => r.trimStart().startsWith(prefix));
    if (idx === -1) throw new Error(`rule ${proposal.target_rule_number} not found`);
    next.rules[idx] = `${proposal.target_rule_number}. ${proposal.new_rule_text}`;
    return { game: next, ruleNumber: proposal.target_rule_number };
  }
  if (proposal.target_rule_number == null) throw new Error('repeal requires target_rule_number');
  const prefix = `${proposal.target_rule_number}.`;
  const idx = next.rules.findIndex((r) => r.trimStart().startsWith(prefix));
  if (idx === -1) throw new Error(`rule ${proposal.target_rule_number} not found`);
  next.rules.splice(idx, 1);
  return { game: next, ruleNumber: proposal.target_rule_number };
}

function computeNextRuleNumber(rules: string[]): number {
  let max = 200;
  for (const r of rules) {
    const m = /^\s*(\d+)\./.exec(r);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n > max) max = n;
    }
  }
  return max + 1;
}
