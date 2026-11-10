// Narration is the only optional LLM step. The product works without a key:
// it falls back to a deterministic summary built from the typed audit result.
// The model is never allowed to introduce a fact that is not in that result.

import { formatBDT } from './rules.js'

const BASE_URL = process.env.LLM_BASE_URL || 'https://openrouter.ai/api/v1'
const MODEL = process.env.LLM_MODEL || 'google/gemini-2.5-flash'

function bulletCharge(findings) {
  return findings
    .filter((f) => f.verdict !== 'PASS')
    .map((f) => `${f.verdict}: ${f.label} — ${f.reason}${f.cite ? ` (p.${f.cite})` : ''}`)
}

export function deterministicSummary({ tender, verdict, findings, documents, security }) {
  const lines = []
  const blocking = findings.filter((f) => f.verdict === 'FAIL')
  const open = findings.filter((f) => f.verdict === 'RISK')

  if (verdict === 'ELIGIBLE') {
    lines.push(`You meet every stated minimum-qualification criterion in this tender.`)
  } else if (verdict === 'DISQUALIFIED') {
    lines.push(`Do not submit as you stand: ${blocking.length} stated ${blocking.length === 1 ? 'criterion fails' : 'criteria fail'} against your profile.`)
    for (const f of blocking) lines.push(`• ${f.label} — ${f.reason}${f.cite ? ` (p.${f.cite})` : ''}`)
  } else {
    lines.push(`Your profile clears the numeric gates, but ${open.length} criterion${open.length === 1 ? ' is' : 's are'} unresolved. Resolve them in writing before you spend the bid security.`)
    for (const f of open) lines.push(`• ${f.label} — ${f.reason}${f.cite ? ` (p.${f.cite})` : ''}`)
  }

  const mandatory = documents.filter((d) => d.mandatory).length
  lines.push(`Attach ${mandatory} mandatory document${mandatory === 1 ? '' : 's'}; tender security is ${formatBDT(security?.amount_bdt)}.`)
  return lines.join('\n')
}

// Bangla summary, deterministically derived from the same typed result.
// Most owners cannot read the English legalese; this is the product for them.
export function banglaSummary({ verdict, counts, documents, security }) {
  const lines = []
  if (verdict === 'ELIGIBLE') {
    lines.push('এই দরপত্রে উল্লিখিত সব শর্ত আপনার প্রতিষ্ঠান পূরণ করে।')
  } else if (verdict === 'DISQUALIFIED') {
    lines.push(`বর্তমান তথ্য অনুযায়ী ${counts.FAIL}টি শর্ত পূরণ হচ্ছে না, তাই আবেদন করলে বাতিল হওয়ার সম্ভাবনা আছে।`)
  } else {
    lines.push('কিছু শর্ত দরপত্রে স্পষ্টভাবে উল্লেখ নেই — জামানত জমা দেওয়ার আগে দরপত্র দাখিলকারী কর্তৃপক্ষের সাথে লিখিতভাবে নিশ্চিত করুন।')
  }
  const docs = documents.filter((d) => d.mandatory).length
  lines.push(`মোট ${docs}টি বাধ্যতামূলক কাগজ জমা দিতে হবে।`)
  if (security?.amount_bdt) lines.push(`দরপত্র জামানত: ${formatBDT(security.amount_bdt)}।`)
  return lines.join('\n')
}

export async function narrate({ tender, verdict, findings, documents, security, citationScore }) {
  const key = process.env.LLM_API_KEY
  const fallback = deterministicSummary({ tender, verdict, findings, documents, security })

  if (!key) return { text: fallback, mode: 'deterministic', model: null }

  const charges = bulletCharge(findings)
  const prompt = [
    'You are a procurement assistant for a small Bangladeshi contractor.',
    'Write at most 4 short sentences of plain English advice.',
    'RULES: use ONLY the facts listed below. Do not invent requirements, amounts, dates or deadlines.',
    'If a criterion is unresolved, say what the bidder must confirm and with whom. Never estimate a missing value.',
    '',
    `Tender: ${tender.title} (${tender.entity})`,
    `Aggregate verdict: ${verdict}`,
    `Citation integrity: ${citationScore}% of findings quote the source document verbatim.`,
    `Deadline: ${tender.submission?.deadline || 'not stated'} (${tender.submission?.mode || 'mode not stated'})`,
    `Tender security: ${formatBDT(security?.amount_bdt)}`,
    `Mandatory documents: ${documents.filter((d) => d.mandatory).map((d) => d.name).join('; ')}`,
    `Outstanding issues: ${charges.length ? charges.join(' | ') : 'none'}`,
  ].join('\n')

  try {
    const res = await fetch(`${BASE_URL.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.1,
        max_tokens: 320,
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: AbortSignal.timeout(20000),
    })
    if (!res.ok) throw new Error(`llm ${res.status}`)
    const data = await res.json()
    const text = data?.choices?.[0]?.message?.content?.trim()
    if (!text) throw new Error('empty completion')
    return { text, mode: 'live', model: MODEL }
  } catch (err) {
    return { text: fallback, mode: 'fallback', model: null, error: String(err.message || err) }
  }
}
