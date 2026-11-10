import test from 'node:test'
import assert from 'node:assert/strict'

import { formatMoney } from '../lib/money.js'
import { evaluateRequirement } from '../lib/rules.js'

test('money renders in the currency the document is denominated in', () => {
  assert.equal(formatMoney(25000000, 'BDT'), 'BDT 2.50 cr')
  assert.equal(formatMoney(18500000, 'BDT'), 'BDT 1.85 cr')
  assert.equal(formatMoney(65000, 'BDT'), 'BDT 65,000')
  assert.equal(formatMoney(2500000, 'USD'), 'USD 2.50m')
  assert.equal(formatMoney(65000, 'EUR'), 'EUR 65,000')
  assert.equal(formatMoney(1500000000, 'USD'), 'USD 1.50bn')
  assert.equal(formatMoney(500000, 'INR'), 'INR 5.00 lakh')
  assert.equal(formatMoney(null), '—')
  assert.equal(formatMoney('not a number'), '—')
})

test('a failed threshold is explained in the tender currency, not raw integers', () => {
  const req = { id: 'r1', kind: 'turnover_avg', operator: '>=', value: 25000000 }
  const out = evaluateRequirement(req, { turnover_avg: 18500000, currency: 'BDT' })
  assert.equal(out.verdict, 'FAIL')
  assert.match(out.detail, /BDT 2\.50 cr/)
  assert.match(out.detail, /BDT 1\.85 cr/)
})

test('the same threshold in another currency uses that currency', () => {
  const req = { id: 'r1', kind: 'turnover_avg', operator: '>=', value: 2500000 }
  const out = evaluateRequirement(req, { turnover_avg: 1850000, currency: 'USD' })
  assert.equal(out.verdict, 'FAIL')
  assert.match(out.detail, /USD 2\.50m/)
  assert.match(out.detail, /USD 1\.85m/)
})
