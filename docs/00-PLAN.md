# 00 — The Plan: Kickoff to Winning Submission

**Kickoff:** Tuesday 11 August 2026 · **Final submission:** ~Friday 11 September 2026 (confirm the exact date in the first mentor session)

Five phases. Each has a hard exit criterion. **Do not start the next phase until the current one exits** — the single most common way hackathon teams lose is carrying half-finished work forward until everything is 80% done and nothing is demoable.

---

## How teams actually lose this competition

Read this before the plan. Every item is avoidable.

1. **They build a chatbot over PDFs.** Impressive in week one, indistinguishable from every other team by week four. Our differentiator is prevention (Feature 2) and precedent-grounding with refusal (Feature 3) — not chat.
2. **They demo on three documents.** Search over a tiny corpus is unconvincing. Ours has ~1,100 considerations with planted structure.
3. **They have no numbers.** "It works well" loses to "Recall@5 of 0.87 against 0.61 for vector-only, on a held-out set."
4. **They ignore the domain.** Using "amendment" instead of "substantial modification" tells a Novo Nordisk regulatory judge you did not do the reading.
5. **They demo live on unreliable Wi-Fi with no backup.** Record the demo video in Week 4.
6. **They present the technology instead of the business case.** Judges weight Business Impact plus Feasibility at 35% — more than Technical Implementation alone.
7. **They finish the code the night before and rehearse the pitch zero times.** Presentation Quality is 15%, and a rehearsed deck also raises the perceived score of everything else.
8. **They waste the mentor.** Weekly access to a Novo Nordisk regulatory professional is the largest unfair advantage available. Use every session.

---

## PHASE 0 — Foundations (Tue 11 Aug – Sat 16 Aug)

**Exit criterion:** the app runs from a fresh clone on any team member's machine, authenticates a user, shows an empty search page, and reads from the live Supabase database. Domain document has zero unresolved `[VERIFY]` tags on the items you need for the deck.

### Day 1 — Tue 11 Aug — Kickoff and setup

1. **Attend kickoff. Take notes on exactly what they emphasise.** Whatever the Novo Nordisk speakers repeat is what the judges weight.
2. **Assign roles now** (details in `docs/07-TEAM-AND-RISKS.md`):
   - **Lead / Integrator** — owns the repo, the deploy, the demo, the final merge
   - **Retrieval Engineer** — embeddings, hybrid search, the eval harness
   - **AI Engineer** — risk scoring, RAG drafting, the verifier
   - **Frontend / UX** — all five screens, charts, the workflow UI
   - **Domain / PM** — EU CTR research, taxonomy, synthetic corpus design, deck, report, mentor liaison
3. **Set up the shared infrastructure** (Lead, ~2 hours). The scaffold, migrations, CI workflow, and taxonomy already exist in this repo — what remains is accounts and wiring:
   ```bash
   git init && git add -A && git commit -m "Initial scaffold and knowledge base"
   gh repo create <org>/rfi-vault --private --source=. --push
   npx shadcn@latest init -d
   cp .env.example .env.local            # then fill in the keys below
   ```
   - Supabase project in **eu-central-1 (Frankfurt)** — region matters, see `docs/02-ARCHITECTURE.md` §5
   - Google AI Studio API key for Gemini (https://aistudio.google.com/apikey)
   - GitHub Actions already configured in `.github/workflows/ci.yml`
   - Branch protection on `main`; everything goes through a PR
   - **Hosting is deliberately not set up today** — see ADR-011. Decided at the start of Phase 3.
4. **Daily standup slot booked** — 20 minutes, same time every day, non-negotiable. Async written update if someone cannot attend.

### Day 2 — Wed 12 Aug — Domain immersion (whole team, together)

This is not optional and it is not only the PM's job. **The whole team reads for one day.** Every subsequent decision gets faster and better.

- Read `docs/01-DOMAIN.md` end to end.
- Domain lead reads the **EMA CTIS Sponsor Handbook** and resolves every `[VERIFY]` tag.
- Each engineer reads **Regulation (EU) No 536/2014 Articles 5–8** — skim, but actually open it.
- Dissect the supplied ISTAT RFI example line by line as a group. Every field in `rfi_consideration` should trace to something in that document.
- Write the **first draft of the taxonomy** in `scripts/seed/taxonomy.ts`.
- **Prepare the mentor question list** (see the Mentor Protocol below).

### Day 3 — Thu 13 Aug — Schema and skeleton

- Apply migrations `0001`–`0008` from `docs/03-DATA-MODEL.md`.
- `npm run db:migrate` working; typed client generated:
  ```bash
  npx supabase gen types typescript --project-id <id> > lib/db/types.ts
  ```
- Supabase Auth wired; five demo accounts, one per role, seeded via script.
- App shell: sidebar, five routes, all rendering an empty state.
- **Fresh-clone check.** A teammate on a different machine clones the repo and reaches a running app in under ninety seconds using only `README.md`. This is the Day 3 milestone that replaces "deploy to Vercel" (ADR-011) — it protects against the same failure mode, which is discovering on the final weekend that the app only runs on one person's laptop.
- Add hosting selection to the Phase 3 agenda so it does not silently slip.

### Day 4 — Fri 14 Aug — First mentor session

Highest-leverage hour of the entire month. See the Mentor Protocol below.

### Day 5–6 — Sat 15 – Sun 16 Aug — Corpus generation

- Hand-write ~40 skeleton considerations across the taxonomy tiers.
- Build `scripts/seed/generate.ts`; produce **900–1,200 considerations** with the distributions in `docs/03-DATA-MODEL.md` §2.1.
- Plant the demo structure: near-duplicate clusters, semantic-only pairs, keyword-only pairs, risk labels, the no-precedent RFI, the ISTAT spike.
- Embed everything; verify the HNSW index is used:
  ```sql
  explain analyze select * from rfi_embedding order by embedding <=> $1 limit 10;
  ```
- **Read 30 generated considerations out loud as a team.** If they sound like an LLM wrote them, fix the skeletons and regenerate. The corpus is the demo.

---

## PHASE 1 — Feature 1, hybrid search + the eval harness (Mon 17 Aug – Sun 23 Aug)

**Exit criterion:** search works end to end for every team member from a fresh clone, and `npm run eval` prints the ablation table with real numbers.

### Mon 18 – Tue 18 Aug
- `hybrid_search` SQL function deployed and unit-tested.
- `/api/search` route: Zod-validated, filters for section / part / Member State / category / date / status.
- Vector-only and keyword-only paths kept behind a flag — **you need them for the ablation table**, so do not delete them.

### Wed 19 – Thu 20 Aug
- Search UI: query box, facet filters, result cards showing consideration, approved response, Member State, date, confidence band, and *why it matched*.
- Detail view with the source document link (signed URL, correct page).
- Empty, loading, and error states.

### Fri 21 Aug — **Build the eval harness this week, not later**
- Hand-mark 50 gold queries (whole team, one hour, in parallel — 10 each).
- `scripts/eval/run.ts` → Recall@5, MRR@10, nDCG@10, latency.
- Run all four configurations. Commit `docs/metrics/2026-08-21.json`.
- **Second mentor session** — bring the working search and let them try it.

### Sat 22 – Sun 23 Aug
- Tune RRF `k`; decide on the reranker based on measured nDCG.
- Calibrate the confidence bands against the gold set.
- Break the ablation down by query type — this becomes the strongest slide in the deck.

---

## PHASE 2 — Features 2 and 3, the differentiators (Mon 24 Aug – Sun 30 Aug)

**Exit criterion:** upload a draft application, get per-section risk scores with evidence; paste an RFI, get a grounded draft with citations, deltas, and a working refusal path.

### Mon 24 – Tue 25 Aug — Risk scoring
- Rule engine with 20–30 rules across sections and Member States; unit-tested individually.
- Similarity and base-rate signals.
- Blend, fit weights on the training split, band thresholds from the PR curve.
- `/assess` UI: sections sorted by risk, colour-banded, expandable to show drivers, precedents, and `recommendedAction`.

### Wed 26 – Thu 27 Aug — Draft generation
- Retrieval with the APPROVED + ACCEPTED preference.
- `generateObject` with `DraftSchema`; streamed into the UI.
- **The confidence gate and the refusal path — build this before polishing the happy path.**
- Delta detection surfaced as a reviewer checklist.
- Verifier pass; unsupported sentences visibly flagged.

### Fri 28 Aug — Mentor session + evaluation
- Demo risk scoring and drafting. Ask directly: *"Would you trust this? What would stop you using it?"* Write the answer down verbatim — it is a quote for the deck and a roadmap item.
- Run eval suites B and C. Commit the metrics.

### Sat 29 – Sun 30 Aug — Workflow and audit
- Status machine: DRAFT → IN_REVIEW → APPROVED → SUBMITTED, with request-changes.
- Audit events on every transition; append-only trigger tested.
- RLS policies tested per role.
- **The feedback loop, demoed end to end:** approve a draft, search for it, find it.

---

## PHASE 3 — Analytics, hardening, production readiness (Mon 31 Aug – Sun 6 Sep)

**Exit criterion:** all five features work on a live hosted URL, the test suite is green in CI, and the demo video is recorded.

### Mon 31 Aug — Choose and set up hosting (ADR-011)
Deferred from Day 1, and this is the deadline. Criteria: EU region, free tier, deploys from GitHub, Node 24, under thirty minutes of setup. Candidates: Render, Netlify, Cloudflare, Railway, self-hosted `next start`, or Vercel. Time-box to half a day; if it overruns, fall back to a local demo plus the recorded video and say so honestly.

### Mon 31 Aug – Tue 1 Sep — Analytics
- Aggregate views; Recharts dashboard: volume by section, by category, by Member State, over time.
- Recurrence view — "this issue has recurred N times across M trials".
- Preventability split, Tier 1 + Tier 2 share.
- Effort-avoided model with the assumptions exposed as adjustable inputs.
- Make the ISTAT spike findable in the UI; it is a demo beat.

### Wed 2 – Thu 3 Sep — Hardening
- Playwright E2E covering all five features, plus the RLS isolation test.
- Vitest coverage ≥ 70% on `lib/`.
- Error boundaries, toasts, skeleton loaders, empty states everywhere.
- Rate limiting on AI routes; file type and size validation on upload.
- Accessibility pass: keyboard navigation, focus rings, contrast, chart labels.
- Lighthouse ≥ 90 / ≥ 95.
- `README.md`, `.env.example`, architecture diagram, ninety-second setup instructions.

### Fri 4 Sep — Final mentor session
- Full dress-rehearsal demo. Ask what a judge would attack. Fix exactly that over the weekend.

### Sat 5 – Sun 6 Sep — Freeze and record
- **Feature freeze Saturday evening.** No new features after this point, ever, under any argument.
- Final `npm run eval`; metrics locked for the deck.
- **Record the demo video** — 4–5 minutes, clean audio, cursor visible, no dead air. This is your insurance against a failed live demo, and against a strict time limit on the day.
- Seed a pristine demo database; script the exact click path.

---

## PHASE 4 — Presentation, report, rehearsal (Mon 7 Sep – Thu 10 Sep)

**Exit criterion:** deck done, report done, demo rehearsed five times, Q&A answers written down.

- **Mon 7 Sep** — Build the deck from `docs/06-DEMO-AND-DECK.md`. Story first, slides second.
- **Tue 8 Sep** — Write the 2-page report. Two pages is a hard constraint; it takes two drafts to do well. Cut ruthlessly.
- **Wed 9 Sep** — Rehearsal one and two. Time it. Cut 20%. Prepare Q&A answers, especially: *hallucination, data privacy, integration with existing systems, why not just SharePoint search, what happens with real data volumes, who maintains the taxonomy.*
- **Thu 10 Sep** — Rehearsals three to five, including one with the college mentor as a hostile audience. Test the exact demo machine, network, screen share, and audio in the actual Teams setup.
- **Fri 11 Sep** — Submit early in the day. Present.

---

## The Mentor Protocol

You get roughly four sessions with a Novo Nordisk GBS professional. Treat each one as a stakeholder interview, not a status update.

**Every session:** send an agenda 24 hours ahead, demo something working (even in week one), ask your prepared questions, send a written summary within two hours listing what you will change as a result. That summary loop alone will make your team memorable.

**Session 1 (14 Aug) — discovery.** Do not demo technology. Ask:
- Walk me through what happens the day a validation RFI arrives. Who is touched, in what order?
- What share of applications get a validation RFI? How many considerations typically?
- Which categories recur most? What is the most annoying repeat offender?
- Where are past RFIs stored today — SharePoint, Veeva Vault RIM, email, a spreadsheet?
- How many person-hours does a typical consideration consume?
- Has an application ever lapsed because a response missed the clock?
- Who would use this daily, and who would have to approve deploying it?
- What would make a regulatory affairs colleague *not* trust an AI-drafted response?

**Session 2 (21 Aug) — validate retrieval.** Let them use the search. Watch what they type — real user vocabulary is free product insight. Ask whether the taxonomy matches how they think.

**Session 3 (28 Aug) — validate the differentiators.** Demo risk scoring and drafting. Ask what would stop them trusting it, and what integration it would need to be adopted.

**Session 4 (4 Sep) — dress rehearsal.** Full pitch. Ask them to be the judge. Ask directly what would make this a winner and what is missing.

**Put their answers in the deck.** A slide reading *"Validated with our Novo Nordisk mentor: [three quotes]"* is worth more than any feature, because it proves the solution is grounded in the actual problem rather than in your assumptions.

---

## Daily discipline

- 20-minute standup, same time, every day: shipped / blocked / today.
- Every merge to `main` deploys and stays green. Never break `main`.
- **Demo-able every Friday.** If it cannot be demoed on Friday, it does not count as done.
- Log every decision in `docs/DECISIONS.md` and every insight in `MEMORY.md`, on the day it happens.
- Time-box any blocker to two hours, then escalate to the team.

## Weekly checkpoint questions

Ask these every Friday. Honest answers only.

1. Can we demo today, end to end, on the production URL?
2. What number improved this week?
3. What did the mentor tell us, and what did we change because of it?
4. What is the one thing most likely to sink us, and who owns it?
5. Are we still building the thing that wins, or the thing that is fun to build?
