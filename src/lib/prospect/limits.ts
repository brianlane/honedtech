// How many accounts a scheduled run is allowed to work.
//
// The cap is the only thing standing between a cron run and a large volume of
// cold email, so it must not be possible to disable it by accident.
// `Number("abc")` is NaN, and `collected.length >= NaN` is always false, so an
// unvalidated limit silently removed the cap entirely rather than failing.
// Anything that is not a positive number falls back to the default.

export function parseRunLimit(raw: string | undefined | null, fallback: number): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return fallback;
  }
  return Math.floor(parsed);
}
