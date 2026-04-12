#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function exists(p) {
  return fs.existsSync(p);
}

function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    return fallback;
  }
}

function copyFile(src, dest) {
  ensureDir(path.dirname(dest));
  fs.copyFileSync(src, dest);
}

function maxWeekDate(weeks) {
  if (!Array.isArray(weeks) || !weeks.length) return null;
  return weeks.map((w) => w.week_date).filter(Boolean).sort().slice(-1)[0] || null;
}

function requireFile(filePath, label) {
  if (!exists(filePath)) {
    throw new Error(`Missing required ${label}: ${filePath}`);
  }
}

function main() {
  const root = path.resolve(process.argv[2] || process.cwd());
  const issueMonth = process.argv[3];
  if (!/^\d{4}-\d{2}$/.test(issueMonth || '')) {
    throw new Error('Usage: node netlify/freeze_issue_snapshot.js <repo-root> <YYYY-MM>');
  }

  const publishDir = path.join(root, 'publish');
  const newsletterDir = path.join(publishDir, 'newsletter');
  const dataDir = path.join(publishDir, 'data');

  const issueDir = path.join(root, 'issues', issueMonth);
  const historyWeeksDir = path.join(root, 'history', 'weeks');
  const historyEvidenceDir = path.join(root, 'history', 'evidence_packs');
  const historyConceptDir = path.join(root, 'history', 'concept_evidence');
  const historyDeckDir = path.join(root, 'history', 'deck_content');

  const filesToCopy = [
    ['default.html', path.join(newsletterDir, 'default.html')],
    ['default.md', path.join(newsletterDir, 'default.md')],
    ['default.json', path.join(newsletterDir, 'default.json')],
    ['marketing-activity-30d.html', path.join(newsletterDir, 'marketing-activity-30d.html')],
    ['marketing-activity-30d.md', path.join(newsletterDir, 'marketing-activity-30d.md')],
    ['marketing-activity-30d.json', path.join(newsletterDir, 'marketing-activity-30d.json')]
  ];

  for (const [, src] of filesToCopy) {
    requireFile(src, 'newsletter artifact');
  }

  ensureDir(issueDir);
  for (const [name, src] of filesToCopy) {
    copyFile(src, path.join(issueDir, name));
  }

  const defaultIssue = readJson(path.join(newsletterDir, 'default.json'), {}) || {};
  const marketingIssue = readJson(path.join(newsletterDir, 'marketing-activity-30d.json'), {}) || {};
  const refreshManifest = readJson(path.join(dataDir, 'refresh_manifest.json'), {}) || {};
  const weeks = readJson(path.join(dataDir, 'weeks.json'), []) || [];
  const evidencePacks = path.join(dataDir, 'evidence_packs.json');
  const conceptEvidence = path.join(dataDir, 'concept_evidence_default_30d.json');
  const deckContent = path.join(dataDir, 'deck_content.json');

  if (exists(path.join(dataDir, 'weeks.json'))) {
    ensureDir(historyWeeksDir);
    copyFile(path.join(dataDir, 'weeks.json'), path.join(historyWeeksDir, `${issueMonth}.json`));
  }
  if (exists(evidencePacks)) {
    ensureDir(historyEvidenceDir);
    copyFile(evidencePacks, path.join(historyEvidenceDir, `${issueMonth}.json`));
  }
  if (exists(conceptEvidence)) {
    ensureDir(historyConceptDir);
    copyFile(conceptEvidence, path.join(historyConceptDir, `${issueMonth}.json`));
  }
  if (exists(deckContent)) {
    ensureDir(historyDeckDir);
    copyFile(deckContent, path.join(historyDeckDir, `${issueMonth}.json`));
  }

  const manifest = {
    issue_id: `everpure-${issueMonth}`,
    issue_month: issueMonth,
    generated_at: defaultIssue.generated_at || marketingIssue.generated_at || new Date().toISOString(),
    git_sha: process.env.GITHUB_SHA || process.env.COMMIT_REF || null,
    latest_week_date: maxWeekDate(weeks),
    default_issue: {
      window: defaultIssue.window || '30d',
      audience: defaultIssue.audience || 'exec',
      tone: defaultIssue.tone || 'strategic',
      path: `issues/${issueMonth}/default.html`
    },
    marketing_issue: {
      preset: marketingIssue.preset || 'marketing_activity_30d',
      audience: marketingIssue.audience || 'marketing',
      tone: marketingIssue.tone || 'detailed',
      path: `issues/${issueMonth}/marketing-activity-30d.html`
    },
    source_refresh_manifest: exists(path.join(dataDir, 'refresh_manifest.json')) ? 'data/refresh_manifest.json' : null,
    history_paths: {
      weeks: exists(path.join(root, 'history', 'weeks', `${issueMonth}.json`)) ? `history/weeks/${issueMonth}.json` : null,
      evidence_packs: exists(path.join(root, 'history', 'evidence_packs', `${issueMonth}.json`)) ? `history/evidence_packs/${issueMonth}.json` : null,
      concept_evidence: exists(path.join(root, 'history', 'concept_evidence', `${issueMonth}.json`)) ? `history/concept_evidence/${issueMonth}.json` : null,
      deck_content: exists(path.join(root, 'history', 'deck_content', `${issueMonth}.json`)) ? `history/deck_content/${issueMonth}.json` : null
    }
  };

  fs.writeFileSync(path.join(issueDir, 'issue_manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');

  console.log(JSON.stringify({
    issue_month: issueMonth,
    archived_issue_dir: issueDir,
    history_written: manifest.history_paths,
    outputs: [
      path.join(issueDir, 'default.html'),
      path.join(issueDir, 'marketing-activity-30d.html'),
      path.join(issueDir, 'issue_manifest.json')
    ]
  }, null, 2));
}

main();
