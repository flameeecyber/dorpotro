import test from 'node:test'
import assert from 'node:assert/strict'
import { runAudit, defaultProfile } from '../lib/pipeline.js'
import { checkInstrument } from '../lib/security-check.js'

test('corrigendum: an amendment flips the verdict the base document would have given', async () => {
  const a = await runAudit({ tenderId: 'egp-788210', profile: defaultProfile })
  assert.equal(a.baseVerdict, 'ELIGIBLE', 'base document alone clears the profile')
  assert.equal(a.verdict, 'DISQUALIFIED', 'amended threshold disqualifies it')
  assert.equal(a.amendmentChangedOutcome, true)
  assert.equal(a.changelog.length, 3)
})

test('corrigendum: the amended clause is cited to the amendment page', async () => {
  const a = await runAudit({ tenderId: 'egp-788210', profile: defaultProfile })
  const q1 = a.findings.find((f) => f.id === 'q1')
  assert.equal(q1.value, 25000000)
  assert.equal(q1.cite, 8)
  assert.equal(q1.verdict, 'FAIL')
  assert.ok(a.changelog.every((c) => c.verified))
  assert.ok(a.documents.some((d) => d.addedBy === 2), 'amendment adds a mandatory document')
})

test('gaps: the shortfall against the amended threshold is exact', async () => {
  const a = await runAudit({ tenderId: 'egp-788210', profile: defaultProfile })
  const gap = a.gaps.gaps.find((g) => g.kind === 'turnover_avg')
  assert.equal(gap.need, 25000000)
  assert.equal(gap.have, 18500000)
  assert.equal(gap.shortfall, 6500000)
  assert.equal(a.gaps.ready, false)
})

test('confidence: an unstated threshold is escalated, a verified one is not', async () => {
  const goods = await runAudit({ tenderId: 'egp-780931', profile: defaultProfile })
  assert.ok(goods.escalations.some((e) => e.id === 'q1'))
  const works = await runAudit({ tenderId: 'egp-771204', profile: defaultProfile })
  assert.equal(works.escalations.length, 0)
})

test('security: a compliant instrument passes', async () => {
  const tender = (await runAudit({ tenderId: 'egp-771204', profile: defaultProfile })).security
  const submission = (await runAudit({ tenderId: 'egp-771204', profile: defaultProfile })).submission
  const result = checkInstrument(
    { amount: 200000, form: 'bank guarantee', payee: 'Executive Engineer, RHD Sylhet', valid_until: '2027-03-25' },
    { security: tender, submission },
  )
  assert.equal(result.ok, true)
  assert.equal(result.issues.filter((i) => i.severity === 'high').length, 0)
})

test('security: short amount and wrong form are rejected with reasons', async () => {
  const audit = await runAudit({ tenderId: 'egp-771204', profile: defaultProfile })
  const result = checkInstrument(
    { amount: 150000, form: 'cheque', payee: 'RHD', valid_until: '2027-03-25' },
    { security: audit.security, submission: audit.submission },
  )
  assert.equal(result.ok, false)
  const codes = result.issues.map((i) => i.code)
  assert.ok(codes.includes('amount_short'))
  assert.ok(codes.includes('form_wrong'))
  assert.ok(codes.includes('payee_mismatch'))
})

test('security: valid through the final required day is accepted', async () => {
  const audit = await runAudit({ tenderId: 'egp-788210', profile: defaultProfile })
  const boundary = checkInstrument(
    { amount: 160000, form: 'bank guarantee', payee: 'Executive Engineer, LGED Sunamganj', valid_until: '2027-03-27' },
    { security: audit.security, submission: audit.submission },
  )
  assert.equal(boundary.ok, true, JSON.stringify(boundary.issues))
})

test('security: validity that ends before the deadline is rejected', async () => {
  const audit = await runAudit({ tenderId: 'egp-771204', profile: defaultProfile })
  const result = checkInstrument(
    { amount: 200000, form: 'pay order', payee: 'Executive Engineer, RHD Sylhet', valid_until: '2026-12-01' },
    { security: audit.security, submission: audit.submission },
  )
  assert.equal(result.ok, false)
  assert.ok(result.issues.some((i) => i.code === 'validity_short'))
})
