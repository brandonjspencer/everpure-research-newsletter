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
  {
    key: "activity",
    label: "Activity log",
    icon: ICONS.activity,
    path: "newsletter/marketing-activity-30d.html",
  },
  { key: "sitemap", label: "Sitemap", icon: ICONS.sitemap, path: "sitemap/" },
];

function brandCss() {
  return `<style>
  :root{
    --paper:#fbf7f2; --card:#ffffff; --ink:#1d1d1f; --muted:#6b6b6b; --line:#ece6df; --accent:#ef5b25;
    --rail:#211c17; --rail-ink:#d8cfc4; --rail-active:#ef5b25; --rail-active-bg:rgba(239,91,37,.16);
    --c-high:#2e7d57; --c-medium:#d98a00; --c-low:#c2410c; --c-unknown:#b8b2aa;
    --bar-base:#9aa7b1; --bar-variant:#ef5b25; --track:#e8e1d8;
  }
  :root[data-theme="dark"]{
    --paper:#15130f; --card:#211d18; --ink:#f1ebe2; --muted:#a59b8e; --line:#332d25; --accent:#ff7a45;
    --rail:#100e0b; --rail-ink:#b7ada0; --rail-active:#ff7a45; --rail-active-bg:rgba(255,122,69,.18);
    --c-high:#57bd8c; --c-medium:#e3a52e; --c-low:#e8794f; --c-unknown:#6f6760;
    --bar-base:#5b6b78; --bar-variant:#ff7a45; --track:#2b251e;
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
  h2{font-size:18px;margin:0 0 4px;letter-spacing:-.01em}
  .kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:0 0 26px}
  .kpi{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px 16px}
  .kpi-v{font-size:26px;font-weight:700;letter-spacing:-.02em}
  .kpi-l{font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.04em;margin-top:2px}
  .panel{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:22px 24px;margin:0 0 20px}
  .panel .desc,.desc{color:var(--muted);font-size:13px;margin:0 0 16px}
  svg.chart{width:100%;height:auto;display:block}
  text.axis{font-size:12px;fill:var(--ink);font-weight:600}
  text.sub{font-size:10px;fill:var(--muted)}
  text.mlabel{font-size:12px;fill:var(--ink);text-transform:capitalize}
  text.mval{font-size:11px;fill:var(--muted)}
  .legend{display:flex;flex-wrap:wrap;gap:14px;margin-top:10px;font-size:12px;color:var(--muted)}
  .lg i{display:inline-block;width:11px;height:11px;border-radius:3px;margin-right:5px;vertical-align:-1px}
  .cmp{padding:14px 0;border-top:1px solid var(--line)}
  .cmp:first-of-type{border-top:0}
  .cmp-h{display:flex;justify-content:space-between;align-items:baseline;gap:10px;margin-bottom:6px;flex-wrap:wrap}
  .cmp-h span{color:var(--muted);font-size:12px}
  .quote{margin:0 0 14px;padding:0 0 14px;border-bottom:1px solid var(--line)}
  .quote:last-child{border-bottom:0;margin-bottom:0;padding-bottom:0}
  .quote blockquote{margin:0 0 4px;font-size:15px}
  .quote figcaption{color:var(--muted);font-size:12px}
  .empty{color:var(--muted);font-size:14px;font-style:italic}
  .linklist{list-style:none;margin:0;padding:0}
  .linklist li{padding:11px 0;border-top:1px solid var(--line);display:flex;justify-content:space-between;gap:14px;align-items:baseline;flex-wrap:wrap}
  .linklist li:first-child{border-top:0}
  .linklist .path{color:var(--muted);font-size:12px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
  footer{color:var(--muted);font-size:12px;margin-top:8px}
  .pagelink{display:inline-flex;align-items:center;gap:8px;text-decoration:none;font-weight:600}
  .issuelist{list-style:none;padding:0;margin:0}
  .issuelist>li{padding:16px 0;border-top:1px solid var(--line)}
  .issuelist>li:first-child{border-top:0}
  .issuelist strong{font-size:18px;display:block;margin-bottom:4px}
  .meta{display:block;color:var(--muted);font-size:13px;margin-bottom:10px}
  .links{display:flex;flex-wrap:wrap;gap:10px 16px}
  .links a{font-size:13px;text-decoration:none}
  .links a:hover{text-decoration:underline}
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
  .issuegrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(270px,1fr));gap:16px}
  .issue-hero{display:flex;flex-direction:column;background:var(--card);border:1px solid var(--line);border-radius:14px;overflow:hidden;text-decoration:none;color:inherit;transition:transform .12s ease,box-shadow .12s ease}
  .issue-hero:hover{transform:translateY(-2px);box-shadow:0 8px 22px rgba(0,0,0,.12)}
  .issue-hero-band{background:var(--accent);color:#fff;padding:14px 16px;display:flex;justify-content:space-between;align-items:baseline;gap:8px}
  .issue-hero-month{font-size:18px;font-weight:700;letter-spacing:-.01em}
  .issue-hero-tag{font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;opacity:.92}
  .issue-hero-body{padding:16px;display:flex;flex-direction:column;gap:8px;flex:1}
  .issue-hero-title{font-weight:600;font-size:15px;line-height:1.3}
  .issue-hero-sum{color:var(--muted);font-size:13px;margin:0;line-height:1.5;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
  .issue-hero-foot{margin-top:auto;display:flex;justify-content:space-between;align-items:center;font-size:12px;color:var(--muted);padding-top:8px}
  .issue-hero-foot .go{color:var(--accent);font-weight:600}
  @media (max-width:560px){.kpis{grid-template-columns:repeat(2,1fr)}}
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
${FONT_LINK}
${brandCss()}
${themeInit()}`;
}

module.exports = { ICONS, NAV, brandCss, sidebar, themeInit, docHead, FONT_LINK };
