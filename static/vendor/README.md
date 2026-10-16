# static/vendor — prebuilt client scripts (copied to `publish/vendor/` by `netlify/build.sh`)

Committed, pinned, and served from the site root so pages (including frozen issue archives,
which reference `../vendor/…`) never depend on a CDN or a JS build step. Nothing here is built
by `build.sh`; replace a file deliberately and bump its name/notes below.

| File                    | What                                                                                                                                                     | Source / license                                             |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `motion-11.18.2.min.js` | Motion (formerly Framer Motion), vanilla UMD build — `window.Motion`                                                                                     | `motion@11.18.2` `dist/motion.js`, MIT (`motion-LICENSE.md`) |
| `site-motion.js`        | Site motion layer: scroll reveals, count-ups, bar growth, pointer springs. Loaded by `dashboard_theme.motionHead()`                                      | This repo (hand-written)                                     |
| `hex-mesh-hero.min.js`  | The official Everpure hex mesh, mounted behind the newsletter hero — `window.EverpureHexMesh.mount(host, { color, opacity, scale, clear, eventTarget })` | See below                                                    |

## hex-mesh-hero.min.js

The mesh is the design team's `hex-mesh` library (`packages/lib/src`, **unmodified**; GitHub
`pure-dtg/hex-mesh`, snapshot supplied as `hex-mesh-main.zip` on 2026-10-16). It is a React canvas
component, so it is bundled once into a self-contained island with **Preact** standing in for React
(no React/Vite build path enters this repo). Third-party code inside: `preact@10` (MIT),
`gsap@3` (GSAP standard license), `simplex-noise@4` (MIT); legal comments are kept at the end of the
file.

What the mount adds on top of the library: a fresh random noise seed per page load (a different mesh
every visit), a `scale` zoom (the hero uses `scale: 2`), an optional soft keep-clear zone (`clear`,
normalized `x`/`y`/`rx`/`ry` plus `strength`, added to the field through the library's `contributors`
hook so fewer hexes build there), pointer forwarding from the whole hero to the
canvas (the hero text sits above it), freezing the field while the hero is off screen, and
`prefers-reduced-motion` support (static mesh, no pointer response).

Rebuild (from a checkout of `hex-mesh-main/` next to the entry file):

```sh
npm install esbuild@0.24 preact@10 gsap@3 simplex-noise@4
npx esbuild hero-entry.tsx --bundle --minify --format=iife --target=es2019 --platform=browser \
  --jsx=automatic --alias:react=preact/compat --alias:react-dom=preact/compat \
  --alias:react/jsx-runtime=preact/jsx-runtime --legal-comments=eof --outfile=hex-mesh-hero.min.js
```

`hero-entry.tsx`:

```tsx
// Mounts the official Everpure hex-mesh canvas (packages/lib, unmodified) as a self-contained
// background island for a page hero: window.EverpureHexMesh.mount(host, { color, opacity }).
import { render } from "preact";
import { CanvasHexMesh } from "./hex-mesh-main/packages/lib/src/CanvasHexMesh";
import { DEFAULT_MESH_CONFIG } from "./hex-mesh-main/packages/lib/src/core/meshConfig";
import { DEFAULT_NOISE_PARAMS } from "./hex-mesh-main/packages/lib/src/fields/noise";
import { DEFAULT_MOUSE_PARAMS } from "./hex-mesh-main/packages/lib/src/fields/mouseField";

type Opts = {
  color: [number, number, number];
  opacity?: number;
  /** Visual zoom: 2 draws every hexagon, line and cursor bump at twice the size. */
  scale?: number;
  /** Soft keep-clear zone (normalized 0..1 coords): a Gaussian lift added to the field so fewer
      hexes build there — they can still drift in, and the cursor can still pull them. */
  clear?: { x: number; y: number; rx: number; ry: number; strength: number };
  eventTarget?: HTMLElement;
};

function mount(host: HTMLElement, opts: Opts) {
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const rect = host.getBoundingClientRect();
  const vbWidth = Math.round(1280 / (opts.scale || 1));
  const vbHeight = Math.max(
    Math.round(360 / (opts.scale || 1)),
    Math.round((vbWidth * rect.height) / Math.max(1, rect.width))
  );
  // A fresh seed on every load, so each visit draws a different mesh.
  const seed = Math.floor(Math.random() * 2147483646) + 1;
  const config = {
    ...DEFAULT_MESH_CONFIG,
    vbWidth,
    vbHeight,
    morphDuration: reduce ? 0.001 : DEFAULT_MESH_CONFIG.morphDuration,
  };

  const clear = opts.clear;
  const contributors = clear
    ? [
        {
          enabled: true,
          sample: (x: number, y: number) => {
            const dx = (x / vbWidth - clear.x) / clear.rx;
            const dy = (y / vbHeight - clear.y) / clear.ry;
            return clear.strength * Math.exp(-0.5 * (dx * dx + dy * dy));
          },
        },
      ]
    : [];

  const draw = (live: boolean) =>
    render(
      <CanvasHexMesh
        noiseParams={{
          ...DEFAULT_NOISE_PARAMS,
          seed,
          timeSpeed: live && !reduce ? DEFAULT_NOISE_PARAMS.timeSpeed : 0,
        }}
        mouseParams={{ ...DEFAULT_MOUSE_PARAMS, enabled: live && !reduce }}
        config={config}
        contributors={contributors}
        meshColor={opts.color}
        transitionSec={0}
        canvasStyle={{ opacity: opts.opacity ?? 1, pointerEvents: "auto" }}
      />,
      host
    );
  draw(true);

  // The hero's text sits above the canvas, so forward pointer moves from the whole hero.
  const canvas = host.querySelector("canvas");
  const target = opts.eventTarget || host.parentElement || host;
  if (canvas && !reduce) {
    target.addEventListener("mousemove", (e: MouseEvent) => {
      if (e.target === canvas) return;
      canvas.dispatchEvent(
        new MouseEvent("mousemove", { clientX: e.clientX, clientY: e.clientY, bubbles: true })
      );
    });
  }

  // Freeze the field while the hero is off screen; resume when it scrolls back.
  if ("IntersectionObserver" in window && !reduce) {
    let live = true;
    new IntersectionObserver((entries) => {
      const visible = entries.some((en) => en.isIntersecting);
      if (visible !== live) {
        live = visible;
        draw(live);
      }
    }).observe(host);
  }
}

(window as unknown as { EverpureHexMesh: unknown }).EverpureHexMesh = { mount };
```
