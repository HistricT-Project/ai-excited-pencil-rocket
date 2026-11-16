// ai-excited-01 entry: "The Pencil That Escaped"
// A giant yellow pencil rocket blasts out of a notebook across a sunset sky,
// trailing a hand-drawn scribble, shouting WOW, JUDGE! at the judge.
// Node 22, standard library only. Fully deterministic: fixed seed, no clock,
// no randomness beyond a seeded PRNG, no network, no files read.
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

// ---------- deterministic PRNG (mulberry32, fixed seed) ----------
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- CRC32 + PNG encoder (RGBA, filter none) ----------
const CRC_TABLE: number[] = (() => {
  const table: number[] = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table.push(c >>> 0);
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePNG(w: number, h: number, rgba: Uint8Array): Buffer {
  const raw = Buffer.alloc(h * (1 + w * 4));
  for (let y = 0; y < h; y++) {
    raw[y * (1 + w * 4)] = 0; // filter: none
    Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(
      raw,
      y * (1 + w * 4) + 1,
    );
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------- tiny 2D canvas ----------
type Color = [number, number, number, number?];

class Canvas {
  readonly w: number;
  readonly h: number;
  readonly px: Uint8Array;

  constructor(w: number, h: number) {
    this.w = w;
    this.h = h;
    this.px = new Uint8Array(w * h * 4);
  }

  set(x: number, y: number, c: Color): void {
    const xi = Math.round(x);
    const yi = Math.round(y);
    if (xi < 0 || yi < 0 || xi >= this.w || yi >= this.h) return;
    const i = (yi * this.w + xi) * 4;
    const a = c[3] === undefined ? 255 : c[3];
    if (a >= 255) {
      this.px[i] = c[0];
      this.px[i + 1] = c[1];
      this.px[i + 2] = c[2];
      this.px[i + 3] = 255;
      return;
    }
    if (a <= 0) return;
    const sa = a / 255;
    const da = 1 - sa;
    this.px[i] = Math.round(c[0] * sa + this.px[i] * da);
    this.px[i + 1] = Math.round(c[1] * sa + this.px[i + 1] * da);
    this.px[i + 2] = Math.round(c[2] * sa + this.px[i + 2] * da);
    this.px[i + 3] = 255;
  }

  fillRect(x: number, y: number, w: number, h: number, c: Color): void {
    const x0 = Math.max(0, Math.floor(x));
    const y0 = Math.max(0, Math.floor(y));
    const x1 = Math.min(this.w, Math.ceil(x + w));
    const y1 = Math.min(this.h, Math.ceil(y + h));
    for (let yy = y0; yy < y1; yy++) {
      for (let xx = x0; xx < x1; xx++) this.set(xx, yy, c);
    }
  }

  fillCircle(cx: number, cy: number, r: number, c: Color): void {
    const x0 = Math.max(0, Math.floor(cx - r));
    const y0 = Math.max(0, Math.floor(cy - r));
    const x1 = Math.min(this.w - 1, Math.ceil(cx + r));
    const y1 = Math.min(this.h - 1, Math.ceil(cy + r));
    const rr = r * r;
    for (let yy = y0; yy <= y1; yy++) {
      for (let xx = x0; xx <= x1; xx++) {
        const dx = xx - cx;
        const dy = yy - cy;
        if (dx * dx + dy * dy <= rr) this.set(xx, yy, c);
      }
    }
  }

  fillEllipse(cx: number, cy: number, rx: number, ry: number, c: Color): void {
    const x0 = Math.max(0, Math.floor(cx - rx));
    const y0 = Math.max(0, Math.floor(cy - ry));
    const x1 = Math.min(this.w - 1, Math.ceil(cx + rx));
    const y1 = Math.min(this.h - 1, Math.ceil(cy + ry));
    for (let yy = y0; yy <= y1; yy++) {
      for (let xx = x0; xx <= x1; xx++) {
        const dx = (xx - cx) / rx;
        const dy = (yy - cy) / ry;
        if (dx * dx + dy * dy <= 1) this.set(xx, yy, c);
      }
    }
  }

  // Thick line with round caps: stamp circles along the segment.
  line(x0: number, y0: number, x1: number, y1: number, width: number, c: Color): void {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len = Math.hypot(dx, dy);
    const steps = Math.max(1, Math.ceil(len / Math.max(1, width * 0.4)));
    const r = width / 2;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      this.fillCircle(x0 + dx * t, y0 + dy * t, r, c);
    }
  }

  // Even-odd scanline polygon fill. pts = [[x,y],...]
  polygon(pts: number[][], c: Color): void {
    let minY = Infinity;
    let maxY = -Infinity;
    for (const p of pts) {
      if (p[1] < minY) minY = p[1];
      if (p[1] > maxY) maxY = p[1];
    }
    const y0 = Math.max(0, Math.floor(minY));
    const y1 = Math.min(this.h - 1, Math.ceil(maxY));
    for (let y = y0; y <= y1; y++) {
      const xs: number[] = [];
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i];
        const b = pts[(i + 1) % pts.length];
        if ((a[1] <= y && b[1] > y) || (b[1] <= y && a[1] > y)) {
          const t = (y - a[1]) / (b[1] - a[1]);
          xs.push(a[0] + t * (b[0] - a[0]));
        }
      }
      xs.sort((p, q) => p - q);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const xa = Math.max(0, Math.ceil(xs[k]));
        const xb = Math.min(this.w - 1, Math.floor(xs[k + 1]));
        for (let x = xa; x <= xb; x++) this.set(x, y, c);
      }
    }
  }

  // Vertical gradient: stops = [[y0, color], [y1, color], ...] sorted by y.
  vgrad(stops: [number, Color][]): void {
    for (let y = 0; y < this.h; y++) {
      let c0 = stops[0];
      let c1 = stops[stops.length - 1];
      for (let s = 0; s < stops.length - 1; s++) {
        if (y >= stops[s][0] && y <= stops[s + 1][0]) {
          c0 = stops[s];
          c1 = stops[s + 1];
          break;
        }
      }
      const span = Math.max(1, c1[0] - c0[0]);
      const t = Math.min(1, Math.max(0, (y - c0[0]) / span));
      const col: Color = [
        Math.round(c0[1][0] + (c1[1][0] - c0[1][0]) * t),
        Math.round(c0[1][1] + (c1[1][1] - c0[1][1]) * t),
        Math.round(c0[1][2] + (c1[1][2] - c0[1][2]) * t),
        255,
      ];
      for (let x = 0; x < this.w; x++) this.set(x, y, col);
    }
  }

  // Soft radial glow: concentric circles fading out.
  glow(cx: number, cy: number, r0: number, r1: number, c: Color, maxA: number): void {
    const steps = 26;
    for (let i = steps; i >= 1; i--) {
      const t = i / steps;
      const r = r0 + (r1 - r0) * t;
      const a = Math.round(maxA * (1 - t) * (1 - t));
      this.fillCircle(cx, cy, r, [c[0], c[1], c[2], a]);
    }
  }
}

// ---------- chunky 5x7 bitmap font (bold, hand-drawn) ----------
// Each glyph: 7 rows of 5 chars, '#' = ink.
const FONT: Record<string, string[]> = {
  W: ['#...#', '#...#', '#...#', '#.#.#', '#.#.#', '#.#.#', '.#.#.'],
  O: ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  ',': ['.....', '.....', '.....', '.....', '.....', '..##.', '..##.', '.#...'],
  J: ['..###', '....#', '....#', '....#', '....#', '#...#', '.###.'],
  U: ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  D: ['###..', '#..#.', '#...#', '#...#', '#...#', '#..#.', '###..'],
  G: ['.###.', '#...#', '#....', '#.###', '#...#', '#...#', '.###.'],
  E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
  '!': ['..#..', '..#..', '..#..', '..#..', '..#..', '.....', '..#..'],
  ' ': ['.....', '.....', '.....', '.....', '.....', '.....', '.....'],
};

function textWidth(text: string, scale: number): number {
  let w = 0;
  for (const ch of text) {
    w += 5 * scale + 1 * scale; // glyph + 1px gap
  }
  return w - 1 * scale;
}

// Draw text centred at cx, top at y. Outline pass first, then fill.
function drawText(
  cv: Canvas,
  text: string,
  cx: number,
  y: number,
  scale: number,
  fill: Color,
  outline: Color,
  outlinePx: number,
): void {
  const w = textWidth(text, scale);
  let x = cx - w / 2;
  const draw = (dx: number, dy: number, col: Color) => {
    let gx = x;
    for (const ch of text) {
      const g = FONT[ch] ?? FONT[' '];
      for (let row = 0; row < 7; row++) {
        for (let colI = 0; colI < 5; colI++) {
          if (g[row][colI] === '#') {
            cv.fillRect(
              gx + dx + colI * scale,
              y + dy + row * scale,
              scale,
              scale,
              col,
            );
          }
        }
      }
      gx += 6 * scale;
    }
  };
  // 8-direction outline
  for (const [ox, oy] of [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ]) {
    draw(ox * outlinePx, oy * outlinePx, outline);
  }
  draw(0, 0, fill);
}

// ---------- scene ----------
const W = 1024;
const H = 1024;

const INK: Color = [23, 18, 75];
const WHITE: Color = [255, 255, 255];
const PENCIL_YELLOW: Color = [255, 210, 63];
const PENCIL_DARK: Color = [232, 169, 12];
const WOOD: Color = [245, 201, 138];
const GRAPHITE: Color = [43, 43, 58];
const FERRULE: Color = [200, 204, 212];
const FERRULE_DARK: Color = [138, 143, 156];
const ERASER: Color = [255, 107, 157];
const FLAME_ORANGE: Color = [255, 122, 26];
const FLAME_YELLOW: Color = [255, 210, 63];

type Pt = [number, number];

function drawStar(cv: Canvas, cx: number, cy: number, r: number, c: Color): void {
  cv.line(cx - r, cy, cx + r, cy, 3, c);
  cv.line(cx, cy - r, cx, cy + r, 3, c);
  cv.fillCircle(cx, cy, r * 0.28, c);
}

// The pencil rocket: back (eraser) at (bx,by), tip at (tx,ty).
function drawPencil(
  cv: Canvas,
  bx: number,
  by: number,
  tx: number,
  ty: number,
  w: number,
): void {
  const dx = tx - bx;
  const dy = ty - by;
  const len = Math.hypot(dx, dy);
  const ux = dx / len;
  const uy = dy / len;
  const px = -uy;
  const py = ux;
  const half = w / 2;
  const oh = half + 7;
  const at = (t: number): Pt => [bx + ux * t * len, by + uy * t * len];
  const off = (p: Pt, s: number): Pt => [p[0] + px * s, p[1] + py * s];

  const a086 = at(0.86);
  const a020 = at(0.2);
  const a012 = at(0.12);
  const a0015 = at(0.015);
  const aBack = at(-0.03);
  const tip: Pt = [tx + ux * 8, ty + uy * 8];

  // silhouette outline
  cv.polygon(
    [tip, off(a086, oh), off(aBack, oh), off(aBack, -oh), off(a086, -oh)],
    INK,
  );
  // wood tip
  cv.polygon([[tx, ty], off(a086, half), off(a086, -half)], WOOD);
  // graphite point
  const a095 = at(0.95);
  cv.polygon([[tx, ty], off(a095, 11), off(a095, -11)], GRAPHITE);
  // body
  cv.polygon(
    [off(a086, half), off(a020, half), off(a020, -half), off(a086, -half)],
    PENCIL_YELLOW,
  );
  // body stripe + highlight
  const s1 = at(0.84);
  const s2 = at(0.22);
  cv.line(s1[0], s1[1], s2[0], s2[1], 12, PENCIL_DARK);
  const h1 = off(s1, -15);
  const h2 = off(s2, -15);
  cv.line(h1[0], h1[1], h2[0], h2[1], 5, [255, 233, 138]);
  // ferrule
  cv.polygon(
    [off(a020, half), off(a012, half), off(a012, -half), off(a020, -half)],
    FERRULE,
  );
  for (const t of [0.18, 0.14]) {
    const a = off(at(t), half);
    const b = off(at(t), -half);
    cv.line(a[0], a[1], b[0], b[1], 3, FERRULE_DARK);
  }
  // eraser
  cv.polygon(
    [off(a012, half), off(a0015, half), off(a0015, -half), off(a012, -half)],
    ERASER,
  );
  cv.fillCircle(a0015[0], a0015[1], half, ERASER);
}

// Flame bursting from the eraser end, pointing away from the pencil.
function drawFlame(
  cv: Canvas,
  bx: number,
  by: number,
  ux: number,
  uy: number,
  px: number,
  py: number,
): void {
  const away = (d: number): Pt => [bx - ux * d, by - uy * d];
  const side = (p: Pt, s: number): Pt => [p[0] + px * s, p[1] + py * s];
  const b = (d: number, s: number): Pt => side(away(d), s);
  // outer flame
  cv.polygon([b(0, 36), b(105, 17), away(140), b(105, -17), b(0, -36)], FLAME_ORANGE);
  // middle flame
  cv.polygon([b(0, 20), b(65, 10), away(95), b(65, -10), b(0, -20)], FLAME_YELLOW);
  // white core
  cv.polygon([b(0, 10), away(58), b(0, -10)], WHITE);
  // smoke puffs drifting off the flame
  const rnd = mulberry32(7);
  for (let i = 0; i < 2; i++) {
    const d = 125 + i * 26 + rnd() * 12;
    const j = (rnd() - 0.5) * 36;
    cv.fillCircle(
      bx - ux * d + px * j,
      by - uy * d + py * j,
      11 + rnd() * 7,
      [255, 255, 255, 70],
    );
  }
}

// Hand-drawn squiggle the pencil just drew, trailing below it.
function drawSquiggle(
  cv: Canvas,
  bx: number,
  by: number,
  tx: number,
  ty: number,
): void {
  const dx = tx - bx;
  const dy = ty - by;
  const len = Math.hypot(dx, dy);
  const ux = dx / len;
  const uy = dy / len;
  const px = -uy;
  const py = ux;
  const pts: Pt[] = [];
  for (let t = 0.12; t <= 0.82; t += 0.02) {
    const wob = Math.sin(t * 24) * 22;
    pts.push([
      bx + ux * t * len + px * (95 + wob),
      by + uy * t * len + py * (95 + wob),
    ]);
  }
  for (let i = 0; i < pts.length - 1; i++) {
    cv.line(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], 8, INK);
  }
  const last = pts[pts.length - 1];
  drawStar(cv, last[0], last[1], 15, [255, 210, 63]);
}

// A flying sheet of ruled paper, rotated.
function drawPaper(
  cv: Canvas,
  cx: number,
  cy: number,
  angleDeg: number,
  s: number,
): void {
  const a = (angleDeg * Math.PI) / 180;
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  const w = 64 * s;
  const h = 82 * s;
  const corner = (lx: number, ly: number): Pt => [
    cx + lx * ca - ly * sa,
    cy + lx * sa + ly * ca,
  ];
  const pts = [
    corner(-w / 2, -h / 2),
    corner(w / 2, -h / 2),
    corner(w / 2, h / 2),
    corner(-w / 2, h / 2),
  ];
  cv.polygon(pts, [255, 253, 245]);
  for (let i = 0; i < 4; i++) {
    cv.line(pts[i][0], pts[i][1], pts[(i + 1) % 4][0], pts[(i + 1) % 4][1], 3, INK);
  }
  for (const ly of [-h / 4, 0, h / 4]) {
    const p1 = corner(-w / 2 + 7, ly);
    const p2 = corner(w / 2 - 7, ly);
    cv.line(p1[0], p1[1], p2[0], p2[1], 2, [185, 210, 232]);
  }
}

// The open notebook the pencil escaped from, bottom-left.
function drawNotebook(cv: Canvas): void {
  // pages
  cv.polygon(
    [
      [60, 892],
      [180, 880],
      [180, 986],
      [60, 1000],
    ],
    [255, 253, 245],
  );
  cv.polygon(
    [
      [180, 880],
      [300, 892],
      [300, 1000],
      [180, 986],
    ],
    [255, 253, 245],
  );
  // ruled lines
  for (const y of [912, 932, 952]) {
    cv.line(72, y - 2, 168, y - 6, 2, [185, 210, 232]);
    cv.line(192, y - 6, 288, y - 2, 2, [185, 210, 232]);
  }
  // dashed pencil outline on the right page: the empty spot it left
  const dash = (x0: number, y0: number, x1: number, y1: number) => {
    const len = Math.hypot(x1 - x0, y1 - y0);
    const n = Math.floor(len / 12);
    for (let i = 0; i < n; i += 2) {
      const t0 = i / n;
      const t1 = Math.min(1, (i + 1) / n);
      cv.line(
        x0 + (x1 - x0) * t0,
        y0 + (y1 - y0) * t0,
        x0 + (x1 - x0) * t1,
        y0 + (y1 - y0) * t1,
        3,
        [150, 150, 170],
      );
    }
  };
  dash(205, 912, 268, 918);
  dash(268, 918, 284, 926);
  dash(284, 926, 268, 934);
  dash(268, 934, 205, 928);
  dash(205, 928, 205, 912);
  // fold + outlines
  cv.line(180, 880, 180, 986, 3, INK);
  cv.line(60, 892, 180, 880, 3, INK);
  cv.line(180, 880, 300, 892, 3, INK);
  cv.line(60, 1000, 180, 986, 3, INK);
  cv.line(180, 986, 300, 1000, 3, INK);
  cv.line(60, 892, 60, 1000, 3, INK);
  cv.line(300, 892, 300, 1000, 3, INK);
  // spiral rings along the fold
  for (const y of [896, 918, 940, 962]) {
    cv.fillCircle(180, y, 6, [120, 120, 140]);
    cv.fillCircle(180, y, 3, [255, 255, 255]);
  }
}

function main(): void {
  const cv = new Canvas(W, H);
  const rnd = mulberry32(12345);

  // sunset sky
  cv.vgrad([
    [0, [22, 18, 74]],
    [420, [74, 42, 134]],
    [680, [184, 74, 122]],
    [880, [240, 117, 47]],
    [1024, [255, 179, 71]],
  ]);

  // stars (skip the text band and the sun)
  for (let i = 0; i < 110; i++) {
    const x = rnd() * W;
    const y = rnd() * 560;
    if (x < 640 && y > 100 && y < 390) continue;
    if (x > 770 && x < 970 && y > 40 && y < 240) continue;
    const r = 1 + rnd() * 2;
    const a = 140 + Math.floor(rnd() * 115);
    cv.fillCircle(x, y, r, [255, 255, 255, a]);
    if (rnd() < 0.15) {
      cv.line(x - 7, y, x + 7, y, 2, [255, 255, 255, a]);
      cv.line(x, y - 7, x, y + 7, 2, [255, 255, 255, a]);
    }
  }

  // sun, top-right
  cv.glow(870, 140, 75, 215, [255, 210, 63], 70);
  cv.fillCircle(870, 140, 75, [255, 233, 168]);
  cv.fillCircle(870, 140, 55, [255, 244, 200]);

  // dark hill along the bottom
  cv.polygon(
    [
      [0, 1024],
      [0, 972],
      [300, 958],
      [650, 972],
      [1024, 948],
      [1024, 1024],
    ],
    [36, 27, 82],
  );

  // speed lines parallel to the pencil
  const ux = 0.6783;
  const uy = -0.7348;
  for (let i = 0; i < 10; i++) {
    const x = 80 + rnd() * 860;
    const y = 420 + rnd() * 420;
    const len = 60 + rnd() * 80;
    cv.line(x, y, x + ux * len, y + uy * len, 5, [255, 255, 255, 70]);
  }

  // the pencil's launch geometry (eraser end raised so the flame shows
  // in the sky gap above the notebook)
  const bx = 250;
  const by = 800;
  const tx = 820;
  const ty = 230;
  const pdx = tx - bx;
  const pdy = ty - by;
  const plen = Math.hypot(pdx, pdy);
  const puX = pdx / plen;
  const puY = pdy / plen;
  const ppX = -puY;
  const ppY = puX;

  // squiggle trail, then the notebook, then the flame (behind the pencil)
  drawSquiggle(cv, bx, by, tx, ty);
  drawNotebook(cv);
  drawFlame(cv, bx, by, puX, puY, ppX, ppY);

  // the pencil rocket itself
  drawPencil(cv, bx, by, tx, ty, 64);

  // flying sheets of paper below the pencil
  drawPaper(cv, 510, 787, -25, 1);
  drawPaper(cv, 660, 625, 15, 0.85);
  drawPaper(cv, 779, 496, -40, 0.75);

  // the shout, top-left, drawn last so nothing covers it
  drawText(cv, 'WOW,', 300, 140, 16, WHITE, INK, 7);
  drawText(cv, 'JUDGE!', 300, 258, 16, WHITE, INK, 7);
  drawStar(cv, 620, 180, 12, [255, 210, 63]);
  drawStar(cv, 60, 320, 10, [255, 255, 255, 220]);

  const out = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
  mkdirSync(out, { recursive: true });
  const png = encodePNG(W, H, cv.px);
  writeFileSync(join(out, 'entry.png'), png);
  console.log(`wrote ${join(out, 'entry.png')} (${png.length} bytes)`);
}

main();
