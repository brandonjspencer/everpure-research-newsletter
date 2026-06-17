# CLAUDE.md

Guidance for Claude Code working in this repository.

## What this is

The **Everpure Research Newsletter Builder** turns a 30-day research cycle (tracked in
Notion, with linked Google Slides decks) into a leadership-ready monthly **Research
Roundup**, published to GitHub Pages and distributed by email. It is a hybrid
**Python (ingestion/normalization) + Node.js (evidence + rendering)** static-site generator.

**Core principle:** deterministic build outputs are the evidence substrate; editorial
synthesis must never invent certainty beyond what the evidence supports.

> Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the pipeline and component map,
> [docs/OPERATIONS.md](docs/OPERATIONS.md) for the monthly runbook and editorial rules, and
> [docs/CHANGE_HISTORY.md](docs/CHANGE_HISTORY.md) for why the code looks the way it does.
> The canonical project context lives in [docs/handoff/](docs/handoff/).

## Commands

```bash
# Dev tooling setup (once)
make install-dev              # pip deps + ruff/pyright/pytest + npm + pre-commit

# The gates (same as CI) — run before declaring work done
make check                    # ruff + pyright + pytest + eslint + prettier + tsc + node tests
make fmt                      # auto-format & auto-fix (ruff + prettier + eslint)

# Individual checks
ruff check . && ruff format --check .   # Python lint + format
pyright                                 # Python typecheck (lenient/basic)
pytest                                  # Python smoke tests
npm run lint                            # ESLint (JS)
npm run typecheck                       # tsc --checkJs (lenient)
npm test                                # Node smoke tests

# Build
./run_all.sh                  # LOCAL build: parse data/Everpure.html -> output/
bash netlify/build.sh         # FULL build (live fetch + evidence pipeline) -> publish/
```

CI runs `.github/workflows/ci.yml` (lint + typecheck + tests) on every push/PR. Pages
deploy runs separately in `.github/workflows/deploy-pages.yml` — **do not fold CI into it.**

## How the build works (short version)

Two entry points: `run_all.sh` (local, always uses the committed `data/Everpure.html`
snapshot → `output/`) and `netlify/build.sh` (CI, layered live-fetch fallback → `publish/`).

The pipeline has a **strict order** (see ARCHITECTURE.md). Two invariants that have broken
before:

- External research ingest runs **after** deck fetch/PDF ingest and **before**
  `build_evidence_packs.js`.
- Static newsletter generation runs **after** evidence packs / clean evidence / concept
  evidence — it depends on that substrate.

There are two output layers: **stage-1** (deterministic JSON: evidence packs, concept
evidence) and **stage-2** (the hand-authored writers `render_stage2_*_current.js` that
rewrite the static `newsletter/*` artifacts). Stage-2 writers are tightly scoped — the
default writer touches only `newsletter/default.*` + `api/newsletter-default.*`; the
marketing writer only its own artifact.

## Conventions & guardrails

- **Generated artifacts are not committed.** `publish/` (except `publish/index.html`) and
  fetched `deck_artifacts/` are rebuilt; they're gitignored. `output/` holds committed
  legacy sample data used as test fixtures.
- **Prefer post-generation static rewriting over editing the live API**
  (`netlify/functions/api.js`). The project deliberately moved away from re-patching API
  logic.
- **Do not introduce a React/Vite build path.** On-brand styling is ported into the static
  HTML writer (`render_stage2_default_current.js`) on purpose.
- **Frozen issues are immutable.** Approved months live in `issues/YYYY-MM/` and `history/`
  (committed) and are republished verbatim every build. Don't edit a frozen archive unless
  explicitly asked. Freeze via `node netlify/freeze_issue_snapshot.js . YYYY-MM`.
- **JSON artifacts ship in both underscore and hyphenated forms** (`deck_content.json` +
  `deck-content.json`) — keep the aliasing intact (`fix_static_aliases.js`).
- **Generated links must be relative** (`newsletter/default.html`), never root-relative, so
  they survive the GitHub Pages `/<repo>/` subpath.
- **Confidence labels** are exactly `Low/Medium/High confidence` and must reflect evidence,
  not preference. Reserve **High** for corroborated evidence.

## High-risk areas

- Stage-2 renderers: avoid reintroducing hardcoded Issue-01 copy.
- Email CTAs: never point distribution email at the mutable `/newsletter/default.html` —
  always the frozen `/issues/YYYY-MM/default.html`.
- Mobile email: test the small breakpoint for horizontal scroll.
- Build freshness: a green build ≠ fresh data. Check `refresh_manifest.json`
  `source_fetch_method` before interpreting content (see OPERATIONS.md).

## Secrets policy

Never paste or commit credentials, OAuth refresh tokens, client secrets, `.env` values,
private keys, or recipient spreadsheets. The Notion source is a **public page** fetched via
the `SOURCE_URL` secret (no Notion API token or database id is used). Google deck fetch needs
a `drive.readonly` OAuth token. The Pages deploy (`deploy-pages.yml`) reads secrets
`SOURCE_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN` and the
variable `GOOGLE_FETCH_LIMIT`.

## Environment notes

- Local venv is Python 3.9; CI uses 3.12. Code targets **3.9+** (the lint/typecheck config
  is pinned to the 3.9 floor so it never suggests 3.10-only syntax that would crash locally).
- If `.venv` breaks with a "bad interpreter" error (it was created at an old path), recreate
  it: `python3 -m venv .venv && .venv/bin/python -m pip install -r requirements.txt`.
- The Node renderers are plain CommonJS using only Node built-ins (no runtime npm deps);
  `node_modules/` is dev-tooling only.
- Typecheck is intentionally **lenient** — Pyright `basic` mode and `tsc --checkJs` with
  `strict: false`. It's there to catch real bugs, not to force a typed migration.
