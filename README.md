# Dorpotro (দরপত্র)

**Tender eligibility, with the page it came from.** A Bangladeshi SME can drop a public
e-GP tender and get a defensible answer in one screen: *can I bid, what must I attach,
what will disqualify me* — every finding carrying the page it was read from, or an
explicit `not stated in the document`.

No login. No database. No build step, no dependencies to install. Node 18+ and nothing else.

```bash
git clone https://github.com/flameeecyber/dorpotro.git
cd dorpotro
npm start          # http://localhost:3000
npm test           # rules, verifier and all four sample tenders
npm run eval       # labelled expectations, exits non-zero on drift
```

## Why it is different

Most "AI document" tools summarise and hope. Dorpotro is built around a contract:

> **Cite, or refuse.** A finding may only name a page when the quoted sentence is
> actually on that page. A requirement whose threshold the tender never states is
> returned as `RISK — not stated in the document`, never as a guess.

That contract is enforced in code by `lib/verify.js`, and it is why the verdicts are
trustworthy enough to put money behind.

## Depth beyond the happy path

- **Pipeline board.** The landing view audits every tender on the board at once and ranks them
  `ELIGIBLE` → `AT RISK` → `DISQUALIFIED`, each row naming the gate that blocks it
  (*“3 gates would disqualify you: …”*) and the days left. It re-runs on every profile edit, so
  the ranking is computed from the documents rather than cached.
- **Corrigendum reconciliation.** Amendments supersede clauses, so they are applied before
  anything else and the audit reflects the live requirement. The response also carries
  `baseVerdict`, so the UI can say what the base document alone would have told you —
  `egp-788210` reads `ELIGIBLE` on the base document and `DISQUALIFIED` after Amendment 02.
- **Verdicts are re-aggregated after verification.** A failed citation downgrades a finding
  and the banner is recomputed, so a broken quote can never leave an optimistic verdict on screen.
- **Per-finding confidence with escalation.** Verified thresholds score `0.96`, refusals `0.6`,
  unverified citations `0.4`; anything below `0.8` is surfaced as “needs review”.
- **“What would it take”.** Exact shortfall to the taka for every failed numeric gate, plus the
  minimum profile that clears every stated gate.
- **Security instrument checker.** Validates face value, form, payee and validity
  (deadline + `validity_days`) against the clause, and rejects the four ways a guarantee
  actually gets thrown out.
- **Bangla summary**, deterministic, derived from the same typed result as the English one.
- **Eval harness.** `npm run eval` scores the pipeline against labelled expectations for all
  four tenders and exits non-zero on drift, so a rule or prompt change cannot silently regress.

## How an audit runs

```
ingest ──► extract ──► rules ──► verify ──► narrate
pages      clauses     code      quotes     prose
```

| Stage | Module | What it does |
| --- | --- | --- |
| Ingest | `lib/pipeline.js` | Loads page-addressed text; the page map is the ground truth for every later citation |
| Extract | `lib/pipeline.js` | Qualification clauses and document items, each with a page number (pre-extracted for the bundled samples; a live PDF upload replaces this with a Reader agent call per section class) |
| Rules | `lib/rules.js` | Typed predicates evaluated against the company profile — **the model never decides a verdict** |
| Verify | `lib/verify.js` | Re-reads every quote against its cited page; corrects wrong page numbers; downgrades anything it cannot find to `RISK` |
| Narrate | `lib/llm.js` | Optional LLM prose, constrained to the verified facts. Falls back to a deterministic summary with no API key |

The UI exposes all five steps in the **Agent trace** panel with per-step timings, plus a
**citation integrity** percentage — so the reasoning is observable rather than asserted.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port |
| `LLM_API_KEY` | unset | Optional. Any OpenAI-compatible key. Without it the app runs fully, in deterministic mode |
| `LLM_BASE_URL` | `https://openrouter.ai/api/v1` | OpenAI-compatible endpoint |
| `LLM_MODEL` | `google/gemini-2.5-flash` | Narration model |

Copy `.env.example` to `.env` or export the variables before `npm start`. **The app is
fully functional with no key** — the deterministic summary is generated from the typed
audit result, and the UI labels which mode produced it.

## Sample tenders

Four representative documents are bundled in `data/tenders/` with page-level text, so the demo
never depends on finding a live PDF at the right moment:

| Tender | Type | Expected verdict | Demonstrates |
| --- | --- | --- | --- |
| e-GP 771204 · RHD Sylhet | works | `ELIGIBLE` | the happy path, 100% citation integrity |
| e-GP 780931 · DSHE | goods | `AT RISK` | the refusal path — a turnover clause pointing at an unpublished TDS |
| e-GP 788210 · LGED Sunamganj | works | `DISQUALIFIED` | corrigendum reconciliation — `ELIGIBLE` on the base document, failed by Amendment 02 |
| e-GP 793558 · BPDB | services | `DISQUALIFIED` | three stated criteria failing against the seed profile |

They are modelled on real e-GP invitations for tenders and are labelled as samples in
`data/index.json`; they are not verbatim government documents. The pipeline treats them
exactly as it would a live download, and every quote is verified against the page text
that ships with them.

## Deploy (for the demo link)

No build step, no dependencies, so any Node host works:

- **Render / Railway / Fly** — new Web Service, build command empty, start command `node server.js`, add `LLM_API_KEY` if you want live narration.
- **Vercel** — Vercel expects a file-based API, so either wrap `runAudit` in `api/audit.js` or point the demo link at a Render URL. Render is the five-minute path.
- **Local tunnel** — `npm start` + `cloudflared tunnel --url http://localhost:3000` if you are out of time and need a public URL now.

Without `LLM_API_KEY` the deployment still works end to end and the header badge says
`deterministic mode` — the demo never depends on a secret.

## Try it in 60 seconds

1. Open the URL — no account, no key.
2. A company profile is pre-filled.
3. Click a tender, press **Run audit**.
4. Check the verdict banner, the page chips, the document checklist, and the trace.
5. Switch to e-GP 780931 to see the agent refuse to invent a threshold.

**Copy compliance matrix** produces the markdown table a bidder pastes into their
technical proposal.

## Roadmap

- **P1** corrigendum reconciliation, tender-security instrument checker, counterfactual
  bid simulator, Bangla-first output, deadline reminders
- **P2** NOA price intelligence, capability-matched tender monitoring, a labelled eval
  corpus with eval-gated prompts, human-in-the-loop escalation, per-bid provenance ledger

## Layout

```
server.js            zero-dependency HTTP server + JSON API
lib/rules.js         deterministic verdicts (pure functions, tested)
lib/verify.js        the cite-or-refuse contract
lib/llm.js           optional narration with deterministic fallback
lib/pipeline.js      ingest → extract → rules → verify → narrate
data/tenders/*.json  three page-addressed sample tenders
lib/corrigendum.js   amendment supersession and base-vs-final diff
lib/gaps.js          shortfall arithmetic for failed numeric gates
lib/security-check.js  bid-security face value, form, payee, validity
public/              single-page UI
scripts/eval.js      labelled eval harness (`npm run eval`)
test/                node:test suite
```

## Disclaimer

Advisory only. Always check the published tender document and any corrigendum before
submitting a bid.

## Prior art, checked honestly

Before claiming novelty, the local and global landscape was surveyed (Nov 2026):

| Product | What it does | Where Dorpotro differs |
|---|---|---|
| **TenderPulse** (Dhaka) | e-GP ZIP → eligibility, BOQ, PPR 2008 rule checks, bilingual copilot | Broader and commercial. It *extracts and scores*; it does not refuse. Dorpotro's verdict is a pure function over extracted facts, and an unanswered clause becomes an explicit "not stated in the document" rather than a plausible number |
| **GoBiDx** (Dhaka) | Tender aggregation, AI summaries, document vault, marketplace | Discovery-shaped. Dorpotro is a single-tender decision tool with page-level evidence |
| **TenderAI / Bidligence** (global) | Bid/no-bid scores, compliance matrices, bid writing | Weighted scoring models. Dorpotro makes the opposite bet: no score, no weighting — boolean gates where each gate cites the page that produced it |
| **e-GP portal itself** | Publishes notices and documents | Read-only publishing. No eligibility reasoning, no corrigendum reconciliation |

The two ideas not found in any of the above:

1. **Cite-or-refuse as a hard contract.** Competitors reward fluency. A wrong turnover threshold is worse than no threshold, so an unstated clause is reported as unstated and the affected gate drops to AT RISK.
2. **Corrigendum reconciliation with a base-vs-final diff.** Amendment 02 on tender 788210 raises turnover from 1.00 crore to 2.50 crore, adds a document, and moves the deadline. A bidder reading only the base document would read ELIGIBLE; the audit says DISQUALIFIED and shows exactly which change flipped it.

Neither is technically exotic. Both are what a bidder actually loses money on.
