/**
 * doodle.ts — 2D doodle (hand-drawn) texture factory.
 * Every visual asset is drawn procedurally on canvas:
 * guns, shells, dice, skill icons, the enemy, particles, walls, etc.
 * Deterministic: every texture uses a fixed seed so nothing flickers.
 */

export type SkillId =
  | "reroll"
  | "voodoo"
  | "peek"
  | "eject"
  | "coffee"
  | "cuffs";

export const SKILL_IDS: SkillId[] = [
  "reroll",
  "voodoo",
  "peek",
  "eject",
  "coffee",
  "cuffs",
];

export const SKILL_META: Record<
  SkillId,
  { name: string; tag: string; desc: string; color: string }
> = {
  reroll: {
    name: "REROLL",
    tag: "Reweave fate",
    desc: "Rerandomize the chamber ONCE, then you MUST shoot this turn. 2-turn cooldown.",
    color: "#d9a441",
  },
  voodoo: {
    name: "VOODOO",
    tag: "2-turn curse",
    desc: "1x per game, lasts 2 turns: ANY live hit you would take is REFLECTED to the enemy — even a bullet from your own gun. Curse: shooting yourself with a BLANK rerolls the shell and forces one shot at the enemy.",
    color: "#5e9c5b",
  },
  peek: {
    name: "PEEK",
    tag: "Inspect the chamber",
    desc: "Look at the current shell (LIVE or BLANK). 3-turn cooldown.",
    color: "#7fb4c9",
  },
  eject: {
    name: "EJECT",
    tag: "Toss a shell",
    desc: "Eject the chambered shell without firing. Free action, 3-turn cooldown.",
    color: "#b08968",
  },
  coffee: {
    name: "COFFEE",
    tag: "+1 HP",
    desc: "Sip some hot coffee, restore 1 HP (up to max). Usable 2x per game.",
    color: "#c98a4b",
  },
  cuffs: {
    name: "CUFFS",
    tag: "Freeze the enemy",
    desc: "The enemy skips their next turn. Usable 1x per game.",
    color: "#9b8ec4",
  },
};

/* ============================ core helpers ============================ */

export type RNG = () => number;

export function mulberry32(seed: number): RNG {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const INK = "#221a12";
const PAPER = "#f6f1e3";
const RED = "#c73e2e";
const RED_DARK = "#8f2418";
const BLANK_BLUE = "#7d8fa3";
const BRASS = "#c9a227";

const cache = new Map<string, HTMLCanvasElement>();
const dataCache = new Map<string, string>();

export function makeCanvas(
  key: string,
  w: number,
  h: number,
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number, rng: RNG) => void,
  seed = 1,
): HTMLCanvasElement {
  const hit = cache.get(key);
  if (hit) return hit;
  const cv = document.createElement("canvas");
  cv.width = w;
  cv.height = h;
  const ctx = cv.getContext("2d")!;
  draw(ctx, w, h, mulberry32(seed));
  cache.set(key, cv);
  return cv;
}

export function dataURL(key: string, cv: HTMLCanvasElement): string {
  const hit = dataCache.get(key);
  if (hit) return hit;
  const url = cv.toDataURL("image/png");
  dataCache.set(key, url);
  return url;
}

function wobblePath(
  ctx: CanvasRenderingContext2D,
  pts: [number, number][],
  rng: RNG,
  jitter = 3,
  close = false,
) {
  // subdivide
  const dense: [number, number][] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[i + 1];
    const d = Math.hypot(x2 - x1, y2 - y1);
    const n = Math.max(2, Math.round(d / 16));
    for (let k = 0; k < n; k++) {
      const t = k / n;
      dense.push([x1 + (x2 - x1) * t, y1 + (y2 - y1) * t]);
    }
  }
  dense.push(pts[pts.length - 1]);
  // jitter
  const j = dense.map(([x, y]) => [
    x + (rng() - 0.5) * jitter * 2,
    y + (rng() - 0.5) * jitter * 2,
  ]) as [number, number][];
  ctx.beginPath();
  ctx.moveTo(j[0][0], j[0][1]);
  for (let i = 1; i < j.length - 1; i++) {
    const mx = (j[i][0] + j[i + 1][0]) / 2;
    const my = (j[i][1] + j[i + 1][1]) / 2;
    ctx.quadraticCurveTo(j[i][0], j[i][1], mx, my);
  }
  const last = j[j.length - 1];
  ctx.lineTo(last[0], last[1]);
  if (close) ctx.closePath();
}

interface StrokeOpts {
  width?: number;
  jitter?: number;
  close?: boolean;
  color?: string;
  passes?: number;
}

function sketchStroke(
  ctx: CanvasRenderingContext2D,
  pts: [number, number][],
  rng: RNG,
  opts: StrokeOpts = {},
) {
  const { width = 6, jitter = 3, close = false, color = INK, passes = 2 } = opts;
  ctx.strokeStyle = color;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (let p = 0; p < passes; p++) {
    ctx.globalAlpha = p === 0 ? 1 : 0.35;
    ctx.lineWidth = p === 0 ? width : width * 0.7;
    wobblePath(ctx, pts, rng, jitter, close);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

function sketchLine(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  rng: RNG,
  opts?: { width?: number; jitter?: number; color?: string },
) {
  sketchStroke(ctx, [[x1, y1], [x2, y2]], rng, opts);
}

function sketchCircle(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  rng: RNG,
  opts: { width?: number; jitter?: number; color?: string; fill?: string; passes?: number } = {},
) {
  if (opts.fill && r > 0.5) {
    ctx.fillStyle = opts.fill;
    ctx.beginPath();
    ctx.ellipse(cx, cy, r, r * (0.97 + rng() * 0.05), rng() * 0.2, 0, Math.PI * 2);
    ctx.fill();
  }
  if (r < 0.5) return;
  const pts: [number, number][] = [];
  const n = Math.max(10, Math.round(r / 3));
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  sketchStroke(ctx, pts, rng, { ...opts, close: true });
}

function sketchEllipse(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  rng: RNG,
  opts: { width?: number; jitter?: number; fill?: string; rot?: number } = {},
) {
  if (opts.fill) {
    ctx.fillStyle = opts.fill;
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, opts.rot ?? 0, 0, Math.PI * 2);
    ctx.fill();
  }
  const pts: [number, number][] = [];
  const n = Math.max(10, Math.round((rx + ry) / 4));
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    const x = cx + Math.cos(a) * rx;
    const y = cy + Math.sin(a) * ry;
    const c = Math.cos(opts.rot ?? 0);
    const s = Math.sin(opts.rot ?? 0);
    pts.push([cx + (x - cx) * c - (y - cy) * s, cy + (x - cx) * s + (y - cy) * c]);
  }
  sketchStroke(ctx, pts, rng, { ...opts, close: true });
}

function hatch(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  rng: RNG,
  color = "rgba(34,26,18,0.5)",
  gap = 9,
) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  for (let i = -h; i < w; i += gap) {
    ctx.beginPath();
    ctx.moveTo(x + i + (rng() - 0.5) * 3, y + h + (rng() - 0.5) * 3);
    ctx.lineTo(x + i + h + (rng() - 0.5) * 3, y + (rng() - 0.5) * 3);
    ctx.stroke();
  }
  ctx.restore();
}

function handText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  size: number,
  color = INK,
  rot = 0,
  font = '"Permanent Marker", cursive',
) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.font = `${size}px ${font}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = color;
  ctx.fillText(text, 0, 0);
  ctx.restore();
}

/* ============================ GUNS ============================ */

/** Revolver from behind — first person aiming at the enemy (big centered muzzle). */
export function texGunAimEnemy() {
  return makeCanvas(
    "gun-aim-enemy",
    1024,
    768,
    (ctx, w, h, rng) => {
      const cx = w / 2;
      // silinder (cylinder) bulat di belakang muzzle
      sketchCircle(ctx, cx, 430, 190, rng, { width: 9, fill: "#3a3129" });
      sketchCircle(ctx, cx, 430, 150, rng, { width: 8, fill: "#4a4036" });
      // chamber holes
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2 - Math.PI / 2 + 0.3;
        sketchCircle(ctx, cx + Math.cos(a) * 84, 430 + Math.sin(a) * 84, 34, rng, {
          width: 5,
          fill: "#241d16",
        });
      }
      // rangka barrel dari cylinder ke muzzle
      sketchStroke(
        ctx,
        [
          [cx - muzzleR() - 26, 402],
          [cx - 92, 380],
        ],
        rng,
        { width: 10, color: "#3a3129" },
      );
      sketchStroke(
        ctx,
        [
          [cx + muzzleR() + 26, 402],
          [cx + 92, 380],
        ],
        rng,
        { width: 10, color: "#3a3129" },
      );
      // muzzle ring besar
      const mr = 118;
      sketchCircle(ctx, cx, 396, mr, rng, { width: 13, fill: "#18130e" });
      sketchCircle(ctx, cx, 396, mr * 0.62, rng, { width: 9, color: "#0d0a07" });
      ctx.fillStyle = "#0a0805";
      ctx.beginPath();
      ctx.ellipse(cx, 396, mr * 0.58, mr * 0.55, 0, 0, Math.PI * 2);
      ctx.fill();
      // spiral rifling
      ctx.strokeStyle = "rgba(246,241,227,0.12)";
      ctx.lineWidth = 6;
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.ellipse(cx, 396, mr * 0.3 + i * 24, mr * 0.28 + i * 22, 0.4, 0, Math.PI * 2);
        ctx.stroke();
      }
      // front sight
      sketchStroke(
        ctx,
        [
          [cx, 396 - mr - 4],
          [cx, 396 - mr - 52],
        ],
        rng,
        { width: 10, color: "#3a3129" },
      );
      sketchStroke(
        ctx,
        [
          [cx - 16, 396 - mr - 52],
          [cx + 16, 396 - mr - 52],
        ],
        rng,
        { width: 9, color: "#3a3129" },
      );
      // hammer di atas
      sketchStroke(
        ctx,
        [
          [cx + 40, 258],
          [cx + 78, 196],
          [cx + 122, 216],
        ],
        rng,
        { width: 11, color: "#3a3129" },
      );
      // tangan doodle menggenggam dari bawah
      ctx.fillStyle = PAPER;
      wobblePath(
        ctx,
        [
          [cx + 150, 768],
          [cx + 180, 620],
          [cx + 120, 560],
          [cx + 60, 540],
          [cx + 20, 600],
          [cx - 10, 768],
        ],
        rng,
        4,
        true,
      );
      ctx.fill();
      sketchStroke(
        ctx,
        [
          [cx + 150, 768],
          [cx + 180, 620],
          [cx + 120, 560],
          [cx + 60, 540],
          [cx + 20, 600],
          [cx - 10, 768],
        ],
        rng,
        { width: 8, jitter: 4, close: true },
      );
      for (let i = 0; i < 3; i++) {
        sketchStroke(
          ctx,
          [
            [cx + 30 + i * 46, 560 + i * 6],
            [cx + 52 + i * 46, 620 + i * 4],
            [cx + 34 + i * 46, 668],
          ],
          rng,
          { width: 6, jitter: 2 },
        );
      }
      // trigger guard
      sketchStroke(
        ctx,
        [
          [cx - 96, 520],
          [cx - 130, 570],
          [cx - 80, 606],
        ],
        rng,
        { width: 8, color: "#3a3129" },
      );
      // hatch shading
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(cx, 430, 190, 190, 0, Math.PI * 0.7, Math.PI * 1.55);
      ctx.clip();
      hatch(ctx, cx - 200, 240, 120, 380, rng, "rgba(0,0,0,0.35)", 10);
      ctx.restore();

      function muzzleR() {
        return 118;
      }
    },
    7,
  );
}

/** Revolver samping mengarah ke kepala sendiri. */
export function texGunAimSelf() {
  return makeCanvas(
    "gun-aim-self",
    900,
    768,
    (ctx, w, h, rng) => {
      const cx = 430;
      const cy = 380;
      // barrel ke kanan
      ctx.fillStyle = "#3a3129";
      wobblePath(
        ctx,
        [
          [cx - 30, cy - 36],
          [cx + 332, cy - 32],
          [cx + 332, cy + 32],
          [cx - 30, cy + 36],
        ],
        rng,
        3,
        true,
      );
      ctx.fill();
      sketchStroke(
        ctx,
        [
          [cx - 30, cy - 36],
          [cx + 332, cy - 32],
          [cx + 332, cy + 32],
          [cx - 30, cy + 36],
        ],
        rng,
        { width: 8, jitter: 3, close: true },
      );
      // front sight
      sketchStroke(
        ctx,
        [
          [cx + 316, cy - 34],
          [cx + 320, cy - 74],
        ],
        rng,
        { width: 8 },
      );
      // cylinder
      sketchCircle(ctx, cx, cy, 104, rng, { width: 9, fill: "#4a4036" });
      sketchCircle(ctx, cx - 34, cy - 22, 30, rng, { width: 5, fill: "#241d16" });
      sketchCircle(ctx, cx + 40, cy + 8, 30, rng, { width: 5, fill: "#241d16" });
      // frame atas
      sketchStroke(
        ctx,
        [
          [cx - 150, cy - 88],
          [cx - 30, cy - 96],
        ],
        rng,
        { width: 9 },
      );
      // hammer
      sketchStroke(
        ctx,
        [
          [cx - 120, cy - 92],
          [cx - 148, cy - 168],
          [cx - 96, cy - 180],
        ],
        rng,
        { width: 10 },
      );
      // grip + tangan
      ctx.fillStyle = PAPER;
      wobblePath(
        ctx,
        [
          [cx - 120, cy + 40],
          [cx - 210, cy + 120],
          [cx - 250, cy + 260],
          [cx - 160, cy + 300],
          [cx - 70, cy + 210],
          [cx - 66, cy + 60],
        ],
        rng,
        4,
        true,
      );
      ctx.fill();
      sketchStroke(
        ctx,
        [
          [cx - 120, cy + 40],
          [cx - 210, cy + 120],
          [cx - 250, cy + 260],
          [cx - 160, cy + 300],
          [cx - 70, cy + 210],
          [cx - 66, cy + 60],
        ],
        rng,
        { width: 8, jitter: 4, close: true },
      );
      for (let i = 0; i < 3; i++) {
        sketchStroke(
          ctx,
          [
            [cx - 200 + i * 10, cy + 150 + i * 44],
            [cx - 130 + i * 8, cy + 160 + i * 44],
          ],
          rng,
          { width: 6, jitter: 2 },
        );
      }
      // trigger guard
      sketchEllipse(ctx, cx - 60, cy + 66, 52, 40, rng, { width: 8 });
      hatch(ctx, cx - 260, cy + 130, 110, 170, rng, "rgba(0,0,0,0.25)", 10);
      handText(ctx, "?!", cx + 150, cy - 120, 44, RED, -0.2);
    },
    11,
  );
}

/** Revolver samping untuk props di meja. */
export function texGunTable() {
  return makeCanvas(
    "gun-table",
    768,
    512,
    (ctx, w, h, rng) => {
      const cx = w / 2;
      const cy = h / 2 + 20;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(-0.08);
      ctx.fillStyle = "#3a3129";
      wobblePath(ctx, [[60, -28], [302, -24], [302, 24], [60, 28]], rng, 3, true);
      ctx.fill();
      sketchStroke(ctx, [[60, -28], [302, -24], [302, 24], [60, 28]], rng, {
        width: 7,
        jitter: 3,
        close: true,
      });
      sketchStroke(ctx, [[286, -26], [290, -62]], rng, { width: 7 });
      sketchCircle(ctx, 0, 0, 78, rng, { width: 8, fill: "#4a4036" });
      sketchCircle(ctx, -26, -14, 22, rng, { width: 4, fill: "#241d16" });
      sketchCircle(ctx, 30, 6, 22, rng, { width: 4, fill: "#241d16" });
      sketchStroke(ctx, [[-110, -66], [-20, -72]], rng, { width: 8 });
      sketchStroke(ctx, [[-90, -70], [-118, -128], [-70, -140]], rng, { width: 8 });
      ctx.fillStyle = "#6b4a2f";
      wobblePath(ctx, [[-90, 30], [-160, 90], [-186, 190], [-110, 214], [-50, 150], [-46, 40]], rng, 4, true);
      ctx.fill();
      sketchStroke(ctx, [[-90, 30], [-160, 90], [-186, 190], [-110, 214], [-50, 150], [-46, 40]], rng, {
        width: 8,
        jitter: 4,
        close: true,
      });
      hatch(ctx, -180, 100, 120, 110, rng, "rgba(0,0,0,0.3)", 9);
      sketchEllipse(ctx, -30, 52, 40, 30, rng, { width: 7 });
      ctx.restore();
      ctx.fillStyle = "rgba(0,0,0,0.35)";
      ctx.beginPath();
      ctx.ellipse(cx, cy + 190, 210, 26, 0, 0, Math.PI * 2);
      ctx.fill();
    },
    21,
  );
}

/** Revolver dengan cylinder terbuka (reload). */
export function texGunOpen() {
  return makeCanvas(
    "gun-open",
    768,
    512,
    (ctx, w, h, rng) => {
      const cx = w / 2;
      const cy = h / 2 + 10;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(0.06);
      ctx.fillStyle = "#3a3129";
      wobblePath(ctx, [[60, -28], [302, -24], [302, 24], [60, 28]], rng, 3, true);
      ctx.fill();
      sketchStroke(ctx, [[60, -28], [302, -24], [302, 24], [60, 28]], rng, {
        width: 7,
        jitter: 3,
        close: true,
      });
      sketchStroke(ctx, [[286, -26], [290, -62]], rng, { width: 7 });
      sketchEllipse(ctx, -150, 0, 88, 74, rng, { width: 8, fill: "#4a4036", rot: -0.35 });
      sketchCircle(ctx, -190, -34, 26, rng, { width: 5, fill: "#241d16" });
      sketchCircle(ctx, -168, 22, 26, rng, { width: 5, fill: "#241d16" });
      sketchCircle(ctx, -110, -2, 26, rng, { width: 5, fill: "#241d16" });
      ctx.fillStyle = "#6b4a2f";
      wobblePath(ctx, [[-60, 40], [-130, 100], [-156, 200], [-80, 224], [-20, 160], [-16, 50]], rng, 4, true);
      ctx.fill();
      sketchStroke(ctx, [[-60, 40], [-130, 100], [-156, 200], [-80, 224], [-20, 160], [-16, 50]], rng, {
        width: 8,
        jitter: 4,
        close: true,
      });
      ctx.restore();
    },
    31,
  );
}

/* ============================ SHELLS ============================ */

/** Shell doodle dengan muka: live merah marah, blank biru ngantuk. */
export function texShell(kind: "live" | "blank") {
  return makeCanvas(
    `shell-${kind}`,
    256,
    256,
    (ctx, w, h, rng) => {
      const cx = w / 2;
      const body = kind === "live" ? RED : BLANK_BLUE;
      const dark = kind === "live" ? RED_DARK : "#57697c";
      ctx.fillStyle = body;
      wobblePath(
        ctx,
        [
          [cx - 62, 60],
          [cx + 62, 60],
          [cx + 68, 150],
          [cx + 50, 196],
          [cx - 50, 196],
          [cx - 68, 150],
        ],
        rng,
        3,
        true,
      );
      ctx.fill();
      sketchStroke(
        ctx,
        [
          [cx - 62, 60],
          [cx + 62, 60],
          [cx + 68, 150],
          [cx + 50, 196],
          [cx - 50, 196],
          [cx - 68, 150],
        ],
        rng,
        { width: 7, jitter: 3, close: true },
      );
      ctx.fillStyle = BRASS;
      wobblePath(
        ctx,
        [
          [cx - 52, 196],
          [cx + 52, 196],
          [cx + 46, 234],
          [cx - 46, 234],
        ],
        rng,
        2,
        true,
      );
      ctx.fill();
      sketchStroke(
        ctx,
        [
          [cx - 52, 196],
          [cx + 52, 196],
          [cx + 46, 234],
          [cx - 46, 234],
        ],
        rng,
        { width: 6, jitter: 2, close: true },
      );
      ctx.strokeStyle = "rgba(255,255,255,0.35)";
      ctx.lineWidth = 8;
      ctx.beginPath();
      ctx.moveTo(cx - 38, 76);
      ctx.quadraticCurveTo(cx - 52, 120, cx - 42, 176);
      ctx.stroke();
      const eyeY = 108;
      if (kind === "live") {
        sketchStroke(ctx, [[cx - 40, eyeY - 26], [cx - 12, eyeY - 10]], rng, { width: 7, jitter: 2, color: INK });
        sketchStroke(ctx, [[cx + 40, eyeY - 26], [cx + 12, eyeY - 10]], rng, { width: 7, jitter: 2, color: INK });
        sketchCircle(ctx, cx - 26, eyeY + 4, 7, rng, { width: 5, fill: INK });
        sketchCircle(ctx, cx + 26, eyeY + 4, 7, rng, { width: 5, fill: INK });
        sketchStroke(
          ctx,
          [
            [cx - 28, 150],
            [cx - 12, 142],
            [cx + 4, 150],
            [cx + 20, 142],
            [cx + 34, 150],
          ],
          rng,
          { width: 6, jitter: 2 },
        );
      } else {
        sketchStroke(ctx, [[cx - 42, eyeY], [cx - 10, eyeY]], rng, { width: 7, jitter: 2 });
        sketchStroke(ctx, [[cx + 42, eyeY], [cx + 10, eyeY]], rng, { width: 7, jitter: 2 });
        sketchCircle(ctx, cx - 26, eyeY + 10, 6, rng, { width: 5, fill: INK });
        sketchCircle(ctx, cx + 26, eyeY + 10, 6, rng, { width: 5, fill: INK });
        sketchCircle(ctx, cx, 150, 12, rng, { width: 6 });
        handText(ctx, "z", cx + 74, 66, 34, dark, 0.3);
        handText(ctx, "z", cx + 96, 44, 24, dark, 0.4);
      }
      handText(ctx, kind === "live" ? "LIVE" : "BLANK", cx, 44, 34, dark, -0.05);
    },
    kind === "live" ? 41 : 43,
  );
}

/* ============================ DICE & SKILL ICONS ============================ */

function drawIcon(ctx: CanvasRenderingContext2D, id: SkillId, cx: number, cy: number, s: number, rng: RNG) {
  const W = s * 0.13;
  switch (id) {
    case "reroll": {
      const r = s * 0.3;
      const pts: [number, number][] = [];
      for (let i = 0; i <= 20; i++) {
        const a = -0.4 + (i / 20) * Math.PI * 1.75;
        pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
      }
      sketchStroke(ctx, pts, rng, { width: W * 1.1, jitter: s * 0.01 });
      const ea = -0.4 + Math.PI * 1.75;
      const ex = cx + Math.cos(ea) * r;
      const ey = cy + Math.sin(ea) * r;
      sketchStroke(
        ctx,
        [
          [ex - s * 0.14, ey - s * 0.1],
          [ex + s * 0.05, ey],
          [ex - s * 0.1, ey + s * 0.12],
        ],
        rng,
        { width: W * 0.8, jitter: s * 0.008 },
      );
      break;
    }
    case "voodoo": {
      sketchCircle(ctx, cx, cy - s * 0.08, s * 0.26, rng, { width: W, fill: PAPER });
      ctx.fillStyle = PAPER;
      wobblePath(
        ctx,
        [
          [cx - s * 0.12, cy + s * 0.14],
          [cx + s * 0.12, cy + s * 0.14],
          [cx + s * 0.09, cy + s * 0.3],
          [cx - s * 0.09, cy + s * 0.3],
        ],
        rng,
        2,
        true,
      );
      ctx.fill();
      sketchStroke(
        ctx,
        [
          [cx - s * 0.12, cy + s * 0.14],
          [cx + s * 0.12, cy + s * 0.14],
          [cx + s * 0.09, cy + s * 0.3],
          [cx - s * 0.09, cy + s * 0.3],
        ],
        rng,
        { width: W * 0.9, jitter: 2, close: true },
      );
      sketchCircle(ctx, cx - s * 0.11, cy - s * 0.06, s * 0.07, rng, { width: W * 0.8, fill: INK });
      sketchCircle(ctx, cx + s * 0.11, cy - s * 0.06, s * 0.07, rng, { width: W * 0.8, fill: INK });
      for (let i = -1; i <= 1; i++) {
        sketchLine(ctx, cx + i * s * 0.07, cy + s * 0.16, cx + i * s * 0.07, cy + s * 0.24, rng, {
          width: W * 0.6,
          jitter: 1,
        });
      }
      sketchStroke(
        ctx,
        [
          [cx - s * 0.34, cy - s * 0.34],
          [cx + s * 0.34, cy + s * 0.34],
        ],
        rng,
        { width: W * 0.9, color: "#5e9c5b" },
      );
      sketchStroke(
        ctx,
        [
          [cx + s * 0.34, cy - s * 0.34],
          [cx - s * 0.34, cy + s * 0.34],
        ],
        rng,
        { width: W * 0.9, color: "#5e9c5b" },
      );
      break;
    }
    case "peek": {
      sketchEllipse(ctx, cx, cy, s * 0.34, s * 0.2, rng, { width: W, fill: PAPER });
      sketchCircle(ctx, cx, cy, s * 0.12, rng, { width: W * 0.9, fill: "#1d3a4a" });
      sketchCircle(ctx, cx + s * 0.04, cy - s * 0.04, s * 0.035, rng, { width: W * 0.5, fill: PAPER });
      for (const a of [-2.4, -1.9, -1.2, -0.6, -0.2]) {
        sketchLine(
          ctx,
          cx + Math.cos(a) * s * 0.32,
          cy + Math.sin(a) * s * 0.2,
          cx + Math.cos(a) * s * 0.42,
          cy + Math.sin(a) * s * 0.28,
          rng,
          { width: W * 0.7, jitter: 1 },
        );
      }
      break;
    }
    case "eject": {
      ctx.fillStyle = RED;
      wobblePath(
        ctx,
        [
          [cx - s * 0.3, cy - s * 0.16],
          [cx - s * 0.02, cy - s * 0.16],
          [cx - s * 0.02, cy + s * 0.2],
          [cx - s * 0.3, cy + s * 0.2],
        ],
        rng,
        2,
        true,
      );
      ctx.fill();
      sketchStroke(
        ctx,
        [
          [cx - s * 0.3, cy - s * 0.16],
          [cx - s * 0.02, cy - s * 0.16],
          [cx - s * 0.02, cy + s * 0.2],
          [cx - s * 0.3, cy + s * 0.2],
        ],
        rng,
        { width: W * 0.9, jitter: 2, close: true },
      );
      ctx.fillStyle = BRASS;
      ctx.fillRect(cx - s * 0.3, cy + s * 0.2, s * 0.28, s * 0.07);
      sketchStroke(
        ctx,
        [
          [cx + s * 0.06, cy],
          [cx + s * 0.34, cy],
        ],
        rng,
        { width: W * 1.1 },
      );
      sketchStroke(
        ctx,
        [
          [cx + s * 0.22, cy - s * 0.12],
          [cx + s * 0.34, cy],
          [cx + s * 0.22, cy + s * 0.12],
        ],
        rng,
        { width: W, jitter: 1.5 },
      );
      break;
    }
    case "coffee": {
      ctx.fillStyle = PAPER;
      wobblePath(
        ctx,
        [
          [cx - s * 0.24, cy - s * 0.05],
          [cx + s * 0.24, cy - s * 0.05],
          [cx + s * 0.18, cy + s * 0.26],
          [cx - s * 0.18, cy + s * 0.26],
        ],
        rng,
        2,
        true,
      );
      ctx.fill();
      sketchStroke(
        ctx,
        [
          [cx - s * 0.24, cy - s * 0.05],
          [cx + s * 0.24, cy - s * 0.05],
          [cx + s * 0.18, cy + s * 0.26],
          [cx - s * 0.18, cy + s * 0.26],
        ],
        rng,
        { width: W, jitter: 2, close: true },
      );
      sketchEllipse(ctx, cx + s * 0.3, cy + s * 0.07, s * 0.09, s * 0.11, rng, { width: W * 0.9 });
      sketchEllipse(ctx, cx, cy - s * 0.04, s * 0.2, s * 0.05, rng, { width: W * 0.7, fill: "#6b4a2f" });
      sketchStroke(
        ctx,
        [
          [cx - s * 0.1, cy - s * 0.12],
          [cx - s * 0.14, cy - s * 0.24],
          [cx - s * 0.06, cy - s * 0.34],
        ],
        rng,
        { width: W * 0.7, jitter: 2 },
      );
      sketchStroke(
        ctx,
        [
          [cx + s * 0.08, cy - s * 0.12],
          [cx + s * 0.04, cy - s * 0.26],
          [cx + s * 0.14, cy - s * 0.36],
        ],
        rng,
        { width: W * 0.7, jitter: 2 },
      );
      break;
    }
    case "cuffs": {
      sketchCircle(ctx, cx - s * 0.2, cy + s * 0.05, s * 0.15, rng, { width: W, fill: PAPER });
      sketchCircle(ctx, cx + s * 0.2, cy + s * 0.05, s * 0.15, rng, { width: W, fill: PAPER });
      sketchCircle(ctx, cx - s * 0.2, cy + s * 0.05, s * 0.07, rng, { width: W * 0.7 });
      sketchCircle(ctx, cx + s * 0.2, cy + s * 0.05, s * 0.07, rng, { width: W * 0.7 });
      sketchStroke(
        ctx,
        [
          [cx - s * 0.07, cy - s * 0.02],
          [cx - s * 0.02, cy - s * 0.12],
          [cx + s * 0.02, cy - s * 0.12],
          [cx + s * 0.07, cy - s * 0.02],
        ],
        rng,
        { width: W * 0.8, jitter: 2 },
      );
      sketchCircle(ctx, cx - s * 0.2, cy - s * 0.14, s * 0.03, rng, { width: W * 0.5, fill: INK });
      break;
    }
  }
}

/** Ikon skill polos (transparan) untuk HUD. */
export function texSkillIcon(id: SkillId) {
  return makeCanvas(
    `icon-${id}`,
    256,
    256,
    (ctx, w, h, rng) => {
      drawIcon(ctx, id, w / 2, h / 2, w, rng);
    },
    51 + SKILL_IDS.indexOf(id),
  );
}

/** Satu sisi dadu: ikon skill + nama. */
export function texDieFace(id: SkillId) {
  return makeCanvas(
    `die-${id}`,
    512,
    512,
    (ctx, w, h, rng) => {
      const meta = SKILL_META[id];
      ctx.fillStyle = PAPER;
      wobblePath(
        ctx,
        [
          [56, 48],
          [456, 40],
          [468, 462],
          [44, 470],
        ],
        rng,
        5,
        true,
      );
      ctx.fill();
      sketchStroke(
        ctx,
        [
          [56, 48],
          [456, 40],
          [468, 462],
          [44, 470],
        ],
        rng,
        { width: 12, jitter: 5, close: true },
      );
      const pips: [number, number][] = [
        [96, 88],
        [416, 84],
        [92, 428],
        [420, 432],
      ];
      for (const [px, py] of pips) {
        sketchCircle(ctx, px, py, 9, rng, { width: 5, fill: INK });
      }
      drawIcon(ctx, id, w / 2, h / 2 - 30, 340, rng);
      handText(ctx, meta.name, w / 2, 432, 56, INK, -0.02);
    },
    61 + SKILL_IDS.indexOf(id),
  );
}

/* ============================ ENEMY ============================ */

export type EnemyMood =
  | "idle1"
  | "idle2"
  | "talk"
  | "grin"
  | "hit"
  | "dead"
  | "laugh"
  | "aim"
  | "scared";

/** THE DEALER — doodle enemy (bust). */
export function texEnemy(mood: EnemyMood) {
  return makeCanvas(
    `enemy-${mood}`,
    640,
    640,
    (ctx, w, h, rng) => {
      const cx = w / 2;
      const tilt =
        mood === "hit" ? -0.1 : mood === "dead" ? 0.2 : mood === "laugh" ? -0.06 : 0;
      ctx.save();
      ctx.translate(cx, 330);
      ctx.rotate(tilt);
      ctx.translate(-cx, -330);

      // badan / jaket
      ctx.fillStyle = "#4b5a4e";
      wobblePath(
        ctx,
        [
          [92, 640],
          [130, 470],
          [210, 420],
          [cx, 396],
          [434, 424],
          [512, 478],
          [548, 640],
        ],
        rng,
        5,
        true,
      );
      ctx.fill();
      sketchStroke(
        ctx,
        [
          [92, 640],
          [130, 470],
          [210, 420],
          [cx, 396],
          [434, 424],
          [512, 478],
          [548, 640],
        ],
        rng,
        { width: 8, jitter: 4, close: true },
      );
      ctx.fillStyle = "#8a7a5e";
      wobblePath(
        ctx,
        [
          [cx - 74, 424],
          [cx + 74, 424],
          [cx + 40, 640],
          [cx - 40, 640],
        ],
        rng,
        3,
        true,
      );
      ctx.fill();
      sketchStroke(
        ctx,
        [
          [cx - 74, 424],
          [cx + 74, 424],
          [cx + 40, 640],
          [cx - 40, 640],
        ],
        rng,
        { width: 6, jitter: 3, close: true },
      );
      ctx.fillStyle = PAPER;
      wobblePath(
        ctx,
        [
          [cx - 60, 360],
          [cx + 60, 360],
          [cx + 54, 440],
          [cx - 54, 440],
        ],
        rng,
        3,
        true,
      );
      ctx.fill();

      // kepala
      const hy = 232;
      sketchCircle(ctx, cx, hy, 148, rng, { width: 9, fill: PAPER });
      sketchCircle(ctx, cx - 148, hy + 16, 26, rng, { width: 7, fill: PAPER });
      sketchCircle(ctx, cx + 148, hy + 16, 26, rng, { width: 7, fill: PAPER });
      // bandana merah
      ctx.fillStyle = RED;
      wobblePath(
        ctx,
        [
          [cx - 146, hy - 52],
          [cx - 60, hy - 96],
          [cx + 60, hy - 100],
          [cx + 146, hy - 48],
          [cx + 132, hy - 20],
          [cx - 132, hy - 24],
        ],
        rng,
        4,
        true,
      );
      ctx.fill();
      sketchStroke(
        ctx,
        [
          [cx - 146, hy - 52],
          [cx - 60, hy - 96],
          [cx + 60, hy - 100],
          [cx + 146, hy - 48],
          [cx + 132, hy - 20],
          [cx - 132, hy - 24],
        ],
        rng,
        { width: 7, jitter: 3, close: true, color: RED_DARK },
      );
      sketchCircle(ctx, cx + 158, hy - 30, 16, rng, { width: 6, fill: RED });
      sketchStroke(
        ctx,
        [
          [cx + 168, hy - 38],
          [cx + 210, hy - 60],
          [cx + 226, hy - 20],
        ],
        rng,
        { width: 8, color: RED, jitter: 4 },
      );
      for (const [x1, y1, x2, y2] of [
        [cx - 90, hy - 140, cx - 104, hy - 186],
        [cx - 40, hy - 150, cx - 44, hy - 200],
        [cx + 30, hy - 152, cx + 40, hy - 198],
        [cx + 96, hy - 134, cx + 116, hy - 178],
      ] as [number, number, number, number][]) {
        sketchLine(ctx, x1, y1, x2, y2, rng, { width: 6, jitter: 3 });
      }

      // ---- wajah per mood ----
      const eyeY = hy - 8;
      const exL = cx - 62;
      const exR = cx + 62;
      ctx.lineCap = "round";
      if (mood === "dead") {
        for (const ex of [exL, exR]) {
          sketchStroke(ctx, [[ex - 24, eyeY - 24], [ex + 24, eyeY + 24]], rng, { width: 8, jitter: 2 });
          sketchStroke(ctx, [[ex + 24, eyeY - 24], [ex - 24, eyeY + 24]], rng, { width: 8, jitter: 2 });
        }
        ctx.fillStyle = "#d98a8a";
        wobblePath(ctx, [[cx - 20, hy + 66], [cx + 20, hy + 66], [cx + 14, hy + 108], [cx - 14, hy + 108]], rng, 2, true);
        ctx.fill();
        sketchStroke(ctx, [[cx - 20, hy + 66], [cx + 20, hy + 66], [cx + 14, hy + 108], [cx - 14, hy + 108]], rng, { width: 5, jitter: 2, close: true });
        sketchLine(ctx, cx - 46, hy + 64, cx + 46, hy + 66, rng, { width: 7, jitter: 2 });
      } else if (mood === "hit") {
        for (const sgn of [-1, 1]) {
          const ex = cx + sgn * 62;
          sketchStroke(ctx, [[ex - 22 * sgn, eyeY - 22], [ex + 10 * sgn, eyeY]], rng, { width: 8, jitter: 2 });
          sketchStroke(ctx, [[ex - 22 * sgn, eyeY + 22], [ex + 10 * sgn, eyeY]], rng, { width: 8, jitter: 2 });
        }
        sketchEllipse(ctx, cx, hy + 74, 34, 26, rng, { width: 7, fill: "#3a2620" });
        sketchCircle(ctx, cx - 110, hy + 40, 18, rng, { width: 5, color: "rgba(199,62,46,0.7)" });
        sketchCircle(ctx, cx + 118, hy + 20, 14, rng, { width: 5, color: "rgba(199,62,46,0.7)" });
      } else if (mood === "laugh") {
        for (const sgn of [-1, 1]) {
          const ex = cx + sgn * 62;
          sketchStroke(
            ctx,
            [
              [ex - 26, eyeY + 8],
              [ex, eyeY - 20],
              [ex + 26, eyeY + 8],
            ],
            rng,
            { width: 8, jitter: 2 },
          );
        }
        ctx.fillStyle = "#3a2620";
        wobblePath(
          ctx,
          [
            [cx - 62, hy + 40],
            [cx + 62, hy + 40],
            [cx + 40, hy + 108],
            [cx - 40, hy + 108],
          ],
          rng,
          3,
          true,
        );
        ctx.fill();
        sketchStroke(
          ctx,
          [
            [cx - 62, hy + 40],
            [cx + 62, hy + 40],
            [cx + 40, hy + 108],
            [cx - 40, hy + 108],
          ],
          rng,
          { width: 7, jitter: 3, close: true },
        );
        ctx.fillStyle = PAPER;
        ctx.fillRect(cx - 50, hy + 40, 100, 18);
        sketchLine(ctx, cx - 50, hy + 58, cx + 50, hy + 58, rng, { width: 5, jitter: 1.5 });
      } else if (mood === "talk") {
        sketchEllipse(ctx, exL, eyeY, 26, 30, rng, { width: 7, fill: "#ffffff" });
        sketchEllipse(ctx, exR, eyeY, 26, 30, rng, { width: 7, fill: "#ffffff" });
        sketchCircle(ctx, exL + 4, eyeY + 4, 9, rng, { width: 4, fill: INK });
        sketchCircle(ctx, exR + 4, eyeY + 4, 9, rng, { width: 4, fill: INK });
        sketchEllipse(ctx, cx, hy + 72, 26, 34, rng, { width: 7, fill: "#3a2620" });
      } else if (mood === "scared") {
        sketchCircle(ctx, exL, eyeY, 32, rng, { width: 7, fill: "#ffffff" });
        sketchCircle(ctx, exR, eyeY, 32, rng, { width: 7, fill: "#ffffff" });
        sketchCircle(ctx, exL, eyeY, 7, rng, { width: 4, fill: INK });
        sketchCircle(ctx, exR, eyeY, 7, rng, { width: 4, fill: INK });
        sketchStroke(
          ctx,
          [
            [cx - 44, hy + 76],
            [cx - 22, hy + 64],
            [cx, hy + 78],
            [cx + 22, hy + 64],
            [cx + 44, hy + 76],
          ],
          rng,
          { width: 7, jitter: 2 },
        );
        sketchStroke(ctx, [[cx - 170, hy - 40], [cx - 186, hy - 6]], rng, { width: 7, color: "#7fb4c9", jitter: 2 });
        sketchStroke(ctx, [[cx + 176, hy - 20], [cx + 192, hy + 14]], rng, { width: 7, color: "#7fb4c9", jitter: 2 });
      } else if (mood === "grin") {
        sketchEllipse(ctx, exL, eyeY, 26, 28, rng, { width: 7, fill: "#ffffff" });
        sketchEllipse(ctx, exR, eyeY, 26, 28, rng, { width: 7, fill: "#ffffff" });
        sketchCircle(ctx, exL - 2, eyeY + 2, 9, rng, { width: 4, fill: INK });
        sketchCircle(ctx, exR - 2, eyeY + 2, 9, rng, { width: 4, fill: INK });
        sketchStroke(
          ctx,
          [
            [cx - 74, hy + 44],
            [cx, hy + 62],
            [cx + 74, hy + 40],
          ],
          rng,
          { width: 8, jitter: 3 },
        );
        sketchLine(ctx, cx - 62, hy + 58, cx + 60, hy + 56, rng, { width: 6, jitter: 2 });
        for (let i = -2; i <= 2; i++) {
          sketchLine(ctx, cx + i * 24, hy + 48, cx + i * 24, hy + 60, rng, { width: 4, jitter: 1 });
        }
      } else {
        sketchEllipse(ctx, exL, eyeY, 26, 30, rng, { width: 7, fill: "#ffffff" });
        sketchEllipse(ctx, exR, eyeY, 26, 30, rng, { width: 7, fill: "#ffffff" });
        const px = mood === "idle2" ? 6 : -3;
        const py = mood === "idle2" ? -2 : 3;
        sketchCircle(ctx, exL + px, eyeY + py, 9, rng, { width: 4, fill: INK });
        sketchCircle(ctx, exR + px, eyeY + py, 9, rng, { width: 4, fill: INK });
        sketchStroke(ctx, [[exL - 28, eyeY - 40], [exL + 22, eyeY - 34]], rng, { width: 8, jitter: 2 });
        sketchStroke(ctx, [[exR - 22, eyeY - 34], [exR + 28, eyeY - 40]], rng, { width: 8, jitter: 2 });
        if (mood === "idle2") {
          sketchStroke(ctx, [[cx - 40, hy + 66], [cx, hy + 76], [cx + 40, hy + 64]], rng, { width: 7, jitter: 2 });
        } else {
          sketchStroke(ctx, [[cx - 36, hy + 70], [cx + 36, hy + 70]], rng, { width: 7, jitter: 2 });
        }
      }
      sketchStroke(ctx, [[cx, hy + 18], [cx - 8, hy + 34], [cx + 6, hy + 38]], rng, { width: 6, jitter: 2 });

      hatch(ctx, 92, 470, 90, 160, rng, "rgba(0,0,0,0.35)", 11);
      hatch(ctx, 460, 480, 84, 150, rng, "rgba(0,0,0,0.35)", 11);

      // lengan aim dengan revolver
      if (mood === "aim") {
        ctx.fillStyle = "#4b5a4e";
        wobblePath(
          ctx,
          [
            [470, 500],
            [560, 400],
            [596, 300],
            [540, 268],
            [470, 330],
            [430, 430],
          ],
          rng,
          4,
          true,
        );
        ctx.fill();
        sketchStroke(
          ctx,
          [
            [470, 500],
            [560, 400],
            [596, 300],
            [540, 268],
            [470, 330],
            [430, 430],
          ],
          rng,
          { width: 8, jitter: 4, close: true },
        );
        sketchCircle(ctx, 540, 280, 44, rng, { width: 7, fill: PAPER });
        sketchCircle(ctx, 540, 208, 54, rng, { width: 7, fill: "#3a3129" });
        sketchCircle(ctx, 540, 208, 26, rng, { width: 6, fill: "#0d0a07" });
        sketchStroke(ctx, [[508, 232], [500, 258]], rng, { width: 6 });
        sketchStroke(ctx, [[572, 232], [580, 258]], rng, { width: 6 });
      }
      ctx.restore();
    },
    71 + mood.length,
  );
}

/* ============================ SPEECH ============================ */

/** Balon kata doodle dengan teks. */
export function texSpeech(lines: string[]) {
  const clean = lines.slice(0, 4);
  const key = `speech-${clean.join("|")}`;
  return makeCanvas(
    key,
    768,
    380,
    (ctx, w, h, rng) => {
      ctx.font = '44px "Patrick Hand", cursive';
      const maxW = Math.max(...clean.map((l) => ctx.measureText(l).width), 120);
      const bw = Math.min(maxW + 90, w - 20);
      const bh = 62 + clean.length * 56;
      const bx = (w - bw) / 2;
      const by = 12;
      ctx.fillStyle = PAPER;
      wobblePath(
        ctx,
        [
          [bx + 30, by],
          [bx + bw - 30, by - 4],
          [bx + bw, by + 34],
          [bx + bw - 6, by + bh - 30],
          [bx + bw - 60, by + bh],
          [bx + 40, by + bh - 4],
          [bx, by + bh - 36],
          [bx + 6, by + 30],
        ],
        rng,
        4,
        true,
      );
      ctx.fill();
      sketchStroke(
        ctx,
        [
          [bx + 30, by],
          [bx + bw - 30, by - 4],
          [bx + bw, by + 34],
          [bx + bw - 6, by + bh - 30],
          [bx + bw - 60, by + bh],
          [bx + 40, by + bh - 4],
          [bx, by + bh - 36],
          [bx + 6, by + 30],
        ],
        rng,
        { width: 7, jitter: 3, close: true },
      );
      ctx.fillStyle = PAPER;
      wobblePath(
        ctx,
        [
          [bx + 90, by + bh - 6],
          [bx + 40, by + bh + 66],
          [bx + 150, by + bh - 10],
        ],
        rng,
        3,
        true,
      );
      ctx.fill();
      sketchStroke(
        ctx,
        [
          [bx + 90, by + bh - 6],
          [bx + 40, by + bh + 66],
          [bx + 150, by + bh - 10],
        ],
        rng,
        { width: 6, jitter: 3, close: true },
      );
      ctx.font = '44px "Patrick Hand", cursive';
      ctx.fillStyle = INK;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      clean.forEach((l, i) => {
        ctx.fillText(l, w / 2, by + 58 + i * 56);
      });
    },
    90 + clean.length,
  );
}

/* ============================ VFX SPRITES ============================ */

export function texMuzzle() {
  return makeCanvas(
    "muzzle",
    512,
    512,
    (ctx, w, h, rng) => {
      const cx = w / 2;
      const cy = h / 2;
      const spikes = 12;
      ctx.beginPath();
      for (let i = 0; i < spikes * 2; i++) {
        const a = (i / (spikes * 2)) * Math.PI * 2;
        const r = i % 2 === 0 ? 150 + rng() * 80 : 60 + rng() * 30;
        const x = cx + Math.cos(a) * r;
        const y = cy + Math.sin(a) * r;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      const g = ctx.createRadialGradient(cx, cy, 10, cx, cy, 220);
      g.addColorStop(0, "#fffbe8");
      g.addColorStop(0.45, "#ffd75e");
      g.addColorStop(0.8, "#ff9a3d");
      g.addColorStop(1, "rgba(255,120,40,0)");
      ctx.fillStyle = g;
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.8)";
      ctx.lineWidth = 5;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx, cy, 52, 0, Math.PI * 2);
      ctx.fillStyle = "#ffffff";
      ctx.fill();
    },
    101,
  );
}

export function texSmoke() {
  return makeCanvas(
    "smoke",
    256,
    256,
    (ctx, w, h, rng) => {
      const cx = w / 2;
      const cy = h / 2;
      for (let i = 0; i < 7; i++) {
        const a = rng() * Math.PI * 2;
        const d = rng() * 46;
        const r = 40 + rng() * 44;
        const g = ctx.createRadialGradient(
          cx + Math.cos(a) * d,
          cy + Math.sin(a) * d,
          4,
          cx + Math.cos(a) * d,
          cy + Math.sin(a) * d,
          r,
        );
        g.addColorStop(0, "rgba(230,224,210,0.5)");
        g.addColorStop(1, "rgba(230,224,210,0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(cx + Math.cos(a) * d, cy + Math.sin(a) * d, r, 0, Math.PI * 2);
        ctx.fill();
      }
    },
    103,
  );
}

export function texSplat(seed = 111) {
  return makeCanvas(
    `splat-${seed}`,
    512,
    512,
    (ctx, w, h, rng) => {
      const cx = w / 2;
      const cy = w / 2;
      for (let i = 0; i < 9; i++) {
        const a = rng() * Math.PI * 2;
        const d = rng() * 120;
        const r = 30 + rng() * 60;
        ctx.fillStyle = i % 3 === 0 ? RED_DARK : RED;
        ctx.beginPath();
        ctx.ellipse(cx + Math.cos(a) * d, cy + Math.sin(a) * d, r, r * (0.7 + rng() * 0.4), rng() * 3, 0, Math.PI * 2);
        ctx.fill();
      }
      for (let i = 0; i < 16; i++) {
        const a = rng() * Math.PI * 2;
        const d = 130 + rng() * 110;
        const r = 6 + rng() * 16;
        ctx.fillStyle = rng() > 0.5 ? RED : RED_DARK;
        ctx.beginPath();
        ctx.arc(cx + Math.cos(a) * d, cy + Math.sin(a) * d, r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = "rgba(255,255,255,0.16)";
      for (let i = 0; i < 5; i++) {
        const a = rng() * Math.PI * 2;
        const d = rng() * 90;
        ctx.beginPath();
        ctx.arc(cx + Math.cos(a) * d, cy + Math.sin(a) * d, 8 + rng() * 14, 0, Math.PI * 2);
        ctx.fill();
      }
    },
    seed,
  );
}

export function texSpark() {
  return makeCanvas(
    "spark",
    128,
    128,
    (ctx, w, h, rng) => {
      const cx = w / 2;
      const cy = h / 2;
      ctx.strokeStyle = "#ffd75e";
      ctx.lineWidth = 9;
      ctx.lineCap = "round";
      const r1 = 46;
      for (const a of [0, Math.PI / 2, Math.PI / 4, -Math.PI / 4]) {
        ctx.beginPath();
        ctx.moveTo(cx - Math.cos(a) * r1, cy - Math.sin(a) * r1);
        ctx.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
        ctx.stroke();
      }
      ctx.fillStyle = "#fffbe8";
      ctx.beginPath();
      ctx.arc(cx, cy, 12, 0, Math.PI * 2);
      ctx.fill();
    },
    105,
  );
}

export function texRing() {
  return makeCanvas(
    "ring",
    256,
    256,
    (ctx, w, h, rng) => {
      sketchCircle(ctx, w / 2, h / 2, 96, rng, { width: 10, color: "#f6f1e3", jitter: 5 });
      sketchCircle(ctx, w / 2, h / 2, 66, rng, { width: 6, color: "rgba(246,241,227,0.6)", jitter: 4 });
    },
    107,
  );
}

export function texDust() {
  return makeCanvas(
    "dust",
    256,
    256,
    (ctx, w, h, rng) => {
      const cx = w / 2;
      const cy = h / 2;
      for (let i = 0; i < 10; i++) {
        const a = rng() * Math.PI * 2;
        const d = rng() * 70;
        const r = 18 + rng() * 30;
        const g = ctx.createRadialGradient(
          cx + Math.cos(a) * d,
          cy + Math.sin(a) * d,
          2,
          cx + Math.cos(a) * d,
          cy + Math.sin(a) * d,
          r,
        );
        g.addColorStop(0, "rgba(214,200,170,0.5)");
        g.addColorStop(1, "rgba(214,200,170,0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(cx + Math.cos(a) * d, cy + Math.sin(a) * d, r, 0, Math.PI * 2);
        ctx.fill();
      }
    },
    109,
  );
}

export function texVoodooMask() {
  return makeCanvas(
    "voodoo-mask",
    256,
    256,
    (ctx, w, h, rng) => {
      const cx = w / 2;
      ctx.fillStyle = "#c9b48a";
      sketchEllipse(ctx, cx, 120, 78, 92, rng, { width: 7, fill: "#c9b48a" });
      sketchStroke(ctx, [[cx - 30, 44], [cx - 12, 60], [cx - 26, 74]], rng, { width: 4, jitter: 1.5 });
      sketchStroke(ctx, [[cx - 44, 100], [cx - 16, 128]], rng, { width: 6 });
      sketchStroke(ctx, [[cx - 16, 100], [cx - 44, 128]], rng, { width: 6 });
      sketchStroke(ctx, [[cx + 16, 100], [cx + 44, 128]], rng, { width: 6 });
      sketchStroke(ctx, [[cx + 44, 100], [cx + 16, 128]], rng, { width: 6 });
      sketchLine(ctx, cx - 26, 158, cx + 26, 158, rng, { width: 5 });
      for (let i = -2; i <= 2; i++) {
        sketchLine(ctx, cx + i * 12, 150, cx + i * 12, 166, rng, { width: 3, jitter: 1 });
      }
      sketchStroke(ctx, [[cx + 60, 60], [cx + 108, 16]], rng, { width: 6, color: "#8a5a13" });
      ctx.strokeStyle = "rgba(94,156,91,0.65)";
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.arc(cx, 120, 108, 0.6, 2.6);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx, 120, 122, 3.6, 5.6);
      ctx.stroke();
    },
    113,
  );
}

/* ============================ HUD bits ============================ */

export function texHeart(kind: "full" | "empty") {
  return makeCanvas(
    `heart-${kind}`,
    128,
    128,
    (ctx, w, h, rng) => {
      const cx = w / 2;
      const cy = h / 2 + 6;
      if (kind === "full") {
        ctx.fillStyle = RED;
        ctx.beginPath();
        ctx.moveTo(cx, cy + 44);
        ctx.bezierCurveTo(cx - 74, cy - 12, cx - 44, cy - 56, cx, cy - 20);
        ctx.bezierCurveTo(cx + 44, cy - 56, cx + 74, cy - 12, cx, cy + 44);
        ctx.fill();
      }
      ctx.strokeStyle = kind === "full" ? "#5c120a" : "rgba(246,241,227,0.75)";
      ctx.lineWidth = 7;
      ctx.beginPath();
      ctx.moveTo(cx, cy + 44);
      ctx.bezierCurveTo(cx - 74, cy - 12, cx - 44, cy - 56, cx, cy - 20);
      ctx.bezierCurveTo(cx + 44, cy - 56, cx + 74, cy - 12, cx, cy + 44);
      ctx.stroke();
      if (kind === "full") {
        ctx.fillStyle = "rgba(255,255,255,0.35)";
        ctx.beginPath();
        ctx.ellipse(cx - 22, cy - 18, 12, 8, -0.6, 0, Math.PI * 2);
        ctx.fill();
      }
    },
    121,
  );
}

export function texBulletPip(kind: "live" | "blank") {
  return makeCanvas(
    `pip-${kind}`,
    96,
    96,
    (ctx, w, h, rng) => {
      const cx = w / 2;
      const body = kind === "live" ? RED : BLANK_BLUE;
      const dark = kind === "live" ? RED_DARK : "#57697c";
      ctx.fillStyle = body;
      wobblePath(ctx, [[cx - 24, 18], [cx + 24, 18], [cx + 27, 58], [cx + 20, 76], [cx - 20, 76], [cx - 27, 58]], rng, 2, true);
      ctx.fill();
      sketchStroke(ctx, [[cx - 24, 18], [cx + 24, 18], [cx + 27, 58], [cx + 20, 76], [cx - 20, 76], [cx - 27, 58]], rng, {
        width: 5,
        jitter: 1.5,
        close: true,
        color: dark,
      });
      ctx.fillStyle = BRASS;
      ctx.fillRect(cx - 21, 76, 42, 12);
      if (kind === "live") {
        sketchCircle(ctx, cx, 44, 7, rng, { width: 4, fill: INK });
      } else {
        sketchCircle(ctx, cx, 46, 8, rng, { width: 4 });
      }
    },
    123,
  );
}

/* ============================ ENVIRONMENT ============================ */

export function texWall(seed: number, label?: string) {
  return makeCanvas(
    `wall-${seed}`,
    1024,
    1024,
    (ctx, w, h, rng) => {
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, "#2c261e");
      g.addColorStop(1, "#231d16");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < 46; i++) {
        const x = rng() * w;
        const y = rng() * h;
        const r = 20 + rng() * 90;
        ctx.fillStyle = `rgba(${rng() > 0.5 ? "20,16,12" : "60,50,38"},${0.05 + rng() * 0.08})`;
        ctx.beginPath();
        ctx.ellipse(x, y, r, r * (0.5 + rng() * 0.6), rng() * 3, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.strokeStyle = "rgba(12,9,6,0.55)";
      ctx.lineWidth = 3;
      for (let i = 0; i < 6; i++) {
        let x = rng() * w;
        let y = rng() * h;
        ctx.beginPath();
        ctx.moveTo(x, y);
        for (let s = 0; s < 8; s++) {
          x += (rng() - 0.5) * 90;
          y += rng() * 70;
          ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      const chalk = "rgba(214,204,180,0.30)";
      ctx.strokeStyle = chalk;
      ctx.lineWidth = 6;
      ctx.lineCap = "round";
      const tallyX = 130 + rng() * 200;
      const tallyY = 150 + rng() * 140;
      for (let i = 0; i < 8; i++) {
        const col = Math.floor(i / 5);
        const row = i % 5;
        const x = tallyX + col * 110 + row * 20;
        ctx.beginPath();
        ctx.moveTo(x, tallyY);
        ctx.lineTo(x + (rng() - 0.5) * 8, tallyY + 56);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.moveTo(tallyX - 18, tallyY + 10);
      ctx.lineTo(tallyX + 66, tallyY + 48);
      ctx.stroke();
      const eyeX = 700 + rng() * 180;
      const eyeY = 620 + rng() * 200;
      ctx.strokeStyle = chalk;
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.ellipse(eyeX, eyeY, 64, 34, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(eyeX, eyeY, 16, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      let first = true;
      for (let a = 0; a < Math.PI * 4; a += 0.2) {
        const r = 6 + a * 7;
        const x = 220 + rng() * 20 + 280 + Math.cos(a) * r;
        const y = 760 + Math.sin(a) * r;
        if (first) {
          ctx.moveTo(x, y);
          first = false;
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.stroke();
      if (label) {
        handText(ctx, label, 320 + rng() * 360, 380 + rng() * 120, 74, chalk, (rng() - 0.5) * 0.2, '"Patrick Hand", cursive');
      }
      sketchCircle(ctx, 830, 240, 56, rng, { width: 5, color: chalk, jitter: 8 });
      sketchCircle(ctx, 830, 240, 20, rng, { width: 4, color: chalk, jitter: 4 });
    },
    seed,
  );
}

export function texFloor() {
  return makeCanvas(
    "floor",
    1024,
    1024,
    (ctx, w, h, rng) => {
      ctx.fillStyle = "#3a2d20";
      ctx.fillRect(0, 0, w, h);
      const plankH = 128;
      for (let row = 0; row < h / plankH; row++) {
        const shade = 0.9 + rng() * 0.25;
        ctx.fillStyle = `rgb(${Math.round(58 * shade)},${Math.round(45 * shade)},${Math.round(31 * shade)})`;
        ctx.fillRect(0, row * plankH, w, plankH - 3);
        ctx.strokeStyle = "rgba(20,14,9,0.4)";
        ctx.lineWidth = 2;
        for (let i = 0; i < 7; i++) {
          const y = row * plankH + 12 + rng() * (plankH - 24);
          ctx.beginPath();
          ctx.moveTo(0, y);
          for (let x = 0; x <= w; x += 64) {
            ctx.lineTo(x, y + Math.sin(x * 0.02 + row) * 5 + (rng() - 0.5) * 3);
          }
          ctx.stroke();
        }
        const seam = rng() * w;
        ctx.strokeStyle = "rgba(12,8,5,0.8)";
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(seam, row * plankH);
        ctx.lineTo(seam, row * plankH + plankH - 3);
        ctx.stroke();
      }
      for (let i = 0; i < 20; i++) {
        ctx.fillStyle = `rgba(10,7,4,${0.06 + rng() * 0.1})`;
        ctx.beginPath();
        ctx.ellipse(rng() * w, rng() * h, 30 + rng() * 80, 20 + rng() * 50, rng() * 3, 0, Math.PI * 2);
        ctx.fill();
      }
    },
    131,
  );
}

export function texCeiling() {
  return makeCanvas(
    "ceiling",
    512,
    512,
    (ctx, w, h, rng) => {
      ctx.fillStyle = "#191510";
      ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < 9; i++) {
        ctx.fillStyle = `rgba(40,33,24,${0.2 + rng() * 0.2})`;
        ctx.beginPath();
        ctx.ellipse(rng() * w, rng() * h, 40 + rng() * 90, 24 + rng() * 60, rng() * 3, 0, Math.PI * 2);
        ctx.fill();
      }
    },
    133,
  );
}

export function texTableTop() {
  return makeCanvas(
    "tabletop",
    1024,
    1024,
    (ctx, w, h, rng) => {
      ctx.fillStyle = "#5a4128";
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = "rgba(30,20,12,0.5)";
      ctx.lineWidth = 3;
      for (let i = 0; i < 26; i++) {
        const y = rng() * h;
        ctx.beginPath();
        ctx.moveTo(0, y);
        for (let x = 0; x <= w; x += 80) {
          ctx.lineTo(x, y + Math.sin(x * 0.015 + i) * 7 + (rng() - 0.5) * 4);
        }
        ctx.stroke();
      }
      ctx.strokeStyle = "rgba(20,13,8,0.65)";
      ctx.lineWidth = 4;
      for (let i = 0; i < 14; i++) {
        const x = rng() * w;
        const y = rng() * h;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + (rng() - 0.5) * 160, y + (rng() - 0.5) * 60);
        ctx.stroke();
      }
      sketchCircle(ctx, 200 + rng() * 600, 200 + rng() * 600, 70, rng, {
        width: 9,
        color: "rgba(20,13,8,0.4)",
        jitter: 6,
      });
      handText(ctx, "alive?", 560, 760, 52, "rgba(20,13,8,0.5)", -0.15, '"Patrick Hand", cursive');
      sketchCircle(ctx, 300, 300, 34, rng, { width: 5, color: "rgba(20,13,8,0.45)", jitter: 7 });
    },
    137,
  );
}

/* ============================ PROPS ============================ */

export function texBottle() {
  return makeCanvas(
    "bottle",
    256,
    512,
    (ctx, w, h, rng) => {
      const cx = w / 2;
      ctx.fillStyle = "#3f5a3c";
      wobblePath(
        ctx,
        [
          [cx - 62, 480],
          [cx - 66, 300],
          [cx - 34, 250],
          [cx - 34, 130],
          [cx + 34, 130],
          [cx + 34, 250],
          [cx + 66, 300],
          [cx + 62, 480],
        ],
        rng,
        4,
        true,
      );
      ctx.fill();
      sketchStroke(
        ctx,
        [
          [cx - 62, 480],
          [cx - 66, 300],
          [cx - 34, 250],
          [cx - 34, 130],
          [cx + 34, 130],
          [cx + 34, 250],
          [cx + 66, 300],
          [cx + 62, 480],
        ],
        rng,
        { width: 7, jitter: 3, close: true },
      );
      ctx.fillStyle = "#8a5a13";
      ctx.fillRect(cx - 40, 96, 80, 38);
      sketchStroke(ctx, [[cx - 40, 96], [cx + 40, 96], [cx + 40, 134], [cx - 40, 134]], rng, { width: 6, jitter: 2, close: true });
      ctx.fillStyle = PAPER;
      ctx.fillRect(cx - 52, 330, 104, 84);
      sketchStroke(ctx, [[cx - 52, 330], [cx + 52, 330], [cx + 52, 414], [cx - 52, 414]], rng, { width: 5, jitter: 2, close: true });
      handText(ctx, "DARE?", cx, 372, 30, INK, -0.06, '"Patrick Hand", cursive');
      ctx.strokeStyle = "rgba(255,255,255,0.25)";
      ctx.lineWidth = 8;
      ctx.beginPath();
      ctx.moveTo(cx - 40, 300);
      ctx.quadraticCurveTo(cx - 48, 380, cx - 40, 452);
      ctx.stroke();
    },
    141,
  );
}

export function texCards() {
  return makeCanvas(
    "cards",
    256,
    256,
    (ctx, w, h, rng) => {
      const draw = (x: number, y: number, rot: number, face: boolean) => {
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(rot);
        ctx.fillStyle = face ? PAPER : "#8f2418";
        wobblePath(ctx, [[-52, -74], [52, -70], [56, 70], [-48, 74]], rng, 3, true);
        ctx.fill();
        sketchStroke(ctx, [[-52, -74], [52, -70], [56, 70], [-48, 74]], rng, { width: 6, jitter: 2, close: true });
        if (face) {
          handText(ctx, "A", 0, 0, 64, RED_DARK, -0.1);
          handText(ctx, "A", -32, -44, 22, INK, 0);
        }
        ctx.restore();
      };
      draw(120, 168, 0.2, false);
      draw(132, 150, -0.15, false);
      draw(126, 128, 0.05, true);
    },
    143,
  );
}

export function texShellBox() {
  return makeCanvas(
    "shellbox",
    320,
    256,
    (ctx, w, h, rng) => {
      const cx = w / 2;
      ctx.fillStyle = "#a3542e";
      wobblePath(ctx, [[40, 90], [280, 84], [288, 210], [34, 214]], rng, 3, true);
      ctx.fill();
      sketchStroke(ctx, [[40, 90], [280, 84], [288, 210], [34, 214]], rng, { width: 7, jitter: 3, close: true });
      ctx.fillStyle = "#c06a3a";
      wobblePath(ctx, [[44, 88], [276, 82], [270, 40], [50, 44]], rng, 3, true);
      ctx.fill();
      sketchStroke(ctx, [[44, 88], [276, 82], [270, 40], [50, 44]], rng, { width: 6, jitter: 3, close: true });
      handText(ctx, "6 CHAMBER", cx, 140, 34, PAPER, -0.03);
      handText(ctx, "EASY NOW", cx, 182, 28, "#f3d9c2", 0.04, '"Patrick Hand", cursive');
    },
    145,
  );
}

export function texBoombox() {
  return makeCanvas(
    "boombox",
    320,
    256,
    (ctx, w, h, rng) => {
      const cx = w / 2;
      ctx.fillStyle = "#2e2a24";
      wobblePath(ctx, [[30, 60], [290, 54], [296, 208], [26, 214]], rng, 4, true);
      ctx.fill();
      sketchStroke(ctx, [[30, 60], [290, 54], [296, 208], [26, 214]], rng, { width: 7, jitter: 3, close: true });
      sketchCircle(ctx, cx - 76, 134, 52, rng, { width: 6, fill: "#1a1712" });
      sketchCircle(ctx, cx + 76, 132, 52, rng, { width: 6, fill: "#1a1712" });
      sketchCircle(ctx, cx - 76, 134, 18, rng, { width: 4 });
      sketchCircle(ctx, cx + 76, 132, 18, rng, { width: 4 });
      ctx.fillStyle = "#4a4036";
      ctx.fillRect(cx - 34, 96, 68, 74);
      sketchStroke(ctx, [[cx - 34, 96], [cx + 34, 96], [cx + 34, 170], [cx - 34, 170]], rng, { width: 4, jitter: 2, close: true });
      sketchCircle(ctx, cx - 14, 132, 9, rng, { width: 3 });
      sketchCircle(ctx, cx + 14, 132, 9, rng, { width: 3 });
      sketchStroke(ctx, [[70, 58], [100, 10], [220, 8], [250, 54]], rng, { width: 7, jitter: 3 });
      sketchStroke(ctx, [[286, 60], [314, -6]], rng, { width: 5, jitter: 2 });
      sketchCircle(ctx, 314, -6, 7, rng, { width: 4 });
      handText(ctx, "MOOD MUSIC", cx, 192, 24, "rgba(246,241,227,0.75)", 0, '"Patrick Hand", cursive');
    },
    147,
  );
}

/** Poster kertas di dinding. */
export function texPoster(seed: number, title: string) {
  return makeCanvas(
    `poster-${seed}`,
    512,
    700,
    (ctx, w, h, rng) => {
      wobblePath(
        ctx,
        [
          [60, 40],
          [452, 30],
          [466, 620],
          [380, 660],
          [200, 640],
          [70, 655],
          [50, 380],
        ],
        rng,
        6,
        true,
      );
      ctx.fillStyle = PAPER;
      ctx.fill();
      sketchStroke(
        ctx,
        [
          [60, 40],
          [452, 30],
          [466, 620],
          [380, 660],
          [200, 640],
          [70, 655],
          [50, 380],
        ],
        rng,
        { width: 6, jitter: 4, close: true },
      );
      handText(ctx, title, w / 2, 150, 72, INK, -0.03);
      sketchCircle(ctx, w / 2, 340, 110, rng, { width: 7, fill: "#efe7d2" });
      sketchCircle(ctx, w / 2 - 40, 320, 26, rng, { width: 5, fill: INK });
      sketchCircle(ctx, w / 2 + 40, 320, 26, rng, { width: 5, fill: INK });
      for (let i = -2; i <= 2; i++) {
        sketchLine(ctx, w / 2 + i * 20, 390, w / 2 + i * 20, 416, rng, { width: 4, jitter: 1 });
      }
      handText(ctx, "don't be afraid", w / 2, 520, 40, "#4a4036", 0.03, '"Patrick Hand", cursive');
      handText(ctx, "fear is a luxury", w / 2, 570, 40, "#4a4036", -0.02, '"Patrick Hand", cursive');
      ctx.fillStyle = "rgba(120,90,40,0.18)";
      ctx.beginPath();
      ctx.ellipse(140, 600, 60, 30, 0.5, 0, Math.PI * 2);
      ctx.fill();
    },
    151 + seed,
  );
}

/** Papan panjang doodle di dinding. */
export function texArrowSign() {
  return makeCanvas(
    "arrow-sign",
    512,
    256,
    (ctx, w, h, rng) => {
      ctx.fillStyle = PAPER;
      wobblePath(
        ctx,
        [
          [40, 60],
          [380, 50],
          [380, 30],
          [480, 120],
          [380, 210],
          [380, 190],
          [40, 196],
        ],
        rng,
        4,
        true,
      );
      ctx.fill();
      sketchStroke(
        ctx,
        [
          [40, 60],
          [380, 50],
          [380, 30],
          [480, 120],
          [380, 210],
          [380, 190],
          [40, 196],
        ],
        rng,
        { width: 7, jitter: 4, close: true },
      );
      handText(ctx, "DON'T DIE", 200, 126, 52, RED_DARK, -0.02);
    },
    157,
  );
}
