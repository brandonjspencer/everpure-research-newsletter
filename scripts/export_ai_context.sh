#!/usr/bin/env bash
set -euo pipefail

# Export a clean, ChatGPT-friendly repository context ZIP.
# This script is intentionally read-only: it does not commit, push, or modify repo files.

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_NAME="$(basename "$ROOT")"
TIMESTAMP="$(date +"%Y%m%d-%H%M%S")"

OUTPUT_DIR="${1:-$HOME/Desktop}"
case "$OUTPUT_DIR" in
  /*) ;;
  *) OUTPUT_DIR="$PWD/$OUTPUT_DIR" ;;
esac

mkdir -p "$OUTPUT_DIR"

ZIP_PATH="$OUTPUT_DIR/everpure-ai-context-$TIMESTAMP.zip"
TMP_BASE="${TMPDIR:-/tmp}"
STAGE_DIR="$(mktemp -d "$TMP_BASE/everpure-ai-context.XXXXXX")"
DEST="$STAGE_DIR/$REPO_NAME"

cleanup() {
  rm -rf "$STAGE_DIR"
}
trap cleanup EXIT

mkdir -p "$DEST"

EXCLUDES=(
  "--exclude=.git"
  "--exclude=node_modules"
  "--exclude=.env"
  "--exclude=.env.*"
  "--exclude=.DS_Store"
  "--exclude=__pycache__"
  "--exclude=*.pyc"
  "--exclude=*.pyo"
  "--exclude=*.zip"
  "--exclude=*.pem"
  "--exclude=*.key"
  "--exclude=*.p12"
  "--exclude=*.pfx"
  "--exclude=*.crt"
  "--exclude=*.cer"
  "--exclude=id_rsa*"
  "--exclude=eval \"$(ssh-agent -s)\""
  "--exclude=eval \"$(ssh-agent -s)\".pub"
)

copy_path() {
  local rel="$1"
  local src="$ROOT/$rel"
  local parent

  if [ ! -e "$src" ]; then
    return 0
  fi

  parent="$(dirname "$rel")"
  mkdir -p "$DEST/$parent"
  rsync -a "${EXCLUDES[@]}" "$src" "$DEST/$parent/"
}

copy_glob() {
  local pattern="$1"
  local matches=()
  shopt -s nullglob
  matches=("$ROOT"/$pattern)
  shopt -u nullglob

  for src in "${matches[@]}"; do
    local rel="${src#$ROOT/}"
    copy_path "$rel"
  done
}

# Source, renderer, workflow, archive, email, and generated-output context.
copy_path ".github"
copy_path "netlify"
copy_path "scripts"
copy_path "emails"
copy_path "issues"
copy_path "history"
copy_path "docs"
copy_path "data"
copy_path "output"
copy_path "publish"
copy_path "deck_artifacts"
copy_path "deck_artifacts_empty"

# Root-level implementation and project files.
copy_glob "*.py"
copy_glob "*.js"
copy_glob "*.sh"
copy_glob "*.md"
copy_glob "package*.json"
copy_glob "requirements*.txt"
copy_path ".nvmrc"

# Add a small manifest so the uploaded ZIP has review context.
{
  echo "# Everpure AI Context Export"
  echo ""
  echo "Generated UTC: $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  echo "Repository path: $ROOT"
  echo "Export file: $(basename "$ZIP_PATH")"
  echo ""
  echo "## Git state"
  echo ""
  if git -C "$ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    echo "Branch: $(git -C "$ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)"
    echo "Commit: $(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || echo unknown)"
    echo ""
    echo "### Working tree status"
    echo ""
    git -C "$ROOT" status --short || true
  else
    echo "Not inside a git working tree."
  fi
  echo ""
  echo "## Included context"
  echo ""
  echo "- Build/workflow code: .github, netlify, root Python/JS/shell files"
  echo "- Newsletter/email/archive artifacts: publish, issues, history, emails"
  echo "- Research data artifacts: output, data, deck_artifacts when present"
  echo "- Project docs: root markdown files and docs when present"
  echo ""
  echo "## Excluded context"
  echo ""
  echo "- .git"
  echo "- node_modules"
  echo "- .env and .env.*"
  echo "- .DS_Store, caches, pyc files"
  echo "- common private key/certificate file patterns"
  echo "- local ZIP files"
} > "$DEST/AI_CONTEXT_MANIFEST.md"

# Create the final ZIP from the staging parent so the archive contains one top-level repo folder.
(
  cd "$STAGE_DIR"
  zip -qr "$ZIP_PATH" "$REPO_NAME"
)

echo "Created AI context ZIP: $ZIP_PATH"
echo "Upload that ZIP to ChatGPT when repository context is needed."
