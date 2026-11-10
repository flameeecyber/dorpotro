// The audit pipeline and the sample data store.
// Order matters: corrigendum -> extract -> rules -> verify -> gaps -> narrate.
// Verdicts are computed before any prose is written, and verification gates the prose.
// The verdict is re-aggregated *after* verification downgrades, so a failed citation
// can never leave an optimistic banner on screen.

import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { evaluateRequirement, aggregate, isUnstated } from './rules.js'
import { verifyAll, verifyOne } from './verify.js'
import { applyAmendments } from './corrigendum.js'
import { computeGaps } from './gaps.js'
import { narrate, banglaSummary } from './llm.js'

const DATA = join(dirname(fileURLToPath(import.meta.url)), '..', 'data')

const index = JSON.parse(readFileSync(join(DATA, 'index.json'), 'utf8'))
const tenderCache = new Map()

export const defaultProfile = JSON.parse(readFileSync(join(DATA, 'profile.json'), 'utf8'))

export function listTenders() {
  return index.tenders.map((t) => ({ ...t }))
}

export function getTender(id) {
  if (!tenderCache.has(id)) {
    const entry = index.tenders.find((t) => t.id === id)
    if (!entry) return null
    tenderCache.set(id, JSON.parse(readFileSync(join(DATA, entry.file), 'utf8')))
  }
  return tenderCache.get(id)
}

function step(id, label, status, detail, ms) {
  return { id, label, status, detail, ms }
}

export async function runAudit({ tenderId, profile }) {
  const tender = getTender(tenderId)
  if (!tender) throw new Error(`unknown tender: ${tenderId}`)

  const who = profile?.name || 'your company'
  // Currency belongs to the document; it only ever travels with the profile so that
  // thresholds render in the money the tender is denominated in.
  const bidder = { ...profile, currency: tender.currency || profile?.currency || 'BDT' }
  const pages = tender.pages
  const trace = []
  let t = Date.now()

  const chars = pages.reduce((n, p) => n + p.text.length, 0)
  trace.push(step('ingest', 'Ingest', 'ok', `${pages.length} pages, ${chars.toLocaleString('en-US')} characters`, Date.now() - t))

  // 1. CORRIGENDUM — amendments supersede clauses, so they are applied before anything else.
  t = Date.now()
  const corr = applyAmendments(tender)
  trace.push(
    step(
      'corrigendum',
      'Corrigendum',
      'ok',
      corr.changelog.length
        ? `${corr.changelog.length} change(s) applied from amendment ${corr.amendments.map((a) => a.number).join(', ')}`
        : 'no amendments on this tender',
      Date.now() - t,
    ),
  )

  // 2. EXTRACT — pre-extracted for the bundled samples; a live PDF upload replaces
  // this with a Reader agent call per section class.
  t = Date.now()
  const baseFindings = tender.requirements.map((req) => ({ ...req, ...evaluateRequirement(req, bidder) }))
  const baseVerdict = aggregate(baseFindings).verdict
  trace.push(
    step(
      'extract',
      'Extract',
      'ok',
      `${corr.requirements.length} qualification clauses, ${corr.documents.length} document items`,
      Date.now() - t,
    ),
  )

  // 3. RULES — pure code, no model involvement.
  t = Date.now()
  let findings = corr.requirements.map((req) => ({
    ...req,
    ...evaluateRequirement(req, bidder),
    unstated: isUnstated(req),
    amendedBy: req.amendedBy || null,
  }))
  const rulesMs = Date.now() - t

  // 4. VERIFY — every claim must exist on the page it names.
  t = Date.now()
  const reqVerify = verifyAll(
    findings.map((f) => ({ id: f.id, quote: f.quote, page: f.page })),
    pages,
  )
  const docVerify = verifyAll(
    corr.documents.map((d) => ({ id: d.id, quote: d.quote, page: d.page })),
    pages,
  )
  const chgVerify = verifyAll(
    corr.changelog.map((c) => ({ id: c.id, quote: c.quote, page: c.page })),
    pages,
  )
  const subVerify = verifyOne({ quote: corr.submission?.quote, page: corr.submission?.page }, pages)
  const secVerify = verifyOne({ quote: tender.security?.quote, page: tender.security?.page }, pages)

  const reqById = new Map(reqVerify.results.map((r) => [r.id, r]))
  const docById = new Map(docVerify.results.map((r) => [r.id, r]))
  const chgById = new Map(chgVerify.results.map((r) => [r.id, r]))

  for (const f of findings) {
    const v = reqById.get(f.id)
    f.cite = v?.cite ?? null
    f.citeNote = v?.note
    f.verified = Boolean(v?.ok)
    if (!v?.ok) {
      f.verdict = 'RISK'
      f.reason = 'unverified citation'
      f.detail = 'The quoted clause could not be located in the document, so the finding was downgraded rather than trusted.'
    }
    // Confidence drives escalation: a verified threshold is trusted, a refusal is not.
    f.confidence = !v?.ok ? 0.4 : f.unstated ? 0.6 : 0.96
    f.escalate = f.confidence < 0.8
  }

  // Re-aggregate after downgrades. Verification can only make a verdict more cautious.
  const { verdict, counts } = aggregate(findings)

  trace.push(step('rules', 'Rules', 'ok', `${counts.PASS} pass / ${counts.RISK} risk / ${counts.FAIL} fail → ${verdict}`, rulesMs))

  const documents = corr.documents.map((d) => {
    const v = docById.get(d.id)
    return { ...d, cite: v?.cite ?? null, verified: Boolean(v?.ok), citeNote: v?.note }
  })

  const changelog = corr.changelog.map((c) => {
    const v = chgById.get(c.id)
    return { ...c, verified: Boolean(v?.ok), note: v?.note }
  })

  const allScores = [...reqVerify.results, ...docVerify.results, ...chgVerify.results, subVerify, secVerify]
  const citationScore = allScores.length
    ? Math.round((allScores.filter((r) => r.ok).length / allScores.length) * 100)
    : 0
  const corrected = allScores.filter((r) => r.note?.startsWith('citation corrected')).length
  const verifyStatus = allScores.some((r) => !r.ok) ? 'failed' : corrected ? 'degraded' : 'ok'
  trace.push(
    step(
      'verify',
      'Verify',
      verifyStatus,
      `${citationScore}% citation integrity${corrected ? `, ${corrected} page number(s) corrected` : ''}`,
      Date.now() - t,
    ),
  )

  // 5. GAPS — what the profile would have to look like to clear every stated gate.
  t = Date.now()
  const gaps = computeGaps(findings, bidder)
  trace.push(
    step(
      'gaps',
      'Gaps',
      'ok',
      gaps.ready ? 'no shortfall on stated criteria' : `${gaps.gaps.length} shortfall(s), ${gaps.unstated.length} unknown threshold(s)`,
      Date.now() - t,
    ),
  )

  // 6. NARRATE — prose last, constrained to the verified facts above.
  t = Date.now()
  const summary = await narrate({ tender, verdict, findings, documents, security: tender.security, citationScore })
  const summaryBn = banglaSummary({ verdict, counts, documents, security: tender.security })
  trace.push(
    step(
      'narrate',
      'Narrate',
      summary.mode === 'live' ? 'ok' : 'degraded',
      summary.mode === 'live' ? `live model ${summary.model}` : `deterministic summary (${summary.mode}); no facts added`,
      Date.now() - t,
    ),
  )

  return {
    tender: {
      id: tender.id,
      title: tender.title,
      entity: tender.entity,
      type: tender.type,
      method: tender.method,
      estimated_cost: tender.estimated_cost,
      tender_id: tender.tender_id,
      currency: tender.currency || 'BDT',
      portal: tender.portal || 'portal',
      timezone: tender.timezone || 'UTC',
      timezone_label: tender.timezone_label || '',
      pages: pages.length,
    },
    profile: { name: who },
    verdict,
    baseVerdict,
    amendmentChangedOutcome: baseVerdict !== verdict,
    counts,
    citationScore,
    findings,
    documents,
    changelog,
    gaps,
    escalations: findings
      .filter((f) => f.escalate)
      .map((f) => ({ id: f.id, label: f.label, reason: f.reason, confidence: f.confidence })),
    security: { ...tender.security, verified: secVerify.ok, cite: secVerify.cite },
    submission: { ...corr.submission, verified: subVerify.ok, cite: subVerify.cite },
    ambiguities: (tender.ambiguities || []).map((a) => ({
      ...a,
      verified: verifyOne({ quote: a.text, page: a.page }, pages).ok,
    })),
    summary: summary.text,
    summaryBn,
    summaryMode: summary.mode,
    trace,
    generatedAt: new Date().toISOString(),
  }
}
