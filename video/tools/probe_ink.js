// Ink bounding boxes (and true baselines) of each scene's elements, measured by toggling each element
// off and diffing screenshots, with the slow camera drift neutralised. Feeds tools/solve_layout.py.
// Usage: node tools/probe_ink.js tools/ink_plan.json [--raw] [--threshold 240] > tools/ink_report.json
//   --raw        measure the un-adjusted layout (the page skips its LAYOUT table) — use this when re-solving
//   --threshold  per-pixel RGB difference that counts as ink (lower it for low-contrast text, e.g. 120)
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
  const args = process.argv.slice(2);
  const RAW = args.includes("--raw");
  const ti = args.indexOf("--threshold");
  const THRESH = ti >= 0 ? Number(args[ti + 1]) : 240;
  if (RAW) await p.evaluateOnNewDocument("window.__noLayout = true;");
  await p.evaluateOnNewDocument(fs.readFileSync(path.join(__dirname, "..", "vclock.js"), "utf8"));
  await p.goto("file://" + path.join(__dirname, "..", "index.html"), { waitUntil: "load" });
  await p.evaluate(() => window.__ready);
  const plan = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
  let f = 0;
  const out = {};
  for (const [name, t, sels] of plan) {
    const tgt = Math.round(t * 480);
    for (; f <= tgt; f++) await p.evaluate((x) => window.__stepTo(x), f / 480);
    out[name] = {};
    await p.evaluate(() =>
      document.querySelectorAll(".content").forEach((c) => {
        c.style.transform = "none";
      })
    );
    for (const sel of sels) {
      const base = await p.screenshot({ encoding: "base64", type: "png" });
      await p.evaluate((s) => {
        document.querySelectorAll(s).forEach((e) => (e.dataset.v = e.style.visibility));
        document.querySelectorAll(s).forEach((e) => (e.style.visibility = "hidden"));
      }, sel);
      const shot = await p.screenshot({ encoding: "base64", type: "png" });
      await p.evaluate(
        (s) =>
          document.querySelectorAll(s).forEach((e) => (e.style.visibility = e.dataset.v || "")),
        sel
      );
      const box = await p.evaluate(
        async (a, b, T) => {
          const load = (src) =>
            new Promise((r) => {
              const i = new Image();
              i.onload = () => r(i);
              i.src = "data:image/png;base64," + src;
            });
          const [A, B] = await Promise.all([load(a), load(b)]);
          const c = document.createElement("canvas");
          c.width = 1920;
          c.height = 1080;
          const x = c.getContext("2d");
          x.drawImage(A, 0, 0);
          const da = x.getImageData(0, 0, 1920, 1080).data;
          x.drawImage(B, 0, 0);
          const db = x.getImageData(0, 0, 1920, 1080).data;
          let x0 = 1e9,
            y0 = 1e9,
            x1 = -1,
            y1 = -1;
          for (let y = 0; y < 1080; y++)
            for (let X = 0; X < 1920; X++) {
              const i = (y * 1920 + X) * 4;
              if (
                Math.abs(da[i] - db[i]) +
                  Math.abs(da[i + 1] - db[i + 1]) +
                  Math.abs(da[i + 2] - db[i + 2]) >
                T
              ) {
                if (X < x0) x0 = X;
                if (X > x1) x1 = X;
                if (y < y0) y0 = y;
                if (y > y1) y1 = y;
              }
            }
          return x1 < 0 ? null : [x0, y0, x1, y1];
        },
        base,
        shot,
        THRESH
      );
      const base_y = await p.evaluate((s) => {
        const el = document.querySelector(s);
        if (!el) return null;
        const spans = [...el.querySelectorAll(".mask > span")];
        const host = spans.length ? spans[spans.length - 1] : el;
        if (
          host.tagName === "svg" ||
          el.tagName === "svg" ||
          (el.querySelector("svg") && !spans.length)
        )
          return null;
        const i = document.createElement("i");
        i.style.cssText = "display:inline-block;width:0;height:0;vertical-align:baseline";
        host.appendChild(i);
        const y = i.getBoundingClientRect().top;
        i.remove();
        return Math.round(y * 10) / 10;
      }, sel);
      out[name][sel] = box ? [...box, base_y] : null;
    }
  }
  console.log(JSON.stringify(out, null, 1));
  await b.close();
})();
