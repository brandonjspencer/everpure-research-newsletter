#!/usr/bin/env node
/**
 * Shared branded theme for the static pages: light/dark CSS variables, the
 * collapsible hover-expand icon sidebar, the theme toggle, and inline SVG icons.
 *
 * One source of truth so the dashboard (homepage), sitemap, issues archive, and
 * activity log all look and navigate the same. Consumers either build a full page
 * with `docHead()` + `sidebar()` + `themeInit()`, or (for renderers that own
 * their HTML) splice `brandCss()` into <head> and `sidebar()` after <body>.
 *
 * Nav links are RELATIVE with a per-page `prefix` ("" for the root homepage,
 * "../" for one-level pages like /sitemap/, /issues/, /newsletter/…) so they
 * survive the GitHub Pages /<repo>/ subpath.
 */

const fs = require("fs");
const path = require("path");

// Brand favicon (Everpure/Pure Storage), embedded as a base64 data URI rather than
// a /favicon.ico file reference. A data URI resolves identically at every page
// depth, so it survives the GitHub Pages /<repo>/ subpath with no per-page prefix
// and no build copy step — the same path fragility the nav links above avoid. The
// source .ico is committed at netlify/assets/favicon.ico (read once at module load).
const FAVICON_LINK = (() => {
  try {
    const ico = fs.readFileSync(path.join(__dirname, "assets", "favicon.ico"));
    return `<link rel="icon" href="data:image/x-icon;base64,${ico.toString("base64")}">`;
  } catch {
    return "";
  }
})();

const ICONS = {
  brand:
    '<svg viewBox="0 0 29 26" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M19.9941 0H8.82056C7.66536 0 6.59756 0.61636 6.01996 1.61728L0.4332 11.2936C-0.1444 12.2945 -0.1444 13.5272 0.4332 14.5274L6.11268 24.3922C6.69028 25.3931 7.7976 25.9821 8.95356 25.9821H14.516L6.96768 12.9101L10.6871 6.4676H18.1268L21.8462 12.9101L17.3576 20.6842H24.8262L28.3807 14.5274C28.9583 13.5272 28.9583 12.2945 28.3807 11.2936L22.7939 1.61728C22.2163 0.61636 21.1485 0 19.9933 0L19.9941 0Z" fill="#FF7023"/></svg>',
  dashboard:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/></svg>',
  issues:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M9 13h6M9 17h6"/></svg>',
  activity:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12h4l3 7 4-15 3 8h4"/></svg>',
  sitemap:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="3" width="6" height="5" rx="1.2"/><rect x="3" y="16" width="6" height="5" rx="1.2"/><rect x="15" y="16" width="6" height="5" rx="1.2"/><path d="M12 8v4M12 12H6v4M12 12h6v4"/></svg>',
  sun: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  moon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>',
};

const NAV = [
  { key: "dashboard", label: "Dashboard", icon: ICONS.dashboard, path: "" },
  { key: "issues", label: "Issues", icon: ICONS.issues, path: "issues/" },
  { key: "activity", label: "Activity log", icon: ICONS.activity, path: "activity/" },
  { key: "sitemap", label: "Sitemap", icon: ICONS.sitemap, path: "sitemap/" },
];

function brandCss() {
  return `<style>
  :root{
    --paper:#fbf7f2; --card:#ffffff; --ink:#1d1d1f; --muted:#6b6b6b; --line:#ece6df; --accent:#ef5b25;
    --rail:#211c17; --rail-ink:#d8cfc4; --rail-active:#ef5b25; --rail-active-bg:rgba(239,91,37,.16);
    --c-high:#2e7d57; --c-medium:#d98a00; --c-low:#c2410c; --c-unknown:#b8b2aa;
    --bar-base:#9aa7b1; --bar-variant:#ef5b25; --track:#e8e1d8; --hover:#f4eee6;
  }
  :root[data-theme="dark"]{
    --paper:#15130f; --card:#211d18; --ink:#f1ebe2; --muted:#a59b8e; --line:#332d25; --accent:#ff7a45;
    --rail:#100e0b; --rail-ink:#b7ada0; --rail-active:#ff7a45; --rail-active-bg:rgba(255,122,69,.18);
    --c-high:#57bd8c; --c-medium:#e3a52e; --c-low:#e8794f; --c-unknown:#6f6760;
    --bar-base:#5b6b78; --bar-variant:#ff7a45; --track:#2b251e; --hover:#2b2620;
  }
  *{box-sizing:border-box}
  html{color-scheme:light dark}
  body{margin:0;background:var(--paper);color:var(--ink);font-family:'Familjen Grotesk',system-ui,-apple-system,sans-serif;line-height:1.5}
  a{color:var(--accent)}
  .rail{position:fixed;top:0;left:0;bottom:0;width:60px;background:var(--rail);color:var(--rail-ink);
    display:flex;flex-direction:column;gap:4px;padding:14px 10px;overflow:hidden;z-index:50;
    transition:width .18s ease;white-space:nowrap}
  .rail:hover,.rail:focus-within{width:212px;box-shadow:2px 0 18px rgba(0,0,0,.18)}
  .rail .brand{display:flex;align-items:center;gap:12px;color:var(--rail-ink);text-decoration:none;
    padding:6px 8px 14px;font-weight:700;letter-spacing:-.01em}
  .rail .brand svg{min-width:26px;width:26px;height:auto;display:block}
  .rail a.navlink,.rail button.themebtn{display:flex;align-items:center;gap:14px;color:var(--rail-ink);
    text-decoration:none;padding:10px 8px;border-radius:10px;font-size:15px;border:0;background:none;
    cursor:pointer;width:100%;text-align:left;font:inherit}
  .rail a.navlink svg,.rail button.themebtn svg{min-width:22px;width:22px;height:22px}
  .rail a.navlink:hover,.rail button.themebtn:hover{background:rgba(255,255,255,.08);color:#fff}
  .rail a.navlink.active{color:var(--rail-active);background:var(--rail-active-bg)}
  .rail .label{opacity:0;transition:opacity .12s ease}
  .rail:hover .label,.rail:focus-within .label{opacity:1}
  .rail .spacer{flex:1}
  .rail .themebtn .moon{display:none}
  :root[data-theme="dark"] .rail .themebtn .sun{display:none}
  :root[data-theme="dark"] .rail .themebtn .moon{display:inline-flex}
  .shell{margin-left:60px;min-height:100vh}
  .wrap{max-width:900px;margin:0 auto;padding:34px 24px 72px}
  header h1{font-size:30px;margin:0 0 4px;letter-spacing:-.02em}
  header p.sub{color:var(--muted);margin:0 0 24px}
  .sub .hint{font-size:12px;opacity:.7}
  h2{font-size:18px;margin:0 0 4px;letter-spacing:-.01em}
  .kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:0 0 26px}
  .kpi{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px 16px}
  .kpi-v{font-size:26px;font-weight:700;letter-spacing:-.02em;color:var(--accent)}
  .kpi-l{font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.04em;margin-top:2px}
  .panel{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:22px 24px;margin:0 0 20px}
  .panel .desc,.desc{color:var(--muted);font-size:13px;margin:0 0 16px}
  .panel-h{display:flex;align-items:center;gap:8px;margin:0}
  .panel-grip{flex:none;display:inline-flex;align-items:center;cursor:grab;color:var(--muted);background:none;border:0;padding:4px 2px;margin:0;border-radius:6px;touch-action:none}
  .panel-grip:hover{color:var(--ink)}
  .panel-grip:active{cursor:grabbing}
  .panel-grip:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
  .grip-i{display:block;fill:currentColor}
  .panel.dragging{opacity:.6;box-shadow:0 10px 28px rgba(0,0,0,.20)}
  .panel-toggle{display:flex;align-items:center;justify-content:space-between;gap:12px;flex:1;min-width:0;font:inherit;color:inherit;background:none;border:0;padding:0;cursor:pointer;text-align:left}
  .panel-caret{display:block;width:20px;height:20px;color:var(--muted);transition:transform .15s ease;flex:none}
  .panel-toggle:hover .panel-caret{color:var(--ink)}
  .panel-toggle[aria-expanded="false"] .panel-caret{transform:rotate(-90deg)}
  .panel-body{margin-top:4px}
  .panel-body[hidden]{display:none}
  /* Confidence chart — HTML stacked columns (responsive; text never shrinks). */
  .ccols{display:flex;gap:10px;align-items:flex-end}
  .ccol{flex:1;min-width:0;display:flex;flex-direction:column;align-items:center;text-align:center}
  .ccol-bar{width:100%;max-width:64px;height:170px;display:flex;align-items:flex-end}
  .ccol-stack{width:100%;height:100%;display:flex;flex-direction:column-reverse;border-radius:5px;overflow:hidden}
  .cseg{width:100%}
  .ccol-x{font-size:13px;font-weight:600;margin-top:8px}
  .ccol-sub{font-size:11px;color:var(--muted);line-height:1.35}
  /* Comparison chart — HTML bars; grid collapses to stacked label+bars on mobile. */
  .mc{margin-top:2px}
  .mc-metric{display:grid;grid-template-columns:130px 1fr;gap:10px 14px;align-items:center;padding:7px 0;border-top:1px solid var(--line)}
  .mc-metric:first-child{border-top:0}
  .mc-label{font-size:13px;color:var(--ink);text-transform:capitalize}
  .mc-bars{display:flex;flex-direction:column;gap:5px;min-width:0}
  .mc-row{display:flex;align-items:center;gap:8px}
  .mc-track{flex:1;height:9px;background:var(--track);border-radius:3px;overflow:hidden;min-width:0}
  .mc-fill{height:100%;border-radius:3px;min-width:2px}
  .mc-val{font-size:11px;color:var(--muted);min-width:34px;text-align:right;flex:none}
  .legend{display:flex;flex-wrap:wrap;gap:14px;margin-top:10px;font-size:12px;color:var(--muted)}
  .lg i{display:inline-block;width:11px;height:11px;border-radius:3px;margin-right:5px;vertical-align:-1px}
  /* Variant legend item with a hover thumbnail (the Helio compare screenshot). */
  .lg.has-thumb{position:relative}
  .thumb-pop{display:none;position:absolute;top:calc(100% + 8px);left:0;z-index:20;background:var(--card);border:1px solid var(--line);border-radius:10px;padding:6px;box-shadow:0 12px 30px rgba(0,0,0,.22)}
  .thumb-pop img{display:block;width:260px;max-width:min(260px,calc(100vw - 90px));height:auto;border-radius:6px}
  /* Hover-only, and only advertised on hover-capable devices (the variant name is
     always visible text, so touch/keyboard users aren't shown a dead affordance). */
  @media (hover:hover){
    .lg.has-thumb{cursor:zoom-in;text-decoration:underline dotted var(--line);text-underline-offset:3px}
    .lg.has-thumb:hover .thumb-pop{display:block}
  }
  .cmp{padding:14px 0;border-top:1px solid var(--line)}
  .cmp:first-of-type{border-top:0}
  .cmp-h{display:flex;justify-content:space-between;align-items:baseline;gap:10px;margin-bottom:6px;flex-wrap:wrap}
  .cmp-h span{color:var(--muted);font-size:12px}
  .quote{margin:0 0 14px;padding:0 0 14px;border-bottom:1px solid var(--line)}
  .quote:last-child{border-bottom:0;margin-bottom:0;padding-bottom:0}
  .quote blockquote{margin:0 0 4px;font-size:15px}
  .quote figcaption{color:var(--muted);font-size:12px}
  .quote figcaption .q-topic{color:var(--accent);font-weight:600}
  .q-prompt{margin:0 0 8px;color:var(--muted);font-size:13px;line-height:1.4}
  .q-prompt-label{display:inline-block;font-size:10px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--accent);margin-right:6px}
  .q-signal{margin:0 0 10px;color:var(--ink);font-size:14px;font-weight:600;line-height:1.4}
  .q-signal-label{display:inline-block;font-size:10px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#fff;background:var(--accent);border-radius:4px;padding:2px 6px;margin-right:8px;vertical-align:middle}
  /* Per-comparison footer beneath each chart: a deterministic frontrunner line + the
     signal (curated read or computed fallback) + an optional next-step. Pill labels and
     the signal type mirror the Voice-of-the-user styling for a consistent visual grammar. */
  /* Insight block now sits ABOVE the chart: a dashed bottom rule separates it from the legend + bars. */
  .cmp-lead{margin:16px 0 22px;padding-bottom:18px;border-bottom:1px dashed var(--line)}
  .cmp-front-label,.cmp-signal-label,.cmp-rec-label{display:inline-block;font-size:10px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;border-radius:4px;padding:2px 6px;margin-right:8px;vertical-align:middle}
  .cmp-front{margin:0 0 10px;font-size:13px;line-height:1.5;color:var(--muted)}
  .cmp-front-label{color:#fff;background:var(--c-high)}
  .cmp-front-solo .cmp-front-label{background:var(--muted)}
  .cf-name{font-weight:700;color:var(--ink)}
  .cf-stat{color:var(--muted)}
  .cf-up{color:var(--c-high);font-weight:600}
  .cmp-signal{margin:0 0 10px;color:var(--ink);font-size:14px;font-weight:600;line-height:1.45}
  .cmp-signal-label{color:#fff;background:var(--accent);vertical-align:middle}
  .cmp-rec{margin:0;color:var(--muted);font-size:13px;line-height:1.45}
  .cmp-rec-label{color:var(--accent);background:transparent;border:1px solid var(--accent)}
  .empty{color:var(--muted);font-size:14px;font-style:italic}
  .linklist{list-style:none;margin:0;padding:0}
  .linklist li{padding:11px 0;border-top:1px solid var(--line);display:flex;justify-content:space-between;gap:14px;align-items:baseline;flex-wrap:wrap}
  .linklist li:first-child{border-top:0}
  .linklist .path{color:var(--muted);font-size:12px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
  footer{color:var(--muted);font-size:12px;margin-top:8px}
  .pagelink{display:inline-flex;align-items:center;gap:8px;text-decoration:none;font-weight:600}
  .issuelist{list-style:none;padding:0;margin:0}
  .issuelist>li{padding:16px 0;border-top:1px solid var(--line);display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap}
  .issuelist>li:first-child{border-top:0}
  .issue-row-head{display:flex;align-items:baseline}
  .issuelist strong{font-size:18px;letter-spacing:-.01em}
  .meta{display:block;color:var(--muted);font-size:13px;margin-bottom:10px}
  .links{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-left:auto}
  .btn{display:inline-flex;align-items:center;gap:6px;background:var(--accent);color:#fff;border:1px solid var(--accent);border-radius:8px;padding:7px 15px;font-size:13px;font-weight:600;text-decoration:none}
  .btn:hover{filter:brightness(1.06)}
  main{max-width:980px;margin:0 auto;padding:34px 24px 60px}
  main h1{font-size:30px;margin:0 0 8px;letter-spacing:-.02em}
  .lede{color:var(--muted);margin-bottom:24px;font-size:15px;line-height:1.6}
  .grid{display:grid;gap:14px;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));margin:20px 0 28px}
  .stat{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px 16px}
  .stat .label{font-size:12px;color:var(--muted);margin-bottom:6px}
  .stat .value{font-size:22px;font-weight:700}
  .section{margin-top:32px}
  .cards{display:grid;gap:14px}
  .card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:16px 18px}
  .subtle{color:var(--muted);font-size:13px;margin-top:4px}
  /* Published-issues carousel: 3-up native scroll track + prev/next arrows. */
  /* Nothing here clips: pages stack in one grid cell and cross-fade, so each card's
     hover shadow renders on every side (a scroll container would clip the left/right
     shadows). Each page is a single nowrap row (cards never wrap/stack); the client
     sets how many cards per page by width. Arrows live centered below the cards. */
  .issue-carousel{position:relative}
  .issue-track{display:grid;grid-template-columns:1fr}
  .issue-page{grid-area:1/1;display:flex;flex-wrap:nowrap;gap:14px;opacity:0;visibility:hidden;transition:opacity .25s ease,visibility 0s linear .25s}
  .issue-page.is-active{opacity:1;visibility:visible;transition:opacity .25s ease,visibility 0s linear 0s}
  /* Cap each card at its per-view width (set by JS as --issue-card-w; 3-up fallback)
     so a partial last page's card keeps its 3-up size instead of stretching wide. */
  .issue-page>.issue-hero{flex:1 1 0;min-width:0;max-width:var(--issue-card-w, calc((100% - 28px)/3))}
  .ic-nav-row{display:flex;justify-content:center;gap:14px;margin-top:18px}
  .ic-nav{width:36px;height:36px;border-radius:50%;border:1px solid var(--line);background:var(--card);color:var(--ink);cursor:pointer;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 8px rgba(0,0,0,.10);transition:color .12s ease,border-color .12s ease,opacity .12s ease}
  .ic-nav:hover:not(:disabled){color:var(--accent);border-color:var(--accent)}
  .ic-nav:disabled{opacity:.4;cursor:default;box-shadow:none}
  .ic-caret{display:block;width:20px;height:20px}
  .issue-hero{display:flex;flex-direction:column;background:var(--card);border:1px solid var(--line);border-radius:14px;overflow:hidden;text-decoration:none;color:inherit;transition:transform .12s ease,box-shadow .12s ease}
  .issue-hero:hover{transform:translateY(-2px);box-shadow:0 8px 22px rgba(0,0,0,.12)}
  .issue-hero-band{background:var(--accent);color:#fff;padding:14px 16px;display:flex;justify-content:space-between;align-items:baseline;gap:8px}
  .issue-hero-month{font-size:18px;font-weight:700;letter-spacing:-.01em}
  .issue-hero-tag{font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:#fff;border:1px solid rgba(255,255,255,.5);border-radius:999px;padding:2px 9px}
  .issue-hero-body{padding:16px;display:flex;flex-direction:column;gap:10px;flex:1}
  .issue-hero-title{font-weight:600;font-size:15px;line-height:1.3}
  .issue-hero-foot{margin-top:auto;display:flex;justify-content:space-between;align-items:center;font-size:12px;color:var(--muted);padding-top:4px}
  .issue-hero-foot .go{color:var(--accent);font-weight:600}
  .issue-tag{font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--accent);border:1px solid var(--line);border-radius:999px;padding:2px 9px;margin-left:10px;vertical-align:2px}
  .filechip{font-size:11px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--muted);border:1px solid var(--line);border-radius:6px;padding:3px 7px;text-decoration:none}
  .filechip:hover{color:var(--ink);border-color:var(--muted)}
  .cmp-h-r{display:inline-flex;align-items:baseline;gap:12px;flex-wrap:wrap}
  .cmp-link{font-size:12px;font-weight:600;color:var(--accent);text-decoration:none;white-space:nowrap}
  .cmp-link:hover{text-decoration:underline}
  /* Dropdown multiselect */
  .ms{position:relative;display:inline-block;margin:0 0 18px;max-width:100%}
  .ms-toggle{display:inline-flex;align-items:center;gap:10px;font:inherit;font-size:13px;color:var(--ink);background:var(--card);border:1px solid var(--line);border-radius:10px;padding:9px 14px;cursor:pointer}
  .ms-toggle:hover{border-color:var(--muted)}
  .ms-toggle[aria-expanded="true"]{border-color:var(--accent)}
  .ms-count{color:var(--muted);font-size:12px}
  .ms-caret{display:block;width:16px;height:16px;color:var(--muted);transition:transform .15s ease;flex:none}
  .ms-toggle:hover .ms-caret{color:var(--ink)}
  .ms-toggle[aria-expanded="true"] .ms-caret{transform:rotate(180deg)}
  .ms-panel{position:absolute;top:calc(100% + 6px);left:0;z-index:30;min-width:300px;max-width:440px;background:var(--card);border:1px solid var(--line);border-radius:12px;box-shadow:0 12px 30px rgba(0,0,0,.18);padding:12px 14px}
  .ms-panel[hidden]{display:none}
  .ms-search{display:block;width:100%;box-sizing:border-box;margin-bottom:8px;padding:7px 10px;font:inherit;font-size:13px;color:var(--ink);background:var(--paper);border:1px solid var(--line);border-radius:8px}
  .ms-search:focus{outline:2px solid var(--accent);outline-offset:1px;border-color:var(--accent)}
  .ms-search::placeholder{color:var(--muted)}
  .ms-head{display:flex;justify-content:flex-end;gap:6px;margin-bottom:8px;padding-bottom:8px;border-bottom:1px solid var(--line)}
  .ms-btn{font:inherit;font-size:12px;color:var(--muted);background:none;border:1px solid var(--line);border-radius:7px;padding:3px 10px;cursor:pointer}
  .ms-btn:hover{color:var(--ink);border-color:var(--muted)}
  /* The options scroll (not the whole panel) so the All/None header stays pinned. */
  .ms-opts{display:flex;flex-direction:column;gap:2px;max-height:264px;overflow:auto}
  .ms-opt{display:flex;align-items:center;gap:8px;padding:5px 4px;border-radius:7px}
  .ms-opt:hover{background:var(--hover)}
  .ms-opt-main{display:flex;align-items:center;gap:9px;flex:1;min-width:0;font-size:13px;color:var(--ink);cursor:pointer}
  .ms-opt-main input{accent-color:var(--accent);flex:none}
  .ms-opt-name{min-width:0}
  .ms-opt-link{flex:none;color:var(--muted);text-decoration:none;font-size:14px;line-height:1;padding:2px 6px;border-radius:6px}
  .ms-opt-link:hover{color:var(--accent);background:var(--hover)}
  /* Cross-fading quote rotator */
  .qrotator{position:relative}
  .q-stage{display:grid}
  .q-slide{grid-area:1/1;opacity:0;transition:opacity .7s ease;pointer-events:none}
  .q-slide.is-active{opacity:1;pointer-events:auto}
  .qrotator .quote{margin:0;padding:0;border:0}
  .qrotator .quote blockquote{font-size:18px;line-height:1.5}
  .q-dots{display:flex;gap:8px;margin-top:16px}
  .q-dot{width:9px;height:9px;padding:0;border:0;border-radius:50%;background:var(--line);cursor:pointer;transition:background .15s ease}
  .q-dot:hover{background:var(--muted)}
  .q-dot.is-active{background:var(--accent)}
  /* Comprehension & sentiment trend rows (sparklines) */
  .mtrends{display:flex;flex-direction:column}
  .mt-row{padding:12px 0;border-top:1px solid var(--line)}
  .mt-row:first-child{border-top:0}
  .mt-name{font-size:14px;font-weight:600;margin-bottom:6px}
  .mt-metric{display:flex;align-items:center;gap:12px;padding:3px 0;flex-wrap:wrap}
  .mt-label{width:118px;font-size:13px;color:var(--muted)}
  svg.spark{width:84px;height:22px;display:block;flex:none}
  .mt-val{font-size:13px;min-width:118px}
  .mt-delta{font-weight:600;margin-left:2px}
  .mt-cyc{display:inline-flex;align-items:center;gap:7px;font-size:11px;color:var(--muted);margin-left:auto}
  .mt-soon{font-style:italic;opacity:.85}
  @media (prefers-reduced-motion: reduce){.q-slide{transition:none}.ms-caret{transition:none}.panel-caret{transition:none}.issue-page{transition:none}}
  @media (max-width:600px){.mc-metric{grid-template-columns:1fr;gap:5px;align-items:start}.mc-label{font-weight:600}.ccols{gap:6px}.ccol-sub{font-size:10px}
    /* Issue/activity index rows stack into a card: title on top, a full-width
       action row beneath with MD/JSON left and the View button pushed right. */
    .issuelist>li{flex-direction:column;align-items:stretch;gap:12px}
    .links{margin-left:0;width:100%}
    .links .btn{margin-left:auto}
    .filechip{padding:6px 10px}}
  @media (max-width:520px){.kpis{grid-template-columns:repeat(2,1fr)}
    .ms,.ms-toggle{display:flex;width:100%}.ms-toggle{justify-content:space-between}.ms-panel{min-width:0;width:100%;max-width:100%}}
</style>`;
}

function sidebar(activeKey, prefix = "") {
  const home = prefix === "" ? "index.html" : prefix;
  const links = NAV.map((item) => {
    const href = item.key === "dashboard" ? home : prefix + item.path;
    const active = item.key === activeKey ? " active" : "";
    return `<a class="navlink${active}" href="${href}"${item.key === activeKey ? ' aria-current="page"' : ""} title="${item.label}">${item.icon}<span class="label">${item.label}</span></a>`;
  }).join("");
  return `<nav class="rail" aria-label="Primary">
  <a class="brand" href="${home}" aria-label="Everpure Research home">${ICONS.brand}<span class="label">Everpure Research</span></a>
  ${links}
  <span class="spacer"></span>
  <button class="themebtn" id="themeToggle" type="button" aria-label="Toggle light or dark theme"><span class="sun">${ICONS.sun}</span><span class="moon">${ICONS.moon}</span><span class="label">Theme</span></button>
</nav>`;
}

// Runs in <head> so the theme is applied before first paint (no flash). Also wires
// the toggle via event delegation (works even before the button parses).
function themeInit() {
  return `<script>
(function(){var K="everpure-theme",r=document.documentElement;
function set(t){r.setAttribute("data-theme",t);}
try{var s=localStorage.getItem(K);set(s||(matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"));}catch(e){set("light");}
document.addEventListener("click",function(e){var b=e.target.closest&&e.target.closest("#themeToggle");if(!b)return;
var n=r.getAttribute("data-theme")==="dark"?"light":"dark";set(n);try{localStorage.setItem(K,n);}catch(_){}});})();
</script>`;
}

const FONT_LINK =
  '<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Familjen+Grotesk:wght@400;500;600;700&display=swap" rel="stylesheet">';

function docHead(title) {
  return `<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
${FAVICON_LINK}
${FONT_LINK}
${brandCss()}
${themeInit()}`;
}

module.exports = { ICONS, NAV, brandCss, sidebar, themeInit, docHead, FONT_LINK, FAVICON_LINK };
