#!/usr/bin/env node
/**
 * Gera os ícones da extensão (icon16/32/48/128.png) e o icon.svg a partir de um
 * único desenho vetorial, seguindo o MESTRE Design System 1.0: hexágono neon,
 * chip com o monograma "M", órbita ciano/verde.
 *
 * Por que não recortar o logo: o texto "MESTRE" some abaixo de 48 px.
 * Aqui cada tamanho tem um nível de detalhe próprio, então o 16 px continua nítido.
 *
 * Só usa módulos nativos do Node (a extensão não tem dependências npm).
 * Execute com: node browser-extension/icons/build-icons.js
 */

import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Desenho (coordenadas 0..100, centro em 50,50)
// ---------------------------------------------------------------------------

/** Tokens do Design System 1.0, mais tons derivados para degradês. */
const C = {
  cyan: [0, 217, 255, 1], // Primária #00D9FF
  blue: [37, 99, 235, 1], // Secundária #2563EB
  green: [57, 255, 136, 1], // IA / Destaque #39FF88
  neutral: [226, 232, 240, 1], // Neutro #E2E8F0
  dark: [5, 11, 22, 1], // Escuro (BG) #050B16
  cyanDeep: [29, 155, 240, 1],
  band: [30, 58, 138, 1],
  navy: [11, 26, 51, 1],
  chip: [12, 25, 48, 1],
  chipDeep: [7, 15, 30, 1],
  silver: [255, 255, 255, 1],
  silverDeep: [148, 163, 184, 1],
  pin: [203, 213, 225, 1],
};

const solid = (color) => ({ type: "solid", color });
const linear = (x0, y0, x1, y1, stops) => ({ type: "linear", x0, y0, x1, y1, stops });
const radial = (cx, cy, r, stops) => ({ type: "radial", cx, cy, r, stops });

/** Vértices do hexágono com ponta para cima, recuado `d` unidades para dentro. Ordem: topo, sup. dir., inf. dir., base, inf. esq., sup. esq. */
function hexPts(d) {
  const r = 49 - d / Math.cos(Math.PI / 6);
  return [-90, -30, 30, 90, 150, 210].map((deg) => {
    const a = (deg * Math.PI) / 180;
    return [50 + r * Math.cos(a), 50 + r * Math.sin(a)];
  });
}
const hexagon = (d) => ({ kind: "poly", pts: hexPts(d) });

/** Monograma "M" na caixa dada: corpo prateado e o "V" ciano no entalhe de cima. */
function monogram(x0, y0, x1, y1, stem = 0.24) {
  const w = x1 - x0;
  const h = y1 - y0;
  const s = stem * w; // espessura das hastes
  const cx = (x0 + x1) / 2;
  const body = {
    kind: "poly",
    pts: [
      [x0, y1], [x0, y0], [x0 + s, y0], [cx, y0 + 0.47 * h], [x1 - s, y0], [x1, y0],
      [x1, y1], [x1 - s, y1], [x1 - s, y0 + 0.42 * h], [cx, y0 + 0.86 * h], [x0 + s, y0 + 0.42 * h], [x0 + s, y1],
    ],
  };
  const g = 0.05 * w;
  const notch = { kind: "poly", pts: [[x0 + s + g, y0], [x1 - s - g, y0], [cx, y0 + 0.47 * h - g * 1.6]] };
  return { body, notch };
}

/** Faixa de elipse com pontas afinadas (a "órbita" do logo), convertida em polígono. */
function swoosh(cx, cy, rx, ry, rotDeg, a0Deg, a1Deg, thick, steps = 120) {
  const rot = (rotDeg * Math.PI) / 180;
  const outer = [];
  const inner = [];
  for (let i = 0; i <= steps; i++) {
    const f = i / steps;
    const th = ((a0Deg + (a1Deg - a0Deg) * f) * Math.PI) / 180;
    const t = thick * Math.pow(Math.sin(Math.PI * f), 0.7);
    const ex = rx * Math.cos(th);
    const ey = ry * Math.sin(th);
    let nx = ry * Math.cos(th);
    let ny = rx * Math.sin(th);
    const len = Math.hypot(nx, ny) || 1;
    nx /= len;
    ny /= len;
    for (const [list, sign] of [[outer, 1], [inner, -1]]) {
      const px = ex + (sign * nx * t) / 2;
      const py = ey + (sign * ny * t) / 2;
      list.push([cx + px * Math.cos(rot) - py * Math.sin(rot), cy + px * Math.sin(rot) + py * Math.cos(rot)]);
    }
  }
  return { kind: "poly", pts: [...outer, ...inner.reverse()] };
}

/** Gira um ponto em k·90° em torno do centro (50,50), para repetir os pinos nos 4 lados. */
function rot([x, y], k) {
  switch (k & 3) {
    case 1: return [100 - y, x];
    case 2: return [100 - x, 100 - y];
    case 3: return [y, 100 - x];
    default: return [x, y];
  }
}

/**
 * Nível de detalhe por tamanho. Abaixo de 40 px fica só hexágono + "M".
 * Em 16 px o "V" ciano do entalhe se funde ao topo do "M" (vira um "H"), então sai.
 */
const LEVELS = {
  full: { rim: 2.2, band: 8, chip: 17, pins: [-12.8, -6.4, 0, 6.4, 12.8], pinW: 3.2, pinL: 5, traces: true, accents: 1.8, orbit: 3.4, m: 13.5, stem: 0.24, notch: true },
  medium: { rim: 3, band: 10, chip: 19, pins: [-9, 0, 9], pinW: 5, pinL: 5.5, traces: false, accents: 2.8, orbit: 0, m: 14.5, stem: 0.24, notch: true },
  small: { rim: 4.5, band: 11, chip: 0, accents: 0, orbit: 0, m: 20, stem: 0.25, notch: true },
  tiny: { rim: 7, band: 13, chip: 0, accents: 0, orbit: 0, m: 22, stem: 0.27, notch: false },
};

function levelFor(size) {
  if (size >= 96) return "full";
  if (size >= 40) return "medium";
  if (size >= 24) return "small";
  return "tiny";
}

/** Lista de camadas, de trás para frente. */
function design(levelName) {
  const L = LEVELS[levelName];
  const layers = [];
  const add = (shape, fill) => layers.push({ ...shape, fill });
  const line = ([x0, y0], [x1, y1], w, fill) => add({ kind: "line", x0, y0, x1, y1, w }, fill);
  const path = (pts, w, fill) => pts.slice(1).forEach((p, i) => line(pts[i], p, w, fill));
  const ringPad = ([x, y], color) => {
    add({ kind: "circle", cx: x, cy: y, r: 3.2 }, solid(color));
    add({ kind: "circle", cx: x, cy: y, r: 1.5 }, solid(C.dark));
  };

  // Moldura: borda ciano, faixa azul e miolo escuro.
  add(hexagon(0), linear(0, 0, 0, 100, [[0, C.cyan], [1, C.cyanDeep]]));
  add(hexagon(L.rim), linear(0, 0, 0, 100, [[0, C.blue], [1, C.band]]));
  add(hexagon(L.band), radial(50, 42, 60, [[0, C.navy], [0.7, C.dark], [1, C.dark]]));

  // Filetes verdes junto à moldura (em cima dos dois lados e chevron embaixo).
  if (L.accents) {
    const v = hexPts(L.band + 2.6);
    const at = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    const seg = (a, b, t0, t1) => line(at(a, b, t0), at(a, b, t1), L.accents, solid(C.green));
    seg(v[5], v[0], 0.25, 0.55);
    seg(v[0], v[1], 0.45, 0.75);
    seg(v[2], v[3], 0.62, 1);
    seg(v[3], v[4], 0, 0.38);
  }

  // Trilhas com pads em anel: 3 de cada lado e 3 em cima (a do meio em verde).
  if (L.traces) {
    const mirror = (pts) => pts.map(([x, y]) => [100 - x, y]);
    const left = [
      [[28, 37.2], [24.5, 37.2], [21, 33.7]],
      [[28, 50], [20.5, 50]],
      [[28, 62.8], [24.5, 62.8], [21, 66.3]],
    ];
    for (const t of [...left, ...left.map(mirror)]) {
      path(t, 2, solid(C.cyan));
      ringPad(t[t.length - 1], C.cyan);
    }
    const topSide = [[43.6, 28], [43.6, 24], [40.5, 20.5]];
    for (const t of [topSide, mirror(topSide)]) {
      path(t, 2, solid(C.cyan));
      ringPad(t[t.length - 1], C.cyan);
    }
    path([[50, 28], [50, 16.5]], 2, solid(C.green));
    ringPad([50, 16.5], C.green);
  }

  // Chip: pinos prateados, borda ciano→azul e corpo escuro.
  if (L.chip) {
    const lo = 50 - L.chip;
    const hi = 50 + L.chip;
    for (let k = 0; k < 4; k++) {
      for (const o of L.pins) {
        const [ax, ay] = rot([50 + o - L.pinW / 2, lo - L.pinL], k);
        const [bx, by] = rot([50 + o + L.pinW / 2, lo + 1], k);
        add({ kind: "rrect", x0: Math.min(ax, bx), y0: Math.min(ay, by), x1: Math.max(ax, bx), y1: Math.max(ay, by), r: L.pinW * 0.3 }, solid(C.pin));
      }
    }
    const r = L.chip * 0.24;
    add({ kind: "rrect", x0: lo - 1.6, y0: lo - 1.6, x1: hi + 1.6, y1: hi + 1.6, r: r + 1.6 }, linear(0, lo, 0, hi, [[0, C.cyan], [1, C.blue]]));
    add({ kind: "rrect", x0: lo, y0: lo, x1: hi, y1: hi, r }, linear(0, lo, 0, hi, [[0, C.chip], [1, C.chipDeep]]));
  }

  // Monograma.
  const y0 = 50 - 0.9 * L.m;
  const y1 = 50 + 0.9 * L.m;
  const { body, notch } = monogram(50 - L.m, y0, 50 + L.m, y1, L.stem);
  if (L.notch) add(notch, linear(0, y0, 0, (y0 + y1) / 2, [[0, C.cyan], [1, C.blue]]));
  add(body, linear(0, y0, 0, y1, [[0, C.silver], [0.55, C.neutral], [1, C.silverDeep]]));

  // Órbita na frente, como no logo.
  if (L.orbit) {
    add(swoosh(50, 52, 30, 10.5, -22, -70, 190, L.orbit), linear(20, 62, 82, 38, [[0, C.green], [0.45, C.cyan], [1, C.cyan]]));
  }

  return layers;
}

// ---------------------------------------------------------------------------
// Rasterização com supersampling (anti-aliasing sem dependências)
// ---------------------------------------------------------------------------

/** Margem transparente por tamanho. No 128 o Chrome recomenda arte de 96 px + 16 px de margem. */
const PADDING = { 16: 0, 32: 1, 48: 2, 128: 16 };

function lerpStops(stops, t) {
  if (t <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i++) {
    const [t1, c1] = stops[i];
    if (t <= t1) {
      const [t0, c0] = stops[i - 1];
      const f = (t - t0) / (t1 - t0 || 1);
      return c0.map((v, j) => v + (c1[j] - v) * f);
    }
  }
  return stops[stops.length - 1][1];
}

function sampleFill(fill, u, v) {
  if (fill.type === "solid") return fill.color;
  if (fill.type === "linear") {
    const dx = fill.x1 - fill.x0;
    const dy = fill.y1 - fill.y0;
    const t = ((u - fill.x0) * dx + (v - fill.y0) * dy) / (dx * dx + dy * dy);
    return lerpStops(fill.stops, Math.min(1, Math.max(0, t)));
  }
  const t = Math.hypot(u - fill.cx, v - fill.cy) / fill.r;
  return lerpStops(fill.stops, Math.min(1, t));
}

function inside(s, u, v) {
  switch (s.kind) {
    case "poly": {
      let hit = false;
      for (let i = 0, j = s.pts.length - 1; i < s.pts.length; j = i++) {
        const [xi, yi] = s.pts[i];
        const [xj, yj] = s.pts[j];
        if ((yi > v) !== (yj > v) && u < ((xj - xi) * (v - yi)) / (yj - yi) + xi) hit = !hit;
      }
      return hit;
    }
    case "rrect": {
      if (u < s.x0 || u > s.x1 || v < s.y0 || v > s.y1) return false;
      const dx = Math.max(s.x0 + s.r - u, 0, u - (s.x1 - s.r));
      const dy = Math.max(s.y0 + s.r - v, 0, v - (s.y1 - s.r));
      return dx * dx + dy * dy <= s.r * s.r;
    }
    case "circle":
      return (u - s.cx) ** 2 + (v - s.cy) ** 2 <= s.r * s.r;
    case "line": {
      const dx = s.x1 - s.x0;
      const dy = s.y1 - s.y0;
      const t = Math.min(1, Math.max(0, ((u - s.x0) * dx + (v - s.y0) * dy) / (dx * dx + dy * dy || 1)));
      return Math.hypot(u - (s.x0 + dx * t), v - (s.y0 + dy * t)) <= s.w / 2;
    }
    default:
      throw new Error(`forma desconhecida: ${s.kind}`);
  }
}

function bbox(s) {
  switch (s.kind) {
    case "poly": {
      const xs = s.pts.map((p) => p[0]);
      const ys = s.pts.map((p) => p[1]);
      return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
    }
    case "rrect": return [s.x0, s.y0, s.x1, s.y1];
    case "circle": return [s.cx - s.r, s.cy - s.r, s.cx + s.r, s.cy + s.r];
    case "line": {
      const h = s.w / 2;
      return [Math.min(s.x0, s.x1) - h, Math.min(s.y0, s.y1) - h, Math.max(s.x0, s.x1) + h, Math.max(s.y0, s.y1) + h];
    }
    default: throw new Error(`forma desconhecida: ${s.kind}`);
  }
}

/** Devolve RGBA 8 bits (não pré-multiplicado), size×size. */
function render(size) {
  const pad = PADDING[size] ?? Math.round(size / 8);
  const scale = (size - 2 * pad) / 100;
  const k = Math.max(4, Math.round(1024 / size)); // amostras por pixel em cada eixo
  const n = size * k;
  const acc = new Float32Array(n * n * 4); // RGBA pré-multiplicado, 0..1

  for (const layer of design(levelFor(size))) {
    const [bx0, by0, bx1, by1] = bbox(layer);
    const px0 = Math.max(0, Math.floor((pad + bx0 * scale) * k));
    const py0 = Math.max(0, Math.floor((pad + by0 * scale) * k));
    const px1 = Math.min(n - 1, Math.ceil((pad + bx1 * scale) * k));
    const py1 = Math.min(n - 1, Math.ceil((pad + by1 * scale) * k));
    for (let py = py0; py <= py1; py++) {
      const v = ((py + 0.5) / k - pad) / scale;
      for (let px = px0; px <= px1; px++) {
        const u = ((px + 0.5) / k - pad) / scale;
        if (!inside(layer, u, v)) continue;
        const [r, g, b, a] = sampleFill(layer.fill, u, v);
        if (a <= 0) continue;
        const i = (py * n + px) * 4;
        const keep = 1 - a;
        acc[i] = (r / 255) * a + acc[i] * keep;
        acc[i + 1] = (g / 255) * a + acc[i + 1] * keep;
        acc[i + 2] = (b / 255) * a + acc[i + 2] * keep;
        acc[i + 3] = a + acc[i + 3] * keep;
      }
    }
  }

  const out = Buffer.alloc(size * size * 4);
  const samples = k * k;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < k; sy++) {
        let i = ((y * k + sy) * n + x * k) * 4;
        for (let sx = 0; sx < k; sx++, i += 4) {
          r += acc[i]; g += acc[i + 1]; b += acc[i + 2]; a += acc[i + 3];
        }
      }
      const o = (y * size + x) * 4;
      if (a > 0) {
        out[o] = Math.round((r / a) * 255);
        out[o + 1] = Math.round((g / a) * 255);
        out[o + 2] = Math.round((b / a) * 255);
      }
      out[o + 3] = Math.round((a / samples) * 255);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// PNG (RGBA 8 bits, sem filtro)
// ---------------------------------------------------------------------------

function makeCrcTable() {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
}
const CRC_TABLE = makeCrcTable();

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
}

function pngChunk(type, data) {
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  chunk.write(type, 4, 4, "ascii");
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, "ascii"), data])), 8 + data.length);
  return chunk;
}

function encodePng(size, rgba) {
  const stride = 1 + size * 4;
  const raw = Buffer.alloc(size * stride);
  for (let y = 0; y < size; y++) {
    raw[y * stride] = 0;
    rgba.copy(raw, y * stride + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bits por canal
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------
// SVG (mesmo desenho, nível "full")
// ---------------------------------------------------------------------------

function toSvg(layers) {
  const defs = [];
  const num = (v) => String(Math.round(v * 100) / 100);
  const rgb = (c) => `rgb(${c[0]},${c[1]},${c[2]})`;
  const stopsSvg = (stops) =>
    stops.map(([t, c]) => `<stop offset="${num(t)}" stop-color="${rgb(c)}"${c[3] < 1 ? ` stop-opacity="${num(c[3])}"` : ""}/>`).join("");
  const paint = (fill, attr) => {
    if (fill.type === "solid") {
      return `${attr}="${rgb(fill.color)}"${fill.color[3] < 1 ? ` ${attr}-opacity="${num(fill.color[3])}"` : ""}`;
    }
    const id = `g${defs.length}`;
    if (fill.type === "linear") {
      defs.push(`<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${num(fill.x0)}" y1="${num(fill.y0)}" x2="${num(fill.x1)}" y2="${num(fill.y1)}">${stopsSvg(fill.stops)}</linearGradient>`);
    } else {
      defs.push(`<radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="${num(fill.cx)}" cy="${num(fill.cy)}" r="${num(fill.r)}">${stopsSvg(fill.stops)}</radialGradient>`);
    }
    return `${attr}="url(#${id})"`;
  };

  const body = layers.map((s) => {
    switch (s.kind) {
      case "poly": return `<polygon points="${s.pts.map((p) => p.map(num).join(",")).join(" ")}" ${paint(s.fill, "fill")}/>`;
      case "rrect": return `<rect x="${num(s.x0)}" y="${num(s.y0)}" width="${num(s.x1 - s.x0)}" height="${num(s.y1 - s.y0)}" rx="${num(s.r)}" ${paint(s.fill, "fill")}/>`;
      case "circle": return `<circle cx="${num(s.cx)}" cy="${num(s.cy)}" r="${num(s.r)}" ${paint(s.fill, "fill")}/>`;
      case "line": return `<line x1="${num(s.x0)}" y1="${num(s.y0)}" x2="${num(s.x1)}" y2="${num(s.y1)}" stroke-width="${num(s.w)}" stroke-linecap="round" ${paint(s.fill, "stroke")}/>`;
      default: throw new Error(`forma desconhecida: ${s.kind}`);
    }
  });

  return [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="128" height="128">',
    "  <!-- Gerado por build-icons.js. Edite o script, não este arquivo. -->",
    `  <defs>${defs.join("")}</defs>`,
    ...body.map((line) => `  ${line}`),
    "</svg>",
    "",
  ].join("\n");
}

// ---------------------------------------------------------------------------

const svgPath = join(__dirname, "icon.svg");
writeFileSync(svgPath, toSvg(design("full")));
console.log(`ok  ${svgPath}`);

for (const size of [16, 32, 48, 128]) {
  const path = join(__dirname, `icon${size}.png`);
  writeFileSync(path, encodePng(size, render(size)));
  console.log(`ok  ${path}  ${size}x${size}  (${levelFor(size)})`);
}
