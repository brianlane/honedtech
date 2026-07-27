// Company name matching for domain resolution.
//
// WARN filings name an employer but carry no website, and Google Places is
// built for local business discovery rather than corporate entity resolution.
// Searching "Compass Group USA Houston" happily returns a local builder
// called "Compass Builds". Taking the first result with a website attributes
// a layoff to a stranger, which is the single worst thing this pipeline could
// do, so a candidate has to earn the match on its name.
//
// The bar is deliberately set where false negatives are cheap and false
// positives are not. Thousands of filings sit inside the contact window
// against a weekly cap of a handful of accounts, so skipping a real match
// costs almost nothing and emailing the wrong company costs the sender.

// Legal-entity and country qualifiers that differ between how a state
// registry writes a name and how a business lists itself. Descriptive words
// (group, services, logistics) are deliberately NOT stripped: they are what
// separates "Compass Group" from "Compass Builds".
const NOISE_TOKENS = new Set([
  'inc',
  'incorporated',
  'llc',
  'lc',
  'corp',
  'corporation',
  'co',
  'company',
  'ltd',
  'limited',
  'lp',
  'llp',
  'plc',
  'pllc',
  'pc',
  'gmbh',
  'the',
  'and',
  'of',
  'usa',
  'us',
  'dba',
]);

// How alike two names have to be. Three of four shared words survives a
// formal-versus-brand difference without letting a near-miss through.
export const MIN_MATCH_RATIO = 0.75;

// Lowercased, punctuation-free words that actually identify a company.
// Single characters go too, since they carry no signal and inflate ratios.
export function significantTokens(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((t) => t.length > 1 && !NOISE_TOKENS.has(t));
}

// Symmetric overlap of the two names, 0 to 1: shared words over total
// distinct words. Returns 0 when either side has nothing distinctive left.
//
// Symmetry is the whole point. Measuring only how much of the employer
// appears in the candidate lets any superset score perfectly, which is how
// "Compass Group USA" matched a Houston firm called "Compass Building Group".
// Counting the candidate's extra words against it is what catches that.
export function nameMatchRatio(employer: string, candidate: string): number {
  const wanted = new Set(significantTokens(employer));
  const have = new Set(significantTokens(candidate));
  if (wanted.size === 0 || have.size === 0) {
    return 0;
  }
  let shared = 0;
  for (const token of wanted) {
    if (have.has(token)) {
      shared += 1;
    }
  }
  return shared / (wanted.size + have.size - shared);
}

// Whether a Places result is plausibly the employer named in the filing.
export function isLikelySameCompany(employer: string, candidate: string): boolean {
  return nameMatchRatio(employer, candidate) >= MIN_MATCH_RATIO;
}
