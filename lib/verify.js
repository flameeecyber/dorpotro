// The cite-or-refuse contract.
// A finding may only claim a page if the quoted sentence is actually on that page.
// If it is not, the page is corrected when the text is found elsewhere, or the
// finding is downgraded to RISK with an explicit "unverified citation" reason.

export function normalize(input) {
  return String(input || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\u0980-\u09FF\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function tokenScore(quote, pageText) {
  const q = normalize(quote).split(' ').filter(Boolean)
  if (q.length === 0) return 0
  const bucket = new Set(normalize(pageText).split(' ').filter(Boolean))
  let hit = 0
  for (const tok of q) if (bucket.has(tok)) hit += 1
  return hit / q.length
}

// Exact substring wins outright; otherwise require 90% of the quote's tokens on the page.
export function matchQuote(quote, pageText) {
  const q = normalize(quote)
  if (!q) return { ok: false, score: 0 }
  if (normalize(pageText).includes(q)) return { ok: true, score: 1 }
  const score = tokenScore(quote, pageText)
  return { ok: score >= 0.9, score: Number(score.toFixed(3)) }
}

export function verifyOne({ quote, page }, pages) {
  if (!quote) {
    return { ok: false, cite: null, score: 0, note: 'no quote supplied by the extractor' }
  }
  const claimed = pages.find((p) => p.n === page)
  if (claimed) {
    const m = matchQuote(quote, claimed.text)
    if (m.ok) return { ok: true, cite: page, score: m.score, note: 'verified on the cited page' }
  }
  // The quote may be right while the page number is wrong. Find it and say so.
  for (const p of pages) {
    if (p.n === page) continue
    const m = matchQuote(quote, p.text)
    if (m.ok) {
      return { ok: true, cite: p.n, score: m.score, note: `citation corrected: page ${page} → ${p.n}` }
    }
  }
  return { ok: false, cite: null, score: 0, note: 'quote not found anywhere in the document' }
}

export function verifyAll(items, pages) {
  const results = items.map((item) => ({ id: item.id, ...verifyOne(item, pages) }))
  const ok = results.filter((r) => r.ok).length
  return {
    results,
    citationScore: results.length === 0 ? 0 : Math.round((ok / results.length) * 100),
    unverified: results.filter((r) => !r.ok).map((r) => r.id),
  }
}
