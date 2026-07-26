import type { JobPosting } from './ats';
import type { AccountSignal, CategoryOverlap, DetectedTool } from './types';

// What a company hires for is what a company runs. A req for a "Workday
// administrator" is proof Workday is deployed, and three BI tools named across
// one job board is the enterprise version of the widget-overlap finding on the
// SMB side.
//
// The published benchmark is that the median organization has three or more
// tools covering a single function across seven separate categories, so this
// looks for something known to be common rather than fishing.

interface CategoryDef {
  id: string;
  label: string;
  tools: { name: string; pattern: RegExp }[];
}

// Word-boundary anchored so "Looker" does not match "looking" and "SAP" does
// not match "sapphire".
function tool(name: string, expr: string): { name: string; pattern: RegExp } {
  return { name, pattern: new RegExp(`\\b${expr}\\b`, 'i') };
}

const CATEGORIES: CategoryDef[] = [
  {
    id: 'bi',
    label: 'business intelligence',
    tools: [
      tool('Tableau', 'tableau'),
      tool('Power BI', 'power\\s?bi'),
      tool('Looker', 'looker'),
      tool('Qlik', 'qlik'),
      tool('Domo', 'domo'),
    ],
  },
  {
    id: 'pm',
    label: 'project management',
    tools: [
      tool('Jira', 'jira'),
      tool('Asana', 'asana'),
      tool('Monday.com', 'monday\\.com'),
      tool('Smartsheet', 'smartsheet'),
      tool('Wrike', 'wrike'),
      tool('ClickUp', 'clickup'),
    ],
  },
  {
    id: 'crm',
    label: 'CRM',
    tools: [
      tool('Salesforce', 'salesforce'),
      tool('HubSpot', 'hubspot'),
      tool('Microsoft Dynamics', 'dynamics 365|ms dynamics'),
      tool('Zoho', 'zoho'),
      tool('Pipedrive', 'pipedrive'),
    ],
  },
  {
    id: 'marketing',
    label: 'marketing automation',
    tools: [
      tool('Marketo', 'marketo'),
      tool('Pardot', 'pardot'),
      tool('Eloqua', 'eloqua'),
      tool('Mailchimp', 'mailchimp'),
      tool('Klaviyo', 'klaviyo'),
      tool('Braze', 'braze'),
    ],
  },
  {
    id: 'itsm',
    label: 'service desk',
    tools: [
      tool('ServiceNow', 'servicenow'),
      tool('Zendesk', 'zendesk'),
      tool('Freshservice', 'freshservice|freshdesk'),
      tool('Jira Service Management', 'jira service management'),
    ],
  },
  {
    id: 'hris',
    label: 'HR and payroll',
    tools: [
      tool('Workday', 'workday'),
      tool('BambooHR', 'bamboohr'),
      tool('ADP', 'adp'),
      tool('Paylocity', 'paylocity'),
      tool('Rippling', 'rippling'),
      tool('Gusto', 'gusto'),
    ],
  },
  {
    id: 'erp',
    label: 'ERP and finance',
    tools: [
      tool('SAP', 'sap'),
      tool('NetSuite', 'netsuite'),
      tool('Oracle ERP', 'oracle erp|oracle financials'),
      tool('Coupa', 'coupa'),
      tool('Workiva', 'workiva'),
    ],
  },
  {
    id: 'comms',
    label: 'messaging and meetings',
    tools: [
      tool('Slack', 'slack'),
      tool('Microsoft Teams', 'microsoft teams|ms teams'),
      tool('Zoom', 'zoom'),
      tool('Webex', 'webex'),
    ],
  },
];

const CATEGORY_LABELS = new Map<string, string>(
  CATEGORIES.map((c) => [c.id, c.label]),
);

export function categoryLabel(id: string): string {
  return CATEGORY_LABELS.get(id) ?? id;
}

// Named tools mentioned anywhere in the text, deduplicated and in a stable
// category-then-catalog order.
export function detectSoftware(text: string): DetectedTool[] {
  if (!text) {
    return [];
  }
  const found: DetectedTool[] = [];
  for (const category of CATEGORIES) {
    for (const entry of category.tools) {
      if (entry.pattern.test(text)) {
        found.push({ name: entry.name, category: category.id });
      }
    }
  }
  return found;
}

// Flattens a job board into one searchable blob. Titles are weighted by being
// included twice, which does not matter for presence detection but keeps the
// helper honest if we ever score by frequency.
export function postingsText(postings: JobPosting[]): string {
  return postings
    .map((p) => `${p.title} ${p.title} ${p.description}`)
    .join('\n');
}

// Functions covered by more than one tool. Two is already worth a
// conversation; the report is where we work out which one wins.
export function overlappingCategories(tools: DetectedTool[]): CategoryOverlap[] {
  const byCategory = new Map<string, string[]>();
  for (const t of tools) {
    const list = byCategory.get(t.category) ?? [];
    if (!list.includes(t.name)) {
      list.push(t.name);
    }
    byCategory.set(t.category, list);
  }
  const out: CategoryOverlap[] = [];
  for (const category of CATEGORIES) {
    const names = byCategory.get(category.id);
    if (names && names.length >= 2) {
      out.push({ category: category.id, label: category.label, tools: names });
    }
  }
  return out.sort((a, b) => b.tools.length - a.tools.length);
}

// Titles that name a tool and a full-time job maintaining it. A dedicated
// administrator req means the deployment is big enough to need one, which
// makes every other finding about that tool land harder.
export function adminRoles(postings: JobPosting[]): DetectedTool[] {
  const out: DetectedTool[] = [];
  const seen = new Set<string>();
  for (const posting of postings) {
    if (!/\b(administrator|admin|specialist)\b/i.test(posting.title)) {
      continue;
    }
    for (const t of detectSoftware(posting.title)) {
      if (!seen.has(t.name)) {
        seen.add(t.name);
        out.push(t);
      }
    }
  }
  return out;
}

function andList(items: string[]): string {
  if (items.length === 2) {
    return `${items[0]} and ${items[1]}`;
  }
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
}

// Turns a job board into contactable signals. Dollar figures stay at zero
// here: we know the tools overlap but not what they pay, and inventing a
// number is exactly what loses the meeting.
export function stackSignals(postings: JobPosting[]): AccountSignal[] {
  const signals: AccountSignal[] = [];
  const tools = detectSoftware(postingsText(postings));

  for (const overlap of overlappingCategories(tools)) {
    signals.push({
      kind: 'stack_overlap',
      headline: `Your job postings name ${andList(
        overlap.tools,
      )}. That is ${overlap.tools.length} tools covering ${
        overlap.label
      }, and the licenses for all of them bill in full.`,
      monthlyReclaimUsd: 0,
      // More tools in one function is a stronger, more specific pitch.
      strength: Math.min(75, 40 + overlap.tools.length * 5),
      evidence: `Detected across ${postings.length} open posting(s): ${overlap.tools.join(', ')}`,
    });
  }

  const admins = adminRoles(postings);
  if (admins.length > 0) {
    const names = admins.map((a) => a.name);
    signals.push({
      kind: 'admin_churn',
      headline: `You are hiring a dedicated administrator for ${
        names.length === 1 ? names[0] : andList(names)
      }. A platform that needs a full-time owner is a platform worth checking the seat count on.`,
      monthlyReclaimUsd: 0,
      strength: 35,
      evidence: `Administrator req(s) naming: ${admins.map((a) => a.name).join(', ')}`,
    });
  }

  return signals.sort((a, b) => b.strength - a.strength);
}
