// Corrigendum reconciliation.
// Amendments supersede clauses. A bidder who reads only the base document bids
// against a dead requirement, so the effective requirement set is what gets audited.

export function applyAmendments(tender) {
  const amendments = tender.amendments || []
  const requirements = tender.requirements.map((r) => ({ ...r }))
  const documents = tender.documents.map((d) => ({ ...d }))
  const submission = { ...tender.submission }
  const changelog = []

  for (const am of amendments) {
    for (const change of am.changes || []) {
      if (change.kind === 'override_requirement') {
        const req = requirements.find((r) => r.id === change.target)
        if (!req) continue
        changelog.push({
          id: `chg-${changelog.length + 1}`,
          amendment: am.number,
          date: am.date,
          target: req.label,
          field: change.field,
          from: req[change.field],
          to: change.to,
          page: change.page,
          quote: change.quote,
        })
        req[change.field] = change.to
        req.quote = change.quote
        req.page = change.page
        req.amendedBy = am.number
      } else if (change.kind === 'override_submission') {
        changelog.push({
          id: `chg-${changelog.length + 1}`,
          amendment: am.number,
          date: am.date,
          target: 'Submission',
          field: change.field,
          from: submission[change.field],
          to: change.to,
          page: change.page,
          quote: change.quote,
        })
        submission[change.field] = change.to
        submission.quote = change.quote
        submission.page = change.page
      } else if (change.kind === 'add_document') {
        documents.push({
          id: `am${am.number}-d${documents.length + 1}`,
          name: change.name,
          mandatory: true,
          page: change.page,
          quote: change.quote,
          addedBy: am.number,
        })
        changelog.push({
          id: `chg-${changelog.length + 1}`,
          amendment: am.number,
          date: am.date,
          target: change.name,
          field: 'document',
          from: null,
          to: 'now required',
          page: change.page,
          quote: change.quote,
        })
      }
    }
  }

  return { requirements, documents, submission, changelog, amendments }
}
