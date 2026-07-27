import { describe, expect, it } from 'vitest';
import {
  MAX_LAG_DAYS,
  MIN_AFFECTED_SEATS,
  MIN_LAG_DAYS,
  daysSinceEffective,
  isWithinContactWindow,
  normalizeWarnRecord,
  selectContactableRecords,
  unreclaimedSeatSpend,
  warnSignal,
} from '../src/lib/enterprise/warn';
import {
  atsFeedUrl,
  detectAtsBoard,
  parseJobFeed,
  type AtsBoard,
} from '../src/lib/enterprise/ats';
import {
  adminRoles,
  categoryLabel,
  detectSoftware,
  overlappingCategories,
  postingsText,
  stackSignals,
} from '../src/lib/enterprise/stack';
import {
  accountScore,
  primarySignal,
  rankAccounts,
  totalMonthlyReclaim,
} from '../src/lib/enterprise/score';
import {
  buildBrief,
  composeEnterpriseEmail,
  enterpriseUrl,
  estimateSeats,
  reclaimUrl,
} from '../src/lib/enterprise/brief';
import {
  MIN_MATCH_RATIO,
  isLikelySameCompany,
  nameMatchRatio,
  significantTokens,
} from '../src/lib/enterprise/match';
import type {
  AccountSignal,
  EnterpriseAccount,
  WarnRecord,
} from '../src/lib/enterprise/types';

const NOW = new Date('2026-07-26T00:00:00Z');
// 90 days before NOW, comfortably inside the contact window.
const IN_WINDOW = '2026-04-27';

describe('normalizeWarnRecord', () => {
  it('maps a canonical aggregator record', () => {
    const record = normalizeWarnRecord({
      employer_canonical: 'Acme Logistics',
      city: 'Tempe',
      state: 'AZ',
      employees: 240,
      notice_date: '2026-03-01',
      effective_date: IN_WINDOW,
      closure_type: 'layoff',
      official_filing_url: 'https://az.gov/warn/1',
    });
    expect(record).toEqual({
      employer: 'Acme Logistics',
      city: 'Tempe',
      state: 'AZ',
      employeesAffected: 240,
      noticeDate: '2026-03-01',
      effectiveDate: IN_WINDOW,
      closureType: 'layoff',
      sourceUrl: 'https://az.gov/warn/1',
    });
  });

  it('accepts the alternate field spellings other providers use', () => {
    const record = normalizeWarnRecord({
      company_name: 'Beta Corp',
      state_code: 'CA',
      employees_affected: 51,
      layoff_date: IN_WINDOW,
      source_url: 'https://ca.gov/warn/2',
      type: 'closure',
    });
    expect(record?.employer).toBe('Beta Corp');
    expect(record?.state).toBe('CA');
    expect(record?.employeesAffected).toBe(51);
    expect(record?.effectiveDate).toBe(IN_WINDOW);
    expect(record?.closureType).toBe('closure');
  });

  it('reads headcounts published as formatted strings', () => {
    expect(normalizeWarnRecord({ employer: 'A', num_employees: '1,240' })?.employeesAffected).toBe(1240);
    expect(normalizeWarnRecord({ employer: 'A', affected: 'approx 300' })?.employeesAffected).toBe(300);
  });

  it('leaves the headcount unset when it cannot be read', () => {
    expect(normalizeWarnRecord({ employer: 'A', employees: 'unknown' })?.employeesAffected).toBeUndefined();
    // A filing that parses to zero affected is not a signal.
    expect(normalizeWarnRecord({ employer: 'A', employees: '0' })?.employeesAffected).toBeUndefined();
    expect(normalizeWarnRecord({ employer: 'A', employees: 0 })?.employeesAffected).toBeUndefined();
    expect(normalizeWarnRecord({ employer: 'A', employees: -4 })?.employeesAffected).toBeUndefined();
    expect(normalizeWarnRecord({ employer: 'A' })?.employeesAffected).toBeUndefined();
  });

  it('rejects anything with no employer to attribute the filing to', () => {
    expect(normalizeWarnRecord(null)).toBeNull();
    expect(normalizeWarnRecord('a string')).toBeNull();
    expect(normalizeWarnRecord([])).toBeNull();
    expect(normalizeWarnRecord({ city: 'Tempe' })).toBeNull();
    expect(normalizeWarnRecord({ employer: '   ' })).toBeNull();
    expect(normalizeWarnRecord({ employer: 42 })).toBeNull();
  });
});

describe('company name matching', () => {
  it('strips legal and country qualifiers but keeps descriptive words', () => {
    expect(significantTokens('Compass Group USA, Inc.')).toEqual(['compass', 'group']);
    expect(significantTokens('The Boeing Company')).toEqual(['boeing']);
    expect(significantTokens('Flagship Facilities Services, LLC')).toEqual([
      'flagship',
      'facilities',
      'services',
    ]);
  });

  it('drops single characters, which carry no signal', () => {
    expect(significantTokens('A & B Logistics')).toEqual(['logistics']);
  });

  // The real failures that motivated this gate. Each of these resolved to an
  // unrelated company's website against live Places results.
  it('rejects the local businesses Places actually returned', () => {
    expect(isLikelySameCompany('USIC Locating Services', 'USI Locate AZ')).toBe(false);
    expect(isLikelySameCompany('Compass Group USA', 'Compass Reporting Group')).toBe(false);
  });

  // A superset scores a perfect one-way match, which is exactly how a Houston
  // builder passed for a national food service company.
  it('counts a candidate\u2019s extra words against it', () => {
    expect(nameMatchRatio('Compass Group USA', 'Compass Building Group')).toBeCloseTo(2 / 3);
    expect(isLikelySameCompany('Compass Group USA', 'Compass Building Group')).toBe(false);
  });

  it('accepts a formal name against its shorter brand form', () => {
    expect(isLikelySameCompany('Rite Aid Corporation', 'Rite Aid')).toBe(true);
    expect(isLikelySameCompany('Flagship Facilities Services, LLC', 'Flagship Facilities Services')).toBe(true);
    // Three of four tokens is exactly the bar.
    expect(nameMatchRatio('Bath Body Works Direct', 'Bath & Body Works')).toBe(MIN_MATCH_RATIO);
    expect(isLikelySameCompany('Bath Body Works Direct', 'Bath & Body Works')).toBe(true);
  });

  it('rejects a candidate sharing only one word of several', () => {
    expect(nameMatchRatio('Acme Logistics Services', 'Acme Dental')).toBeCloseTo(1 / 4);
    expect(isLikelySameCompany('Acme Logistics Services', 'Acme Dental')).toBe(false);
  });

  it('scores zero when either side has nothing distinctive left', () => {
    expect(nameMatchRatio('The Company LLC', 'Anything')).toBe(0);
    expect(nameMatchRatio('Acme Logistics', 'Inc')).toBe(0);
    expect(isLikelySameCompany('', 'Acme')).toBe(false);
  });
});

describe('the contact window', () => {
  const base: WarnRecord = { employer: 'Acme', employeesAffected: 100 };

  it('measures days from the effective date', () => {
    expect(daysSinceEffective({ ...base, effectiveDate: IN_WINDOW }, NOW)).toBe(90);
  });

  it('falls back to the notice date when no effective date is published', () => {
    expect(daysSinceEffective({ ...base, noticeDate: IN_WINDOW }, NOW)).toBe(90);
  });

  it('returns null for a missing or unparseable date', () => {
    expect(daysSinceEffective(base, NOW)).toBeNull();
    expect(daysSinceEffective({ ...base, effectiveDate: 'not-a-date' }, NOW)).toBeNull();
  });

  it('excludes a layoff too recent to contact about decently', () => {
    const days = MIN_LAG_DAYS - 10;
    const recent = new Date(NOW.getTime() - days * 86_400_000).toISOString();
    expect(isWithinContactWindow({ ...base, effectiveDate: recent }, NOW)).toBe(false);
  });

  it('excludes a layoff too old to still be credible', () => {
    const days = MAX_LAG_DAYS + 10;
    const old = new Date(NOW.getTime() - days * 86_400_000).toISOString();
    expect(isWithinContactWindow({ ...base, effectiveDate: old }, NOW)).toBe(false);
  });

  it('excludes a filing with no usable date rather than guessing', () => {
    expect(isWithinContactWindow(base, NOW)).toBe(false);
  });

  it('includes one inside the window', () => {
    expect(isWithinContactWindow({ ...base, effectiveDate: IN_WINDOW }, NOW)).toBe(true);
  });
});

describe('selectContactableRecords', () => {
  const day = (offset: number): string =>
    new Date(NOW.getTime() - offset * 86_400_000).toISOString().slice(0, 10);

  const big = MIN_AFFECTED_SEATS + 5;

  const records: WarnRecord[] = [
    { employer: 'Old', state: 'CA', employeesAffected: big, effectiveDate: day(300) },
    { employer: 'Fresh', state: 'CA', employeesAffected: big, effectiveDate: day(10) },
    { employer: 'Mid', state: 'CA', employeesAffected: big, effectiveDate: day(200) },
    { employer: 'Newest', state: 'TX', employeesAffected: big, effectiveDate: day(50) },
    { employer: 'NoCount', state: 'CA', effectiveDate: day(100) },
    { employer: 'NoDate', state: 'CA', employeesAffected: big },
  ];

  it('keeps only in-window filings that carry a headcount, freshest first', () => {
    expect(selectContactableRecords(records, NOW).map((r) => r.employer)).toEqual([
      'Newest',
      'Mid',
    ]);
  });

  it('drops a layoff too small to be worth a $2,499 pitch', () => {
    const tiny: WarnRecord[] = [
      { employer: 'Tiny', state: 'CA', employeesAffected: 1, effectiveDate: day(100) },
      {
        employer: 'JustUnder',
        state: 'CA',
        employeesAffected: MIN_AFFECTED_SEATS - 1,
        effectiveDate: day(100),
      },
      {
        employer: 'JustOver',
        state: 'CA',
        employeesAffected: MIN_AFFECTED_SEATS,
        effectiveDate: day(100),
      },
    ];
    expect(selectContactableRecords(tiny, NOW).map((r) => r.employer)).toEqual(['JustOver']);
  });

  // A national employer files per site. Amazon alone accounts for over a
  // hundred filings in a typical window, which would exhaust the weekly limit
  // and pay for a Places lookup every time.
  it('keeps only the freshest filing per employer', () => {
    const repeated: WarnRecord[] = [
      { employer: 'Amazon', state: 'CA', employeesAffected: big, effectiveDate: day(200) },
      { employer: '  amazon  ', state: 'TX', employeesAffected: big, effectiveDate: day(60) },
      { employer: 'Amazon', state: 'NY', employeesAffected: big, effectiveDate: day(120) },
    ];
    const picked = selectContactableRecords(repeated, NOW);
    expect(picked).toHaveLength(1);
    expect(picked[0].state).toBe('TX');
  });

  it('narrows to the given states, case-insensitively', () => {
    expect(
      selectContactableRecords(records, NOW, ['tx']).map((r) => r.employer),
    ).toEqual(['Newest']);
  });

  it('ignores blank entries in the state filter', () => {
    expect(selectContactableRecords(records, NOW, ['', '  ']).map((r) => r.employer)).toEqual([
      'Newest',
      'Mid',
    ]);
  });

  it('skips a record with no state when a state filter is set', () => {
    const stateless: WarnRecord[] = [
      { employer: 'Nowhere', employeesAffected: big, effectiveDate: day(100) },
    ];
    expect(selectContactableRecords(stateless, NOW, ['CA'])).toEqual([]);
  });

  it('returns nothing for an empty archive', () => {
    expect(selectContactableRecords([], NOW)).toEqual([]);
  });
});

describe('warnSignal', () => {
  it('claims only a conservative share of the departing seats', () => {
    // 100 seats at 35% of the $45 assumed core stack.
    expect(unreclaimedSeatSpend({ employer: 'A', employeesAffected: 100 })).toBe(1575);
    expect(unreclaimedSeatSpend({ employer: 'A' })).toBe(0);
  });

  it('builds a dated, dollar-carrying signal', () => {
    const signal = warnSignal(
      {
        employer: 'Acme',
        state: 'AZ',
        employeesAffected: 240,
        effectiveDate: IN_WINDOW,
        sourceUrl: 'https://az.gov/warn/1',
      },
      NOW,
    );
    expect(signal?.kind).toBe('layoff');
    expect(signal?.headline).toContain('shrank by 240 in AZ');
    expect(signal?.headline).toContain('about 3 months ago');
    expect(signal?.monthlyReclaimUsd).toBe(3780);
    expect(signal?.evidence).toContain('https://az.gov/warn/1');
  });

  it('omits the state and the link when they were not published', () => {
    const signal = warnSignal(
      { employer: 'Acme', employeesAffected: 60, effectiveDate: IN_WINDOW },
      NOW,
    );
    expect(signal?.headline).toContain('shrank by 60 about 3 months ago');
    expect(signal?.evidence).not.toContain('http');
  });

  it('never dates a layoff as more recent than the lag rule allows', () => {
    // The freshest filing that can reach a draft is MIN_LAG_DAYS old, which
    // already rounds to two months. Nothing should ever read as last month.
    const freshest = new Date(NOW.getTime() - MIN_LAG_DAYS * 86_400_000).toISOString();
    const signal = warnSignal(
      { employer: 'Acme', employeesAffected: 30, effectiveDate: freshest },
      NOW,
    );
    expect(signal?.headline).toContain('about 2 months ago');
  });

  it('falls back to the notice date in the evidence line', () => {
    const signal = warnSignal(
      { employer: 'Acme', employeesAffected: 30, noticeDate: IN_WINDOW },
      NOW,
    );
    expect(signal?.evidence).toContain(IN_WINDOW);
  });

  it('caps strength so one enormous filing cannot dominate', () => {
    const huge = warnSignal(
      { employer: 'A', employeesAffected: 100000, effectiveDate: IN_WINDOW },
      NOW,
    );
    expect(huge?.strength).toBe(100);
  });

  it('returns null outside the window or with no headcount', () => {
    expect(warnSignal({ employer: 'A', employeesAffected: 10 }, NOW)).toBeNull();
    expect(warnSignal({ employer: 'A', effectiveDate: IN_WINDOW }, NOW)).toBeNull();
  });
});

describe('detectAtsBoard and atsFeedUrl', () => {
  it('finds each vendor from a careers-page link', () => {
    const cases: [string, AtsBoard][] = [
      ['<a href="https://boards.greenhouse.io/acmecorp">Jobs</a>', { vendor: 'greenhouse', token: 'acmecorp' }],
      ['<a href="https://jobs.lever.co/beta">Jobs</a>', { vendor: 'lever', token: 'beta' }],
      ['<a href="https://jobs.ashbyhq.com/gamma">Jobs</a>', { vendor: 'ashby', token: 'gamma' }],
      ['<a href="https://careers.smartrecruiters.com/Delta">Jobs</a>', { vendor: 'smartrecruiters', token: 'delta' }],
      ['<a href="https://apply.workable.com/epsilon">Jobs</a>', { vendor: 'workable', token: 'epsilon' }],
      ['<a href="https://zeta.recruitee.com/">Jobs</a>', { vendor: 'recruitee', token: 'zeta' }],
    ];
    for (const [html, expected] of cases) {
      expect(detectAtsBoard(html)).toEqual(expected);
    }
  });

  it('returns null for empty markup or an ATS we do not read', () => {
    expect(detectAtsBoard('')).toBeNull();
    expect(detectAtsBoard('<a href="/careers">Jobs</a>')).toBeNull();
  });

  it('builds the public feed url for every vendor', () => {
    expect(atsFeedUrl({ vendor: 'greenhouse', token: 'acme' })).toContain(
      'boards-api.greenhouse.io/v1/boards/acme/jobs?content=true',
    );
    expect(atsFeedUrl({ vendor: 'lever', token: 'acme' })).toContain('api.lever.co/v0/postings/acme');
    expect(atsFeedUrl({ vendor: 'ashby', token: 'acme' })).toContain('posting-api/job-board/acme');
    expect(atsFeedUrl({ vendor: 'smartrecruiters', token: 'acme' })).toContain('companies/acme/postings');
    expect(atsFeedUrl({ vendor: 'workable', token: 'acme' })).toContain('widget/accounts/acme');
    expect(atsFeedUrl({ vendor: 'recruitee', token: 'acme' })).toContain('acme.recruitee.com');
  });
});

describe('parseJobFeed', () => {
  it('reads the Greenhouse envelope and unescapes its HTML content', () => {
    const payload = {
      jobs: [
        { title: 'Salesforce Administrator', content: '&lt;p&gt;Own our &amp;quot;CRM&amp;quot;&lt;/p&gt;' },
      ],
    };
    const jobs = parseJobFeed('greenhouse', payload);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].title).toBe('Salesforce Administrator');
    expect(jobs[0].description).toContain('Own our');
    expect(jobs[0].description).not.toContain('<p>');
  });

  it('reads the flat Lever array', () => {
    const jobs = parseJobFeed('lever', [
      { text: 'Data Analyst', descriptionPlain: 'Tableau and Looker' },
    ]);
    expect(jobs[0].title).toBe('Data Analyst');
    expect(jobs[0].description).toBe('Tableau and Looker');
  });

  it('reads the Recruitee offers envelope', () => {
    const jobs = parseJobFeed('recruitee', { offers: [{ title: 'Ops Lead' }] });
    expect(jobs[0].title).toBe('Ops Lead');
    expect(jobs[0].description).toBe('');
  });

  it('reads the Ashby, SmartRecruiters, and Workable envelopes', () => {
    expect(parseJobFeed('ashby', { jobs: [{ title: 'A' }] })[0].title).toBe('A');
    expect(parseJobFeed('smartrecruiters', { content: [{ name: 'B' }] })[0].title).toBe('B');
    expect(parseJobFeed('workable', { jobs: [{ title: 'C' }] })[0].title).toBe('C');
  });

  it('skips rows with no title and tolerates a changed shape', () => {
    expect(parseJobFeed('greenhouse', { jobs: [{ content: 'x' }, null, 'nope'] })).toEqual([]);
    expect(parseJobFeed('greenhouse', { jobs: 'not-an-array' })).toEqual([]);
    expect(parseJobFeed('greenhouse', null)).toEqual([]);
    expect(parseJobFeed('greenhouse', 'a string')).toEqual([]);
  });

  it('ignores a non-string description', () => {
    expect(parseJobFeed('greenhouse', { jobs: [{ title: 'A', content: 42 }] })[0].description).toBe('');
  });
});

describe('software detection', () => {
  it('names tools and their function', () => {
    expect(detectSoftware('We run Tableau and Workday')).toEqual([
      { name: 'Tableau', category: 'bi' },
      { name: 'Workday', category: 'hris' },
    ]);
  });

  it('is anchored on word boundaries', () => {
    // "looking" must not match Looker, and "sapphire" must not match SAP.
    expect(detectSoftware('looking at sapphire')).toEqual([]);
  });

  it('returns nothing for empty text', () => {
    expect(detectSoftware('')).toEqual([]);
  });

  it('exposes a readable label per category, falling back to the id', () => {
    expect(categoryLabel('bi')).toBe('business intelligence');
    expect(categoryLabel('mystery')).toBe('mystery');
  });

  it('flattens postings into one searchable blob', () => {
    expect(postingsText([{ title: 'Analyst', description: 'Qlik' }])).toContain('Analyst Analyst Qlik');
  });
});

describe('overlappingCategories', () => {
  it('reports only functions covered by two or more tools, widest first', () => {
    const tools = detectSoftware('Tableau Looker Power BI Jira Asana Salesforce');
    const overlaps = overlappingCategories(tools);
    expect(overlaps.map((o) => o.category)).toEqual(['bi', 'pm']);
    expect(overlaps[0].tools).toEqual(['Tableau', 'Power BI', 'Looker']);
    expect(overlaps[0].label).toBe('business intelligence');
  });

  it('ignores a function covered by exactly one tool', () => {
    expect(overlappingCategories(detectSoftware('Salesforce only'))).toEqual([]);
  });

  it('counts a tool named twice only once', () => {
    const dupes = [
      { name: 'Jira', category: 'pm' },
      { name: 'Jira', category: 'pm' },
    ];
    expect(overlappingCategories(dupes)).toEqual([]);
  });
});

describe('adminRoles', () => {
  it('finds tools named in administrator titles', () => {
    const roles = adminRoles([
      { title: 'Workday Administrator', description: '' },
      { title: 'NetSuite Admin', description: '' },
      { title: 'Warehouse Associate', description: 'Uses Workday' },
    ]);
    expect(roles.map((r) => r.name)).toEqual(['Workday', 'NetSuite']);
  });

  it('does not repeat a tool across two admin reqs', () => {
    const roles = adminRoles([
      { title: 'Jira Administrator', description: '' },
      { title: 'Jira Specialist', description: '' },
    ]);
    expect(roles).toHaveLength(1);
  });

  it('is empty when no title names a tool', () => {
    expect(adminRoles([{ title: 'Office Administrator', description: '' }])).toEqual([]);
  });
});

describe('stackSignals', () => {
  it('names two overlapping tools naturally', () => {
    const signals = stackSignals([
      { title: 'Analyst', description: 'Tableau and Looker experience' },
    ]);
    const overlap = signals.find((s) => s.kind === 'stack_overlap');
    expect(overlap?.headline).toContain('Tableau and Looker');
    expect(overlap?.headline).toContain('2 tools covering business intelligence');
    expect(overlap?.monthlyReclaimUsd).toBe(0);
  });

  it('uses a serial list for three or more', () => {
    const signals = stackSignals([
      { title: 'Analyst', description: 'Tableau, Looker, and Power BI' },
    ]);
    expect(signals[0].headline).toContain('Tableau, Power BI, and Looker');
  });

  it('reports a single administrator req without an awkward list', () => {
    const signals = stackSignals([{ title: 'Workday Administrator', description: '' }]);
    const admin = signals.find((s) => s.kind === 'admin_churn');
    expect(admin?.headline).toContain('administrator for Workday.');
  });

  it('joins several administrator reqs', () => {
    const signals = stackSignals([
      { title: 'Workday Administrator', description: '' },
      { title: 'Jira Administrator', description: '' },
    ]);
    const admin = signals.find((s) => s.kind === 'admin_churn');
    expect(admin?.headline).toContain('Workday and Jira');
  });

  it('sorts strongest first and returns nothing for a quiet board', () => {
    const signals = stackSignals([
      { title: 'Salesforce Administrator', description: 'Tableau, Looker, Domo' },
    ]);
    expect(signals[0].kind).toBe('stack_overlap');
    expect(signals.map((s) => s.strength)).toEqual(
      [...signals.map((s) => s.strength)].sort((a, b) => b - a),
    );
    expect(stackSignals([])).toEqual([]);
  });
});

describe('scoring', () => {
  const layoff: AccountSignal = {
    kind: 'layoff',
    headline: 'l',
    monthlyReclaimUsd: 3000,
    strength: 70,
  };
  const overlap: AccountSignal = {
    kind: 'stack_overlap',
    headline: 'o',
    monthlyReclaimUsd: 0,
    strength: 50,
  };

  it('sums the dollar signals', () => {
    expect(totalMonthlyReclaim([layoff, overlap])).toBe(3000);
    expect(totalMonthlyReclaim([])).toBe(0);
  });

  it('picks the strongest signal, or null when there are none', () => {
    expect(primarySignal([overlap, layoff])).toBe(layoff);
    expect(primarySignal([])).toBeNull();
  });

  it('rewards corroborating signals over a single one', () => {
    const one: EnterpriseAccount = { company: 'A', domain: 'a.com', signals: [layoff] };
    const two: EnterpriseAccount = { company: 'B', domain: 'b.com', signals: [layoff, overlap] };
    expect(accountScore(two)).toBeGreaterThan(accountScore(one));
  });

  it('caps the dollar bonus so recovery cannot outrank signal depth', () => {
    const rich: EnterpriseAccount = {
      company: 'A',
      domain: 'a.com',
      signals: [{ ...layoff, monthlyReclaimUsd: 1_000_000 }],
    };
    expect(accountScore(rich)).toBe(95);
  });

  it('scores an account with no signals at zero', () => {
    expect(accountScore({ company: 'A', domain: 'a.com', signals: [] })).toBe(0);
  });

  it('ranks strongest first and breaks ties by name', () => {
    const a: EnterpriseAccount = { company: 'Zeta', domain: 'z.com', signals: [overlap] };
    const b: EnterpriseAccount = { company: 'Alpha', domain: 'al.com', signals: [overlap] };
    const c: EnterpriseAccount = { company: 'Mid', domain: 'm.com', signals: [layoff, overlap] };
    expect(rankAccounts([a, b, c]).map((x) => x.company)).toEqual(['Mid', 'Alpha', 'Zeta']);
  });
});

describe('brief and email composition', () => {
  const account: EnterpriseAccount = {
    company: 'Acme Logistics',
    domain: 'acmelogistics.com',
    city: 'Tempe',
    state: 'AZ',
    signals: [
      {
        kind: 'layoff',
        headline: 'Your team shrank by 240 in AZ about 3 months ago.',
        monthlyReclaimUsd: 3780,
        strength: 69,
        evidence: 'WARN filing, 240 affected, effective 2026-04-27: https://az.gov/warn/1',
      },
      {
        kind: 'stack_overlap',
        headline: 'Your job postings name Tableau and Looker.',
        monthlyReclaimUsd: 0,
        strength: 50,
        evidence: 'Detected across 12 open posting(s): Tableau, Looker',
      },
    ],
  };

  it('tags the landing page with campaign parameters', () => {
    expect(enterpriseUrl()).toContain('/enterprise?');
    expect(enterpriseUrl()).toContain('utm_campaign=enterprise');
  });

  it('deep-links the estimate with their own seat count', () => {
    expect(reclaimUrl(240)).toContain('r=240%7C0%7Cemail_suite%2Ccomms%2Ccrm');
    expect(reclaimUrl(12.7)).toContain('r=12%7C0');
  });

  it('returns no estimate link when there is no seat count', () => {
    expect(reclaimUrl(0)).toBe('');
  });

  it('recovers the headcount from the layoff evidence', () => {
    expect(estimateSeats(account)).toBe(240);
    expect(estimateSeats({ ...account, signals: [account.signals[1]] })).toBe(0);
    expect(
      estimateSeats({ ...account, signals: [{ ...account.signals[0], evidence: undefined }] }),
    ).toBe(0);
  });

  it('builds a brief with the evidence and the manual contact reminder', () => {
    const brief = buildBrief(account);
    expect(brief[0]).toBe('Acme Logistics (acmelogistics.com, Tempe, AZ)');
    expect(brief.join('\n')).toContain('[$3,780/mo]');
    expect(brief.join('\n')).toContain('https://az.gov/warn/1');
    expect(brief.join('\n')).toContain('Find the CFO');
  });

  it('omits the location when none was published, and falls back to the headline', () => {
    const bare: EnterpriseAccount = {
      company: 'Beta',
      domain: 'beta.com',
      signals: [{ kind: 'admin_churn', headline: 'Hiring an admin.', monthlyReclaimUsd: 0, strength: 35 }],
    };
    const brief = buildBrief(bare);
    expect(brief[0]).toBe('Beta (beta.com)');
    expect(brief.join('\n')).toContain('Hiring an admin.');
    expect(brief.join('\n')).not.toContain('[$');
  });

  it('leads with the strongest signal and carries the dollars', () => {
    const email = composeEnterpriseEmail(account);
    expect(email.subject).toContain('$3,780/mo');
    expect(email.body).toContain('shrank by 240');
    expect(email.body).toContain('Also worth a look:');
    expect(email.body).toContain('$2,499');
    expect(email.body).toContain('/enterprise?');
    expect(email.body).toContain('r=240');
    expect(email.body).toContain('unsubscribe');
    // The brief rides alongside, never inside the sendable body.
    expect(email.body).not.toContain('https://az.gov/warn/1');
    expect(email.brief.length).toBeGreaterThan(0);
  });

  it('handles an account with one signal and no dollars', () => {
    const quiet: EnterpriseAccount = {
      company: 'Beta',
      domain: 'beta.com',
      signals: [{ kind: 'stack_overlap', headline: 'Two BI tools.', monthlyReclaimUsd: 0, strength: 50 }],
    };
    const email = composeEnterpriseEmail(quiet);
    expect(email.subject).toContain('a note on your software stack');
    expect(email.body).toContain('Two BI tools.');
    expect(email.body).not.toContain('Also worth a look:');
    expect(email.body).not.toContain('Prefer to run the numbers');
  });

  it('handles an account with no signals at all', () => {
    const empty: EnterpriseAccount = { company: 'Gamma', domain: 'gamma.com', signals: [] };
    const email = composeEnterpriseEmail(empty);
    expect(email.subject).toContain('a note on your software stack');
    expect(email.body).toContain('Hi there,');
  });
});
