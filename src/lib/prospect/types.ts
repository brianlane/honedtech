// Shared types for the outreach "Prospector" pipeline. The pure
// classification logic in this folder is coverage-gated; the network runner
// that feeds it lives in scripts/ (outside the gate).

export type Platform =
  | 'shopify'
  | 'wix'
  | 'squarespace'
  | 'godaddy'
  | 'wordpress'
  | 'webflow'
  | 'weebly'
  | 'unknown';

export type EmailProvider = 'google' | 'microsoft' | 'other' | 'none';

// Raw evidence gathered by the network runner for one domain. Every field is
// optional so a partial probe (timeouts, blocked requests) still classifies.
export interface DomainProbe {
  domain: string;
  finalUrl?: string;
  redirectedToHttps?: boolean;
  statusCode?: number;
  headers?: Record<string, string>;
  html?: string;
  htmlBytes?: number;
  requestCount?: number;
  mxRecords?: string[];
  txtRecords?: string[];
  dmarcRecords?: string[];
}

export type FindingCode =
  | 'ecommerce_platform_no_store'
  | 'paid_email_hosting'
  | 'missing_email_auth'
  | 'page_builder_site'
  | 'ada_overlay_widget'
  | 'stale_site'
  | 'widget_overlap'
  | 'heavy_page'
  | 'no_https_redirect';

export interface Finding {
  code: FindingCode;
  // One-line, prospect-facing summary of the waste.
  headline: string;
  // Estimated recoverable monthly spend in USD (0 when not a dollar item).
  monthlyWasteUsd: number;
  // Ordering weight; higher shows first in the email.
  severity: number;
  // Calculator option this specific finding maps to, when the code alone is
  // not specific enough. One page-builder finding can mean Wix, Squarespace,
  // or GoDaddy, and the prefilled link has to price whichever one the email
  // actually names.
  calcOptionId?: string;
}
