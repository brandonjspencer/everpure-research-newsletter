/* global TR -- the page's transition table, read inside page.evaluate() */
// Coverage check: at the last step of each hero growth, screenshot with the clip, then with the clip removed and
// the mesh hidden (= the frame after the hand-off); print IDENTICAL when
// the grown window already covers the whole frame (so the hand-off can't pop).
// Usage: node tools/probe_cover.js
const fs = require("fs"),
  path = require("path"),
  crypto = require("crypto"),
  puppeteer = require("puppeteer-core");
(async () => {
  const b = await puppeteer.launch({
    executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    headless: true,
    args: ["--allow-file-access-from-files", "--force-color-profile=srgb"],
  });
  const p = await b.newPage();
  await p.setViewport({ width: 1920, height: 1080 });
  await p.evaluateOnNewDocument(fs.readFileSync(path.join(__dirname, "..", "vclock.js"), "utf8"));
  await p.goto("file://" + path.join(__dirname, "..", "index.html"), { waitUntil: "load" });
  await p.evaluate(() => window.__ready);
  const cuts = await p.evaluate(() => TR.map((r) => [r.at, r.grow]));
  let f = 0;
  for (const [T, G] of cuts) {
    const tgt = Math.round((T + G) * 480) - 1;
    for (; f <= tgt; f++) await p.evaluate((x) => window.__stepTo(x), f / 480);
    const a = await p.screenshot({ type: "png" });
    await p.evaluate(() => {
      document.querySelectorAll(".scene").forEach((s) => {
        s.style.clipPath = "";
      });
      document.querySelector("#mesh").style.visibility = "hidden";
    });
    const c = await p.screenshot({ type: "png" });
    console.log(
      T,
      crypto.createHash("md5").update(a).digest("hex") ===
        crypto.createHash("md5").update(c).digest("hex")
        ? "IDENTICAL"
        : "differs"
    );
  }
  await b.close();
})();
