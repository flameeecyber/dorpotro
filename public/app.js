const state = { tenders: [], profile: {}, selected: null, audit: null, busy: false, currency: 'BDT', zone: { tz: 'UTC', label: '' } }

const $ = (sel) => document.querySelector(sel)

const esc = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

// Mirrors lib/money.js: lakh/crore only for the currencies that use it, ISO code always.
const LAKH_GROUPED = new Set(['BDT', 'INR', 'PKR', 'NPR', 'LKR'])

const money = (n, currency) => {
  const v = Number(n)
  if (n === null || n === undefined || n === '' || !Number.isFinite(v)) return '—'
  const cur = String(currency || state.currency || 'BDT').toUpperCase()
  const abs = Math.abs(v)
  if (LAKH_GROUPED.has(cur)) {
    if (abs >= 1e7) return `${cur} ${(v / 1e7).toFixed(2)} cr`
    if (abs >= 1e5) return `${cur} ${(v / 1e5).toFixed(2)} lakh`
    return `${cur} ${v.toLocaleString('en-US')}`
  }
  if (abs >= 1e9) return `${cur} ${(v / 1e9).toFixed(2)}bn`
  if (abs >= 1e6) return `${cur} ${(v / 1e6).toFixed(2)}m`
  return `${cur} ${v.toLocaleString('en-US')}`
}

// The tender names its own timezone; the browser's is irrelevant to a deadline.
const when = (iso) => {
  if (!iso) return 'not stated'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return String(iso)
  const stamp = d.toLocaleString('en-GB', {
    timeZone: state.zone.tz || 'UTC',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  return state.zone.label ? `${stamp} ${state.zone.label}` : stamp
}

const portalLabel = (t) => `${t.portal || 'portal'} ${t.tender_id ?? ''}`.trim()

const verdictClass = (v) => (v === 'ELIGIBLE' ? 'ok' : v === 'DISQUALIFIED' ? 'bad' : 'warn')

const fmtChange = (v) => {
  if (v === null || v === undefined) return '—'
  if (typeof v === 'number') return v >= 1000 ? money(v) : String(v)
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v)) return when(v)
  return String(v)
}

// what the tender demands, in words: never let a raw `true` reach the page
function fmtRequirement(f) {
  if (f.value === null || f.value === undefined) return 'not stated'
  if (typeof f.value === 'boolean') return f.value ? 'required' : 'not required'
  if (f.kind === 'turnover_avg' || f.kind === 'largest_work') return money(f.value)
  return `${f.value}${f.unit ? ' ' + f.unit : ''}`
}

// the bidder's own number, in the same unit as the demand — a year count is not money
function fmtActual(f) {
  const a = f.actual
  if (typeof a !== 'number' || !Number.isFinite(a)) return null
  if (f.kind === 'turnover_avg' || f.kind === 'largest_work') return money(a)
  if (f.kind === 'years_experience') return `${a} yr`
  return String(a)
}

// readable names for the minimum-profile line
const MIN_LABEL = { turnover_avg: 'turnover', years_experience: 'experience', largest_work: 'largest work' }

// deadline + validity window, in UTC so the browser's timezone cannot move the day
const needDate = (iso, days) => {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return ''
  return new Date(t + Number(days || 0) * 86400000).toISOString().slice(0, 10)
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/

// accepts only a real calendar date written YYYY-MM-DD; returns null otherwise
function normalizeIsoDate(raw) {
  const m = ISO_DATE.exec(String(raw || '').trim())
  if (!m) return null
  const [, y, mo, d] = m
  const dt = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)))
  const real =
    dt.getUTCFullYear() === Number(y) &&
    dt.getUTCMonth() === Number(mo) - 1 &&
    dt.getUTCDate() === Number(d)
  return real ? `${y}-${mo}-${d}` : null
}

const chip = (v) => `<span class="chip ${v.toLowerCase()}">${esc(v)}</span>`

const cite = (label, quote, note) =>
  quote
    ? `<details class="cite"><summary>${esc(label)}</summary><blockquote>${esc(quote)}</blockquote>${
        note ? `<span class="cite-note">${esc(note)}</span>` : ''
      }</details>`
    : `<span class="cite-note">no citation</span>`

function fillForm(profile) {
  const form = $('#profile-form')
  for (const [key, value] of Object.entries(profile)) {
    const input = form.elements[key]
    if (input) input.value = value ?? ''
  }
  refreshHints()
}

function refreshHints() {
  const form = $('#profile-form')
  for (const key of ['turnover_avg', 'largest_work']) {
    const el = document.querySelector(`[data-hint="${key}"]`)
    if (el) el.textContent = form.elements[key]?.value ? `= ${money(form.elements[key].value)}` : ''
  }
}

function readProfile() {
  const form = $('#profile-form')
  const out = {}
  for (const el of form.elements) {
    if (!el.name) continue
    out[el.name] = el.type === 'number' ? Number(el.value || 0) : el.value
  }
  return out
}

function renderTenders() {
  $('#tenders').innerHTML = state.tenders
    .map(
      (t) => `
      <button class="tender" type="button" data-id="${esc(t.id)}" aria-pressed="${state.selected === t.id}">
        <span class="t-title">${esc(t.title)}</span>
        <span class="t-meta">${esc(t.entity)}</span>
        <span class="t-meta t-id">${esc(portalLabel(t))} · ${esc(t.type)} · ${esc(money(t.estimated_cost, t.currency))} · ${t.pages} pp</span>
      </button>`,
    )
    .join('')
  $('#run').disabled = !state.selected || state.busy
}

function renderEmpty() {
  $('#stage').innerHTML = `
    <div class="empty">
      <h1>Can I bid on this tender?</h1>
      <p>Pick a tender on the left and run the audit. You get a verdict, the clauses behind it with page citations, the document checklist, and the exact tender security you have to arrange.</p>
      <ul class="bullets">
        <li><strong>Extract</strong> — qualification clauses and documents, page-addressed</li>
        <li><strong>Rules</strong> — verdicts computed in code, not guessed by a model</li>
        <li><strong>Verify</strong> — every quote re-checked against the page it names</li>
      </ul>
    </div>`
}

function renderAudit(a) {
  state.currency = a.tender.currency || 'BDT'
  state.zone = { tz: a.tender.timezone || 'UTC', label: a.tender.timezone_label || '' }
  const v = verdictClass(a.verdict)
  const total = a.counts.PASS + a.counts.RISK + a.counts.FAIL
  const unverified = a.findings.filter((f) => f.citeNote && f.citeNote.includes('not found')).length

  const findings = a.findings
    .map(
      (f) => `
      <tr>
        <td>
          <div>${esc(f.label)}${f.amendedBy ? ` <span class="chip warn">amendment ${esc(f.amendedBy)}</span>` : ''}${f.escalate ? ' <span class="chip risk">review</span>' : ''}</div>
          <div class="why">${esc(f.detail || '')}</div>
          ${cite(`p.${f.cite ?? '?'} · source clause`, f.quote, f.citeNote)}
        </td>
        <td class="num" data-label="Tender requires">${fmtRequirement(f)}</td>
        <td class="num" data-label="You have">${fmtActual(f) ?? (f.actual === null || f.actual === undefined ? '—' : esc(f.actual))}</td>
        <td data-label="Verdict">${chip(f.verdict)}<div class="why">${esc(f.reason)}</div></td>
      </tr>`,
    )
    .join('')

  const documents = a.documents
    .map(
      (d) => `
      <li>
        <span class="box">[${d.verified ? '✓' : ' '}]</span>
        <span>${esc(d.name)}${d.mandatory ? '' : ' <span class="chip">optional</span>'}${d.addedBy ? ` <span class="chip warn">amendment ${esc(d.addedBy)}</span>` : ''}</span>
        <span class="chip" style="margin-left:auto">p.${esc(d.cite ?? '?')}</span>
      </li>`,
    )
    .join('')

  const ambiguities = a.ambiguities.length
    ? a.ambiguities
        .map(
          (x) => `
        <div class="ambiguity">
          <div class="q">p.${esc(x.page)} · “${esc(x.text)}”</div>
          <div class="why">${esc(x.reason)}</div>
        </div>`,
        )
        .join('')
    : '<p class="why">No unresolved clauses in this document.</p>'

  const trace = a.trace
    .map(
      (t) => `
      <div class="trace-row">
        <span class="dot ${esc(t.status)}"></span>
        <span class="step">${esc(t.label)}</span>
        <span class="ms">${esc(t.ms)}ms</span>
        <span class="detail">${esc(t.detail)}</span>
      </div>`,
    )
    .join('')

  $('#stage').innerHTML = `
    <div class="audit-nav">
      <button class="btn" id="back-triage" type="button">← All tenders</button>
    </div>

    <div class="verdict ${v}">
      <div>
        <div class="v-label">${esc(a.verdict)}</div>
        <div class="v-sub">${esc(a.profile.name)} · ${esc(a.tender.title)}</div>
        ${a.amendmentChangedOutcome ? `<div class="v-sub amend-note">Base document alone would have read <strong>${esc(a.baseVerdict)}</strong> — Amendment ${esc(a.changelog[0]?.amendment ?? '')} changed the outcome.</div>` : ''}
      </div>
      <div class="v-meta">
        <div class="metric"><div class="n">${a.counts.PASS}/${total}</div><div class="k">criteria met</div></div>
        <div class="metric"><div class="n">${a.citationScore}%</div><div class="k">citation integrity</div></div>
        <div class="metric"><div class="n">${a.documents.filter((d) => d.mandatory).length}</div><div class="k">documents</div></div>
        ${a.escalations.length ? `<div class="metric"><div class="n">${a.escalations.length}</div><div class="k">need review</div></div>` : ''}
      </div>
    </div>

    ${a.changelog.length ? `<div class="card corrigendum">
      <h3>Corrigendum applied — ${a.changelog.length} change${a.changelog.length === 1 ? '' : 's'}</h3>
      ${a.changelog
        .map(
          (c) => `<div class="change">
            <div><span class="chip warn">Amendment ${esc(c.amendment)}</span> ${esc(c.target)} · ${esc(String(c.field).replace(/_/g, ' '))}</div>
            <div class="why">${c.from === null ? 'added' : esc(fmtChange(c.from))} → <strong>${esc(fmtChange(c.to))}</strong> · p.${esc(c.page)}</div>
          </div>`,
        )
        .join('')}
      <p class="why">Read only the base document and the answer changes: this tender would have read <strong>${esc(a.baseVerdict)}</strong>.</p>
    </div>` : ''}

    <div class="grid-2">
      <div class="card">
        <h3>Submission</h3>
        <dl class="kv">
          <dt>Deadline</dt><dd>${esc(when(a.submission.deadline))}</dd>
          <dt>Mode</dt><dd>${esc(a.submission.mode)} · ${esc(a.submission.portal)}</dd>
          <dt>Method</dt><dd>${esc(a.tender.method)}</dd>
          <dt>Est. cost</dt><dd>${esc(money(a.tender.estimated_cost, a.tender.currency))}</dd>
        </dl>
        ${cite(`p.${a.submission.page} · deadline clause`, a.submission.quote)}
      </div>
      <div class="card">
        <h3>Tender security</h3>
        <dl class="kv">
          <dt>Amount</dt><dd>${esc(money(a.security.amount, a.tender.currency))}</dd>
          <dt>Form</dt><dd>${esc(a.security.form)}</dd>
          <dt>Payee</dt><dd>${esc(a.security.payee)}</dd>
          <dt>Validity</dt><dd>${esc(a.security.validity_days)} days</dd>
        </dl>
        ${cite(`p.${a.security.page} · security clause`, a.security.quote)}
        <form id="instrument-form" class="form instrument">
          <h3 class="mini">Check your instrument</h3>
          <div class="pair">
            <label><span>Face value (${esc(a.tender.currency)})</span><input name="amount" type="number" min="0" step="1000" value="${esc(a.security.amount)}" /></label>
            <label><span>Form</span><input name="form" type="text" value="${esc(String(a.security.form || '').split(' or ')[0] || '')}" /></label>
          </div>
          <div class="pair">
            <label><span>In favour of</span><input name="payee" type="text" value="${esc(a.security.payee)}" /></label>
            <label><span>Valid until</span><input name="valid_until" type="text" inputmode="numeric" autocomplete="off" spellcheck="false" maxlength="10" placeholder="YYYY-MM-DD" title="Valid until, written YYYY-MM-DD" value="${esc(needDate(a.submission.deadline, a.security.validity_days))}" /><small class="hint">YYYY-MM-DD</small></label>
          </div>
          <button class="btn" type="submit">Check instrument</button>
          <div id="instrument-result"></div>
        </form>
      </div>
    </div>

    <div class="card">
      <h3>Qualification criteria <span class="chip">${esc(a.tender.id)}</span></h3>
      <table class="criteria">
        <thead><tr><th>Requirement</th><th class="num">Tender</th><th class="num">You</th><th>Verdict</th></tr></thead>
        <tbody>${findings}</tbody>
      </table>
    </div>

    ${a.gaps.gaps.length || a.gaps.unstated.length ? `<div class="card">
      <h3>What would it take</h3>
      ${a.gaps.gaps
        .map(
          (g) => `<div class="gap">
            <div>${esc(g.label)}</div>
            <div class="why">Need ${esc(money(g.need))} · you have ${esc(money(g.have))} · short by <strong>${esc(money(g.shortfall))}</strong>${g.page ? ` (p.${esc(g.page)})` : ''}</div>
          </div>`,
        )
        .join('')}
      ${a.gaps.unstated
        .map(
          (u) => `<div class="gap">
            <div>${esc(u.label)}</div>
            <div class="why">The document states no threshold — ask the procuring entity in writing before arranging security.</div>
          </div>`,
        )
        .join('')}
      <p class="why">Minimum profile that clears every stated gate: ${
        Object.entries(a.gaps.minimum)
          .map(([k, v]) => `${MIN_LABEL[k] ?? String(k).replace(/_/g, ' ')} ${k === 'years_experience' ? `${v} yr` : money(v)}`)
          .join(' · ') || 'no numeric gates stated'
      }.</p>
    </div>` : ''}

    <div class="grid-2">
      <div class="card">
        <h3>Documents to attach (${a.documents.length})</h3>
        <ul class="checklist">${documents}</ul>
      </div>
      <div class="card">
        <h3>Needs a human</h3>
        ${ambiguities}
      </div>
    </div>

    <div class="card">
      <h3>Assessment <span class="chip">${esc(a.summaryMode)}</span></h3>
      <div class="summary">${esc(a.summary)}</div>
      <div class="summary bangla">${esc(a.summaryBn)}</div>
      <div class="actions" style="margin-top:16px">
        <button class="btn" id="copy-matrix" type="button">Copy compliance matrix</button>
        <button class="btn" id="copy-json" type="button">Copy audit JSON</button>
      </div>
    </div>

    <div class="card">
      <h3>Agent trace${unverified ? ' · ' + unverified + ' unverified claim(s) downgraded' : ''}</h3>
      <div class="trace">${trace}</div>
    </div>
  `

  $('#back-triage').addEventListener('click', () => {
    state.audit = null
    loadTriage()
  })

  $('#copy-matrix').addEventListener('click', async (e) => {
    const rows = a.findings
      .map((f) => `| ${f.label} | ${f.value ?? 'not stated'} | ${f.actual ?? '—'} | ${f.verdict} | p.${f.cite ?? '?'} |`)
      .join('\n')
    const md = [
      `### Compliance matrix — ${portalLabel(a.tender)}`,
      `Tender: ${a.tender.title}`,
      `Bidder: ${a.profile.name}`,
      `Verdict: ${a.verdict} (${a.counts.PASS} pass, ${a.counts.RISK} risk, ${a.counts.FAIL} fail)`,
      '',
      '| Criterion | Stated minimum | Bidder | Verdict | Source |',
      '| --- | --- | --- | --- | --- |',
      rows,
      '',
      `Tender security: ${money(a.security.amount, a.tender.currency)} (${a.security.form}), valid ${a.security.validity_days} days.`,
      `Deadline: ${when(a.submission.deadline)}.`,
    ].join('\n')
    try {
      await navigator.clipboard.writeText(md)
      e.target.textContent = 'Copied'
      setTimeout(() => (e.target.textContent = 'Copy compliance matrix'), 1600)
    } catch {
      e.target.textContent = 'Copy failed — use JSON'
    }
  })

  $('#copy-json').addEventListener('click', async (e) => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(a, null, 2))
      e.target.textContent = 'Copied'
      setTimeout(() => (e.target.textContent = 'Copy audit JSON'), 1600)
    } catch {
      e.target.textContent = 'Copy failed'
    }
  })

  const instrumentForm = $('#instrument-form')
  if (instrumentForm) {
    instrumentForm.addEventListener('submit', async (e) => {
      e.preventDefault()
      const out = $('#instrument-result')
      if (out) out.innerHTML = '<span class="cite-note">checking…</span>'
      const instrument = Object.fromEntries(new FormData(instrumentForm).entries())
      const iso = normalizeIsoDate(instrument.valid_until)
      if (!iso) {
        if (out) out.innerHTML = '<div class="issue">Enter the validity ending date as YYYY-MM-DD — for example 2027-03-27.</div>'
        return
      }
      instrument.valid_until = iso
      try {
        const res = await fetch('/api/security-check', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ tenderId: a.tender.id, instrument }),
        })
        const result = await res.json()
        if (!res.ok) throw new Error(result.error || 'check failed')
        if (out) {
          out.innerHTML = result.ok
            ? '<div class="ok-line">Instrument satisfies the clause — amount, form, payee and validity all match.</div>'
            : result.issues.map((i) => `<div class="issue ${esc(i.severity)}">${esc(i.message)}</div>`).join('')
        }
      } catch (err) {
        if (out) out.textContent = err.message
      }
    })
  }
}

const DAY = 86400000

function daysLeft(iso) {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return null
  return Math.ceil((t - Date.now()) / DAY)
}

function deadlineNote(iso) {
  const n = daysLeft(iso)
  if (n === null) return 'deadline not stated'
  if (n < 0) return `deadline passed ${-n}d ago`
  if (n === 0) return 'deadline today'
  return `deadline in ${n}d`
}

// one line saying what stands between this bidder and the bid
function triageLine(a) {
  if (a.verdict === 'ELIGIBLE') {
    const docs = a.documents.filter((d) => d.mandatory).length
    return `clears every stated gate · ${docs} document${docs === 1 ? '' : 's'} to attach`
  }
  if (a.verdict === 'DISQUALIFIED') {
    const fails = a.findings.filter((f) => f.verdict === 'FAIL')
    const names = fails.map((f) => f.label.toLowerCase()).join(', ')
    return `${fails.length} gate${fails.length === 1 ? '' : 's'} would disqualify you: ${names}`
  }
  const risks = a.findings.filter((f) => f.verdict === 'RISK')
  const names = risks.map((f) => f.label.toLowerCase()).join(', ')
  return `${risks.length} clause${risks.length === 1 ? '' : 's'} cannot be resolved from the document: ${names}`
}

function renderTriage(audits) {
  if (!audits.length) return renderEmpty()
  const count = (v) => audits.filter((a) => a.verdict === v).length
  const rank = { ELIGIBLE: 0, 'AT RISK': 1, DISQUALIFIED: 2 }
  const rows = [...audits]
    .sort((x, y) => rank[x.verdict] - rank[y.verdict] || Date.parse(x.submission.deadline) - Date.parse(y.submission.deadline))
    .map(
      (a) => `
      <button class="triage-row ${verdictClass(a.verdict)}" type="button" data-id="${esc(a.tender.id)}">
        <span class="t-badge ${verdictClass(a.verdict)}">${esc(a.verdict)}</span>
        <span class="t-main">
          <span class="t-title">${esc(a.tender.title)}</span>
          <span class="t-meta">${esc(portalLabel(a.tender))} · ${esc(a.tender.entity)} · ${esc(deadlineNote(a.submission.deadline))}</span>
        </span>
        <span class="t-block">${esc(triageLine(a))}</span>
        <span class="t-open">audit →</span>
      </button>`,
    )
    .join('')

  $('#stage').innerHTML = `
    <div class="triage">
      <h1>Which of these can you bid?</h1>
      <p class="triage-sub">
        ${audits.length} tenders audited against your profile: <strong class="t-ok">${count('ELIGIBLE')} eligible</strong>,
        <strong class="t-warn">${count('AT RISK')} at risk</strong>, <strong class="t-bad">${count('DISQUALIFIED')} disqualified</strong>.
        Pick one to see every clause and the page it came from.
      </p>
      <div class="triage-list">${rows}</div>
      <p class="why">Verdicts are recomputed from the documents here and on every profile edit — never replayed from a model's memory.</p>
    </div>`

  $('#stage')
    .querySelectorAll('.triage-row')
    .forEach((row) =>
      row.addEventListener('click', () => {
        state.selected = row.dataset.id
        renderTenders()
        runAudit()
      }),
    )
}

async function loadTriage() {
  if (!state.tenders.length || state.busy) return
  const profile = readProfile()
  $('#stage').innerHTML =
    '<div class="loading"><div class="bar"><i></i></div><div class="why">Auditing every tender on your board…</div></div>'
  try {
    const audits = await Promise.all(
      state.tenders.map(async (t) => {
        const res = await fetch('/api/audit', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ tenderId: t.id, profile }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || `audit failed (${res.status})`)
        return data
      }),
    )
    renderTriage(audits)
  } catch (err) {
    $('#stage').innerHTML = `<div class="error">${esc(err.message)}</div>`
  }
}

// profile edits invalidate the board, but never yank an audit out from under the reader
let triageTimer = null
function scheduleTriage() {
  clearTimeout(triageTimer)
  triageTimer = setTimeout(() => {
    if (!state.busy && !state.audit) loadTriage()
  }, 600)
}

async function runAudit() {
  if (!state.selected || state.busy) return
  state.busy = true
  $('#run').disabled = true
  $('#run').textContent = 'Auditing…'
  $('#stage').innerHTML =
    '<div class="loading"><div class="bar"><i></i></div><div class="why" id="load-step">Extracting clauses…</div></div>'

  const steps = ['Extracting clauses…', 'Evaluating rules…', 'Verifying every citation…', 'Writing the assessment…']
  let i = 0
  const timer = setInterval(() => {
    const el = $('#load-step')
    if (el) el.textContent = steps[Math.min(++i, steps.length - 1)]
  }, 900)

  try {
    const res = await fetch('/api/audit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tenderId: state.selected, profile: readProfile() }),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || `audit failed (${res.status})`)
    state.audit = data
    renderAudit(data)
  } catch (err) {
    $('#stage').innerHTML = `<div class="error">${esc(err.message)}</div>`
  } finally {
    clearInterval(timer)
    state.busy = false
    $('#run').disabled = false
    $('#run').textContent = 'Run audit'
  }
}

async function init() {
  $('#tenders').innerHTML = '<p class="why">loading tenders…</p>'
  try {
    const res = await fetch('/api/tenders')
    const data = await res.json()
    state.tenders = data.tenders
    state.profile = data.profile
    fillForm(data.profile)
    renderTenders()
    loadTriage()
  } catch (err) {
    $('#tenders').innerHTML = `<div class="error">${esc(err.message)}</div>`
  }

  const health = await fetch('/api/health').then((r) => r.json()).catch(() => null)
  const badge = $('#llm-badge')
  if (health?.llm) {
    badge.textContent = `live model · ${health.model || 'configured'}`
    badge.classList.add('live')
  } else {
    badge.textContent = 'deterministic mode · no API key'
  }

  $('#tenders').addEventListener('click', (e) => {
    const btn = e.target.closest('.tender')
    if (!btn) return
    state.selected = btn.dataset.id
    renderTenders()
  })

  $('#run').addEventListener('click', runAudit)
  $('#profile-form').addEventListener('input', () => {
    refreshHints()
    scheduleTriage()
  })
}

init()
