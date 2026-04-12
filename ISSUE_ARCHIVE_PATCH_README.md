# Everpure issue archive patch

This patch adds a safe archive/freeze layer for approved monthly issues.

## What it includes

- `netlify/publish_issue_archives.js`
  - Copies repo-tracked `issues/` and `history/` into `publish/` on every build
  - Generates:
    - `publish/issues/index.html`
    - `publish/data/issues.json`

- `netlify/freeze_issue_snapshot.js`
  - Freezes the current approved issue from `publish/` into repo-tracked archive folders
  - Copies current evidence/history snapshots into repo-tracked `history/`
  - Writes `issues/YYYY-MM/issue_manifest.json`

## Build step to add

Add this line to `netlify/build.sh` before `fix_static_aliases.js`:

```bash
node "$ROOT/netlify/publish_issue_archives.js" "$ROOT"
```

## Freeze workflow after an issue is approved

Run from the repo root after a successful build:

```bash
node netlify/freeze_issue_snapshot.js . 2026-04
```

Then commit the new archive files:

```bash
git add issues history
git commit -m "Archive issue 2026-04"
git push
```

## Result

Once archived and pushed, future builds will publish:

- `/issues/index.html`
- `/data/issues.json`
- `/issues/YYYY-MM/...`
- `/history/...`
