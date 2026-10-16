// Deterministic frame renderer. The page runs on a virtual clock (vclock.js) and is stepped
// frame by frame from t=0 — the hex-mesh transitions carry state, so every worker steps the
// whole timeline and only screenshots its own slice.
// Usage:
//   node render.js stills <outDir> 1.2,4.3,...      -> PNG stills at those times
//   node render.js frames <outDir> 480 [workers]    -> JPEG sequence 00000.jpg..
//   node render.js hash <fps> <from> <to>           -> print a hash per frame (determinism check)
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const puppeteer = require("puppeteer-core");

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PAGE = "file://" + path.join(__dirname, "index.html");
const VCLOCK = fs.readFileSync(path.join(__dirname, "vclock.js"), "utf8");
const STEP_FPS = 480; // the clock always advances on the 480fps grid (8 motion-blur samples per 60fps frame)

async function openPage(browser) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
  page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning") console.error("[page]", m.text());
  });
  page.on("pageerror", (e) => console.error("[pageerror]", String(e && (e.stack || e))));
  await page.evaluateOnNewDocument(VCLOCK);
  await page.goto(PAGE, { waitUntil: "load" });
  await page.evaluate(() => window.__ready);
  const fontOk = await page.evaluate(() => document.fonts.check("800 100px 'Pure Sans'"));
  return { page, fontOk };
}

const stepTo = (page, f) => page.evaluate((x) => window.__stepTo(x), f / STEP_FPS);

async function main() {
  const [mode, a1, a2, a3] = process.argv.slice(2);
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: [
      "--allow-file-access-from-files",
      "--force-color-profile=srgb",
      "--hide-scrollbars",
      "--disable-lcd-text",
    ],
  });
  try {
    if (mode === "stills") {
      fs.mkdirSync(a1, { recursive: true });
      const { page, fontOk } = await openPage(browser);
      console.log("font check Pure Sans 800:", fontOk);
      const want = a2
        .split(",")
        .map(Number)
        .sort((x, y) => x - y);
      let f = 0;
      for (const t of want) {
        const target = Math.round(t * STEP_FPS);
        for (; f <= target; f++) await stepTo(page, f);
        await page.screenshot({ path: path.join(a1, `t${t.toFixed(2)}.png`) });
      }
      return;
    }
    if (mode === "hash") {
      const fps = Number(a1),
        from = Number(a2),
        to = Number(a3);
      const { page } = await openPage(browser);
      const every = STEP_FPS / fps;
      for (let f = 0; f <= to * every; f++) {
        await stepTo(page, f);
        if (f % every === 0 && f / every >= from) {
          const buf = await page.screenshot({ type: "png" });
          console.log(f / every, crypto.createHash("md5").update(buf).digest("hex"));
        }
      }
      return;
    }
    fs.mkdirSync(a1, { recursive: true });
    const fps = Number(a2);
    if (fps !== STEP_FPS) throw new Error(`frames mode renders on the ${STEP_FPS}fps grid`);
    const workers = Number(a3 || 6);
    const { page: probe } = await openPage(browser);
    const dur = await probe.evaluate(() => window.__duration);
    await probe.close();
    const total = Math.round(dur * fps);
    const per = Math.ceil(total / workers);
    const t0 = Date.now();
    let done = 0;
    await Promise.all(
      Array.from({ length: workers }, async (_, w) => {
        const { page } = await openPage(browser);
        const start = w * per;
        const end = Math.min(total, start + per);
        for (let f = 0; f < end; f++) {
          await stepTo(page, f);
          if (f < start) continue;
          await page.screenshot({
            path: path.join(a1, String(f).padStart(5, "0") + ".jpg"),
            type: "jpeg",
            quality: 96,
            optimizeForSpeed: true,
          });
          if (++done % 400 === 0)
            console.log(`${done}/${total} frames, ${((Date.now() - t0) / 1000).toFixed(0)}s`);
        }
      })
    );
    console.log(
      `rendered ${total} frames at ${fps}fps in ${((Date.now() - t0) / 1000).toFixed(0)}s`
    );
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
