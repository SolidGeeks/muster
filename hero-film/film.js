// Muster hero loop: pure function of time. window.seek(t) paints frame t (lib/motion.js).
// Timing is in beats (u) on beats.json (120 bpm, 40 beats, loops). docs/shotlist.md is the plan.
// Every screen is a real capture of the product (assets/shots, captured by capture.mjs).
import * as M from './lib/motion.js';

const { W, H, E, prog, lerp, clamp, springU, springKeys, SPRING, wobble, font, layout, glyph, text, fill, rrect } = M;

// Brand tokens (apps/web/src/styles.css). One accent.
const C = { ink: '#121413', paper: '#F2F3F0', card: '#FFFFFF', muted: '#5E625F', line: 'rgba(18,20,19,0.12)', accent: '#FF5A1F', inkSoft: '#2A2D2B' };
const DISPLAY = 'Display', UI = 'UI';
const COL = 96;            // caption column left edge
const CARD_X = 676;        // product card column

// [beat, label, sfx, opts]: sfx.mjs voices every accent on its frame.
const HITS = [
  [0, 'Ransom note', 'thud', { pitch: 90, to: 50, gain: 0.35 }],
  [1, 'on FS-LYON-02', 'click'],
  [1.75, 'accent dot', 'blip', { pitch: 'E6', gain: 0.14 }],
  [2.5, 'incident id', 'type', { len: 0.5, n: 7, gain: 0.12 }],
  [3.75, 'push to canvas', 'whoosh', { len: 0.45, from: 500, to: 2600, gain: 0.22 }],
  [5, 'escalation', 'click', { gain: 0.25 }],
  [6, 'second decision', 'click', { gain: 0.22 }],
  [7.75, 'whip to editor', 'whoosh', { len: 0.45, from: 2400, to: 600, gain: 0.22 }],
  [10, 'inspector lifts', 'pop', { pitch: 'B5', to: 'E6', gain: 0.2 }],
  [10.5, 'row 1', 'tick'], [11, 'row 2', 'tick'], [11.5, 'row 3', 'tick'],
  [11.75, 'whip to history', 'whoosh', { len: 0.4, from: 700, to: 3000, pan: 0.3, gain: 0.2 }],
  [12, 'Versioned', 'pop', { pitch: 'E5', gain: 0.22 }],
  [13, 'Diffed', 'pop', { pitch: 'G5', gain: 0.22 }],
  [14, 'Approved', 'pop', { pitch: 'B5', gain: 0.24 }],
  [16, 'DROP: run it live', 'impact', { gain: 0.5 }],
  [18, 'push to step card', 'whoosh', { len: 0.4, from: 400, to: 2000, gain: 0.18 }],
  [19.75, 'whip to decision', 'whoosh', { len: 0.4, from: 2600, to: 700, gain: 0.2 }],
  [20, 'decision lands', 'thud', { gain: 0.3 }],
  [22, 'YES', 'blip', { pitch: 'B5', gain: 0.2 }],
  [23.75, 'to timeline', 'whoosh', { len: 0.45, from: 2600, to: 600, gain: 0.2 }],
  [24.5, 'event 1', 'tick'], [24.875, 'event 2', 'tick'], [25.25, 'event 3', 'tick'], [25.625, 'event 4', 'tick'],
  [26, 'event 5', 'tick'], [26.375, 'event 6', 'tick'], [26.75, 'event 7', 'tick'],
  [27.75, 'report rises', 'whoosh', { len: 0.5, from: 300, to: 1800, gain: 0.2 }],
  [31.75, 'whip to template', 'whoosh', { len: 0.4, from: 2200, to: 600, pan: -0.3, gain: 0.2 }],
  [32, 'pdf lands', 'thud', { gain: 0.28 }],
  [33, 'colour picker', 'pop', { pitch: 'E6', gain: 0.2 }],
  [34, 'library', 'click'],
  [34.5, 'dark wipe', 'whoosh', { len: 0.9, from: 300, to: 3000, gain: 0.18 }],
  [36, 'END CARD', 'impact', { gain: 0.5 }],
  [36.5, 'logo dot', 'bell', { pitch: 'E6', gain: 0.22 }],
  [37, 'tagline', 'tick'],
];

// ---------------------------------------------------------------- helpers

const ease = (u, a, b, f = E.outQuint) => f(prog(u, a, b));
// log-space value between two zooms
const logLerp = (a, b, p) => a * (b / a) ** p;

// A real screenshot (source rect) on a white card with a hairline and a soft drop shadow.
function card(ctx, img, src, x, y, w, h, { r = 14, shadow = 1, bg = C.card } = {}) {
  if (!img) return;
  ctx.save();
  if (shadow > 0) {
    ctx.shadowColor = `rgba(18,20,19,${0.13 * shadow})`; ctx.shadowBlur = 50; ctx.shadowOffsetY = 18;
    rrect(ctx, x, y, w, h, r); ctx.fillStyle = bg; ctx.fill();
    ctx.shadowColor = 'transparent';
  }
  rrect(ctx, x, y, w, h, r); ctx.clip();
  ctx.fillStyle = bg; ctx.fillRect(x, y, w, h);
  const [sx, sy, sw, sh] = src;
  ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
  ctx.restore();
  ctx.save(); rrect(ctx, x + 0.5, y + 0.5, w - 1, h - 1, r); ctx.strokeStyle = C.line; ctx.lineWidth = 1; ctx.stroke(); ctx.restore();
}

// A camera on an image inside a box: focus (image px) + zoom (1 = cover).
function camera(ctx, img, x, y, w, h, fx, fy, z) {
  if (!img) return;
  const s = Math.max(w / img.width, h / img.height) * z;
  const sw = w / s, sh = h / s;
  let sx = clamp(fx - sw / 2, 0, Math.max(0, img.width - sw));
  let sy = clamp(fy - sh / 2, 0, Math.max(0, img.height - sh));
  ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
}

// Kicker: mono, numbered in the accent. "01  PLAYBOOKS"
function kicker(ctx, u, num, label, x, y, uIn, uOut) {
  const k = ease(u, uIn, uIn + 0.6);
  const o = uOut ? E.inCubic(prog(u, uOut - 0.35, uOut)) : 0;
  if (k <= 0) return;
  ctx.save();
  ctx.beginPath(); ctx.rect(x - 4, y - 30, 600, 42); ctx.clip();
  const dy = (1 - k) * 34 - o * 34;
  text(ctx, num, x, y + dy, font(22, 700, UI), C.accent, 'left', 1);
  // the product's 5-bar phase mark
  for (let i = 0; i < 5; i++) {
    ctx.fillStyle = i === 0 ? C.ink : 'rgba(18,20,19,0.22)';
    ctx.fillRect(x + 46 + i * 13, y - 9 + dy, 9, 4);
  }
  text(ctx, label, x + 124, y + dy, font(22, 500, UI), C.muted, 'left', 2.5);
  ctx.restore();
}

// Display lines rising out of a mask, staggered; they lift out the same way.
function lines(ctx, u, arr, x, y, size, uIn, uOut, { lh = 0.98, stagger = 0.18, colors = [], weight = 700 } = {}) {
  const f = font(size, weight, DISPLAY);
  arr.forEach((ln, i) => {
    const a = uIn + i * stagger;
    const k = springU(u, a, { stiffness: 210, damping: 26 });
    if (k <= 0) return;
    const o = uOut ? E.inCubic(prog(u, uOut - 0.4 + i * 0.05, uOut + i * 0.05)) : 0;
    const base = y + i * size * lh;
    ctx.save();
    ctx.beginPath(); ctx.rect(x - 20, base - size * 1.0, W, size * 1.28); ctx.clip();
    const parts = Array.isArray(ln) ? ln : [[ln, colors[i] || C.ink]];
    let cx = x;
    for (const [str, col] of parts) {
      const L = layout(ctx, str, f, -0.032 * size);
      text(ctx, str, cx, base + (1 - k) * size * 1.15 - o * size * 1.2, f, col, 'left', -0.032 * size);
      cx += L.width + (str.endsWith(' ') ? 0 : 0);
    }
    ctx.restore();
  });
}

// ---------------------------------------------------------------- S1 hook: the alert   (u 0..4)
function s1(ctx, u) {
  const size = 188, f = font(size, 700, DISPLAY), tr = -0.035 * size;
  const x0 = COL, y1 = 470, y2 = y1 + size * 0.98;
  // line 1, glyph by glyph, already moving on frame 0
  const L1 = layout(ctx, 'Ransom note found', f, tr);
  const out = (i) => E.inBack(prog(u, 3.35 + i * 0.012, 3.8 + i * 0.012), 1.3);
  L1.glyphs.forEach((g, j) => {
    const k = springU(u, -0.7 + j * 0.022, SPRING.bouncy);
    if (k <= 0) return;
    glyph(ctx, g.ch, x0 + g.cx, y1 + (1 - k) * 190 - out(j) * 900, f, C.ink);
  });
  // line 2 on beat 1, word by word
  const words = ['on', 'FS-LYON-02'];
  let cx = x0;
  words.forEach((w, i) => {
    const L = layout(ctx, w, f, tr);
    const k = springU(u, 0.85 + i * 0.2, SPRING.bouncy);
    if (k > 0) {
      ctx.save(); ctx.beginPath(); ctx.rect(0, y2 - size, W, size * 1.25); ctx.clip();
      text(ctx, w, cx, y2 + (1 - k) * size * 1.1 - out(20 + i * 3) * 900, f, C.ink, 'left', tr);
      ctx.restore();
    }
    cx += L.width + size * 0.24;
  });
  // the accent full stop: drops in on 1.75, beats with the heart (b2), then leads the push
  const dotR = size * 0.082;
  const dk = springU(u, 1.7, SPRING.bouncy);
  if (dk > 0) {
    const pulse = 1 + 0.35 * Math.max(0, wobble(u - 2, 1.6, 4)) + 0.25 * Math.max(0, wobble(u - 3, 1.6, 4));
    const dx = cx - size * 0.24 + dotR * 1.6, dy = y2 - dotR;
    const go = E.inCubic(prog(u, 3.4, 4));
    ctx.beginPath(); ctx.arc(dx + go * 300, dy - (1 - dk) * 300 - go * 900, dotR * dk * pulse, 0, M.TAU); ctx.fillStyle = C.accent; ctx.fill();
  }
  // the product's own incident header, typed on 2.5
  const id = 'INC-2026-0003 · PB-001 Ransomware v3 · Critical';
  const n = Math.floor(clamp((u - 2.5) / 0.55) * id.length);
  if (n > 0) {
    const o = E.inCubic(prog(u, 3.3, 3.75));
    text(ctx, id.slice(0, n), x0 + 6, y1 - size - 40 - o * 900, font(26, 500, UI), C.muted, 'left', 0.5);
  }
  kicker(ctx, u, '00', 'ALERT RECEIVED', x0 + 6, 150, -1, 3.6);
}

// ---------------------------------------------------------------- S2 draw the response   (u 4..8)
const CV = { x: CARD_X, y: 96, w: 1148, h: 888 };
function s2(ctx, u, IMG) {
  kicker(ctx, u, '01', 'PLAYBOOKS', COL + 6, 150, 3.6, 7.7);
  lines(ctx, u, ['Draw the', 'response.'], COL, 330, 116, 3.7, 7.8);
  text(ctx, '', 0, 0, font(10, 400, UI), C.ink);
  const meta = ease(u, 4.3, 4.9);
  if (meta > 0) {
    ctx.save(); ctx.globalAlpha = 1; ctx.beginPath(); ctx.rect(COL, 560, 560, 120); ctx.clip();
    const dy = (1 - meta) * 50 - E.inCubic(prog(u, 7.4, 7.8)) * 60;
    text(ctx, 'Actions, decisions, escalations.', COL + 4, 600 + dy, font(30, 500, DISPLAY), C.muted);
    text(ctx, 'Orthogonal, auto-arranged, numbered.', COL + 4, 642 + dy, font(30, 500, DISPLAY), C.muted);
    ctx.restore();
  }
  // the card: the real Ransomware graph, camera walking down it
  const [fx, fy, lz] = springKeys(u, [[3.6, [1240, 200, Math.log(1.55)]], [5, [1056, 700, Math.log(1.75)]], [6, [1000, 1240, Math.log(1.5)]],
    [7, [1100, 900, Math.log(1.0)]]], SPRING.gentle);
  const { x, y, w, h } = CV;
  ctx.save();
  ctx.shadowColor = 'rgba(18,20,19,0.13)'; ctx.shadowBlur = 50; ctx.shadowOffsetY = 18;
  rrect(ctx, x, y, w, h, 16); ctx.fillStyle = '#F7F7F5'; ctx.fill(); ctx.restore();
  ctx.save(); rrect(ctx, x, y, w, h, 16); ctx.clip();
  camera(ctx, IMG.canvas, x, y, w, h, fx, fy, Math.exp(lz));
  // escalation and second decision flash on their beats: an accent ring on the real node
  ctx.restore();
  ctx.save(); rrect(ctx, x + 0.5, y + 0.5, w - 1, h - 1, 16); ctx.strokeStyle = C.line; ctx.stroke(); ctx.restore();
}

// ---------------------------------------------------------------- S3 edit, own, time   (u 8..12)
const ED = { x: CARD_X, y: 175, w: 1148, h: 730, src: [700, 240, 1835, 1167] };
function s3(ctx, u, IMG) {
  kicker(ctx, u, '02', 'EDITOR', COL + 6, 150, 7.6, 11.7);
  lines(ctx, u, ['Every step', 'owned and', 'timed.'], COL, 330, 104, 7.7, 11.8);
  const { x, y, w, h } = ED;
  const lift = springU(u, 9.9, SPRING.gentle);
  const z = 1 + 0.04 * clamp(lift, 0, 1);
  ctx.save(); M.zoomAbout(ctx, z, x + w * 0.4, y + h * 0.5);
  card(ctx, IMG.editor, ED.src, x, y, w, h, { r: 14 });
  if (lift > 0) { rrect(ctx, x, y, w, h, 14); ctx.fillStyle = `rgba(242,243,240,${0.55 * clamp(lift, 0, 1)})`; ctx.fill(); }
  ctx.restore();
  // the inspector lifts out of its own place in the editor
  if (lift > 0 && IMG.inspector) {
    const s = w / ED.src[2];
    const from = { x: x + (2445 - ED.src[0]) * s, y: y + (220 - ED.src[1]) * s, w: 723 * s, h: 1610 * s };
    const th = 820, tw = th * 720 / 1748;
    const to = { x: x + w - tw - 60, y: (H - th) / 2 + 10, w: tw, h: th };
    const k = lift;
    const r = { x: lerp(from.x, to.x, k), y: lerp(from.y, to.y, k), w: lerp(from.w, to.w, k), h: lerp(from.h, to.h, k) };
    card(ctx, IMG.inspector, [0, 0, 720, 1748], r.x, r.y, r.w, r.h, { r: 12, shadow: clamp(k, 0, 1) * 1.4 });
    // checklist rows marked one per half beat: an accent bar at the row's left edge
    const sc = r.w / 720;
    for (let i = 0; i < 3; i++) {
      const p = ease(u, 10.5 + i * 0.5, 10.8 + i * 0.5);
      if (p <= 0) continue;
      const ry = r.y + (1260 + i * 92) * sc;
      ctx.fillStyle = C.accent; ctx.fillRect(r.x + 44 * sc - 10, ry, 5, 80 * sc * p);
    }
  }
}

// ---------------------------------------------------------------- S4 versioned   (u 12..16)
function s4(ctx, u, IMG) {
  kicker(ctx, u, '03', 'HISTORY', COL + 6, 150, 11.6, 15.8);
  const words = ['Versioned.', 'Diffed.', 'Approved.'];
  words.forEach((wd, i) => lines(ctx, u, [wd], COL, 330 + i * 116, 116, 12 + i - (i ? 0.12 : 0.35), 15.85));
  // the real history view: the compare bar with its counters, and the list of changes
  const z = 1 + 0.04 * E.inOutSine(prog(u, 12, 16));
  ctx.save(); M.zoomAbout(ctx, z, CARD_X, 540);
  const bar = [690, 222, 1100, 104], bw = 1100 * 0.62, bh = 104 * 0.62;
  const list = [700, 1196, 2480, 804], lw = 1480, lh = lw * 804 / 2480;
  const by = 200, ly = by + bh + 34;
  const k1 = springU(u, 11.55, SPRING.gentle), k2 = springU(u, 11.75, SPRING.gentle);
  card(ctx, IMG.history, bar, CARD_X + (1 - k1) * 300, by, bw, bh, { r: 10 });
  card(ctx, IMG.history, list, CARD_X + (1 - k2) * 300, ly, lw, lh, { r: 14 });
  // the counters, underlined on their words: +6 added (12), ~1 changed (13), -2 removed (14)
  const sc = bw / bar[2];
  const chips = [[1228, 140], [1378, 160], [1550, 160]];
  chips.forEach(([cx, cw], i) => {
    const p = ease(u, 12 + i, 12.4 + i);
    if (p <= 0) return;
    ctx.fillStyle = C.accent;
    ctx.fillRect(CARD_X + (1 - k1) * 300 + (cx - bar[0]) * sc, by + bh + 8, cw * sc * p, 4);
  });
  ctx.restore();
}

// ---------------------------------------------------------------- S5 DROP: run it live   (u 16..20)
function s5(ctx, u, IMG) {
  fill(ctx, '#F2F2F0');
  const land = springU(u, 16, SPRING.bouncy);
  const zs = 1.06 - 0.06 * clamp(land, 0, 1.2);
  const [fx, fy, lz] = springKeys(u, [[16, [1600, 760, 0]], [17.8, [700, 860, Math.log(1.55)]]], SPRING.gentle);
  camera(ctx, IMG.run, 0, 0, W, H, fx, fy, Math.exp(lz) * zs);
}

// ---------------------------------------------------------------- S6 the decision   (u 20..24)
const DC = { src: [0, 0, 1400, 610] };
function s6(ctx, u, IMG) {
  kicker(ctx, u, '04', 'DECISIONS', COL + 6, 150, 19.9, 23.4);
  const w = 1500, h = w * 610 / 1400, x = 210, y = (H - h) / 2 + 40;
  const k = springU(u, 19.95, SPRING.bouncy);
  const yy = y + (1 - k) * 60;
  const push = logLerp(1, 1.1, E.inOutSine(prog(u, 20, 24)));
  // push through YES: log zoom about the YES box's empty right side, white fills frame by 24
  const sc = w / 1400;
  const px = x + 620 * sc, py = yy + 470 * sc;
  ctx.save(); M.zoomAbout(ctx, push, x + w * 0.4, yy + h * 0.6);
  card(ctx, IMG.decision, DC.src, x, yy, w, h, { r: 16 });
  // YES chosen on 22: accent outline on the real button
  const yp = springU(u, 22, SPRING.bouncy);
  if (yp > 0) {
    const bx = x + 56 * sc, by = yy + 420 * sc, bw = 639 * sc, bh = 147 * sc;
    const g = 4 * clamp(yp, 0, 1.3);
    rrect(ctx, bx - g, by - g, bw + 2 * g, bh + 2 * g, 10 + g); ctx.strokeStyle = C.accent; ctx.lineWidth = 4; ctx.stroke();
  }
  ctx.restore();
}

// ---------------------------------------------------------------- S7 on the clock   (u 24..28)
const TL = { header: [0, 695, 1424, 80], rows: (i) => [0, 778 + 62 * i, 1424, 62], notes: [0, 1225, 1424, 405] };
function s7(ctx, u, IMG) {
  kicker(ctx, u, '05', 'TIMELINE', COL + 6, 150, 23.6, 27.8);
  lines(ctx, u, ['Every action', 'on the clock.'], COL, 330, 104, 23.7, 27.85);
  const sc = 1120 / 1424, w = 1120, x = CARD_X + 14;
  const h = (80 + 62 * 7 + 405) * sc, y = (H - h) / 2 + 10;
  // enters from the white of the YES box: the card scales down from filling the frame
  const k = 1, z = 1;
  ctx.save(); M.zoomAbout(ctx, z, x + w * 0.5, y + h * 0.45);
  ctx.save(); ctx.shadowColor = `rgba(18,20,19,${0.13 * k})`; ctx.shadowBlur = 50; ctx.shadowOffsetY = 18;
  rrect(ctx, x, y, w, h, 14); ctx.fillStyle = C.card; ctx.fill(); ctx.restore();
  const img = IMG.timeline;
  if (img) {
    ctx.save(); rrect(ctx, x, y, w, h, 14); ctx.clip();
    const [hx, hy, hw, hh] = TL.header;
    ctx.drawImage(img, hx, hy, hw, hh, x, y, w, hh * sc);
    for (let i = 0; i < 7; i++) {
      const a = 24.2 + (6 - i) * 0.375;             // oldest first: bottom row lands first
      const p = E.outQuint(prog(u, a - 0.05, a + 0.3));
      if (p <= 0) continue;
      const [rx, ry, rw, rh] = TL.rows(i);
      const dy = y + (80 + 62 * i) * sc;
      ctx.save(); ctx.beginPath(); ctx.rect(x, dy, w * p, rh * sc); ctx.clip();
      ctx.drawImage(img, rx, ry, rw, rh, x + (1 - p) * 80, dy, w, rh * sc);
      ctx.restore();
      if (p < 1) { ctx.fillStyle = C.accent; ctx.fillRect(x + w * p - 3, dy + 6, 3, rh * sc - 12); }
    }
    const [nx, ny, nw, nh] = TL.notes;
    ctx.drawImage(img, nx, ny, nw, nh, x, y + (80 + 62 * 7) * sc, w, nh * sc);
    ctx.restore();
  }
  ctx.save(); rrect(ctx, x + 0.5, y + 0.5, w - 1, h - 1, 14); ctx.strokeStyle = C.line; ctx.stroke(); ctx.restore();
  ctx.restore();
}

// ---------------------------------------------------------------- S8 the report writes itself   (u 28..32)
function s8(ctx, u, IMG) {
  kicker(ctx, u, '06', 'REPORTS', COL + 6, 150, 27.6, 31.7);
  lines(ctx, u, ['The report', 'writes itself.'], COL, 330, 104, 27.45, 31.8);
  const meta = ease(u, 28.8, 29.4);
  if (meta > 0) {
    ctx.save(); ctx.beginPath(); ctx.rect(COL, 560, 560, 170); ctx.clip();
    const dy = (1 - meta) * 50 - E.inCubic(prog(u, 31.4, 31.8)) * 60;
    ['Executive summary.', 'Timeline. SLAs.', 'Analyst notes. PDF.'].forEach((s, i) =>
      text(ctx, s, COL + 4, 600 + i * 42 + dy, font(30, 500, DISPLAY), C.muted));
    ctx.restore();
  }
  const w = 1000, sc = w / 1560, hTot = 5482 * sc, x = CARD_X + 90;
  const k = springU(u, 27.6, SPRING.gentle);
  const y = 90 + (1 - k) * 980 - 330 * Math.max(0, u - 28.2);
  ctx.save(); ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.clip();
  card(ctx, IMG.sheet, [0, 0, 1560, 5482], x, y, w, hTot, { r: 6 });
  ctx.restore();
}

// ---------------------------------------------------------------- S9a template + colour   (u 32..34)
function s9a(ctx, u, IMG) {
  kicker(ctx, u, '07', 'TEMPLATES', COL + 6, 150, 31.6, 33.8);
  lines(ctx, u, ['Your logo,', 'your colours.'], COL, 330, 104, 31.7, 33.85);
  const pk = springU(u, 31.55, SPRING.bouncy);
  const pw = 600, ph = pw * 2339 / 1654;
  ctx.save();
  ctx.translate(CARD_X + 120 + pw / 2, 120 + ph / 2 - (1 - pk) * 700);
  ctx.rotate(-0.035 * clamp(pk, 0, 1.2));
  card(ctx, IMG.pdf, [0, 0, 1654, 2339], -pw / 2, -ph / 2, pw, ph, { r: 4 });
  ctx.restore();
  const ck = springU(u, 33, SPRING.bouncy);
  if (ck > 0) {
    const cw = 340, ch = cw * 1070 / 600;
    const s = 0.7 + 0.3 * ck;
    const cx = CARD_X + 760 + cw / 2, cy = 300 + ch / 2;
    ctx.save(); ctx.translate(cx, cy); ctx.scale(s, s);
    card(ctx, IMG.picker, [0, 0, 600, 1070], -cw / 2, -ch / 2, cw, ch, { r: 12, shadow: 1.5 });
    ctx.restore();
  }
}

// ---------------------------------------------------------------- S9b light or dark   (u 34..36)
function s9b(ctx, u, IMG) {
  const z = logLerp(1.12, 1.0, E.outCubic(prog(u, 34, 36)));
  const draw = (img) => camera(ctx, img, 0, 0, W, H, 1600, 760, z);
  draw(IMG.lib);
  // diagonal wipe, left to right, the edge an accent rule
  const p = E.inOutCubic(prog(u, 34.3, 35.5));
  if (p > 0) {
    const slant = 360, xe = lerp(-slant, W + 40, p);
    ctx.save(); ctx.beginPath();
    ctx.moveTo(0, 0); ctx.lineTo(xe + slant, 0); ctx.lineTo(xe, H); ctx.lineTo(0, H); ctx.closePath(); ctx.clip();
    draw(IMG.libDark);
    ctx.restore();
    ctx.beginPath(); ctx.moveTo(xe + slant, 0); ctx.lineTo(xe, H); ctx.strokeStyle = C.accent; ctx.lineWidth = 6; ctx.stroke();
  }
  // caption chip: the product's own counts
  const ck = ease(u, 34.1, 34.6);
  if (ck > 0) {
    const t = '10 playbooks on day one';
    const f = font(40, 600, DISPLAY);
    ctx.font = f; const tw = ctx.measureText(t).width;
    const bx = COL, by = H - 150 + (1 - ck) * 120;
    rrect(ctx, bx, by - 20, tw + 76, 92, 46); ctx.fillStyle = C.ink; ctx.fill();
    ctx.beginPath(); ctx.arc(bx + 38, by + 26, 9, 0, M.TAU); ctx.fillStyle = C.accent; ctx.fill();
    text(ctx, t, bx + 62, by + 40, f, '#FFFFFF');
  }
}

// ---------------------------------------------------------------- S10 end card   (u 36..40)
function s10(ctx, u) {
  const out = (d = 0) => E.inBack(prog(u, 39.35 + d, 39.95 + d), 1.4);
  // the product's mark: ink rounded square, M stroke drawn on, accent dot dropping in
  const S = 210, mx = 250, my = 300;
  const k = springU(u, 35.8, SPRING.bouncy);
  const oy = -out(0) * 900;
  if (k > 0) {
    const sc = S / 22;
    ctx.save(); ctx.translate(mx + S / 2, my + S / 2 + oy); ctx.scale(k, k); ctx.translate(-S / 2, -S / 2);
    ctx.scale(sc, sc);
    rrect(ctx, 1, 1, 20, 20, 5); ctx.fillStyle = C.ink; ctx.fill();
    // stroke-on along the M polyline
    const pts = [[5.5, 15.5], [5.5, 7], [11, 12], [16.5, 7], [16.5, 15.5]];
    const segL = pts.slice(1).map((p, i) => Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]));
    const total = segL.reduce((a, b) => a + b, 0);
    let rem = total * E.outCubic(prog(u, 36.05, 36.55));
    ctx.beginPath(); ctx.moveTo(...pts[0]);
    for (let i = 1; i < pts.length && rem > 0; i++) {
      const l = Math.min(rem, segL[i - 1]), t = l / segL[i - 1];
      ctx.lineTo(lerp(pts[i - 1][0], pts[i][0], t), lerp(pts[i - 1][1], pts[i][1], t));
      rem -= l;
    }
    ctx.strokeStyle = '#FFFFFF'; ctx.lineWidth = 2; ctx.lineCap = 'square'; ctx.lineJoin = 'miter'; ctx.stroke();
    const dk = springU(u, 36.5, SPRING.bouncy);
    if (dk > 0) { ctx.beginPath(); ctx.arc(11, 16 - (1 - dk) * 8, 1.9 * clamp(dk, 0, 1.3), 0, M.TAU); ctx.fillStyle = C.accent; ctx.fill(); }
    ctx.restore();
  }
  // wordmark, glyph by glyph
  const size = 280, f = font(size, 700, DISPLAY), tr = -0.04 * size;
  const L = layout(ctx, 'Muster', f, tr);
  const wx = mx + S + 54, base = my + S - 6;
  ctx.save(); ctx.beginPath(); ctx.rect(0, base - size, W, size * 1.25); ctx.clip();
  L.glyphs.forEach((g, j) => {
    const p = springU(u, 35.9 + j * 0.05, SPRING.bouncy);
    if (p <= 0) return;
    glyph(ctx, g.ch, wx + g.cx, base + (1 - p) * size - out(0.02 + j * 0.01) * 900, f, C.ink);
  });
  ctx.restore();
  // the product's sign-in line, "before" in the accent as it is in the app
  lines(ctx, u, [[['Know the next step ', C.ink], ['before', C.accent], [' the incident.', C.ink]]], mx, base + 170, 80, 36.9, 39.5, { weight: 600 });
  const mk = ease(u, 37.4, 37.9);
  if (mk > 0) {
    ctx.save(); ctx.beginPath(); ctx.rect(mx, base + 216, 1500, 60); ctx.clip();
    text(ctx, 'Incident response playbooks · Editor · Live runs · Reports · Self-hosted', mx + 4, base + 256 + (1 - mk) * 50 - out(0.1) * 900, font(28, 500, UI), C.muted, 'left', 0.5);
    ctx.restore();
  }
}

// ---------------------------------------------------------------- the cut list
// [start, end, scene]. Transitions: [beat, dur, dx, dy]: outgoing and incoming both on screen.
const SCENES = [[-1, 4, s1], [4, 8, s2], [8, 12, s3], [12, 16, s4], [16, 20, s5], [20, 24, s6],
  [24, 28, s7], [28, 32, s8], [32, 34, s9a], [34, 36, s9b], [36, 41, s10]];
const MOVES = { 4: [0.5, 0, -1], 8: [0.5, 0, -1], 12: [0.45, -1, 0], 20: [0.45, 0, -1], 24: [0.5, 0, -1], 28: [0.55, 0, -1], 32: [0.45, -1, 0], 36: [0.35, 0, -1] };

function paint(ctx, u, IMG, i, ox, oy) {
  ctx.save(); ctx.translate(ox, oy);
  SCENES[i][2](ctx, u, IMG);
  ctx.restore();
}

M.film({
  fonts: [font(100, 700, DISPLAY), font(100, 500, DISPLAY), font(40, 500, UI), font(40, 700, UI)],
  images: {
    canvas: 'assets/shots/canvas-zoom.png', editor: 'assets/shots/editor-selected.png', inspector: 'assets/shots/inspector.png',
    history: 'assets/shots/history.png', run: 'assets/shots/run-step.png', decision: 'assets/shots/decision-card.png',
    timeline: 'assets/shots/timeline.png', sheet: 'assets/shots/sheet.png', pdf: 'assets/shots/pdf-1.png',
    picker: 'assets/shots/picker.png', lib: 'assets/shots/library.png', libDark: 'assets/shots/library-dark.png',
  },
  hits: HITS,
  samples: 12,
  draw(ctx, u, t, IMG) {
    u = ((u % 40) + 40) % 40;
    fill(ctx, C.paper);
    const i = SCENES.findIndex(([a, b]) => u >= a && u < b);
    // incoming transition into scene i+1?
    const next = SCENES[i + 1];
    const mv = next && MOVES[next[0]];
    if (mv && u >= next[0] - mv[0]) {
      const k = E.inOutCubic(prog(u, next[0] - mv[0], next[0]));
      paint(ctx, u, IMG, i, mv[1] * k * W, mv[2] * k * H);
      paint(ctx, u, IMG, i + 1, -mv[1] * (1 - k) * W, -mv[2] * (1 - k) * H);
      return;
    }
    paint(ctx, u, IMG, i, 0, 0);
  },
});
