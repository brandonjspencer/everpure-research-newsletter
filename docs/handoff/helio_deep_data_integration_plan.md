# Helio deep-data integration plan

**Status:** Phase 0 shipped ([PR #32](https://github.com/brandonjspencer/everpure-research-newsletter/pull/32)); Phases 1–3 proposed.
**Author:** drafted 2026-06-18.
**Scope:** how the Helio report-endpoint data (UX metrics + verbatim quotes, and the
sections we don't yet pull) flows into the **dashboard** and the **monthly issues**, and how a
deterministic **inference pass** turns it into *actionable + directional* insight — without
inventing certainty beyond the evidence.

> **Core principle (unchanged).** The deterministic build emits the **evidence substrate**;
> editorial synthesis (humans + the QC agent suite) decides what becomes a published claim.
> Confidence labels are exactly `Low / Medium / High confidence` and reflect **evidence-readiness**,
> never preference. `High` requires corroboration. Respondent quotes are **real participant words**
> only. Frozen issues are immutable. This plan adds inputs and an inference layer; it does not move
> the line between "evidence" and "assertion of certainty."

---

## 0. What shipped in Phase 0 (the foundation this plan builds on)

`everpure_helio_ingest.py` now calls the AI-friendly report endpoint
`GET /api/public/tests/:id/report?include=ux_metrics,questions_summary,questions_responses` for each
discovered variant report id (Tier B, alongside the Tier B-lite config fetch). Per cycle it now puts
into the substrate (`helio_evidence.json` → frozen to `history/helio/YYYY-MM.json`):

- **`metrics[]` gap-filled** with per-variant UX-metric scores — never overwriting a scraped Tier-A
  score, adding the metrics/variants the compare page omitted. This already populates the dashboard's
  **Comprehension & Sentiment** sparklines (`METRIC_TREND_KEYS`).
- **`variants[].report_metrics`** — the raw per-variant API metric map (provenance / corroboration).
- **`respondent_quotes[]`** — verbatim participant answers, with a wrapped copy folded into
  `evidence_text` so the existing harvesters surface them in the dashboard rotator and (via concept
  matching) the issues.
- **`helio_fetch_status.json` → `report_deep[].top_keys`** — the observed live JSON shape, recorded
  for parser refinement.

**The unfetched menu** (available from the same endpoint, not yet requested): `demographics`,
`questions_summary` (per-question rollups), `questions_followups`, `prototype_journeys`,
`audiences_summary`, `filter_options`, `participants`, plus demographic/`sentiment`/`segment_id`
**filters** on every section. These are the inputs Phases 2–3 draw on.

---

## 1. Data inventory — what we can now reason over

| Datum | Source (include) | Grain | Today |
| --- | --- | --- | --- |
| UX metric scores (comprehension, sentiment, engagement, intent, expectations, overall UX) | `ux_metrics` | per variant | **Live (Phase 0)** |
| Sample size `n`, spam/flag integrity | `GET /tests/:id` | per test | Live (Tier B-lite) |
| Verbatim open-ends | `questions_responses` / `merged_explanations` | per response | **Live (Phase 0)** |
| Per-question rollups (which question drove a dip) | `questions_summary` | per question | Fetched, not yet parsed |
| Demographic / segment cuts | `demographics`, filters | per segment | Phase 2 |
| Sentiment-by-segment | `sentiment` filter | per segment | Phase 2 |
| Prototype journeys (task paths, drop-off) | `prototype_journeys` | per task | Phase 3 |

---

## 2. Dashboard integration (the longitudinal "repo-IS-the-DB" view)

The dashboard's job is the **trend over time + the current-cycle comparison**. Deep data upgrades it
from "scraped headline deltas" to "complete, corroborated, explainable."

1. **Corroboration badge on metrics (Phase 1, cheap).** Each metric value now carries a `source`
   (`report_api` when gap-filled). Render a small indicator: **Tier-A scrape only** / **API only** /
   **both agree** (scrape ≈ API within a margin) / **conflict**. "Both agree" is the visual anchor for
   a High-confidence read; "conflict" flags a data-quality question. This is the dashboard's honest
   confidence signal.
2. **Comprehension & Sentiment sparklines — now real (Phase 0/1).** Variants-now is populated;
   cycles-over-time fills as `history/helio/` accrues. Phase 1: add **engagement/intent** as optional
   tracked keys behind the same machinery (`METRIC_TREND_KEYS`).
3. **Quote rotator fed by real verbatims (Phase 0).** Attribute each Helio verbatim to its
   **screen/comparison** rather than the generic "Research participant" where the concept is trusted.
4. **Per-question drill (Phase 2, needs `questions_summary`).** Under a comparison, a collapsible
   "which question moved the metric" mini-table — turns "comprehension 78 vs 61" into "Q3 (label
   recognition) drove it."
5. **Demographic facet (Phase 2, needs `demographics`/filters).** A "who said this" cut — e.g.
   sentiment by segment — rendered as **directional**, explicitly sample-gated (hidden when a
   segment's n is too small to read).
6. **Insight chips (Phase 2).** Surface the inference-pass output (§4) as compact, graded chips on
   each comparison ("Directional winner: V1 — Medium") that link to the grounding evidence.

---

## 3. Issues integration (the monthly Research Roundup)

The issue answers: **What did we learn? Why does it matter? How confident (evidence-backed)? What
needs clarity? What next?** Deep data strengthens each, through the existing data-not-code path
(`netlify/content/default-$MONTH.json` + concept evidence), never by auto-asserting.

- **EVIDENCE column → API-backed numbers.** "Comprehension 78 vs 61 (n=100)" sourced from the API is
  more defensible than a scraped figure. Already flows via `metrics[]` → concept evidence.
- **Per-finding respondent quote → a real, on-topic Helio verbatim.** Today the per-finding
  `respondent_quote` is curated or deck-mined. Phase 1: route a clustered Helio verbatim to the
  matching concept so `bestRespondentQuote()` can pick a participant's own words about *that screen*.
- **Confidence label → a deterministic, evidence-only rubric (Phase 1).** Propose computing a
  suggested label (the editor still decides) from:
  - **n** (sample size) — below a floor caps the label at Medium;
  - **corroboration** — Tier-A scrape and Tier-B API agree within a margin → eligible for High;
  - **delta vs noise margin** — a delta inside the margin for that n → at most Low ("parity");
  - **direction consistency** — comprehension/sentiment/overall pointing the same way.
  `High` only when corroborated **and** n ≥ floor **and** delta beyond noise. This makes the label
  defensible and auditable, matching the "evidence-readiness" definition.
- **Next steps / unresolved → concrete.** A comprehension dip + negative-sentiment verbatims on one
  question becomes a specific "clarify the X label" next step instead of a generic hunch.

---

## 4. The inference pass — actionable + directional, never overclaimed

A new **deterministic stage-1 builder** (proposed `everpure_helio_infer.py` or
`netlify/build_helio_insights.js`, run after evidence packs, before stage-2) that reads the Helio
substrate and emits typed, **graded** insight records to `helio_insights.json` (committed to history).
It is *deterministic and auditable* — the same ethos as the rest of the build. It does **not** call an
LLM and does **not** publish; it produces candidate, evidence-bound statements that the QC agents vet
and humans approve at the freeze gate.

**Every insight record carries:** `claim`, `type`, `direction` (up/down/flat/mixed), `supporting_metrics`
(with n), `corroboration_tier`, `confidence` (rubric-derived, §3), `grounding_quotes` (verbatim ids),
and `caveats`. "Actionable" = tied to a screen/variant decision; "directional" = a lean stated with its
uncertainty.

**Inference rules (thresholded, illustrative — calibrate against real n):**

- **Directional winner.** Variant with higher overall UX **and** comprehension **and** non-worse
  sentiment, each delta ≥ margin(n), n ≥ floor → `winner: <variant>`. High if corroborated + n≥80;
  Medium otherwise. *"V1 leads on comprehension (+17) and overall UX (+9) at n=100."*
- **Mixed signal.** Comprehension up but sentiment down → `needs_clarity` insight: *"comprehension
  improved but sentiment regressed — likely tone/visual, not understanding."*
- **Noise guard (anti-overclaim).** |delta| below margin(n) → `parity` insight: *"no meaningful
  difference at this sample size; treat as a tie."* This rule exists to *prevent* false wins.
- **Quote→metric binding.** Cluster verbatims by theme (keyword/sentiment) and attach the
  representative quote to the metric it explains (negative + "confusing" → the comprehension dip).
  Clustering may group and select, but **never paraphrases** a quote.
- **Cross-cycle trajectory (Phase 3, needs ≥2 cycles).** A concept/screen's metric over time →
  `improving / declining / stable`, with the slope and cycle count stated.
- **Segment divergence (Phase 2, needs demographics).** A segment whose sentiment diverges sharply
  (and whose n clears the floor) → directional *"segment X reacts differently."*

**Guardrails baked into the pass:**

- Confidence is **rubric-derived from evidence only** (n, corroboration, delta-vs-noise). No path to
  `High` without corroboration + adequate n.
- Insights are labeled **direction/hypothesis**, not verdicts; the editorial layer + QC suite decide
  what becomes a finding, and humans approve at freeze.
- The **noise margin** is sample-size aware so small-n comparisons can't manufacture a "win."
- Verbatims stay verbatim; PII (emails already redacted by `redact_text`; add name scrubbing before
  any display) is handled before surfacing.

---

## 5. Phasing

- **Phase 0 — done (PR #32).** Fetch + gap-fill metrics + harvest quotes; defensive/non-blocking;
  verify live via a CI deploy (read `report_deep[].top_keys`, tighten parser if the shape differs).
- **Phase 1 — surface what we already have.** Corroboration badge; quote→concept routing for issues;
  the deterministic confidence rubric in the scaffolder; engagement/intent sparklines.
- **Phase 2 — broaden + infer.** Parse `questions_summary`; add `demographics`/`sentiment` cuts; build
  the inference pass (`helio_insights.json`) + dashboard insight chips + per-question drill.
- **Phase 3 — trajectory.** Cross-cycle metric trajectories; an automated regression "watch list";
  prototype-journey signals.

---

## 6. Risks & open questions

- **Live shape unknown until CI.** `report_deep[].top_keys` reveals the real section shapes; the
  parser degrades to empty (no breakage) if they differ from the documented names.
- **Report id semantics.** We call `/tests/:id/report` with the same `report_id` that `/tests/:id`
  accepts; if the report subroute wants the `uuid`/`report_uuid` instead, add an id fallback
  (the config response already exposes both).
- **Quote PII.** Open-ends can contain names; add name scrubbing before any public display.
- **API volume.** Report calls add one GET per discovered id; bounded by `HELIO_FETCH_LIMIT`. Monitor
  `report_deep_attempted` vs the cap and the documented endpoint limits.
- **Threshold calibration.** Noise margins and the n-floor need tuning against real sample sizes
  before the inference pass is trusted for confidence labeling.
