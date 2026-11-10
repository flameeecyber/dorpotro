// Deterministic verdict layer.
// The language model extracts requirements and explains outcomes; it never decides.
// Every verdict here is a pure function of (requirement, profile) and therefore testable.

export const VERDICT = {
  PASS: 'PASS',
  FAIL: 'FAIL',
  RISK: 'RISK',
}

const NUMERIC_KINDS = new Set(['turnover_avg', 'years_experience', 'largest_work', 'bid_security'])

const PROFILE_FIELD = {
  turnover_avg: 'turnover_avg',
  years_experience: 'years_experience',
  largest_work: 'largest_work',
}

function actualFor(kind, profile) {
  const field = PROFILE_FIELD[kind]
  if (!field) return undefined
  const raw = profile?.[field]
  if (raw === null || raw === undefined || raw === '') return undefined
  const n = Number(raw)
  return Number.isFinite(n) ? n : undefined
}

function compare(actual, operator, target) {
  switch (operator) {
    case '>=': return actual >= target
    case '>': return actual > target
    case '<=': return actual <= target
    case '<': return actual < target
    case '==': return actual === target
    default: return false
  }
}

// A requirement whose threshold the document never states must never be guessed at.
export function isUnstated(req) {
  if (req.operator === 'stated') return false
  if (req.value === null || req.value === undefined || req.value === '') return true
  if (req.operator === 'present') return false
  return false
}

export function evaluateRequirement(req, profile) {
  if (isUnstated(req)) {
    return {
      verdict: VERDICT.RISK,
      actual: null,
      reason: 'not stated in the document',
      detail: 'The tender does not fix a threshold for this criterion. The agent refuses to assume one; ask the procuring entity or read the TDS.',
    }
  }

  if (req.operator === 'present') {
    const present = Boolean(profile?.[req.kind])
    return {
      verdict: present ? VERDICT.PASS : VERDICT.FAIL,
      actual: present ? 'present' : 'missing',
      reason: present ? 'satisfied by your profile' : `no ${String(req.kind).replace(/_/g, ' ')} on file`,
      detail: present ? 'Uploaded and valid.' : 'Attach a current copy before submission.',
    }
  }

  if (!NUMERIC_KINDS.has(req.kind)) {
    return { verdict: VERDICT.RISK, actual: null, reason: 'unrecognised criterion', detail: 'The agent could not classify this requirement; a human should read the cited clause.' }
  }

  const actual = actualFor(req.kind, profile)
  if (actual === undefined) {
    return {
      verdict: VERDICT.RISK,
      actual: null,
      reason: 'missing from your profile',
      detail: 'Add this figure to your company profile to get a definitive answer.',
    }
  }

  const ok = compare(actual, req.operator, req.value)
  return {
    verdict: ok ? VERDICT.PASS : VERDICT.FAIL,
    actual,
    reason: ok ? 'meets the stated threshold' : 'below the stated threshold',
    detail: ok
      ? `Stated minimum ${req.operator} ${req.value}.`
      : `Stated minimum ${req.operator} ${req.value}; you are at ${actual}.`,
  }
}

export function aggregate(findings) {
  const counts = { PASS: 0, FAIL: 0, RISK: 0 }
  for (const f of findings) counts[f.verdict] = (counts[f.verdict] || 0) + 1
  let verdict = 'ELIGIBLE'
  if (counts.FAIL > 0) verdict = 'DISQUALIFIED'
  else if (counts.RISK > 0) verdict = 'AT RISK'
  return { verdict, counts }
}

export function formatBDT(n) {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return '—'
  const v = Number(n)
  if (v >= 1e7) return `BDT ${(v / 1e7).toFixed(2)} cr`
  if (v >= 1e5) return `BDT ${(v / 1e5).toFixed(2)} lakh`
  return `BDT ${v.toLocaleString('en-US')}`
}
