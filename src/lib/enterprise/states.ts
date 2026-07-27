// Which states a run covers, and where that answer comes from.
//
// This cannot be expressed in a GitHub Actions expression. `inputs.states ||
// vars.WARN_STATES` substitutes the repository variable whenever the input is
// blank, and GitHub treats an empty string as falsy, so
// `event == 'workflow_dispatch' && inputs.states || vars.WARN_STATES` collapses
// to the variable too. The dispatch form promises that blank means nationwide,
// so the decision has to happen here where blank and absent can be told apart.

export function resolveWarnStates(
  eventName: string | undefined,
  input: string | undefined,
  fallback: string | undefined,
): string[] {
  // A manual run is authoritative, blank included: the operator said
  // nationwide and meant it.
  const raw = eventName === 'workflow_dispatch' ? (input ?? '') : (input || fallback || '');
  return raw
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter((s) => s.length === 2);
}
