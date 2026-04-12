#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); }
function readJson(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }
function writeJson(p, obj) { fs.writeFileSync(p, JSON.stringify(obj, null, 2) + '\n', 'utf8'); }
function writeText(p, text) { fs.writeFileSync(p, text, 'utf8'); }
function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function sectionMarkdown(title, items, opts = {}) {
  let out = `## ${title}\n\n`;
  for (const item of items) {
    out += `### ${item.headline}\n\n`;
    if (item.finding_statement) out += `**What we found**  \n${item.finding_statement}\n\n`;
    if (item.proof_point) out += `**Proof point**  \n${item.proof_point}\n\n`;
    if (item.why_it_matters) out += `**Why it matters**  \n${item.why_it_matters}\n\n`;
    if (item.next_step) out += `**What we should do next**  \n${item.next_step}\n\n`;
    if (item.confidence_level) out += `**Confidence**  \n${item.confidence_level}\n\n`;
  }
  return out;
}

function sectionHtml(title, items) {
  const blocks = items.map(item => {
    let html = `<section class="card"><h3>${esc(item.headline)}</h3>`;
    if (item.finding_statement) html += `<h4>What we found</h4><p>${esc(item.finding_statement)}</p>`;
    if (item.proof_point) html += `<h4>Proof point</h4><p>${esc(item.proof_point)}</p>`;
    if (item.why_it_matters) html += `<h4>Why it matters</h4><p>${esc(item.why_it_matters)}</p>`;
    if (item.next_step) html += `<h4>What we should do next</h4><p>${esc(item.next_step)}</p>`;
    if (item.confidence_level) html += `<h4>Confidence</h4><p>${esc(item.confidence_level)}</p>`;
    html += `</section>`;
    return html;
  }).join('\n');
  return `<section class="group"><h2>${esc(title)}</h2>${blocks}</section>`;
}

function bulletHtml(title, items) {
  return `<section class="group"><h2>${esc(title)}</h2><ul>${items.map(i => `<li>${esc(i)}</li>`).join('')}</ul></section>`;
}

function main() {
  const publishDir = process.argv[2] || 'publish';
  const publish = path.resolve(publishDir);
  const newsletterDir = path.join(publish, 'newsletter');
  const apiDir = path.join(publish, 'api');
  ensureDir(newsletterDir);
  ensureDir(apiDir);

  const baseJsonPath = path.join(newsletterDir, 'default.json');
  const base = fs.existsSync(baseJsonPath) ? readJson(baseJsonPath) : {};

  const generatedAt = new Date().toISOString();
  const output = {
    generated_at: generatedAt,
    title: 'Everpure monthly leadership brief (30d)',
    audience: 'exec',
    tone: 'strategic',
    mode: 'stage2_curated_brief',
    preset: 'default_exec_monthly_stage2',
    defaults: base.defaults || { window: '30d', audience: 'exec', tone: 'strategic' },
    window: base.window || { since: null, until: null, label: '30d', days: 30 },
    overview: base.overview || {},
    executive_summary: 'The clearest month-to-date decisions are to simplify the platform redesign, keep knowledge portal framing anchored in support expectations, and continue the Evergreen rebrand in the higher-appeal directions without front-loading complexity. The current evidence is useful for choosing the next iteration, not for declaring broad rollout readiness.',
    sections: {
      top_findings: [
        {
          headline: 'Platform redesign baselines',
          finding_statement: 'The platform redesign performs better when the page is easier to parse at a glance. Simpler structure improves sentiment, while infographic-heavy treatment at the top of the page lowers comprehension because it reads as built for advanced technical leads.',
          proof_point: 'Current concept evidence for Concept 176 says removing pop-ups and banners from the new homepage increases positive sentiment, and that comprehension of the platform-page infographic drops when people read it as meant for advanced technical leads.',
          next_step: 'Run one confirmation round that compares a simpler, lower-noise version against the current redesign and use comprehension and sentiment together as the ship gate.',
          confidence_level: 'medium'
        },
        {
          headline: 'Knowledge portal naming and structure',
          finding_statement: 'Users do not appear strongly confused by either knowledge or support framing, but the support-led version is creating a stronger positive reaction. That makes this more of a naming and discoverability decision than a broad structural rewrite.',
          proof_point: 'Current concept evidence for the knowledge portal work says expectations were even between the knowledge and support URL options, while sentiment was about 10 points higher for the support version.',
          next_step: 'Keep the next pass anchored in support-led naming and search expectations, then test whether the broader portal structure can expand without losing that clarity advantage.',
          confidence_level: 'medium'
        },
        {
          headline: 'Evergreen rebrand direction',
          finding_statement: 'The Evergreen rebrand is strongest when it increases appeal without adding cognitive load too early. The design direction benefits from clearer visual pacing, while denser infographic treatment at the top of the page hurts both understanding and sentiment.',
          proof_point: 'Current concept evidence for Concept 178 says a color break after the hero increases appeal and sentiment, while adding more infographic content at the top reduces comprehension and sentiment.',
          next_step: 'Continue with the higher-appeal direction, but keep the upper page simpler and delay denser explanatory content until after the offer is understood.',
          confidence_level: 'medium'
        }
      ],
      comparison_tests: [
        {
          headline: 'Events page baseline',
          finding_statement: 'Events-page work is one of the clearest active comparisons in the current month, but the available notes still do not name a winner. That means the work is mature enough for a decision-focused follow-up rather than another broad exploration round.',
          proof_point: 'The current month keeps surfacing events-page baseline work as a lead concept, but the build does not contain a concept-specific winner statement yet.',
          next_step: 'Reduce the next round to one decisive V1 versus V2 comparison and define the success criteria before the test starts.',
          confidence_level: 'moderate'
        },
        {
          headline: 'AI summary variations',
          finding_statement: 'The AI summary work has moved beyond a single-direction concept and now needs selection pressure. The current notes suggest narrowing rather than opening up more variations.',
          proof_point: 'The current month positions AI Summary – Three Variations as active comparison work, but it still lacks a clean winner statement tied to comprehension or confidence.',
          next_step: 'Collapse to the two strongest framings and use the next round to choose one.',
          confidence_level: 'moderate'
        }
      ],
      in_progress: [
        'Design and UX feedback across homepage, landing page, reader page, search, and header is still useful as design direction, but not yet a ship-readiness signal.',
        'Support taxonomy flow is still an IA problem and should remain in validation until the path and labeling model are clearer.',
        'Pathfinder CTA labels should stay in motion until a smaller comparison establishes which label set is clearest at the point of action.'
      ],
      next_actions: [
        'Confirm a simpler platform redesign against the current redesign using comprehension and sentiment as the ship gate.',
        'Keep knowledge portal testing anchored in support-led naming and search expectations before broadening the model.',
        'Continue Evergreen rebrand with the higher-appeal direction, but reduce top-of-page infographic complexity.',
        'Narrow events and AI summary work to decisive follow-up comparisons rather than broad exploration.'
      ]
    }
  };

  const md = [
    '# Everpure monthly leadership brief (30d)',
    '',
    `[Back to homepage](../index.html)`,
    '',
    '## Executive summary',
    '',
    output.executive_summary,
    '',
    sectionMarkdown('What the research surfaced', output.sections.top_findings),
    sectionMarkdown('Meaningful comparison tests', output.sections.comparison_tests),
    '## What is still in motion',
    '',
    ...output.sections.in_progress.map(x => `- ${x}`),
    '',
    '## What we should do next',
    '',
    ...output.sections.next_actions.map(x => `- ${x}`),
    ''
  ].join('\n');

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${esc(output.title)}</title>
  <style>
    body { font-family: Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; color: #0f172a; background: #fff; margin: 0; }
    .wrap { max-width: 980px; margin: 0 auto; padding: 32px 24px 64px; }
    a { color: #5b21b6; }
    h1 { font-size: 3rem; line-height: 1.1; margin: 28px 0 20px; }
    h2 { font-size: 2.25rem; line-height: 1.15; margin: 44px 0 20px; }
    h3 { font-size: 1.6rem; margin: 0 0 16px; }
    h4 { font-size: 1rem; margin: 20px 0 8px; }
    p, li { font-size: 1rem; line-height: 1.65; }
    .card { border-top: 1px solid #e2e8f0; padding-top: 20px; margin-top: 20px; }
    ul { padding-left: 24px; }
  </style>
</head>
<body>
  <div class="wrap">
    <p><a href="../index.html">Back to homepage</a></p>
    <h1>${esc(output.title)}</h1>
    <section class="group">
      <h2>Executive summary</h2>
      <p>${esc(output.executive_summary)}</p>
    </section>
    ${sectionHtml('What the research surfaced', output.sections.top_findings)}
    ${sectionHtml('Meaningful comparison tests', output.sections.comparison_tests)}
    ${bulletHtml('What is still in motion', output.sections.in_progress)}
    ${bulletHtml('What we should do next', output.sections.next_actions)}
  </div>
</body>
</html>`;

  writeJson(path.join(newsletterDir, 'default.json'), output);
  writeText(path.join(newsletterDir, 'default.md'), md + '\n');
  writeText(path.join(newsletterDir, 'default.html'), html + '\n');
  writeJson(path.join(apiDir, 'newsletter-default.json'), output);
  writeText(path.join(apiDir, 'newsletter-default.md'), md + '\n');

  console.log(JSON.stringify({
    rewritten: true,
    outputs: [
      path.join(newsletterDir, 'default.json'),
      path.join(newsletterDir, 'default.md'),
      path.join(newsletterDir, 'default.html'),
      path.join(apiDir, 'newsletter-default.json'),
      path.join(apiDir, 'newsletter-default.md')
    ]
  }, null, 2));
}

main();
