import { EditorState, ElementStyle, InputElement, InputStyleSet, MousePadElement, PackElement, SimInputState } from './types';
import { defaultBackground, defaultInputStyles, defaultPadStyle, defaultTrail } from './defaults';
import { clamp, deepMerge, hexToRgba, num, str } from './util';
import { TrailRuntime, updateTrail, drawTrail } from './trailEngine';
import { resolveElementStylePatch } from './styleResolver';

interface Transform { x: number; y: number; scale: number; opacity: number; }
interface RenderPreviewOptions { selectedPath?: string; forcedStyleState?: 'auto' | 'normal' | 'pressed' | 'disabled'; }
export interface InputAnimState { down: boolean; pressAt: number; releaseAt: number; releaseFrom?: number; }
interface RenderCtx { ctx: CanvasRenderingContext2D; state: EditorState; sim: SimInputState; guiScale: number; runtimes: Map<string, TrailRuntime>; inputAnimations: Map<string, InputAnimState>; now: number; dt: number; preview?: RenderPreviewOptions; }

export interface PreviewElementBox {
  path: string;
  pathArray: number[];
  parentPath: string;
  depth: number;
  element: PackElement;
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  logicalLeft: number;
  logicalTop: number;
  elementWidth: number;
  elementHeight: number;
  parentX: number;
  parentY: number;
  parentScale: number;
  parentW: number;
  parentH: number;
  elementScale: number;
}

export function renderPreview(canvas: HTMLCanvasElement, state: EditorState, sim: SimInputState, runtimes: Map<string, TrailRuntime>, inputAnimations: Map<string, InputAnimState>, guiScale: number, now: number, dt: number, backgroundColor: string, screenWidth: number, screenHeight: number, previewZoom: number, preview?: RenderPreviewOptions): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const dpr = window.devicePixelRatio || 1;
  const zoom = Math.max(0.05, previewZoom);
  const backingW = Math.round(screenWidth * zoom * dpr);
  const backingH = Math.round(screenHeight * zoom * dpr);
  if (canvas.width !== backingW || canvas.height !== backingH) {
    canvas.width = backingW;
    canvas.height = backingH;
  }
  ctx.setTransform(dpr * zoom, 0, 0, dpr * zoom, 0, 0);
  ctx.clearRect(0, 0, screenWidth, screenHeight);
  ctx.fillStyle = backgroundColor;
  ctx.fillRect(0, 0, screenWidth, screenHeight);
  const settings = state.bundle.settings ?? {};
  const root: Transform = { x: num(settings.globalOffsetX, 0), y: num(settings.globalOffsetY, 0), scale: num(settings.globalScale, 1) * guiScale, opacity: num(settings.globalOpacity, 1) };
  const elements = state.bundle.profile.elements ?? [];
  for (const item of sortWithIndex(elements)) drawElement({ ctx, state, sim, guiScale, runtimes, inputAnimations, now, dt, preview }, item.e, root, screenWidth, screenHeight, [item.i]);
}

function drawElement(rc: RenderCtx, e: PackElement, parent: Transform, parentW: number, parentH: number, path: number[]): void {
  try {
    const x = num(e.x, 0), y = num(e.y, 0), w = num(e.width, e.type === 'group' ? parentW : 40), h = num(e.height, e.type === 'group' ? parentH : 40);
    const anchored = applyAnchor(str(e.anchor, 'top_left') as any, x, y, w, h, parentW, parentH);
    const transform: Transform = {
      x: parent.x + anchored.x * parent.scale,
      y: parent.y + anchored.y * parent.scale,
      scale: parent.scale * num(e.scale, 1),
      opacity: parent.opacity * clamp(num(e.opacity, 1), 0, 1)
    };
    if (e.type === 'group') {
      const children = e.children ?? [];
      for (const item of sortWithIndex(children)) drawElement(rc, item.e, transform, w, h, [...path, item.i]);
    } else if (e.type === 'input' || e.type === 'key' || e.type === 'mouse_button') {
      drawInput(rc, e as InputElement, transform, w, h, path.join('.'));
    } else if (e.type === 'mouse_pad') {
      drawMousePad(rc, e as MousePadElement, transform, w, h);
    }
  } catch (err) {
    console.warn('Preview element render failed', e.id ?? e.type, err);
  }
}

export function anchorOffset(anchor: string, w: number, h: number, pw: number, ph: number): { x: number; y: number } {
  let ax = 0, ay = 0;
  if (anchor.includes('center')) ax = (pw - w) / 2;
  if (anchor.includes('right')) ax = pw - w;
  if (anchor.startsWith('center')) ay = (ph - h) / 2;
  if (anchor.startsWith('bottom')) ay = ph - h;
  return { x: ax, y: ay };
}

function applyAnchor(anchor: string, x: number, y: number, w: number, h: number, pw: number, ph: number): { x: number; y: number } {
  const o = anchorOffset(anchor, w, h, pw, ph);
  return { x: o.x + x, y: o.y + y };
}

function drawInput(rc: RenderCtx, e: InputElement, t: Transform, w: number, h: number, path: string) {
  const valid = !!e.input;
  const pressed = valid && isPressed(e, rc.sim);
  const styleSet = resolveInputStyle(resolveElementStylePatch(rc.state, e));
  const forced = rc.preview?.selectedPath === path ? (rc.preview.forcedStyleState ?? 'auto') : 'auto';
  const resolved = resolveAnimatedInputStyle(styleSet, pressed, valid, forced, rc.inputAnimations, path, rc.now);
  const style: ElementStyle = { ...resolved.style, glow: resolved.style.glow ? { ...resolved.style.glow, enabled: false, alpha: 0, size: 0 } : undefined };
  const label = e.label !== undefined ? e.label : autoLabel(e);
  const styleScale = num(style.scale, 1);
  const baseW = w * t.scale;
  const baseH = h * t.scale;
  const sw = baseW * styleScale;
  const sh = baseH * styleScale;
  // Style scale is intentionally center-origin.
  // offsetX/Y are now pure extra translation values, not compensation for top-left scaling.
  const x = t.x + (baseW - sw) / 2 + num(style.offsetX, 0) * t.scale;
  const y = t.y + (baseH - sh) / 2 + num(style.offsetY, 0) * t.scale;
  const scale = t.scale * styleScale;
  rc.ctx.save();
  rc.ctx.globalAlpha = clamp(t.opacity * num(style.opacity, 1), 0, 1);
  if (resolved.releaseAlpha > 0) drawReleaseEffect(rc.ctx, style, styleSet, x, y, sw, sh, t.opacity, resolved.releaseAlpha);
  if (style.shadow?.enabled) drawShape(rc.ctx, style, x + style.shadow.offsetX, y + style.shadow.offsetY, sw, sh, hexToRgba(style.shadow.color, style.shadow.alpha), 'filled');
  if (style.glow?.enabled) drawGlow(rc.ctx, style, x, y, sw, sh, t.opacity);
  if (style.fillMode !== 'none') {
    if (style.fillMode === 'filled' || style.fillMode === 'filled_outline') drawShape(rc.ctx, style, x, y, sw, sh, hexToRgba(style.fillColor), 'filled');
    if (style.fillMode === 'outline' || style.fillMode === 'filled_outline') drawShape(rc.ctx, style, x, y, sw, sh, hexToRgba(style.borderColor), 'outline');
  }
  if (label !== '') drawText(rc.ctx, label, style, x, y, sw, sh, scale);
  rc.ctx.restore();
}


function resolveAnimatedInputStyle(styleSet: InputStyleSet, pressed: boolean, valid: boolean, forced: 'auto' | 'normal' | 'pressed' | 'disabled', animations: Map<string, InputAnimState>, key: string, now: number): { style: ElementStyle; releaseAlpha: number } {
  if (forced === 'pressed') return { style: styleSet.pressed, releaseAlpha: 0 };
  if (forced === 'normal') return { style: styleSet.normal, releaseAlpha: 0 };
  if (forced === 'disabled' || !valid) return { style: styleSet.disabled, releaseAlpha: 0 };

  const press = styleSet.pressAnimation ?? defaultInputStyles.pressAnimation;
  const pressEnabled = press?.enabled !== false && press?.type !== 'none';
  const pressDuration = Math.max(1, num(press?.durationMs, 70));
  const releaseDuration = Math.max(1, Math.max(90, pressDuration * 1.8));

  let an = animations.get(key);
  if (!an) { an = { down: pressed, pressAt: pressed ? now : 0, releaseAt: 0, releaseFrom: pressed ? 1 : 0 }; animations.set(key, an); }
  if (pressed && !an.down) { an.down = true; an.pressAt = now; an.releaseFrom = 0; }
  if (!pressed && an.down) {
    const currentPressAmount = pressEnabled ? easeOutCubic(clamp((now - an.pressAt) / pressDuration, 0, 1)) : 1;
    an.down = false;
    an.releaseAt = now;
    an.releaseFrom = currentPressAmount;
  }

  if (pressed) {
    const amount = pressEnabled ? easeOutCubic(clamp((now - an.pressAt) / pressDuration, 0, 1)) : 1;
    const style = composeInstantColorMotionStyle(styleSet.pressed, styleSet.normal, styleSet.pressed, amount);
    return { style: applyPressAnimation(style, styleSet.normal, press, amount), releaseAlpha: 0 };
  }

  const releaseAge = an.releaseAt > 0 ? now - an.releaseAt : Infinity;
  if (releaseAge <= releaseDuration) {
    const t = easeOutCubic(clamp(releaseAge / releaseDuration, 0, 1));
    const amount = clamp((an.releaseFrom ?? 1) * (1 - t), 0, 1);
    const style = composeInstantColorMotionStyle(styleSet.normal, styleSet.normal, styleSet.pressed, amount);
    return { style: applyPressAnimation(style, styleSet.normal, press, amount), releaseAlpha: (1 - t) * (1 - t) };
  }

  return { style: styleSet.normal, releaseAlpha: 0 };
}

function applyPressAnimation(style: ElementStyle, normal: ElementStyle, press: InputStyleSet['pressAnimation'], amount: number): ElementStyle {
  if (!press || press.enabled === false || press.type === 'none') return style;
  const out: ElementStyle = { ...style, glow: style.glow ? { ...style.glow } : undefined, shadow: style.shadow ? { ...style.shadow } : undefined };
  const type = press.type === 'glow_pulse' ? 'scale_offset' : press.type;
  if (type === 'scale' || type === 'scale_offset') {
    const baseScale = num(normal.scale, 1);
    const targetScale = Math.min(baseScale, num(press.scale, 0.94));
    out.scale = lerpNumber(baseScale, targetScale, amount);
  }
  if (type === 'offset' || type === 'scale_offset') {
    out.offsetX = lerpNumber(num(normal.offsetX, 0), num(normal.offsetX, 0) + num(press.offsetX, 0), amount);
    out.offsetY = lerpNumber(num(normal.offsetY, 0), num(normal.offsetY, 0) + num(press.offsetY, 0), amount);
  }
  return out;
}

function drawReleaseEffect(_ctx: CanvasRenderingContext2D, _style: ElementStyle, _styleSet: InputStyleSet, _x: number, _y: number, _w: number, _h: number, _opacity: number, _amount: number) {
  // Release glow / border effects are intentionally disabled. Shape motion still eases back in resolveAnimatedInputStyle().
  return;
}

function composeInstantColorMotionStyle(immediate: ElementStyle, normal: ElementStyle, pressed: ElementStyle, t: number): ElementStyle {
  const u = clamp(t, 0, 1);
  return {
    ...immediate,
    cornerRadius: lerpNumber(normal.cornerRadius, pressed.cornerRadius, u),
    borderWidth: lerpNumber(normal.borderWidth, pressed.borderWidth, u),
    opacity: lerpNumber(normal.opacity, pressed.opacity, u),
    scale: lerpNumber(normal.scale, Math.min(pressed.scale, normal.scale), u),
    offsetX: lerpNumber(normal.offsetX, pressed.offsetX, u),
    offsetY: lerpNumber(normal.offsetY, pressed.offsetY, u),
    fontScale: lerpNumber(normal.fontScale, pressed.fontScale, u),
    textOffsetX: lerpNumber(normal.textOffsetX, pressed.textOffsetX, u),
    textOffsetY: lerpNumber(normal.textOffsetY, pressed.textOffsetY, u),
    shadow: blendShadowMotion(immediate.shadow, normal.shadow, pressed.shadow, u),
    glow: blendGlowMotion(immediate.glow, normal.glow, pressed.glow, u)
  };
}

function blendShadowMotion(immediate: ElementStyle['shadow'], normal: ElementStyle['shadow'], pressed: ElementStyle['shadow'], t: number): ElementStyle['shadow'] {
  if (!immediate && !normal && !pressed) return undefined;
  const base = immediate ?? normal ?? pressed ?? { enabled: false, offsetX: 0, offsetY: 0, color: '#000000', alpha: 0 };
  const n = normal ?? { ...base, enabled: false, offsetX: 0, offsetY: 0, alpha: 0 };
  const p = pressed ?? n;
  return { ...base, offsetX: lerpNumber(n.offsetX, p.offsetX, t), offsetY: lerpNumber(n.offsetY, p.offsetY, t), alpha: lerpNumber(n.alpha, p.alpha, t) };
}
function blendGlowMotion(immediate: ElementStyle['glow'], normal: ElementStyle['glow'], pressed: ElementStyle['glow'], t: number): ElementStyle['glow'] {
  if (!immediate && !normal && !pressed) return undefined;
  const base = immediate ?? normal ?? pressed ?? { enabled: false, color: '#ffffff', alpha: 0, size: 0 };
  const n = normal ?? { ...base, enabled: false, alpha: 0, size: 0 };
  const p = pressed ?? n;
  return { ...base, alpha: lerpNumber(n.alpha, p.alpha, t), size: lerpNumber(n.size, p.size, t) };
}
function lerpNumber(a: number, b: number, t: number): number { return a + (b - a) * clamp(t, 0, 1); }
function easeOutCubic(t: number): number { const u = 1 - clamp(t, 0, 1); return 1 - u * u * u; }
function lerpColor(a: string, b: string, t: number): string {
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
  const vals = [0, 2, 4, 6].map(i => parseInt(hex.slice(i, i + 2), 16));
  return vals.some(Number.isNaN) ? null : vals;
}

function drawMousePad(rc: RenderCtx, e: MousePadElement, t: Transform, w: number, h: number) {
  const style = resolvePadStyle(resolveElementStylePatch(rc.state, e));
  const x = t.x, y = t.y, sw = w * t.scale, sh = h * t.scale;
  const pad = num(e.contentPadding, 0) * t.scale;
  const content = { x: x + pad, y: y + pad, w: Math.max(1, sw - pad * 2), h: Math.max(1, sh - pad * 2) };
  const background = deepMerge(defaultBackground, e.background ?? {});
  const trail = deepMerge(defaultTrail, e.trail ?? {});
  const id = e.id ?? `pad_${x}_${y}`;
  let rt = rc.runtimes.get(id);
  if (!rt) { rt = new TrailRuntime(content.w, content.h); rc.runtimes.set(id, rt); }
  updateTrail(rt, trail, content.w, content.h, rc.sim.dx, rc.sim.dy, rc.sim.mouseButtons.has('left'), rc.sim.mouseButtons.has('right'), rc.now, rc.dt);

  rc.ctx.save();
  rc.ctx.globalAlpha = clamp(t.opacity * num(style.opacity, 1), 0, 1);
  if (style.fillMode === 'filled' || style.fillMode === 'filled_outline') drawShape(rc.ctx, style, x, y, sw, sh, hexToRgba(style.fillColor), 'filled');
  clipPad(rc.ctx, style, e.clipShape ?? 'visualShape', content.x, content.y, content.w, content.h);
  rc.ctx.globalAlpha = clamp(t.opacity * num(background.backgroundOpacity, 1), 0, 1);
  drawBackground(rc, background, content, rt);
  rc.ctx.globalAlpha = clamp(t.opacity, 0, 1);
  drawTrail(rc.ctx, rt, trail, content, rc.now);
  rc.ctx.restore();

  rc.ctx.save();
  rc.ctx.globalAlpha = clamp(t.opacity * num(style.opacity, 1), 0, 1);
  if (style.fillMode === 'outline' || style.fillMode === 'filled_outline') drawShape(rc.ctx, style, x, y, sw, sh, hexToRgba(style.borderColor), 'outline');
  rc.ctx.restore();
}

function drawBackground(rc: RenderCtx, bg: any, r: {x:number;y:number;w:number;h:number}, rt: TrailRuntime) {
  const ctx = rc.ctx;
  if (bg.type === 'none') return;
  let ox = 0, oy = 0;
  if (bg.scrollMode === 'world') { ox = -rt.viewOffsetX; oy = -rt.viewOffsetY; }
  if (bg.type === 'image') {
    const p = bg.imagePath ?? bg.path;
    const img = rc.state.textures.get(p)?.image;
    if (img) { drawImageFit(ctx, img, r, bg.imageFit ?? 'cover', ox, oy); return; }
  }
  if (bg.type === 'grid') {
    const size = Math.max(2, num(bg.gridSize, 16));
    ctx.strokeStyle = hexToRgba(str(bg.lineColor, '#ffffff33'));
    ctx.lineWidth = Math.max(1, num(bg.lineWidth, 1));
    for (let px = r.x + mod(ox, size); px < r.x + r.w; px += size) { ctx.beginPath(); ctx.moveTo(px, r.y); ctx.lineTo(px, r.y + r.h); ctx.stroke(); }
    for (let py = r.y + mod(oy, size); py < r.y + r.h; py += size) { ctx.beginPath(); ctx.moveTo(r.x, py); ctx.lineTo(r.x + r.w, py); ctx.stroke(); }
  } else if (bg.type === 'dots') {
    const spacing = Math.max(2, num(bg.spacing, 18)), dot = Math.max(1, num(bg.dotSize, 2));
    ctx.fillStyle = hexToRgba(str(bg.dotColor, '#ffffff55'));
    for (let px = r.x + mod(ox, spacing); px < r.x + r.w; px += spacing) for (let py = r.y + mod(oy, spacing); py < r.y + r.h; py += spacing) { ctx.beginPath(); ctx.arc(px, py, dot, 0, Math.PI * 2); ctx.fill(); }
  } else {
    const cell = Math.max(2, num(bg.cellSize, 16));
    for (let px = -cell + mod(ox, cell); px < r.w + cell; px += cell) for (let py = -cell + mod(oy, cell); py < r.h + cell; py += cell) {
      ctx.fillStyle = hexToRgba((Math.floor(px / cell) + Math.floor(py / cell)) % 2 === 0 ? str(bg.colorA, '#222a38') : str(bg.colorB, '#151a24'));
      ctx.fillRect(r.x + px, r.y + py, cell, cell);
    }
  }
}

function drawImageFit(ctx: CanvasRenderingContext2D, img: HTMLImageElement, r: {x:number;y:number;w:number;h:number}, fit: string, ox: number, oy: number) {
  if (fit === 'tile') {
    const pattern = ctx.createPattern(img, 'repeat'); if (!pattern) return;
    ctx.save(); ctx.translate(r.x + mod(ox, img.width), r.y + mod(oy, img.height)); ctx.fillStyle = pattern; ctx.fillRect(-img.width, -img.height, r.w + img.width * 2, r.h + img.height * 2); ctx.restore(); return;
  }
  let dw = r.w, dh = r.h;
  if (fit === 'contain' || fit === 'cover') {
    const s = fit === 'cover' ? Math.max(r.w / img.width, r.h / img.height) : Math.min(r.w / img.width, r.h / img.height);
    dw = img.width * s; dh = img.height * s;
  } else if (fit === 'center') { dw = img.width; dh = img.height; }
  ctx.drawImage(img, r.x + (r.w - dw) / 2, r.y + (r.h - dh) / 2, dw, dh);
}

function clipPad(ctx: CanvasRenderingContext2D, style: ElementStyle, clipShape: string, x: number, y: number, w: number, h: number) {
  ctx.beginPath();
  if (clipShape === 'visualShape') pathShape(ctx, style, x, y, w, h); else ctx.rect(x, y, w, h);
  ctx.clip();
}

function drawShape(ctx: CanvasRenderingContext2D, style: ElementStyle, x: number, y: number, w: number, h: number, color: string, mode: 'filled' | 'outline') {
  ctx.beginPath(); pathShape(ctx, style, x, y, w, h);
  if (mode === 'filled') { ctx.fillStyle = color; ctx.fill(); }
  else { ctx.strokeStyle = color; ctx.lineWidth = Math.max(1, num(style.borderWidth, 1)); ctx.stroke(); }
}

function pathShape(ctx: CanvasRenderingContext2D, style: ElementStyle, x: number, y: number, w: number, h: number) {
  if (style.shape === 'circle') { const d = Math.min(w, h); ctx.arc(x + w/2, y + h/2, d/2, 0, Math.PI * 2); return; }
  if (style.shape === 'rounded_rectangle') {
    const r = clamp(num(style.cornerRadius, 0), 0, Math.min(w, h) / 2);
    ctx.moveTo(x+r,y); ctx.lineTo(x+w-r,y); ctx.quadraticCurveTo(x+w,y,x+w,y+r); ctx.lineTo(x+w,y+h-r); ctx.quadraticCurveTo(x+w,y+h,x+w-r,y+h); ctx.lineTo(x+r,y+h); ctx.quadraticCurveTo(x,y+h,x,y+h-r); ctx.lineTo(x,y+r); ctx.quadraticCurveTo(x,y,x+r,y); return;
  }
  ctx.rect(x, y, w, h);
}

function drawGlow(ctx: CanvasRenderingContext2D, style: ElementStyle, x: number, y: number, w: number, h: number, opacity: number) {
  const g = style.glow!;
  for (let i = 3; i >= 1; i--) { ctx.globalAlpha = clamp(opacity * g.alpha / i, 0, 1); drawShape(ctx, style, x - g.size*i/3, y - g.size*i/3, w + g.size*i*2/3, h + g.size*i*2/3, hexToRgba(g.color), 'outline'); }
  ctx.globalAlpha = opacity;
}

function drawText(ctx: CanvasRenderingContext2D, label: string, style: ElementStyle, x: number, y: number, w: number, h: number, scale: number) {
  const fontSize = 16 * scale * num(style.fontScale, 1);
  ctx.font = `${fontSize}px sans-serif`;
  ctx.textBaseline = style.verticalAlign === 'top' ? 'top' : style.verticalAlign === 'bottom' ? 'bottom' : 'middle';
  ctx.textAlign = style.horizontalAlign;
  const tx = x + (style.horizontalAlign === 'left' ? 4 * scale : style.horizontalAlign === 'right' ? w - 4 * scale : w / 2) + num(style.textOffsetX, 0) * scale;
  const ty = y + (style.verticalAlign === 'top' ? 4 * scale : style.verticalAlign === 'bottom' ? h - 4 * scale : h / 2) + num(style.textOffsetY, 0) * scale;
  if (style.textShadow) { ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillText(label, tx + scale, ty + scale); }
  ctx.fillStyle = hexToRgba(style.textColor); ctx.fillText(label, tx, ty);
}


export function measurePreviewLayout(_canvas: HTMLCanvasElement, state: EditorState, guiScale: number, previewZoom = 1, screenWidth?: number, screenHeight?: number): PreviewElementBox[] {
  const settings = state.bundle.settings ?? {};
  const w = screenWidth ?? state.bundle.profile.canvas?.referenceWidth ?? 854;
  const h = screenHeight ?? state.bundle.profile.canvas?.referenceHeight ?? 480;
  const zoom = Math.max(0.05, previewZoom);
  const root: Transform = { x: num(settings.globalOffsetX, 0) * zoom, y: num(settings.globalOffsetY, 0) * zoom, scale: num(settings.globalScale, 1) * guiScale * zoom, opacity: num(settings.globalOpacity, 1) };
  const out: PreviewElementBox[] = [];
  const elements = state.bundle.profile.elements ?? [];
  for (const item of sortWithIndex(elements)) collectBox(item.e, [item.i], 0, root, w, h, out);
  return out;
}

function collectBox(e: PackElement, path: number[], depth: number, parent: Transform, parentW: number, parentH: number, out: PreviewElementBox[]): void {
  const w = num(e.width, e.type === 'group' ? parentW : 40);
  const h = num(e.height, e.type === 'group' ? parentH : 40);
  const o = anchorOffset(str(e.anchor, 'top_left'), w, h, parentW, parentH);
  const logicalLeft = o.x + num(e.x, 0);
  const logicalTop = o.y + num(e.y, 0);
  const elementScale = parent.scale * num(e.scale, 1);
  const x = parent.x + logicalLeft * parent.scale;
  const y = parent.y + logicalTop * parent.scale;
  const pathString = path.join('.');
  out.push({
    path: pathString,
    pathArray: [...path],
    parentPath: path.slice(0, -1).join('.'),
    depth,
    element: e,
    id: e.id ?? `${e.type}_${pathString}`,
    type: e.type,
    x,
    y,
    width: w * elementScale,
    height: h * elementScale,
    logicalLeft,
    logicalTop,
    elementWidth: w,
    elementHeight: h,
    parentX: parent.x,
    parentY: parent.y,
    parentScale: parent.scale,
    parentW,
    parentH,
    elementScale
  });
  if (e.type === 'group') {
    const next: Transform = { x, y, scale: elementScale, opacity: parent.opacity * clamp(num(e.opacity, 1), 0, 1) };
    const children = e.children ?? [];
    for (const item of sortWithIndex(children)) collectBox(item.e, [...path, item.i], depth + 1, next, w, h, out);
  }
}

function sortWithIndex(elements: PackElement[]): Array<{ e: PackElement; i: number }> {
  return elements.map((e, i) => ({ e, i })).sort((a, b) => byZ(a.e, b.e) || a.i - b.i);
}

function resolveInputStyle(style: unknown): InputStyleSet { return deepMerge(defaultInputStyles, style ?? {}); }
function resolvePadStyle(style: unknown): ElementStyle { return deepMerge(defaultPadStyle, style ?? {}); }
function autoLabel(e: InputElement): string { if (!e.input) return '?'; if (e.input.type === 'keyCode') return e.input.code.toUpperCase(); if (e.input.type === 'mouseButton') return e.input.button.toUpperCase(); return e.input.name.replace(/^key\./, '').toUpperCase(); }
function isPressed(e: InputElement, sim: SimInputState): boolean { if (!e.input) return false; if (e.input.type === 'mouseButton') return sim.mouseButtons.has(e.input.button); if (e.input.type === 'keyCode') return sim.keys.has(e.input.code.toUpperCase()); if (e.input.type === 'keyBinding') return sim.keys.has(bindingToKey(e.input.name)); return false; }
function bindingToKey(n: string): string { const m: Record<string, string> = { 'key.forward': 'W', 'key.back': 'S', 'key.left': 'A', 'key.right': 'D', 'key.jump': 'SPACE', 'key.sneak': 'SHIFT', 'key.sprint': 'CTRL' }; return m[n] ?? n.toUpperCase(); }
function byZ(a: PackElement, b: PackElement): number { return num(a.zIndex, 0) - num(b.zIndex, 0); }
function mod(a: number, n: number): number { return ((a % n) + n) % n; }
