// Money formatting is a property of the document, not of the product.
//
// Currencies that use lakh/crore grouping get lakh/crore; everything else gets
// grouped digits with the ISO code in front, so a figure is never ambiguous about
// which money it is. Amounts are never rendered without a currency.

const LAKH_GROUPED = new Set(['BDT', 'INR', 'PKR', 'NPR', 'LKR'])

export function formatMoney(amount, currency = 'BDT') {
  if (amount === null || amount === undefined || amount === '') return '—'
  const v = Number(amount)
  if (!Number.isFinite(v)) return '—'
  const cur = String(currency || 'BDT').toUpperCase()
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
