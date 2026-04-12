#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function writeText(p, text) {
  ensureDir(path.dirname(p));
  fs.writeFileSync(p, text, 'utf8');
}

function readJsonIfExists(p, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return fallback;
  }
}

function htmlEscape(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function listHtml(items) {
  return `<ul>\n${items.map(i => `  <li>${htmlEscape(i)}</li>`).join('\n')}\n</ul>`;
}

function cardHtml(item) {
  const parts = [
    `<section class="card">`,
    `  <h3>${htmlEscape(item.title)}</h3>`,
    `  <h4>What we found</h4>`,
    `  <p>${htmlEscape(item.finding)}</p>`,
    `  <h4>Proof point</h4>`,
    `  <p>${htmlEscape(item.proof_point)}</p>`,
    `  <h4>What we should do next</h4>`,
    `  <p>${htmlEscape(item.next_step)}</p>`,
    `  <h4>Confidence</h4>`,
    `  <p>${htmlEscape(item.confidence)}</p>`,
    `</section>`
  ];
  return parts.join('\n');
}

function comparisonHtml(item) {
  return `<section class="card">\n  <h3>${htmlEscape(item.title)}</h3>\n  <h4>What we found</h4>\n  <p>${htmlEscape(item.finding)}</p>\n  <h4>Decision criteria for the next round</h4>\n  <p>${htmlEscape(item.criteria)}</p>\n  <h4>What we should do next</h4>\n  <p>${htmlEscape(item.next_step)}</p>\n  <h4>Confidence</h4>\n  <p>${htmlEscape(item.confidence)}</p>\n</section>`;
}

function buildContent(existing = {}) {
  const now = new Date().toISOString();
  const title = 'Everpure monthly leadership brief (30d)';

  const surfaced = [
    {
      title: 'Platform redesign baselines',
      finding: 'The platform redesign is strongest when the page is easier to scan and the upper page carries less noise. Simpler structure improves sentiment, while infographic-heavy treatment at the top lowers comprehension because people read it as built for advanced technical leads rather than general evaluators.',
      proof_point: 'The current month ties Concept 176 to two consistent signals: removing pop-ups and banner clutter improves positive reaction, and top-of-page infographic treatment reduces comprehension when the page starts to read as too technical.',
      next_step: 'Run one confirmation round that compares a simpler low-noise version against the current redesign, and treat comprehension plus sentiment as the ship gate instead of preference alone.',
      confidence: 'medium — strong enough to narrow the direction, not yet broad-rollout ready.'
    },
    {
      title: 'Knowledge portal naming and structure',
      finding: 'This is primarily a naming and discoverability decision, not a broad structural rewrite. People are not strongly confused by either knowledge or support framing, but the support-led version is creating a clearer positive reaction.',
      proof_point: 'Current concept evidence says expectations were roughly even between knowledge and support URL options, while sentiment was about 10 points higher for the support version.',
      next_step: 'Keep the next pass anchored in support-led naming and search expectations, then test whether the broader portal structure can expand without losing that clarity advantage.',
      confidence: 'medium — enough confidence to steer naming direction, not enough to freeze the full portal model.'
    },
    {
      title: 'Evergreen rebrand direction',
      finding: 'The Evergreen rebrand is strongest when it increases appeal without adding cognitive load too early. Clearer visual pacing helps, while denser infographic treatment near the top hurts both understanding and sentiment.',
      proof_point: 'Current concept evidence for Concept 178 says a color break after the hero increases appeal and sentiment, while adding more infographic content at the top reduces comprehension and sentiment.',
      next_step: 'Continue with the higher-appeal direction, but keep the upper page simpler and delay denser explanatory content until after the offer is understood.',
      confidence: 'medium — solid directional evidence for the next iteration, but still an iteration decision rather than a full ship call.'
    }
  ];

  const comparisons = [
    {
      title: 'Events page baseline',
      finding: 'Events-page work has moved out of broad exploration and into a narrower comparison problem. The current notes still do not name a winner, but they do show that the next round should be a decision round rather than another open-ended concept pass.',
      criteria: 'Choose the winning version based on which variant makes the page easier to understand at a glance and gives the clearest path into the event content, not on stylistic preference alone.',
      next_step: 'Reduce the next round to one decisive V1 versus V2 comparison and agree on the comprehension and progression criteria before the test starts.',
      confidence: 'moderate — enough evidence to tighten the test design, not enough to ship a version yet.'
    },
    {
      title: 'AI summary variations',
      finding: 'The AI summary work now needs selection pressure, not more expansion. The evidence suggests the team should narrow to the strongest framings and force a winner rather than generate additional exploratory variants.',
      criteria: 'Pick the winning framing based on which option is clearest and most credible at first read, and which version creates more confidence in what the AI summary is actually doing.',
      next_step: 'Collapse to the two strongest framings and use the next round to select one based on comprehension and confidence, not novelty.',
      confidence: 'moderate — sufficient to narrow the field, but not yet sufficient for rollout.'
    }
  ];

  const unresolved = [
    'Design and UX feedback across homepage, landing page, reader page, search, and header still needs one more round to determine which structural fixes matter most before treating it as ship guidance.',
    'Support taxonomy flow is still an IA problem: the unresolved question is which path and label model makes support intent obvious without over-expanding the navigation model.',
    'Pathfinder CTA labels remain unresolved: the next task is to identify which label set is clearest at the moment of action and least likely to introduce friction.'
  ];

  const nextActions = [
    'Confirm a simpler platform redesign against the current redesign using comprehension and sentiment as the ship gate.',
    'Keep knowledge portal testing anchored in support-led naming and search expectations before broadening the model.',
    'Continue Evergreen rebrand in the higher-appeal direction, but reduce top-of-page infographic complexity.',
    'Narrow events and AI summary work to decisive follow-up comparisons with explicit winning criteria.'
  ];

  const executiveSummary = 'The clearest month-to-date decisions are to simplify the platform redesign, keep knowledge portal framing anchored in support expectations, and continue the Evergreen rebrand in the higher-appeal direction without front-loading complexity. The current evidence is strongest for choosing the next iteration, not for declaring broad rollout readiness.';

  return {
    title,
    generated_at: now,
    window: existing.window || '30d',
    audience: existing.audience || 'exec',
    tone: existing.tone || 'strategic',
    issue_type: 'default_monthly',
    executive_summary: executiveSummary,
    surfaced_findings: surfaced,
    comparison_tests: comparisons,
    still_in_motion: unresolved,
    next_actions: nextActions,
    source_note: 'Content-first stage-2 brief for the current build cycle, written on top of the deterministic concept-evidence layer.'
  };
}

function toMarkdown(data) {
  return [
    `# ${data.title}`,
    '',
    '## Executive summary',
    '',
    data.executive_summary,
    '',
    '## What the research surfaced',
    '',
    ...data.surfaced_findings.flatMap(item => [
      `### ${item.title}`,
      '',
      '#### What we found',
      '',
      item.finding,
      '',
      '#### Proof point',
      '',
      item.proof_point,
      '',
      '#### What we should do next',
      '',
      item.next_step,
      '',
      '#### Confidence',
      '',
      item.confidence,
      ''
    ]),
    '## Meaningful comparison tests',
    '',
    ...data.comparison_tests.flatMap(item => [
      `### ${item.title}`,
      '',
      '#### What we found',
      '',
      item.finding,
      '',
      '#### Decision criteria for the next round',
      '',
      item.criteria,
      '',
      '#### What we should do next',
      '',
      item.next_step,
      '',
      '#### Confidence',
      '',
      item.confidence,
      ''
    ]),
    '## What is still in motion',
    '',
    ...data.still_in_motion.map(i => `- ${i}`),
    '',
    '## What we should do next',
    '',
    ...data.next_actions.map(i => `- ${i}`),
    ''
  ].join('\n');
}

function toHtml(data) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${htmlEscape(data.title)}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 0; background: #f7f8fb; color: #111827; }
    main { max-width: 980px; margin: 0 auto; padding: 32px 20px 56px; }
    a { color: #2563eb; text-decoration: none; }
    a:hover { text-decoration: underline; }
    h1 { font-size: 2rem; margin-bottom: 0.5rem; }
    h2 { margin-top: 2rem; font-size: 1.35rem; }
    h3 { margin-top: 0; font-size: 1.1rem; }
    h4 { margin-bottom: 0.35rem; font-size: 0.95rem; color: #374151; text-transform: uppercase; letter-spacing: 0.04em; }
    p, li { line-height: 1.6; }
    .meta { color: #6b7280; margin-bottom: 1.25rem; }
    .summary { background: white; border: 1px solid #e5e7eb; border-radius: 14px; padding: 18px 20px; }
    .grid { display: grid; gap: 16px; }
    .card { background: white; border: 1px solid #e5e7eb; border-radius: 14px; padding: 18px 20px; }
  </style>
</head>
<body>
  <main>
    <p><a href="../index.html">Back to homepage</a></p>
    <h1>${htmlEscape(data.title)}</h1>
    <p class="meta">Generated ${htmlEscape(data.generated_at)} · ${htmlEscape(data.window)} · ${htmlEscape(data.audience)} · ${htmlEscape(data.tone)}</p>

    <section class="summary">
      <h2>Executive summary</h2>
      <p>${htmlEscape(data.executive_summary)}</p>
    </section>

    <h2>What the research surfaced</h2>
    <div class="grid">
      ${data.surfaced_findings.map(cardHtml).join('\n')}
    </div>

    <h2>Meaningful comparison tests</h2>
    <div class="grid">
      ${data.comparison_tests.map(comparisonHtml).join('\n')}
    </div>

    <h2>What is still in motion</h2>
    ${listHtml(data.still_in_motion)}

    <h2>What we should do next</h2>
    ${listHtml(data.next_actions)}
  </main>
</body>
</html>`;
}

function main() {
  const publishDir = process.argv[2] || 'publish';
  const existing = readJsonIfExists(path.join(publishDir, 'newsletter', 'default.json'), {});
  const data = buildContent(existing);
  const md = toMarkdown(data);
  const html = toHtml(data);
  const json = JSON.stringify(data, null, 2) + '\n';

  writeText(path.join(publishDir, 'newsletter', 'default.json'), json);
  writeText(path.join(publishDir, 'newsletter', 'default.md'), md + '\n');
  writeText(path.join(publishDir, 'newsletter', 'default.html'), html);
  writeText(path.join(publishDir, 'api', 'newsletter-default.json'), json);
  writeText(path.join(publishDir, 'api', 'newsletter-default.md'), md + '\n');

  console.log(JSON.stringify({
    rewritten: true,
    outputs: [
      path.join(publishDir, 'newsletter', 'default.json'),
      path.join(publishDir, 'newsletter', 'default.md'),
      path.join(publishDir, 'newsletter', 'default.html'),
      path.join(publishDir, 'api', 'newsletter-default.json'),
      path.join(publishDir, 'api', 'newsletter-default.md')
    ]
  }, null, 2));
}

main();
