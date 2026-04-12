#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

function readJson(p){ return JSON.parse(fs.readFileSync(p,'utf8')); }
function writeJson(p,obj){ fs.writeFileSync(p, JSON.stringify(obj,null,2)+"\n"); }
function escapeHtml(s){ return String(s).replace(/[&<>\"]/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
function sentenceKey(s){ return String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim(); }
function firstSentence(s){ const t=String(s||'').replace(/\s+/g,' ').trim(); const m=t.match(/.*?[.!?](\s|$)/); return (m?m[0]:t).trim(); }
function unique(arr){ const out=[]; const seen=new Set(); for(const x of arr||[]){ const k=sentenceKey(x); if(k && !seen.has(k)){ seen.add(k); out.push(x); } } return out; }
function mergeKnowledge(actions){
  const kp = actions.filter(a => /knowledge portal/i.test(a));
  const other = actions.filter(a => !/knowledge portal/i.test(a));
  if(kp.length <= 1) return actions;
  const merged = 'Run one tighter follow-up round on knowledge portal structure and naming, define the decision criteria in advance, and use the next pass to confirm whether the direction is ready to ship or still needs another iteration.';
  return [...other, merged];
}
function conceptTitle(item){ return item.title || item.heading || item.concept_title || item.name || 'Concept'; }
function normalizeItem(item){
  const out = {...item};
  const found = out.what_we_found || out.finding_statement || out.finding || '';
  const proof = out.proof_point || out.evidence_snapshot || '';
  if(sentenceKey(found) === sentenceKey(proof)){
    out.proof_point = '';
  }
  return out;
}

function renderHtml(doc){
  const esc=escapeHtml;
  const lines=[];
  lines.push('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Everpure monthly leadership brief (30d)</title><style>body{font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;max-width:980px;margin:24px auto;padding:0 16px;line-height:1.45;color:#111827}h1,h2,h3{line-height:1.2}h1{font-size:2rem}h2{margin-top:1.8rem;font-size:1.4rem}h3{margin-top:1.2rem;font-size:1.1rem}strong{font-weight:700}ul{padding-left:1.25rem}li{margin:.35rem 0}.muted{color:#4b5563}.back{display:inline-block;margin-bottom:1rem}</style></head><body>');
  lines.push('<a class="back" href="../index.html">Back to homepage</a>');
  lines.push('<h1>Everpure monthly leadership brief (30d)</h1>');
  if(doc.window_label) lines.push(`<p class="muted">${esc(doc.window_label)}</p>`);
  if(doc.executive_summary) lines.push('<h2>Executive summary</h2><p>'+esc(doc.executive_summary)+'</p>');
  const sections=[
    ['What the research surfaced', doc.top_findings],
    ['Meaningful comparison tests', doc.meaningful_comparison_tests],
  ];
  for(const [heading, items] of sections){
    if(items && items.length){
      lines.push(`<h2>${esc(heading)}</h2>`);
      for(const raw of items){
        const item=normalizeItem(raw);
        lines.push(`<h3>${esc(conceptTitle(item))}</h3>`);
        if(item.what_we_found || item.finding_statement || item.finding){
          lines.push('<p><strong>What we found</strong></p><p>'+esc(item.what_we_found || item.finding_statement || item.finding)+'</p>');
        }
        if(item.proof_point){
          lines.push('<p><strong>Proof point</strong></p><p>'+esc(item.proof_point)+'</p>');
        }
        const keyEv = unique(item.key_evidence || item.supporting_signals || []);
        if(keyEv.length){
          lines.push('<p><strong>Key evidence</strong></p><ul>'+keyEv.map(x=>`<li>${esc(x)}</li>`).join('')+'</ul>');
        }
        if(item.what_we_should_do_next || item.next_step){
          lines.push('<p><strong>What we should do next</strong></p><p>'+esc(item.what_we_should_do_next || item.next_step)+'</p>');
        }
        if(item.confidence || item.confidence_level || item.decision_status){
          const conf=[item.confidence || item.confidence_level, item.decision_status].filter(Boolean).join(' • ');
          lines.push('<p><strong>Confidence</strong></p><p>'+esc(conf)+'</p>');
        }
      }
    }
  }
  if(doc.work_in_motion && doc.work_in_motion.length){
    lines.push('<h2>What is still in motion</h2><ul>'+doc.work_in_motion.map(x=>`<li>${esc(x)}</li>`).join('')+'</ul>');
  }
  if(doc.next_actions && doc.next_actions.length){
    lines.push('<h2>What we should do next</h2><ul>'+doc.next_actions.map(x=>`<li>${esc(x)}</li>`).join('')+'</ul>');
  }
  lines.push('</body></html>');
  return lines.join('');
}

function renderMd(doc){
  const out=[];
  out.push('# Everpure monthly leadership brief (30d)');
  if(doc.window_label) out.push('', doc.window_label);
  if(doc.executive_summary) out.push('', '## Executive summary', '', doc.executive_summary);
  const sections=[['What the research surfaced', doc.top_findings],['Meaningful comparison tests', doc.meaningful_comparison_tests]];
  for(const [heading, items] of sections){
    if(items && items.length){
      out.push('', `## ${heading}`);
      for(const raw of items){
        const item=normalizeItem(raw);
        out.push('', `### ${conceptTitle(item)}`);
        const found = item.what_we_found || item.finding_statement || item.finding;
        if(found){ out.push('', '**What we found**', found); }
        if(item.proof_point){ out.push('', '**Proof point**', item.proof_point); }
        const keyEv = unique(item.key_evidence || item.supporting_signals || []);
        if(keyEv.length){ out.push('', '**Key evidence**'); keyEv.forEach(x=>out.push(`- ${x}`)); }
        const next = item.what_we_should_do_next || item.next_step;
        if(next){ out.push('', '**What we should do next**', next); }
        const conf=[item.confidence || item.confidence_level, item.decision_status].filter(Boolean).join(' • ');
        if(conf){ out.push('', '**Confidence**', conf); }
      }
    }
  }
  if(doc.work_in_motion?.length){ out.push('', '## What is still in motion'); doc.work_in_motion.forEach(x=>out.push(`- ${x}`)); }
  if(doc.next_actions?.length){ out.push('', '## What we should do next'); doc.next_actions.forEach(x=>out.push(`- ${x}`)); }
  return out.join('\n');
}

function main(){
  const publishDir = process.argv[2] || path.join(process.cwd(),'publish');
  const newsletterDir = path.join(publishDir,'newsletter');
  const jsonPath = path.join(newsletterDir,'default.json');
  const mdPath = path.join(newsletterDir,'default.md');
  const htmlPath = path.join(newsletterDir,'default.html');
  if(!fs.existsSync(jsonPath)) throw new Error(`Missing ${jsonPath}`);
  const doc = readJson(jsonPath);
  if(Array.isArray(doc.top_findings)) doc.top_findings = doc.top_findings.map(normalizeItem);
  if(Array.isArray(doc.meaningful_comparison_tests)) doc.meaningful_comparison_tests = doc.meaningful_comparison_tests.map(normalizeItem);
  let actions = unique(doc.next_actions || []);
  actions = mergeKnowledge(actions);
  doc.next_actions = actions;
  let motion = unique(doc.work_in_motion || []);
  motion = mergeKnowledge(motion);
  doc.work_in_motion = motion;
  writeJson(jsonPath, doc);
  fs.writeFileSync(mdPath, renderMd(doc));
  fs.writeFileSync(htmlPath, renderHtml(doc));
  console.log(JSON.stringify({updated:[jsonPath,mdPath,htmlPath]},null,2));
}

main();
