# Everpure Research Newsletter Builder

Turns a 30-day research cycle — tracked in Notion, with linked Google Slides decks — into a
leadership-ready monthly **Research Roundup**, published to GitHub Pages and distributed by
email.

It is a hybrid **Python + Node.js** static-site generator. Python ingests and normalizes the
source data; Node builds a deterministic evidence substrate and renders the newsletter
artifacts. The guiding principle: _deterministic build outputs are the evidence substrate;
editorial synthesis must not invent certainty beyond what the evidence supports._

## Documentation

| Doc                                              | What's in it                                                     |
| ------------------------------------------------ | ---------------------------------------------------------------- |
| [CLAUDE.md](CLAUDE.md)                           | Orientation + dev workflow for working in this repo (start here) |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)     | Pipeline, build order, component reference, data flow            |
| [docs/OPERATIONS.md](docs/OPERATIONS.md)         | Monthly ritual, QC gates, freeze, email rules, secrets           |
| [docs/CHANGE_HISTORY.md](docs/CHANGE_HISTORY.md) | Why the code looks the way it does (distilled patch history)     |
| [docs/handoff/](docs/handoff/)                   | Canonical project context handoff + agent/QC prompts             |

## Quick start (local)

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
./run_all.sh                                   # parse data/Everpure.html -> output/
python everpure_api.py --data-dir ./output serve --port 8000
```

The production build (live Notion + Google fetch, full evidence pipeline) runs in CI via
`netlify/build.sh` and deploys to GitHub Pages — see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Dev workflow

```bash
make install-dev       # Python + Node dev tooling + git hooks (ruff, pyright, pytest, eslint, prettier)

make check             # run everything: lint + typecheck + tests (Python & JS)
make fmt               # auto-format & auto-fix (ruff + prettier + eslint)
```

CI (`.github/workflows/ci.yml`) runs the same checks on every push and PR. See
[CLAUDE.md](CLAUDE.md) for the full command reference.

## Repository map

```
data/Everpure.html      Committed Notion HTML snapshot (source-of-truth fallback)
everpure_*.py           Python ingestion / normalization / read API
netlify/                Node evidence + rendering pipeline (build.sh orchestrator)
issues/ history/        Frozen monthly archives + history snapshots (committed)
emails/                 Email HTML artifacts for distribution (committed)
publish/                Deployable site — rebuilt in CI (generated, gitignored)
docs/                   Documentation + handoff context
tests/                  Smoke tests (pytest + node)
```
