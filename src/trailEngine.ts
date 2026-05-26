import { clamp, hexToRgba, num, smoothstep01, str } from './util';

interface Point { x: number; y: number; t: number; br?: boolean; lmb?: boolean; rmb?: boolean; }
interface Sample extends Point { age01: number; fade: number; width: number; color: string; }

const INPUT_SUBSTEP_DISTANCE = 2.1;
const MAX_SUBSTEPS_PER_FRAME = 128;
const TAPER_SAMPLES = 12;
const MAX_INTERNAL_POINTS = 1024;
const MAX_RENDER_SAMPLES = 2048;
const MAX_SMOOTH_POINTS = 2048;
const DEFAULT_MAX_TRAIL_DISTANCE = 165;
const SHARP_TURN_DOT = 0.25;
const REVERSAL_TURN_DOT = -0.35;

export class TrailRuntime {
  points: Point[] = [];
  cursorX: number;
  cursorY: number;
  worldCursorX: number;
  worldCursorY: number;
  viewOffsetX = 0;
  viewOffsetY = 0;
  lastInputTime = 0;
  constructor(w: number, h: number) {
    this.cursorX = w / 2;
    this.cursorY = h / 2;
    this.worldCursorX = w / 2;
    this.worldCursorY = h / 2;
  }
}

export function updateTrail(rt: TrailRuntime, cfg: any, w: number, h: number, dx: number, dy: number, lmb: boolean, rmb: boolean, now: number, dt: number): void {
  if (cfg.enabled === false) {
    rt.points = [];
    rt.lastInputTime = 0;
    return;
  }

  const life = Math.max(50, num(cfg.lifetimeMs, 850));
  rt.points = rt.points.filter(p => now - p.t <= life);
  pruneByDistance(rt, cfg, w);

  const mode = cfg.mode ?? 'wrap';
  const sensitivity = num(cfg.sensitivity, 1);
  const mx = dx * sensitivity;
  const my = dy * sensitivity;
  const dist = Math.hypot(mx, my);
  const hasMove = dist > 0.001;

  if (!hasMove) {
    if (rt.points.length === 0 && cfg.resetMode === 'center_on_empty') resetToCenter(rt, mode, w, h);
    if (mode === 'pan') centerPan(rt, w, h);
    return;
  }

  const prevTime = rt.lastInputTime || Math.max(0, now - Math.max(0, dt) * 1000);
  if (rt.points.length === 0) seedTrailAtCurrentPosition(rt, mode, prevTime, lmb, rmb);

  const steps = Math.min(MAX_SUBSTEPS_PER_FRAME, Math.max(1, Math.ceil(dist / INPUT_SUBSTEP_DISTANCE)));
  const sx = mx / steps;
  const sy = my / steps;
  for (let i = 1; i <= steps; i++) {
    const stepTime = prevTime + (now - prevTime) * (i / steps);
    if (mode === 'pan') panStep(rt, w, h, sx, sy, lmb, rmb, stepTime);
    else wrapStep(rt, w, h, sx, sy, lmb, rmb, stepTime);
    rt.lastInputTime = stepTime;
  }
  if (mode === 'pan') centerPan(rt, w, h);

  const cap = Math.max(64, Math.min(MAX_INTERNAL_POINTS, Math.max(num(cfg.maxPoints, 1024), 512)));
  if (rt.points.length > cap) rt.points.splice(0, rt.points.length - cap);
}

function resetToCenter(rt: TrailRuntime, mode: string, w: number, h: number) {
  rt.cursorX = w / 2;
  rt.cursorY = h / 2;
  if (mode === 'pan') {
    rt.worldCursorX = w / 2;
    rt.worldCursorY = h / 2;
    rt.viewOffsetX = 0;
    rt.viewOffsetY = 0;
  } else {
    rt.worldCursorX = rt.cursorX;
    rt.worldCursorY = rt.cursorY;
    rt.viewOffsetX = 0;
    rt.viewOffsetY = 0;
  }
}

function seedTrailAtCurrentPosition(rt: TrailRuntime, mode: string, time: number, lmb: boolean, rmb: boolean) {
  if (mode === 'pan') pushPoint(rt, rt.worldCursorX, rt.worldCursorY, time, lmb, rmb, false);
  else pushPoint(rt, rt.cursorX, rt.cursorY, time, lmb, rmb, false);
}

function wrapStep(rt: TrailRuntime, w: number, h: number, dx: number, dy: number, lmb: boolean, rmb: boolean, now: number) {
  let remainingDx = dx;
  let remainingDy = dy;
  let guard = 0;
  while (guard++ < 8) {
    const x0 = rt.cursorX;
    const y0 = rt.cursorY;
    const x1 = x0 + remainingDx;
    const y1 = y0 + remainingDy;
    if (x1 >= 0 && x1 <= w && y1 >= 0 && y1 <= h) {
      rt.cursorX = x1;
      rt.cursorY = y1;
      pushPoint(rt, rt.cursorX, rt.cursorY, now, lmb, rmb, false);
      return;
    }

    const cross = firstBoundaryCross(x0, y0, remainingDx, remainingDy, w, h);
    if (!cross) {
      rt.cursorX = clamp(mod(x1, w), 0, w);
      rt.cursorY = clamp(mod(y1, h), 0, h);
      pushPoint(rt, rt.cursorX, rt.cursorY, now, lmb, rmb, true);
      return;
    }

    const edgeX = clamp(x0 + remainingDx * cross.t, 0, w);
    const edgeY = clamp(y0 + remainingDy * cross.t, 0, h);
    pushPoint(rt, edgeX, edgeY, now, lmb, rmb, false);

    const usedDx = remainingDx * cross.t;
    const usedDy = remainingDy * cross.t;
    remainingDx -= usedDx;
    remainingDy -= usedDy;

    let nx = edgeX;
    let ny = edgeY;
    if (cross.side === 'right') nx = 0;
    else if (cross.side === 'left') nx = w;
    if (cross.side === 'bottom') ny = 0;
    else if (cross.side === 'top') ny = h;

    rt.cursorX = nx;
    rt.cursorY = ny;
    pushPoint(rt, rt.cursorX, rt.cursorY, now, lmb, rmb, true);

    const eps = 0.0001;
    if (cross.side === 'right') remainingDx -= eps;
    if (cross.side === 'left') remainingDx += eps;
    if (cross.side === 'bottom') remainingDy -= eps;
    if (cross.side === 'top') remainingDy += eps;
    if (Math.hypot(remainingDx, remainingDy) < 0.0005) return;
  }
}

function firstBoundaryCross(x: number, y: number, dx: number, dy: number, w: number, h: number): { t: number; side: 'left'|'right'|'top'|'bottom' } | null {
  let bestT = Infinity;
  let side: 'left'|'right'|'top'|'bottom' | undefined;
  if (dx > 0) { const t = (w - x) / dx; if (t >= 0 && t <= 1 && t < bestT) { bestT = t; side = 'right'; } }
  if (dx < 0) { const t = (0 - x) / dx; if (t >= 0 && t <= 1 && t < bestT) { bestT = t; side = 'left'; } }
  if (dy > 0) { const t = (h - y) / dy; if (t >= 0 && t <= 1 && t < bestT) { bestT = t; side = 'bottom'; } }
  if (dy < 0) { const t = (0 - y) / dy; if (t >= 0 && t <= 1 && t < bestT) { bestT = t; side = 'top'; } }
  return side ? { t: bestT, side } : null;
}

function panStep(rt: TrailRuntime, w: number, h: number, dx: number, dy: number, lmb: boolean, rmb: boolean, now: number) {
  rt.worldCursorX += dx;
  rt.worldCursorY += dy;
  pushPoint(rt, rt.worldCursorX, rt.worldCursorY, now, lmb, rmb, false);
  centerPan(rt, w, h);
}

function centerPan(rt: TrailRuntime, w: number, h: number) {
  rt.viewOffsetX = rt.worldCursorX - w / 2;
  rt.viewOffsetY = rt.worldCursorY - h / 2;
  rt.cursorX = w / 2;
  rt.cursorY = h / 2;
}

function pushPoint(rt: TrailRuntime, x: number, y: number, t: number, lmb: boolean, rmb: boolean, br: boolean) {
  const last = rt.points[rt.points.length - 1];
  if (last && !br && !last.br && Math.abs(last.x - x) + Math.abs(last.y - y) < 0.20) return;
  rt.points.push({ x, y, t, lmb, rmb, br });
}

function pruneByDistance(rt: TrailRuntime, cfg: any, w: number) {
  if (rt.points.length < 3) return;
  const maxDist = Math.max(num(cfg.maxTrailDistancePx, DEFAULT_MAX_TRAIL_DISTANCE), w * 0.90);
  let accum = 0;
  let keepFrom = 0;
  let newer: Point | undefined;
  for (let i = rt.points.length - 1; i >= 0; i--) {
    const p = rt.points[i];
    if (newer && !newer.br && !p.br) {
      accum += Math.hypot(newer.x - p.x, newer.y - p.y);
      if (accum > maxDist) { keepFrom = i + 1; break; }
    }
    if (p.br) accum = 0;
    newer = p;
  }
  if (keepFrom > 0) rt.points.splice(0, keepFrom);
}

export function drawTrail(ctx: CanvasRenderingContext2D, rt: TrailRuntime, cfg: any, r: {x:number;y:number;w:number;h:number}, now: number): void {
  if (cfg.enabled === false || rt.points.length === 0) return;
  const life = Math.max(50, num(cfg.lifetimeMs, 850));
  const renderPts = appendRenderHeadPoint(rt, cfg);
  const maxPts = Math.max(16, Math.min(MAX_RENDER_SAMPLES, Math.max(num(cfg.maxRenderedSamples, 2048), 512)));
  const clipped = renderPts.length > maxPts ? renderPts.slice(renderPts.length - maxPts) : renderPts;
  const segments = buildTrailSamples(clipped, rt, cfg, r, now, life);
  const head = forceHeadSampleToCursor(segments, rt, cfg, r, now, life);
  const opacity = 1;

  ctx.save();
  ctx.translate(r.x, r.y);
  if (isGlowEnabled(cfg)) drawTrailStripPass(ctx, segments, cfg, opacity, Math.max(0.1, Math.min(1.8, num(cfg.glowWidthMultiplier, 1.7))), 0.07, true);
  if (cfg.line !== false) drawTrailStripPass(ctx, segments, cfg, opacity, 1, 1, false);
  if (cfg.dots?.enabled === true || cfg.dots === true) drawDots(ctx, segments, cfg, opacity);
  if ((cfg.cursor?.type ?? (cfg.cursor === false ? 'none' : 'dot')) !== 'none' && head && head.fade > 0.001) drawHeadCursor(ctx, head, cfg, opacity);
  ctx.restore();
}

function appendRenderHeadPoint(rt: TrailRuntime, cfg: any): Point[] {
  if (rt.points.length === 0) return [];
  const mode = cfg.mode ?? 'wrap';
  const liveX = mode === 'pan' ? rt.worldCursorX : rt.cursorX;
  const liveY = mode === 'pan' ? rt.worldCursorY : rt.cursorY;
  const pts = rt.points.map(p => ({ ...p }));
  const last = pts[pts.length - 1];
  const headTime = rt.lastInputTime || last.t;
  if (Math.hypot(last.x - liveX, last.y - liveY) > 0.0001 || last.br) pts.push({ x: liveX, y: liveY, t: headTime, lmb: last.lmb, rmb: last.rmb, br: false });
  return pts;
}

function buildTrailSamples(pts: Point[], rt: TrailRuntime, cfg: any, r: {w:number;h:number}, now: number, life: number): Sample[][] {
  const out: Sample[][] = [];
  let cur: Point[] = [];
  for (const p of pts) {
    if (p.br && cur.length) { addSampledSegment(out, cur, rt, cfg, now, life); cur = []; }
    cur.push(p);
  }
  if (cur.length) addSampledSegment(out, cur, rt, cfg, now, life);
  return out.map(seg => seg.filter(p => p.x >= -r.w * 2 && p.x <= r.w * 3 && p.y >= -r.h * 2 && p.y <= r.h * 3));
}

function addSampledSegment(out: Sample[][], raw: Point[], rt: TrailRuntime, cfg: any, now: number, life: number) {
  let local = rawLocalSegment(raw, rt, cfg, now, life);
  if (local.length < 2) { if (local.length) out.push(local); return; }
  if ((cfg.smoothing ?? 'catmull_rom') !== 'none') local = chaikinSmooth(local, local.length < 128 ? 2 : 1, num(cfg.maxSmoothingSamples, MAX_SMOOTH_POINTS), cfg, now, life);
  local = removeNearDuplicateSamples(local, 0.25);
  const samples = removeNearDuplicateSamples(resampleSamples(local, cfg, now, life), 0.20);
  applyReferenceStyle(samples, cfg, now, life);
  if (samples.length) out.push(samples);
}

function rawLocalSegment(raw: Point[], rt: TrailRuntime, cfg: any, now: number, life: number): Sample[] {
  const max = Math.max(16, Math.min(MAX_SMOOTH_POINTS, Math.max(num(cfg.maxSmoothingSamples, MAX_SMOOTH_POINTS), 512)));
  const mode = cfg.mode ?? 'wrap';
  const out: Sample[] = [];
  for (const p of raw) {
    if (out.length >= max) break;
    const x = mode === 'pan' ? p.x - rt.viewOffsetX : p.x;
    const y = mode === 'pan' ? p.y - rt.viewOffsetY : p.y;
    out.push(makeSample(x, y, p.t, !!p.lmb, !!p.rmb, cfg, now, life));
  }
  return out;
}

function chaikinSmooth(inPts: Sample[], passes: number, maxSamples: number, cfg: any, now: number, life: number): Sample[] {
  let cur = [...inPts];
  const max = Math.max(16, Math.min(MAX_SMOOTH_POINTS, Math.max(maxSamples, 512)));
  for (let pass = 0; pass < passes && cur.length >= 3 && cur.length < max; pass++) {
    const next: Sample[] = [cur[0]];
    for (let i = 0; i < cur.length - 1 && next.length < max - 1; i++) {
      const a = cur[i], b = cur[i + 1];
      next.push(interpSample(a, b, 0.25, cfg, now, life));
      if (next.length < max - 1) next.push(interpSample(a, b, 0.75, cfg, now, life));
    }
    next.push(cur[cur.length - 1]);
    cur = next;
  }
  return cur;
}

function removeNearDuplicateSamples(inPts: Sample[], minDist: number): Sample[] {
  const out: Sample[] = [];
  for (const s of inPts) {
    if (!out.length) { out.push(s); continue; }
    const last = out[out.length - 1];
    if (Math.hypot(s.x - last.x, s.y - last.y) >= minDist) out.push(s);
    else if (s.t >= last.t) out[out.length - 1] = s;
  }
  return out;
}

function resampleSamples(inPts: Sample[], cfg: any, now: number, life: number): Sample[] {
  const out: Sample[] = [];
  if (!inPts.length) return out;
  const step = Math.max(0.75, Math.min(1.25, num(cfg.baseWidth, 3) * 0.40));
  const max = Math.max(16, Math.min(MAX_RENDER_SAMPLES, Math.max(num(cfg.maxRenderedSamples, MAX_RENDER_SAMPLES), 512)));
  out.push(inPts[0]);
  let nextAt = step;
  let travelled = 0;
  for (let i = 1; i < inPts.length && out.length < max; i++) {
    const a = inPts[i - 1], b = inPts[i];
    const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy);
    if (len < 0.001) continue;
    while (travelled + len >= nextAt && out.length < max) {
      out.push(interpSample(a, b, (nextAt - travelled) / len, cfg, now, life));
      nextAt += step;
    }
    travelled += len;
  }
  const last = inPts[inPts.length - 1];
  const prev = out[out.length - 1];
  if (!prev || Math.hypot(prev.x - last.x, prev.y - last.y) > 0.05) out.push(last);
  return out;
}

function interpSample(a: Sample, b: Sample, u: number, cfg: any, now: number, life: number): Sample {
  return makeSample(
    a.x + (b.x - a.x) * u,
    a.y + (b.y - a.y) * u,
    a.t + (b.t - a.t) * u,
    u < 0.5 ? !!a.lmb : !!b.lmb,
    u < 0.5 ? !!a.rmb : !!b.rmb,
    cfg,
    now,
    life
  );
}

function makeSample(x: number, y: number, t: number, lmb: boolean, rmb: boolean, cfg: any, now: number, life: number): Sample {
  const age01 = clamp((now - t) / life, 0, 1);
  const fade = 1 - smoothstep01(age01);
  const width = computeSampleWidth({ x, y, t, lmb, rmb, age01, fade, width: 0, color: '' }, cfg);
  const sample: Sample = { x, y, t, lmb, rmb, age01, fade, width, color: str(cfg.color, '#eaf6ff') };
  sample.color = computeSampleColor(sample, cfg);
  return sample;
}

function applyReferenceStyle(samples: Sample[], cfg: any, now: number, life: number) {
  if (!samples.length) return;
  const lastInput = samples[samples.length - 1].t;
  const idleFade = 1 - smoothstep01(clamp((now - lastInput) / life, 0, 1));
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    s.age01 = clamp((now - s.t) / life, 0, 1);
    const localAge = 1 - smoothstep01(s.age01);
    const localFade = 0.82 + 0.18 * localAge;
    s.fade = idleFade * localFade;
    const taper = i < TAPER_SAMPLES ? smoothstep01((i + 1) / (TAPER_SAMPLES + 1)) : 1;
    const wm = 1;
    const tailWidth = num(cfg.tailWidth, 0.15);
    s.width = Math.max(0.05, (tailWidth + (num(cfg.baseWidth, 3) - tailWidth) * taper) * wm);
    s.color = computeSampleColor(s, cfg);
  }
}

function forceHeadSampleToCursor(segments: Sample[][], rt: TrailRuntime, cfg: any, r: {w:number;h:number}, now: number, life: number): Sample | null {
  if (!segments.length) return null;
  for (let si = segments.length - 1; si >= 0; si--) {
    const seg = segments[si];
    if (!seg.length) continue;
    const head = seg[seg.length - 1];
    head.x = cfg.mode === 'pan' ? r.w / 2 : rt.cursorX;
    head.y = cfg.mode === 'pan' ? r.h / 2 : rt.cursorY;
    if (rt.lastInputTime > 0) head.t = rt.lastInputTime;
    head.age01 = clamp((now - head.t) / life, 0, 1);
    const idleFade = rt.lastInputTime > 0 ? 1 - smoothstep01(clamp((now - rt.lastInputTime) / life, 0, 1)) : 0;
    head.fade = idleFade;
    head.width = computeSampleWidth(head, cfg);
    head.color = computeSampleColor(head, cfg);
    return head;
  }
  return null;
}

function computeSampleWidth(s: Sample, cfg: any): number {
  const wm = 1;
  return Math.max(0.05, num(cfg.baseWidth, 3) * wm);
}

function computeSampleColor(s: Sample, cfg: any): string {
  const mode = cfg.colorMode ?? 'fixed';
  if (mode === 'button_state') {
    if (s.rmb) return str(cfg.rmbHighlight?.color, '#ffc08a');
    if (s.lmb) return str(cfg.lmbHighlight?.color, '#9edbff');
  }
  if (mode === 'age_gradient') return lerpHexColor(str(cfg.color, '#eaf6ff'), str(cfg.tailColor, '#55eaf6ff'), s.age01);
  if (s.rmb) return str(cfg.rmbHighlight?.color, '#ffc08a');
  if (s.lmb) return str(cfg.lmbHighlight?.color, '#9edbff');
  return str(cfg.color, '#eaf6ff');
}

function drawTrailStripPass(ctx: CanvasRenderingContext2D, segments: Sample[][], cfg: any, op: number, widthMul: number, alphaMul: number, glow: boolean) {
  for (const raw of segments) {
    const seg = removeNearDuplicateSamples(raw, 0.18);
    if (seg.length < 2) {
      if (seg.length === 1 && !glow) {
        const only = seg[0];
        drawCircle(ctx, only.x, only.y, Math.max(1, only.width * 0.55), only.color, op * only.fade);
      }
      continue;
    }
    drawGroupedRuns(ctx, seg, cfg, op, widthMul, alphaMul, glow, 0);
    if (!glow) {
      drawSharpJoins(ctx, seg, cfg, op);
      const head = seg[seg.length - 1];
      drawCircle(ctx, head.x, head.y, Math.max(2, head.width * 0.68), head.color, op * head.fade);
    }
  }
}

function drawGroupedRuns(ctx: CanvasRenderingContext2D, seg: Sample[], cfg: any, op: number, widthMul: number, alphaMul: number, glow: boolean, startIndex: number) {
  let start = Math.max(0, Math.min(startIndex, seg.length - 2));
  while (start < seg.length - 1) {
    let end = start + 1;
    const st = buttonState(seg[start]);
    while (end < seg.length - 1 && end - start < 96) {
      let split = false;
      if (buttonState(seg[end]) !== st) split = true;
      if (end > start && end < seg.length - 1 && isReversal(seg, end)) split = true;
      if (split) break;
      end++;
    }
    drawTrailRun(ctx, seg, start, end, cfg, op, widthMul, alphaMul, glow);
    start = end;
  }
}

function drawTrailRun(ctx: CanvasRenderingContext2D, seg: Sample[], from: number, to: number, cfg: any, op: number, widthMul: number, alphaMul: number, glow: boolean) {
  if (to <= from) return;
  const normals = smoothNormalsRange(seg, from, to);
  for (let i = from; i < to; i++) {
    const a = seg[i], b = seg[i + 1];
    const na = normals[i - from], nb = normals[i + 1 - from];
    const agm = 1;
    const bgm = 1;
    const ah = Math.max(0.05, a.width * 0.5 * widthMul * (glow ? agm : 1));
    const bh = Math.max(0.05, b.width * 0.5 * widthMul * (glow ? bgm : 1));
    let alpha = op * ((a.fade + b.fade) * 0.5) * alphaMul * (glow ? Math.min(1.6, (agm + bgm) * 0.5) : 1);
    if (glow) alpha = Math.min(alpha, op * 0.12);
    const color = glow ? (b.rmb ? str(cfg.rmbHighlight?.color, '#ffc08a') : b.lmb ? str(cfg.lmbHighlight?.color, '#9edbff') : str(cfg.glowColor, '#bbdfff')) : b.color;
    ctx.fillStyle = hexToRgba(color, alpha);
    ctx.beginPath();
    ctx.moveTo(a.x + na[0] * ah, a.y + na[1] * ah);
    ctx.lineTo(b.x + nb[0] * bh, b.y + nb[1] * bh);
    ctx.lineTo(b.x - nb[0] * bh, b.y - nb[1] * bh);
    ctx.lineTo(a.x - na[0] * ah, a.y - na[1] * ah);
    ctx.closePath();
    ctx.fill();
  }
  const a = seg[from], b = seg[to];
  const ac = glow ? (a.rmb ? str(cfg.rmbHighlight?.color, '#ffc08a') : a.lmb ? str(cfg.lmbHighlight?.color, '#9edbff') : str(cfg.glowColor, '#bbdfff')) : a.color;
  const bc = glow ? (b.rmb ? str(cfg.rmbHighlight?.color, '#ffc08a') : b.lmb ? str(cfg.lmbHighlight?.color, '#9edbff') : str(cfg.glowColor, '#bbdfff')) : b.color;
  const ca = capAlpha(op * a.fade * alphaMul, glow);
  const cb = capAlpha(op * b.fade * alphaMul, glow);
  drawCircle(ctx, a.x, a.y, Math.max(0.05, a.width * 0.5 * widthMul), ac, ca);
  drawCircle(ctx, b.x, b.y, Math.max(0.05, b.width * 0.5 * widthMul), bc, cb);
}

function drawSharpJoins(ctx: CanvasRenderingContext2D, seg: Sample[], _cfg: any, op: number) {
  for (let i = 1; i < seg.length - 1; i++) {
    const d = turnDot(seg, i);
    if (d < SHARP_TURN_DOT) {
      const s = seg[i];
      let alpha = joinAlpha(op * s.fade);
      if (isReversal(seg, i)) alpha *= 0.92;
      drawCircle(ctx, s.x, s.y, Math.max(0.05, s.width * 0.50), s.color, alpha);
    }
  }
}

function drawDots(ctx: CanvasRenderingContext2D, segments: Sample[][], cfg: any, op: number) {
  const spacing = Math.max(1, num(cfg.dots?.spacing ?? cfg.dotSpacing, 20));
  const size = Math.max(0.5, num(cfg.dots?.size ?? cfg.dotSize, 2.4));
  for (const seg of segments) {
    let carry = 0;
    if (seg.length < 2) continue;
    for (let i = 1; i < seg.length; i++) {
      const a = seg[i - 1], b = seg[i];
      const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy);
      if (len < 0.001) continue;
      carry += len;
      while (carry >= spacing) {
        const back = carry - spacing;
        const u = clamp(1 - back / len, 0, 1);
        const m = interpSample(a, b, u, cfg, b.t, Math.max(50, num(cfg.lifetimeMs, 850)));
        const col = str(cfg.dots?.color ?? cfg.dotColor, m.color);
        drawCircle(ctx, m.x, m.y, size, col, op * ((a.fade + b.fade) * 0.5) * 0.72);
        carry -= spacing;
      }
    }
  }
}

function drawHeadCursor(ctx: CanvasRenderingContext2D, head: Sample, cfg: any, op: number) {
  const cursor = cfg.cursor ?? {};
  const type = cursor.type ?? 'dot';
  const base = str(cursor.color || head.color, head.color);
  const cursorSize = num(cursor.size ?? cfg.cursorSize, 5);
  const radius = Math.max(head.width * 0.68, Math.max(2, cursorSize * 0.28));
  const alpha = op * head.fade;
  if (type === 'circle') {
    ctx.strokeStyle = hexToRgba(base, alpha);
    ctx.lineWidth = Math.max(1, head.width * 0.18);
    ctx.beginPath(); ctx.arc(head.x, head.y, Math.max(radius, cursorSize / 2), 0, Math.PI * 2); ctx.stroke();
  } else if (type === 'cursor_arrow') {
    drawCircle(ctx, head.x, head.y, radius, base, alpha);
  } else {
    drawCircle(ctx, head.x, head.y, radius, base, alpha);
  }
}

function smoothNormalsRange(seg: Sample[], from: number, to: number): Array<[number, number]> {
  return smoothNormals(seg.slice(from, to + 1));
}

function smoothNormals(seg: Sample[]): Array<[number, number]> {
  let out = seg.map((_, i) => sampleNormal(seg, i));
  for (let i = 1; i < out.length; i++) {
    const dot = out[i - 1][0] * out[i][0] + out[i - 1][1] * out[i][1];
    if (dot < 0) out[i] = [-out[i][0], -out[i][1]];
  }
  if (out.length > 2) {
    out = out.map((cur, i) => {
      let x = cur[0] * 2, y = cur[1] * 2, weight = 2;
      if (i > 0) { x += out[i - 1][0]; y += out[i - 1][1]; weight += 1; }
      if (i < out.length - 1) { x += out[i + 1][0]; y += out[i + 1][1]; weight += 1; }
      x /= weight; y /= weight;
      const len = Math.hypot(x, y);
      return len < 0.0001 ? cur : [x / len, y / len] as [number, number];
    });
  }
  return out;
}

function sampleNormal(seg: Sample[], i: number): [number, number] {
  const cur = seg[i];
  let dx = 0, dy = 0;
  const prev = Math.max(0, i - 2);
  const next = Math.min(seg.length - 1, i + 2);
  if (next !== prev) { const a = seg[prev], b = seg[next]; dx = b.x - a.x; dy = b.y - a.y; }
  if (Math.hypot(dx, dy) < 0.0001) {
    if (i < seg.length - 1) { const n = seg[i + 1]; dx = n.x - cur.x; dy = n.y - cur.y; }
    else if (i > 0) { const p = seg[i - 1]; dx = cur.x - p.x; dy = cur.y - p.y; }
  }
  const len = Math.hypot(dx, dy);
  if (len < 0.0001) return [0, 1];
  dx /= len; dy /= len;
  return [-dy, dx];
}

function buttonState(s: Sample): number { return s.rmb ? 2 : s.lmb ? 1 : 0; }
function isReversal(seg: Sample[], i: number): boolean { return turnDot(seg, i) < REVERSAL_TURN_DOT; }
function turnDot(seg: Sample[], i: number): number {
  if (i <= 0 || i >= seg.length - 1) return 1;
  const p0 = seg[i - 1], p1 = seg[i], p2 = seg[i + 1];
  let ax = p1.x - p0.x, ay = p1.y - p0.y, bx = p2.x - p1.x, by = p2.y - p1.y;
  const al = Math.hypot(ax, ay), bl = Math.hypot(bx, by);
  if (al < 0.001 || bl < 0.001) return 1;
  ax /= al; ay /= al; bx /= bl; by /= bl;
  return ax * bx + ay * by;
}

function drawCircle(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, color: string, alpha: number) {
  if (radius <= 0.001 || alpha <= 0.001) return;
  ctx.fillStyle = hexToRgba(color, alpha);
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
}

function capAlpha(alpha: number, glow: boolean): number {
  const c = alpha * overlapComp(alpha) * (glow ? 0.62 : 0.86);
  return glow ? Math.min(c, 0.10) : c;
}
function joinAlpha(alpha: number): number { return alpha * overlapComp(alpha) * 0.74; }
function overlapComp(alpha: number): number { return alpha < 0.45 ? 0.78 : 0.90; }
function isGlowEnabled(_cfg: any): boolean { return false; }
function mod(a:number,n:number){ return ((a%n)+n)%n; }

function lerpHexColor(a: string, b: string, t: number): string {
  const ca = parseHex(a), cb = parseHex(b);
  if (!ca || !cb) return t < 0.5 ? a : b;
  const u = clamp(t, 0, 1);
  const vals = ca.map((v, i) => Math.round(v + (cb[i] - v) * u));
  return `#${vals.map(v => v.toString(16).padStart(2, '0')).join('')}`;
}
function parseHex(input: string): number[] | null {
  if (!input.startsWith('#')) return null;
  let hex = input.slice(1);
  if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
  if (hex.length === 6) hex += 'ff';
  if (hex.length !== 8) return null;
  const out = [0, 2, 4, 6].map(i => parseInt(hex.slice(i, i + 2), 16));
  return out.some(Number.isNaN) ? null : out;
}
