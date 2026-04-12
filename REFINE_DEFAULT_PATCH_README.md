# Everpure Refine Default Newsletter Patch

This patch adds a **post-generation refinement step** for the default monthly newsletter.

Why this approach is safer:
- it does **not** replace the live API logic again
- it works off the already-generated static GitHub Pages artifacts
- it reads the deterministic `concept-evidence-default-30d` output and rewrites the static default newsletter files

What it does:
- promotes only concepts with stronger concept-scoped proof points into `newsletter/default.*`
- downgrades weaker concepts into "What is still in motion"
- rewrites `default.json`, `default.md`, and `default.html`
- preserves Netlify compatibility because it only adds another build step
