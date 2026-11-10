# Dorpotro (দরপত্র)

**A tender reader that refuses to guess.** Point it at a public procurement document and it answers
three questions with a page number behind every answer:

> Can I bid on this? · What must I attach? · What will disqualify me?

Built for the small firm with no bid department. No login, no database, no build step, no
dependencies. Node 18+ and nothing else.

```bash
git clone https://github.com/flameeecyber/dorpotro.git
cd dorpotro
npm start          # http://localhost:3000
npm test           # rules, verifier and all four sample tenders
npm run eval       # labelled expectations, exits non-zero on drift
```

## The problem it solves

A public tender is 40–200 pages of instructions, and the four clauses that decide whether you win
the right to bid are buried in a technical data sheet or an annexure. Two of them are usually
numbers — average turnover, largest comparable job, years of experience — and they are written in
prose, in local number grouping, with a corrigendum that quietly raised the threshold two weeks
after you read the document.

The cost of getting this wrong is not an error message. It is a bid security — often 2–5% of the
contract value, paid in advance as a bank guarantee — spent on a tender you were never eligible for.
For a firm with three staff and no procurement officer, this is the single most expensive reading
mistake in the business.

Generic chat assistants make it worse: asked for the turnover threshold, a model will read the
wrong page, borrow a number from a similar tender, or answer confidently from nothing at all.

## What it does

- **Verdict first.** `ELIGIBLE`, `AT RISK` or `DISQUALIFIED`, with the counts that produced it.
- **Criteria table with page citations.** Every requirement shows the tender's threshold, your
  number, the verdict, and the quoted clause it came from — as an expandable `p.7 · source clause`.
- **Documents checklist**, page-addressed, marked mandatory or optional, with items added by
  amendments flagged.
- **Tender security card.** Face value, accepted form, payee, validity window — plus a checker that
  validates the instrument you were about to pay for.
- **"What would it take".** The exact shortfall to the unit, and the minimum profile that clears
  every stated gate.
- **Corrigendum reconciliation.** Amendments supersede clauses, so they are applied before anything
  else, and the audit says what the base document alone would have told you.
- **Pipeline board.** Every tender in the library is audited at once and ranked
  `ELIGIBLE` → `AT RISK` → `DISQUALIFIED`, each row naming the gate that blocks it and the days
  left to act.
- **Compliance matrix export.** One click gives the markdown table a bidder pastes into their
  technical proposal.
- **Second-language summary.** Bangla ships as the reference locale; it is generated from the same
  typed result as the English one, never re-read from the document.

## The contract: cite, or refuse

> A finding may only name a page when the quoted sentence is actually on that page. A requirement
> whose threshold the document never states is returned as `RISK — not stated in the document`,
> never as a plausible number.

That contract is enforced in code (`lib/verify.js`), not asked for in a prompt. Every quote is
re-read against the page text; a mismatch corrects the page number or downgrades the finding to
`RISK`, the verdict is re-aggregated afterwards, and the UI reports a **citation integrity**
percentage. A wrong turnover threshold is worse than no threshold, so an unanswered clause becomes
a refusal instead of a guess.

## How an audit runs

```
ingest ──► corrigendum ──► extract ──► rules ──► verify ──► gaps ──► narrate
pages       amendments     clauses     code      quotes     shortfall  prose
```

| Stage | Module | What it does |
| --- | --- | --- |
| Ingest | `lib/pipeline.js` | Loads page-addressed text; the page map is the ground truth for every later citation |
| Corrigendum | `lib/corrigendum.js` | Applies amendments before anything is evaluated, keeping a base-vs-final changelog |
| Extract | `lib/pipeline.js` | Qualification clauses and document items, each with a page number (pre-extracted for the bundled samples; a live upload replaces this with a Reader call per section class) |
| Rules | `lib/rules.js` | Typed predicates over the company profile — **the model never decides a verdict** |
| Verify | `lib/verify.js` | Re-reads every quote against its cited page, corrects page numbers, downgrades what it cannot find |
| Gaps | `lib/gaps.js` | Shortfall arithmetic and the minimum profile that clears every stated gate |
| Narrate | `lib/llm.js` | Optional prose, constrained to the verified facts; deterministic summary with no API key |

The UI exposes all of it in the **Agent trace** panel with per-step timings, so the reasoning is
observable rather than asserted.

## Not tied to one portal

A tender is a document, not a vendor. Everything country-specific lives in the data, not in the
code:

| Field | Example | Used for |
| --- | --- | --- |
| `currency` | `BDT`, `INR`, `USD` | Money is rendered in the tender's currency. Lakh/crore grouping for BDT, INR, PKR, NPR, LKR; grouped digits with the ISO code for everything else (`USD 2.50m`) |
| `portal` | `e-GP`, `TED`, `SAM.gov` | How the tender is labelled in the list, the board and the exported matrix |
| `timezone` + `timezone_label` | `Asia/Dhaka` + `BST` | Deadlines render in the timezone the tender states, not the viewer's |

To add a document from another portal: append an entry to `data/index.json` with those four fields
and a JSON file whose `pages` array holds the page-addressed text. Nothing else changes.

## Samples in the box

Four documents ship with the repo so the app runs offline and a demo never depends on finding a
PDF at the right moment. They are representative samples modelled on real public e-GP invitations
in Bangladesh — not verbatim government documents, and labelled `"sample": true` with a provenance
note in each file.

| Tender | Type | Expected verdict | Demonstrates |
| --- | --- | --- | --- |
| 771204 · RHD Sylhet | works | `ELIGIBLE` | the happy path, 100% citation integrity |
| 780931 · DSHE | goods | `AT RISK` | the refusal path — a turnover clause pointing at an unpublished TDS |
| 788210 · LGED Sunamganj | works | `DISQUALIFIED` | corrigendum reconciliation — `ELIGIBLE` on the base document, failed by Amendment 02 |
| 793558 · BPDB | services | `DISQUALIFIED` | three stated criteria failing against the seed profile |

The seed company profile is a small contractor: turnover 1.85 crore, largest work 95 lakh, 7 years
of experience. Edit any field in the form and every verdict on the board recomputes.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port |
| `LLM_API_KEY` | unset | Optional. Any OpenAI-compatible key. Without it the app runs fully, in deterministic mode |
| `LLM_BASE_URL` | `https://openrouter.ai/api/v1` | OpenAI-compatible endpoint |
| `LLM_MODEL` | `google/gemini-2.5-flash` | Narration model |

Copy `.env.example` to `.env`, or export the variables before `npm start`. **The app is fully
functional with no key** — the summary is generated from the typed audit result, and the header
badge says which mode produced it (`deterministic mode · no API key`).

## Deploy

No build step and no dependencies, so any Node host works:

- **Render / Railway / Fly** — Web Service, empty build command, start `node server.js`, add
  `LLM_API_KEY` only if you want live narration.
- **Vercel** — expects a file-based API; wrap `runAudit` in `api/audit.js` or use a Node host.
- **Local tunnel** — `npm start` plus `cloudflared tunnel --url http://localhost:3000`.

Without a key the deployment still works end to end.

## Try it in 60 seconds

1. Open the URL — no account.
2. A company profile is pre-filled; the board ranks all four tenders.
3. Open **788210** to watch an amendment turn `ELIGIBLE` into `DISQUALIFIED`, with the clause that
   changed and the page it changed on.
4. Open **780931** to watch the agent refuse to invent a threshold.
5. Change the turnover field to `9000000` and watch a row turn red.
6. Press **Copy compliance matrix** and paste anywhere.

## Layout

```
server.js               zero-dependency HTTP server + JSON API
lib/pipeline.js         ingest → corrigendum → extract → rules → verify → gaps → narrate
lib/rules.js            deterministic verdicts (pure functions, tested)
lib/verify.js           the cite-or-refuse contract
lib/corrigendum.js      amendment supersession and base-vs-final diff
lib/gaps.js             shortfall arithmetic for failed numeric gates
lib/security-check.js   bid security face value, form, payee, validity
lib/money.js            currency-aware formatting, lakh/crore only where it is used
lib/llm.js              optional narration with deterministic fallback
data/tenders/*.json     four page-addressed sample tenders
public/                 single-page UI
scripts/eval.js         labelled eval harness (`npm run eval`)
test/                   node:test suite
```

## Roadmap

- **Next** live PDF and ZIP ingest, so a downloaded tender can be dropped in without hand-building
  the page map; portal adapters for e-GP, GeM, TED and SAM.gov
- **Then** deadline reminders, NOA price intelligence, capability-matched tender monitoring, and a
  per-bid provenance ledger a reviewer can audit

## Disclaimer

Advisory only. Always check the published tender document and any corrigendum before submitting a
bid.

## Prior art, checked honestly

The tender-intelligence space is crowded, so before claiming novelty the landscape was surveyed
(Nov 2026):

| Product | What it does | Where Dorpotro differs |
| --- | --- | --- |
| **TenderPulse** (Dhaka) | e-GP ZIP → eligibility, BOQ, PPR 2008 rule checks, bilingual copilot | Broader and commercial. It *extracts and scores*; it does not refuse. Dorpotro's verdict is a pure function over extracted facts, and an unanswered clause becomes an explicit "not stated in the document" rather than a plausible number |
| **GoBiDx** (Dhaka) | Tender aggregation, AI summaries, document vault, marketplace | Discovery-shaped. Dorpotro is a single-tender decision tool with page-level evidence |
| **TenderAI / Bidligence** (global) | Bid/no-bid scores, compliance matrices, bid writing | Weighted scoring models. Dorpotro makes the opposite bet: no score, no weighting — boolean gates where each gate cites the page that produced it |
| **The portals themselves** | Publish notices and documents | Read-only publishing. No eligibility reasoning, no corrigendum reconciliation |

The two ideas not found in any of the above:

1. **Cite-or-refuse as a hard contract.** Competitors reward fluency. A wrong turnover threshold is
   worse than no threshold, so an unstated clause is reported as unstated and the affected gate
   drops to `AT RISK`.
2. **Corrigendum reconciliation with a base-vs-final diff.** Amendment 02 on tender 788210 raises
   turnover from 1.00 crore to 2.50 crore, adds a document and moves the deadline. A bidder reading
   only the base document would read `ELIGIBLE`; the audit says `DISQUALIFIED` and shows exactly
   which change flipped it.

Neither is technically exotic. Both are what a bidder actually loses money on.
