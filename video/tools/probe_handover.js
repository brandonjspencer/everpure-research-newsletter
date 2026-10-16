/* global TR -- the page's transition table, read inside page.evaluate() */
// Hand-over check: screenshot the step just before each cut and the cut itself into <outDir> (pre_T /
// cut_T PNGs) — the hero window replacing its lattice cell should change ~nothing. Also prints each
// transition's hero (kind, cell scale, cover scale, centre, grid offset).
// Usage: node tools/probe_handover.js '[3.306,12.41]' <outDir>
const fs = require("fs"),
  path = require("path"),
  puppeteer = require("puppeteer-core");
(async () => {
  const b = await puppeteer.launch({
    executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    headless: true,
    args: ["--allow-file-access-from-files", "--force-color-profile=srgb"],
  });
  const p = await b.newPage();
  await p.setViewport({ width: 1920, height: 1080 });
  p.on("pageerror", (e) => console.error("[pageerror]", String(e)));
  await p.evaluateOnNewDocument(fs.readFileSync(path.join(__dirname, "..", "vclock.js"), "utf8"));
  await p.goto("file://" + path.join(__dirname, "..", "index.html"), { waitUntil: "load" });
  await p.evaluate(() => window.__ready);
  const T = JSON.parse(process.argv[2]);
  let f = 0;
  const out = process.argv[3];
  fs.mkdirSync(out, { recursive: true });
  for (const t of T) {
    const tgt = Math.round(t * 480);
    for (; f <= tgt - 1; f++) await p.evaluate((x) => window.__stepTo(x), f / 480);
    await p.screenshot({ path: path.join(out, `pre_${t}.png`) });
    await p.evaluate((x) => window.__stepTo(x), f / 480);
    f++;
    await p.screenshot({ path: path.join(out, `cut_${t}.png`) });
  }
  console.log(
    JSON.stringify(
      await p.evaluate(() =>
        TR.map((r) => ({
          kind: r.hero.kind,
          px: r.px,
          S: +r.S.toFixed(2),
          center: [Math.round(r.cell.center.x), Math.round(r.cell.center.y)],
          off: [Math.round(r.off.x), Math.round(r.off.y)],
        }))
      )
    )
  );
  await b.close();
})();
