# AI Context Export Workflow

Use `scripts/export_ai_context.sh` when ChatGPT needs repo visibility but the GitHub app is blocked by admin policy.

The script creates a clean ZIP of the repository context that is safe to upload into a chat. It includes source files, build scripts, generated newsletter artifacts, archive outputs, email artifacts, and a manifest with the current git state. It excludes `.git`, `node_modules`, `.env` files, OS junk, caches, local ZIPs, and common key/certificate file patterns.

## Create a context ZIP

From the repo root:

```bash
bash scripts/export_ai_context.sh
```

By default, the ZIP is created on your Desktop with a timestamped name:

```text
everpure-ai-context-YYYYMMDD-HHMMSS.zip
```

Upload that ZIP to ChatGPT when code inspection, patching, or build troubleshooting is needed.

## Choose another output folder

```bash
bash scripts/export_ai_context.sh ~/Downloads
```

## Recommended workflow

1. Run or trigger the GitHub Pages build.
2. Review the live issue with a cache-busting URL.
3. If code-level help is needed, run this export script and upload the ZIP.
4. ChatGPT returns a patch bundle.
5. Apply the patch locally, run syntax checks, commit, and push.
6. Verify the new GitHub Actions build and live output.

## Safety notes

- Do not upload `.env` files or OAuth secrets.
- Do not paste GitHub or Google tokens into chat.
- The export script is read-only; it does not commit, push, or modify repo source files.
- Review `AI_CONTEXT_MANIFEST.md` inside the ZIP when you want to confirm what was exported.
