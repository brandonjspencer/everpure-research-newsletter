// Video build of the official Everpure hex mesh (packages/lib, unmodified) used as the scene
// transition: the next scene's colour builds across the frame as mesh cells, then one cell — a
// hexagon, arrow or diamond — becomes the window the next scene grows through. The library is
// clock-driven (gsap ticker, setInterval, performance.now); the video renderer replaces those
// clocks with a virtual one, so every frame is reproducible.
import { render } from "preact";
import { gsap } from "gsap";
import { CanvasHexMesh } from "./hex-mesh-main/packages/lib/src/CanvasHexMesh";
import { DEFAULT_MESH_CONFIG } from "./hex-mesh-main/packages/lib/src/core/meshConfig";
import { DEFAULT_NOISE_PARAMS } from "./hex-mesh-main/packages/lib/src/fields/noise";
import { DEFAULT_MOUSE_PARAMS } from "./hex-mesh-main/packages/lib/src/fields/mouseField";
import {
  getAllTriangles,
  getTriangleSideFromHeight,
} from "./hex-mesh-main/packages/lib/src/core/compute/shapes/triangle";
import {
  getAllDiamonds,
  diamondGeometry,
} from "./hex-mesh-main/packages/lib/src/core/compute/shapes/diamond";
import { hexagonGeometry } from "./hex-mesh-main/packages/lib/src/core/compute/shapes/hexagon";
import {
  arrowGeometry,
  getArrowBasedOnTwoDiamonds,
} from "./hex-mesh-main/packages/lib/src/core/compute/shapes/arrow";
import { buildVertexMap } from "./hex-mesh-main/packages/lib/src/core/compute/vertexMap";
import { clampRadiiByEdgeLength } from "./hex-mesh-main/packages/lib/src/render/animation/shapeVertsAtProgress";
import { angleBetween, rotateVertices } from "./hex-mesh-main/packages/lib/src/math";

type RGB = [number, number, number];
type Pt = { x: number; y: number };
type Grid = { vbWidth: number; vbHeight: number };
type Opts = Grid & {
  morphDuration: number;
  seed: number;
  /** Field added to the noise, in viewBox coords. Below the threshold = a cell builds. */
  field: (x: number, y: number) => number;
};

// The shapes' base orientations (render/animation/animationTypes.ts keeps these private).
const ARROW_BASE_AXIS = { x: 1, y: 0 };
const DIAMOND_BASE_AXIS = { x: 0, y: 1 };

function config(g: Grid, morphDuration: number) {
  return {
    ...DEFAULT_MESH_CONFIG,
    vbWidth: g.vbWidth,
    vbHeight: g.vbHeight,
    morphDuration,
    noiseLoopIntervalMs: 16,
    // Every hexagon the grid can form stays whole, so a hexagon window cell is always a true
    // hexagon (arrows and diamonds still appear wherever hexagons can't form).
    hexDecomposeChance: 0,
  };
}

function mount(host: HTMLElement, opts: Opts) {
  // Dispatch the ticker on every virtual frame (default caps at 240fps and can skip a step).
  gsap.ticker.fps(1000);
  gsap.ticker.lagSmoothing(0);
  let color: RGB = [1, 1, 1];
  let grid: Grid = { vbWidth: opts.vbWidth, vbHeight: opts.vbHeight };
  let resetKey = 0;
  const contributors = [{ enabled: true, sample: (x: number, y: number) => opts.field(x, y) }];
  const draw = () =>
    render(
      <CanvasHexMesh
        noiseParams={{ ...DEFAULT_NOISE_PARAMS, seed: opts.seed }}
        mouseParams={{ ...DEFAULT_MOUSE_PARAMS, enabled: false }}
        config={config(grid, opts.morphDuration)}
        contributors={contributors}
        meshColor={color}
        renderMode="cells"
        transitionSec={0}
        resetKey={resetKey}
      />,
      host
    );
  draw();
  return {
    /** Recolour and (optionally) re-grid between transitions, clearing every cell. */
    set(next: { color: RGB; vbWidth?: number; vbHeight?: number }) {
      color = next.color;
      if (next.vbWidth && next.vbHeight) grid = { vbWidth: next.vbWidth, vbHeight: next.vbHeight };
      resetKey += 1;
      draw();
    },
  };
}

/** Every cell the grid can form, with the exact ring a cells-mode paint fills (inner verts,
    corner radii after the painter's edge-length clamp), in viewBox units:
    hexagons (three diamonds round a vertex), arrows (two of them), and lone diamonds. */
function cells(g: Grid) {
  const { triangleHeight, strokeWidth } = DEFAULT_MESH_CONFIG;
  const triangles = getAllTriangles(g.vbWidth, g.vbHeight, triangleHeight);
  const diamonds = getAllDiamonds(triangles);
  const vertexMap = buildVertexMap(triangles);
  const side = getTriangleSideFromHeight(triangleHeight);
  const ring = (verts: Pt[], radii: number[]) => ({
    verts,
    radii: clampRadiiByEdgeLength(verts, radii),
  });
  const centroid = (pts: Pt[]) => ({
    x: pts.reduce((s, p) => s + p.x, 0) / pts.length,
    y: pts.reduce((s, p) => s + p.y, 0) / pts.length,
  });
  const hexagons = [];
  const arrows = [];
  for (const [key, ids] of vertexMap) {
    if (ids.length !== 3 || !ids.every((id) => diamonds[id])) continue;
    const ds = ids.map((id) => diamonds[id]);
    const center = centroid(ds.map((d) => d.center));
    const hex = hexagonGeometry(center.x, center.y, side, strokeWidth);
    hexagons.push({
      kind: "hexagon",
      key,
      center,
      diamondCenters: ds.map((d) => d.center),
      ...ring(hex.innerVerts, hex.innerRadii),
    });
    for (const [i, j] of [
      [0, 1],
      [0, 2],
      [1, 2],
    ]) {
      const a = getArrowBasedOnTwoDiamonds(key, ds[i], ds[j], side, triangleHeight);
      const geo = arrowGeometry(a.notchPoint.x, a.notchPoint.y, side, strokeWidth);
      const verts = rotateVertices(
        geo.innerVerts,
        a.notchPoint,
        angleBetween(ARROW_BASE_AXIS, a.unitVector)
      );
      arrows.push({
        kind: "arrow",
        key,
        center: centroid(verts),
        direction: a.unitVector,
        diamondCenters: [ds[i].center, ds[j].center],
        ...ring(verts, geo.innerRadii),
      });
    }
  }
  const lone = Object.values(diamonds).map((d) => {
    const geo = diamondGeometry(d.center.x, d.center.y, triangleHeight, strokeWidth);
    const verts = rotateVertices(
      geo.innerVerts,
      d.center,
      angleBetween(DIAMOND_BASE_AXIS, d.unitVector)
    );
    return {
      kind: "diamond",
      key: d.id,
      center: d.center,
      direction: d.unitVector,
      diamondCenters: [d.center],
      ...ring(verts, geo.innerRadii),
    };
  });
  return { hexagon: hexagons, arrow: arrows, diamond: lone };
}

(window as unknown as { VideoMesh: unknown }).VideoMesh = { mount, cells };
