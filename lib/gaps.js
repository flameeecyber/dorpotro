// "What would it take" — the minimum profile that clears every stated gate.
// Derived from the same findings the verdict came from, so the advice can never
// drift away from the decision.

const NUMERIC = ['turnover_avg', 'years_experience', 'largest_work']

export function computeGaps(findings, profile) {
  const gaps = findings
    .filter((f) => f.verdict === 'FAIL' && NUMERIC.includes(f.kind))
    .map((f) => ({
      id: f.id,
      kind: f.kind,
      label: f.label,
      need: f.value,
      have: Number(profile?.[f.kind]) || 0,
      shortfall: Math.max(0, Number(f.value) - (Number(profile?.[f.kind]) || 0)),
      page: f.cite,
    }))

  const minimum = {}
  for (const kind of NUMERIC) {
    const reqs = findings.filter((f) => f.kind === kind && f.operator === '>=' && Number.isFinite(f.value))
    if (reqs.length) minimum[kind] = Math.max(...reqs.map((r) => r.value))
  }

  const unstated = findings
    .filter((f) => f.verdict === 'RISK' && f.reason === 'not stated in the document')
    .map((f) => ({ id: f.id, label: f.label, page: f.cite }))

  const ready = gaps.length === 0 && unstated.length === 0

  return { gaps, minimum, unstated, ready }
}
