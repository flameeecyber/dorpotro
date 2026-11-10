// Eval harness. Run with `npm run eval`.
// Fails with a non-zero exit code if the pipeline drifts from the labelled expectations,
// so a prompt or rule change cannot silently regress a verdict.

import { readFileSync } from 'node:fs'
import { runAudit, defaultProfile } from '../lib/pipeline.js'

const suite = JSON.parse(readFileSync(new URL('../data/eval/expectations.json', import.meta.url), 'utf8'))

const rows = []
let failures = 0

for (const c of suite.cases) {
  const audit = await runAudit({ tenderId: c.tenderId, profile: defaultProfile })
  const checks = []

  checks.push(['verdict', audit.verdict === c.expect, `${audit.verdict} (expected ${c.expect})`])
  checks.push(['citations', audit.citationScore >= (c.minCitation ?? 100), `${audit.citationScore}%`])

  for (const id of c.mustFlag || []) {
    const f = audit.findings.find((x) => x.id === id)
    checks.push([`flag ${id}`, f?.verdict === 'RISK', f ? f.verdict : 'missing'])
  }
  for (const id of c.mustFail || []) {
    const f = audit.findings.find((x) => x.id === id)
    checks.push([`fail ${id}`, f?.verdict === 'FAIL', f ? f.verdict : 'missing'])
  }
  if (c.mustHaveChangelog !== undefined) {
    checks.push(['changelog', audit.changelog.length === c.mustHaveChangelog, `${audit.changelog.length} change(s)`])
  }

  const bad = checks.filter((x) => !x[1])
  failures += bad.length
  rows.push({ id: c.tenderId, ok: bad.length === 0, checks })
}

const width = Math.max(...rows.map((r) => r.id.length), 4)
console.log(`\nDorpotro eval — ${rows.length} labelled tenders\n`)
console.log(`${'tender'.padEnd(width)}  result  checks`)
console.log(`${'-'.repeat(width)}  ------  ------`)
for (const r of rows) {
  console.log(`${r.id.padEnd(width)}  ${r.ok ? ' PASS ' : ' FAIL '}  ${r.checks.map(([n, ok]) => `${n}${ok ? '✓' : '✗'}`).join('  ')}`)
}

for (const r of rows) {
  for (const [name, ok, detail] of r.checks) {
    if (!ok) console.log(`\n  ✗ ${r.id} · ${name} — got ${detail}`)
  }
}

const passed = rows.filter((r) => r.ok).length
console.log(`\n${passed}/${rows.length} tenders match their label, ${failures} failed check(s)\n`)
process.exit(failures === 0 ? 0 : 1)
