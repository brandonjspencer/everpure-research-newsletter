# Research Roundup video

The monthly motion-graphics recap: a 16:9, 1080p60 video for LinkedIn/Instagram that is also embedded at
the top of the newsletter's Roundup band (`roundup_video` in `netlify/content/default-*.json`, files in
`static/media/`). October 2026 (Issue 07) is the reference build: 43.2s, seven scenes, seven mesh
transitions.

It is a web page animated with GSAP and rendered frame by frame through headless Chrome, so the type is
the real brand typeface and every frame is reproducible.

## Files

| Path                   | What                                                                                                                                 |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `index.html`           | The scene page: markup + CSS per scene, the GSAP timeline, the mesh transitions, the layout table                                    |
| `render.js`            | Deterministic renderer (stills, full frame sequence, per-frame hashes)                                                               |
| `vclock.js`            | Virtual clock injected before any page script — timers, `requestAnimationFrame`, `performance.now`, `Date.now`, seeded `Math.random` |
| `video-mesh.min.js`    | The official Everpure hex mesh (`pure-dtg/hex-mesh`, library unmodified) bundled for the video                                       |
| `mesh/video-entry.tsx` | Source of that bundle (adds per-transition re-gridding and the exact cell geometry of every hexagon, arrow and diamond)              |
| `tools/`               | Layout measurement and verification (below)                                                                                          |

## Setup

- `cd video && npm ci` (GSAP 3, puppeteer-core).
- Google Chrome at `/Applications/Google Chrome.app` (`CHROME` in `render.js`).
- Pure Sans installed locally (the renderer prints a font check; it must say `true`).
- ffmpeg.

## Render

```bash
cd video
node render.js stills out/stills 2.0,5.4,9.9      # PNG stills at those times
node render.js frames frames 480 8                # full sequence: 480fps JPEGs, 8 workers (~20 min)
node render.js hash 60 150 205                    # md5 per output frame — run twice to prove determinism
```

Encode (music is the edited WAV — see "Music"):

```bash
ffmpeg -framerate 480 -i frames/%05d.jpg -i music_edit.wav \
  -filter_complex "[0:v]tmix=frames=8:weights='1 1 1 1 1 1 1 1',fps=60,scale=in_range=pc:out_range=tv:in_color_matrix=bt601:out_color_matrix=bt709,format=yuv420p[v];[1:a]volume=-2.5dB[a]" \
  -map "[v]" -map "[a]" -c:v libx264 -preset slow -tune animation -crf 14 -profile:v high -level 4.2 \
  -pix_fmt yuv420p -colorspace bt709 -color_primaries bt709 -color_trc bt709 -color_range tv \
  -c:a aac -b:a 320k -ar 48000 -shortest -movflags +faststart master.mp4
# web copy for the newsletter — must stay under the repo's 4 MB pre-commit limit
ffmpeg -i master.mp4 -c:v libx264 -preset veryslow -tune animation -crf 25 -maxrate 4M -bufsize 8M \
  -profile:v high -level 4.2 -pix_fmt yuv420p -colorspace bt709 -color_primaries bt709 -color_trc bt709 \
  -color_range tv -c:a aac -b:a 128k -movflags +faststart web.mp4
ffmpeg -ss 1.25 -i master.mp4 -frames:v 1 -q:v 3 poster.jpg
```

Copy `web.mp4` / `poster.jpg` to `static/media/research-roundup-YYYY-MM{,-poster}.{mp4,jpg}` and point
`roundup_video` at `../media/…`. Send the master to the editor for social.

## How the page works

- **Beat grid.** Everything is timed to the music: `DB(k) = 1.651 + k·BAR` (145 BPM). `T` holds each
  scene's cut (a downbeat or half-bar); scene holds are set so every scene keeps ~2–3s of fully landed
  text before it exits.
- **Determinism.** `render.js` steps the virtual clock on a 480fps grid from t=0 in every worker (the
  mesh carries state frame to frame) and screenshots only its own slice. The GSAP timeline is seeked to
  the same time on each step. `node render.js hash` twice → identical output.
- **Motion blur.** 8 subframes per 60fps frame (`tmix=8`). ffmpeg builds output frame n from subframes
  8n−4…8n+3, so count-ups are quantized to that grid (`countUp()`), or digits ghost.
- **Transitions** (`TR` table): the official mesh, cells form, builds across the frame in the next
  scene's colour. Each cut has its own recipe — `px` (cell scale), `dir` (sweep), `sweep`/`grow`
  (pacing), and a `hero` (`hexagon`/`arrow`/`diamond`, a target spot, a preferred direction). The hero's
  diamonds enter the field one tick before the sweep so the library merges them into exactly that shape
  (`hexDecomposeChance: 0`); the grid is offset so the hero's centre lands on its spot. On the downbeat
  the next scene, clipped (`clip-path`) to the hero cell's exact outline, takes its place and builds in
  while the cell grows past the frame. The outgoing copy exits before any cell arrives; a blur-and-
  threshold "backing" keeps the gaps between cells in the outgoing colour.
- **Layout** (`LAYOUT`, `LAYOUT_REL`, `EYEBROW_GLIDE`): solved from measured ink, not eyeballed — one
  spacing system (baseline → next ink top: eyebrow→hero 72, numeral→line 88, numeral→bars 96,
  numeral→labels 56, headline→bars 112, →takeaway 104–120), every block centred on y 532, every line's
  ink on the 168px margin, opening quotes hung.

## Making next month's

1. **Copy.** Edit the scene markup (eyebrows, figures, lines, takeaways). Every claim must trace to the
   issue's sourced findings; numbers under ten spelled out; en dashes for ranges; tracking untouched.
2. **Music.** Source: the editor-supplied "tv-news-theme" pack, `short-02` (licensed — not committed).
   Lengthen or shorten with bar-aligned edits (4-bar repeats/cuts found by comparing bar spectra), 30ms
   equal-power crossfades on the downbeats, `loudnorm=I=-14`, then `-2.5dB` at encode. October:
   bars 0–12 | 9–13 | 10–end = 43.24s, final hit on `DB(23)`.
3. **Timing.** Re-time `T`, `DUR`, pulses and `TR` to the new edit.
4. **Layout.** `node tools/probe_ink.js tools/ink_plan.json --raw > tools/ink_report.json`, then
   `python3 tools/solve_layout.py tools/ink_report.json` and paste the tables into `index.html`. Re-run
   without `--raw` to confirm the gaps (use `--threshold 120` for low-contrast text).
5. **Verify.** `node tools/probe_handover.js '[…cut times…]' out/handover` (the window replacing its cell
   should change ~nothing), `node tools/probe_cover.js` (every hand-off `IDENTICAL`), and contact sheets of
   stills (`tools/sheet.sh out/stills out/sheet.png 4`) for each transition and scene.
6. **Render, encode, publish** as above.

## Rebuilding the mesh bundle

`mesh/video-entry.tsx` imports the hex-mesh library source (snapshot `hex-mesh-main/`, see
`static/vendor/README.md`). From a folder holding both:

```bash
npx esbuild video-entry.tsx --bundle --minify --format=iife --target=es2019 --platform=browser \
  --jsx=automatic --alias:react=preact/compat --alias:react-dom=preact/compat \
  --alias:react/jsx-runtime=preact/jsx-runtime --legal-comments=eof --outfile=video-mesh.min.js
```

## Pitfalls this build hit

- Arrows are concave: test the hero window's coverage over a dense grid of points, not just the frame
  corners.
- Toggling elements re-rasterises text, so ink measurement takes a fresh base screenshot per element and
  a high diff threshold.
- Frozen issues are copies of `/newsletter/` one level deeper; `publish_issue_archives.js` re-points the
  video's `../media/` path for the archive.
- Eyebrows are toned per ground to clear 3:1 (Pure Orange 300 on Basil, 700 on Stone and Rose).
