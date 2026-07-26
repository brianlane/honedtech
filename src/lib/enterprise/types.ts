// Shared types for the Enterprise outreach track. As with src/lib/prospect,
// everything in this folder is pure and coverage-gated; the network runners
// that feed it live in scripts/.

export type SignalKind = 'layoff' | 'stack_overlap' | 'admin_churn';

// One WARN Act filing, normalized. Every field except the employer is optional
// because state agencies publish wildly different subsets and a partial record
// still carries a usable signal.
export interface WarnRecord {
  employer: string;
  city?: string;
  state?: string;
  employeesAffected?: number;
  noticeDate?: string;
  effectiveDate?: string;
  closureType?: string;
  // Link back to the official state filing, so every claim is checkable.
  sourceUrl?: string;
}

// A named tool found in a job posting, with the function it serves.
export interface DetectedTool {
  name: string;
  category: string;
}

export interface CategoryOverlap {
  category: string;
  label: string;
  tools: string[];
}

// One reason to contact an account, and what it is worth.
export interface AccountSignal {
  kind: SignalKind;
  // Prospect-facing one-liner.
  headline: string;
  // Estimated recoverable monthly spend in USD (0 when not a dollar item).
  monthlyReclaimUsd: number;
  // Ranking weight; higher sorts first.
  strength: number;
  // Short provenance shown in the research brief, never in the email body.
  evidence?: string;
}

export interface EnterpriseAccount {
  company: string;
  domain: string;
  city?: string;
  state?: string;
  signals: AccountSignal[];
}
