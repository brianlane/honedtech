import type { AccountSignal, EnterpriseAccount } from './types';

// Accounts are ranked by signal strength rather than headcount. A 60-person
// company that just cut 40 people is a far better conversation than a quiet
// 900-person one, and sorting by size would get that exactly backwards.

export function totalMonthlyReclaim(signals: AccountSignal[]): number {
  return signals.reduce((sum, s) => sum + s.monthlyReclaimUsd, 0);
}

// Strongest single reason to make contact, which is what the subject line and
// the opening sentence are built from.
export function primarySignal(signals: AccountSignal[]): AccountSignal | null {
  if (signals.length === 0) {
    return null;
  }
  return [...signals].sort((a, b) => b.strength - a.strength)[0];
}

// Composite score. The strongest signal dominates, corroborating ones add a
// decayed bonus so an account with a layoff AND a duplicated stack outranks
// either alone, and dollars break ties because a bigger recovery is an easier
// sale.
export function accountScore(account: EnterpriseAccount): number {
  const sorted = [...account.signals].sort((a, b) => b.strength - a.strength);
  if (sorted.length === 0) {
    return 0;
  }
  let score = sorted[0].strength;
  for (let i = 1; i < sorted.length; i += 1) {
    score += sorted[i].strength / (i + 1);
  }
  // Capped so a single enormous recovery cannot outrank genuine signal depth.
  score += Math.min(totalMonthlyReclaim(account.signals) / 100, 25);
  return Math.round(score * 10) / 10;
}

// Highest score first, then company name so equal scores stay in a stable
// order across runs.
export function rankAccounts(accounts: EnterpriseAccount[]): EnterpriseAccount[] {
  return [...accounts].sort((a, b) => {
    const diff = accountScore(b) - accountScore(a);
    return diff !== 0 ? diff : a.company.localeCompare(b.company);
  });
}
