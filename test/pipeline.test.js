import test from 'node:test'
import assert from 'node:assert/strict'
import { runAudit, defaultProfile } from '../lib/pipeline.js'
import { evaluateRequirement, aggregate } from '../lib/rules.js'
import { matchQuote, normalize } from '../lib/verify.js'

test('rules: a stated threshold is computed, not guessed', () => {
  const pass = evaluateRequirement({ kind: 'turnover_avg', operator: '>=', value: 15000000 }, defaultProfile)
  assert.equal(pass.verdict, 'PASS')
  assert.equal(pass.actual, 18500000)

  const fail = evaluateRequirement({ kind: 'turnover_avg', operator: '>=', value: 50000000 }, defaultProfile)
  assert.equal(fail.verdict, 'FAIL')
})

test('rules: a missing threshold is refused, never inferred', () => {
  const r = evaluateRequirement({ kind: 'turnover_avg', operator: '>=', value: null }, defaultProfile)
  assert.equal(r.verdict, 'RISK')
  assert.match(r.reason, /not stated/)
})

test('rules: aggregate promotes the worst outcome', () => {
  assert.equal(aggregate([{ verdict: 'PASS' }, { verdict: 'PASS' }]).verdict, 'ELIGIBLE')
  assert.equal(aggregate([{ verdict: 'PASS' }, { verdict: 'RISK' }]).verdict, 'AT RISK')
  assert.equal(aggregate([{ verdict: 'RISK' }, { verdict: 'FAIL' }]).verdict, 'DISQUALIFIED')
})

test('verify: a real quote matches, a fabricated one does not', () => {
  const page = 'The Tenderer shall have a minimum average annual turnover of BDT 1,50,00,000 over the last three years.'
  assert.equal(matchQuote('minimum average annual turnover of BDT 1,50,00,000', page).ok, true)
  assert.equal(matchQuote('the bidder must deposit a performance guarantee of ten percent', page).ok, false)
  assert.equal(normalize('BDT 1,50,00,000.'), 'bdt 1 50 00 000')
})

test('pipeline: works tender is eligible with full citation integrity', async () => {
  const a = await runAudit({ tenderId: 'egp-771204', profile: defaultProfile })
  assert.equal(a.verdict, 'ELIGIBLE')
  assert.equal(a.counts.FAIL, 0)
  assert.equal(a.citationScore, 100)
  assert.ok(a.trace.find((t) => t.id === 'verify'))
})

test('pipeline: goods tender is at risk and names the missing threshold', async () => {
  const a = await runAudit({ tenderId: 'egp-780931', profile: defaultProfile })
  assert.equal(a.verdict, 'AT RISK')
  const turnover = a.findings.find((f) => f.id === 'q1')
  assert.equal(turnover.verdict, 'RISK')
  assert.equal(turnover.reason, 'not stated in the document')
  assert.equal(a.ambiguities.length, 2)
})

test('pipeline: services tender disqualifies on three stated criteria', async () => {
  const a = await runAudit({ tenderId: 'egp-793558', profile: defaultProfile })
  assert.equal(a.verdict, 'DISQUALIFIED')
  assert.equal(a.counts.FAIL, 3)
  assert.ok(a.findings.every((f) => Number.isFinite(f.cite)))
})
