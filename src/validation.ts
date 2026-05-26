import { EditorState, PackBundle, PackElement, ValidationIssue } from './types';
import { findTokenRefs } from './styleResolver';

const anchors = new Set(['top_left','top_center','top_right','center_left','center','center_right','bottom_left','bottom_center','bottom_right']);
const shapes = new Set(['rectangle','rounded_rectangle','circle']);
const fillModes = new Set(['filled','outline','filled_outline','none']);
const bgTypes = new Set(['none','checkerboard','grid','dots','image']);
const imageFits = new Set(['cover','contain','stretch','center','tile']);
const scrollModes = new Set(['fixed','world']);
const trailModes = new Set(['wrap','pan']);
const smoothing = new Set(['none','catmull_rom','chaikin']);
const cursorTypes = new Set(['none','dot','circle','cursor_arrow']);


export function validateEditorState(state: EditorState): ValidationIssue[] {
  const issues = validateBundle(state.bundle);
  validateTextureAssets(state, issues);
  return issues;
}

function validateTextureAssets(state: EditorState, issues: ValidationIssue[]): void {
  for (const tex of state.textures.values()) {
    if (!tex.path.startsWith('textures/') || tex.path.includes('..') || tex.path.startsWith('/')) {
      issues.push(err(`textures/${tex.path}`, 'Texture asset path must stay under textures/ and cannot contain traversal.'));
    }
    const img = tex.image;
    if (img) {
      const max = Math.max(img.width, img.height);
      if (max > 2048) issues.push(warn(`textures/${tex.path}`, `Image is ${img.width}×${img.height}; 2048px+ may be expensive in Minecraft.`));
      else if (max > 1024) issues.push({ level: 'info', path: `textures/${tex.path}`, message: `Image is ${img.width}×${img.height}; 1024px or smaller is recommended.` });
    }
  }
}

export function validateBundle(bundle: PackBundle): ValidationIssue[] {
  currentBundleRef = bundle;
  const issues: ValidationIssue[] = [];
  const ids = new Set<string>();
  if (!bundle || typeof bundle !== 'object') return [{ level: 'error', path: '$', message: 'bundle.json is not an object.' }];
  if (bundle.format !== 'input_visualizer_pack') issues.push(err('format', 'format must be input_visualizer_pack.'));
  if (bundle.version !== 1) issues.push(err('version', 'Only version 1 is supported.'));
  if (!bundle.meta?.id) issues.push(err('meta.id', 'meta.id is required.'));
  if (!bundle.meta?.name) issues.push(err('meta.name', 'meta.name is required.'));
  if (!bundle.profile || !Array.isArray(bundle.profile.elements)) issues.push(err('profile.elements', 'profile.elements must be an array.'));
  const cw = bundle.profile?.canvas?.referenceWidth ?? 854;
  const ch = bundle.profile?.canvas?.referenceHeight ?? 480;
  if (!Number.isFinite(cw) || cw <= 0 || cw > 8192) issues.push(warn('profile.canvas.referenceWidth', 'Reference width should be a sane positive value.'));
  if (!Number.isFinite(ch) || ch <= 0 || ch > 8192) issues.push(warn('profile.canvas.referenceHeight', 'Reference height should be a sane positive value.'));
  bundle.profile?.elements?.forEach((e, i) => validateElement(e, `profile.elements[${i}]`, issues, ids));
  return issues;
}

function validateElement(e: PackElement, path: string, issues: ValidationIssue[], ids: Set<string>): void {
  if (!e || typeof e !== 'object') { issues.push(err(path, 'Element must be an object.')); return; }
  if (!['group','input','key','mouse_button','mouse_pad'].includes(e.type)) issues.push(err(`${path}.type`, `Unsupported element type: ${String((e as any).type)}`));
  if (e.id) { if (ids.has(e.id)) issues.push(err(`${path}.id`, `Duplicate id: ${e.id}`)); ids.add(e.id); }
  if (e.anchor && !anchors.has(e.anchor)) issues.push(err(`${path}.anchor`, `Unsupported anchor: ${e.anchor}`));
  if (e.width !== undefined && (!Number.isFinite(e.width) || e.width < 0 || e.width > 4096)) issues.push(warn(`${path}.width`, 'Width is outside the practical HUD range.'));
  if (e.height !== undefined && (!Number.isFinite(e.height) || e.height < 0 || e.height > 4096)) issues.push(warn(`${path}.height`, 'Height is outside the practical HUD range.'));
  validateStyle(e.style, `${path}.style`, issues);
  validateStyleRefAndTokens(e, path, issues);
  validateGameAdjust(e, path, issues);
  if (e.type === 'group') {
    if (!Array.isArray(e.children)) issues.push(err(`${path}.children`, 'Group requires children array.'));
    e.children?.forEach((c, i) => validateElement(c, `${path}.children[${i}]`, issues, ids));
  }
  if (['input','key','mouse_button'].includes(e.type)) validateInput(e as any, path, issues);
  if (e.type === 'mouse_pad') validateMousePad(e as any, path, issues);
}


function validateGameAdjust(e: PackElement, path: string, issues: ValidationIssue[]): void {
  const g = e.gameAdjust;
  if (!g) return;
  if (e.type !== 'group') issues.push(warn(`${path}.gameAdjust`, 'gameAdjust is intended for group elements.'));
  if (g.enabled && !g.storageKey) issues.push(warn(`${path}.gameAdjust.storageKey`, 'Enabled gameAdjust should have a stable storageKey.'));
  if (g.minScale !== undefined && (!Number.isFinite(g.minScale) || g.minScale <= 0)) issues.push(warn(`${path}.gameAdjust.minScale`, 'minScale should be a positive value.'));
  if (g.maxScale !== undefined && (!Number.isFinite(g.maxScale) || g.maxScale <= 0)) issues.push(warn(`${path}.gameAdjust.maxScale`, 'maxScale should be a positive value.'));
  if (g.minScale !== undefined && g.maxScale !== undefined && g.minScale > g.maxScale) issues.push(warn(`${path}.gameAdjust`, 'minScale should not exceed maxScale.'));
}

function validateInput(e: any, path: string, issues: ValidationIssue[]) {
  if (!e.input) { issues.push(warn(`${path}.input`, 'Missing input; element will use disabled state.')); return; }
  if (e.input.type === 'keyBinding' && !e.input.name) issues.push(err(`${path}.input.name`, 'keyBinding requires name.'));
  else if (e.input.type === 'keyCode' && !e.input.code) issues.push(err(`${path}.input.code`, 'keyCode requires code.'));
  else if (e.input.type === 'mouseButton' && !['left','right','middle','button4','button5'].includes(e.input.button)) issues.push(err(`${path}.input.button`, 'mouseButton must be left/right/middle/button4/button5.'));
  else if (!['keyBinding','keyCode','mouseButton'].includes(e.input.type)) issues.push(err(`${path}.input.type`, 'Unsupported input type.'));
}

function validateMousePad(e: any, path: string, issues: ValidationIssue[]) {
  if (e.contentPadding !== undefined && (!Number.isFinite(e.contentPadding) || e.contentPadding < 0 || e.contentPadding > 256)) issues.push(warn(`${path}.contentPadding`, 'contentPadding should be 0..256.'));
  if (e.clipShape && !['visualShape','rectangle'].includes(e.clipShape)) issues.push(err(`${path}.clipShape`, 'clipShape must be visualShape or rectangle.'));
  const bg = e.background;
  if (bg) {
    if (!bgTypes.has(bg.type)) issues.push(err(`${path}.background.type`, 'Unsupported background type.'));
    if (bg.imageFit && !imageFits.has(bg.imageFit)) issues.push(err(`${path}.background.imageFit`, 'Unsupported imageFit.'));
    if (bg.scrollMode && !scrollModes.has(bg.scrollMode)) issues.push(err(`${path}.background.scrollMode`, 'Unsupported scrollMode.'));
    if (bg.type === 'image') {
      const p = bg.imagePath || bg.path;
      if (!p) issues.push(err(`${path}.background.imagePath`, 'image background requires imagePath.'));
      else if (!String(p).startsWith('textures/') || String(p).includes('..') || String(p).startsWith('/')) issues.push(err(`${path}.background.imagePath`, 'Image path must stay under textures/ and cannot contain traversal.'));
    }
  }
  const t = e.trail;
  if (t) {
    if (t.mode && !trailModes.has(t.mode)) issues.push(err(`${path}.trail.mode`, 'trail.mode must be wrap or pan.'));
    if (t.smoothing && !smoothing.has(t.smoothing)) issues.push(err(`${path}.trail.smoothing`, 'smoothing must be none, catmull_rom, or chaikin.'));
    if (t.lifetimeMs !== undefined && (!Number.isFinite(t.lifetimeMs) || t.lifetimeMs < 50 || t.lifetimeMs > 10000)) issues.push(warn(`${path}.trail.lifetimeMs`, 'lifetimeMs should normally be 50..10000.'));
    if (t.deadZoneRatio !== undefined && (!Number.isFinite(t.deadZoneRatio) || t.deadZoneRatio <= 0 || t.deadZoneRatio >= 1)) issues.push(warn(`${path}.trail.deadZoneRatio`, 'deadZoneRatio should be between 0 and 1.'));
    if (t.followMode && !['instant','smooth'].includes(t.followMode)) issues.push(err(`${path}.trail.followMode`, 'followMode must be instant or smooth.'));
    if (t.resetMode && !['none','center_on_empty'].includes(t.resetMode)) issues.push(err(`${path}.trail.resetMode`, 'resetMode must be none or center_on_empty.'));
    if (t.cursor?.type && !cursorTypes.has(t.cursor.type)) issues.push(err(`${path}.trail.cursor.type`, 'cursor type must be none/dot/circle/cursor_arrow.'));
    if (t.sensitivity !== undefined && (!Number.isFinite(t.sensitivity) || t.sensitivity <= 0 || t.sensitivity > 20)) issues.push(warn(`${path}.trail.sensitivity`, 'sensitivity should be >0 and reasonably small.'));
    if (t.maxPoints !== undefined && (!Number.isFinite(t.maxPoints) || t.maxPoints < 16 || t.maxPoints > 5000)) issues.push(warn(`${path}.trail.maxPoints`, 'maxPoints should be 16..5000.'));
  }
}

function validateStyle(style: any, path: string, issues: ValidationIssue[]) {
  if (!style || typeof style !== 'object') return;
  const candidates = ['normal','pressed','disabled'].some(k => style[k]) ? [style.normal, style.pressed, style.disabled] : [style];
  candidates.forEach((s, i) => {
    if (!s || typeof s !== 'object') return;
    const p = candidates.length === 1 ? path : `${path}.${['normal','pressed','disabled'][i]}`;
    if (s.shape && !shapes.has(s.shape)) issues.push(err(`${p}.shape`, 'Unsupported shape.'));
    if (s.fillMode && !fillModes.has(s.fillMode)) issues.push(err(`${p}.fillMode`, 'Unsupported fillMode.'));
    if (s.cornerRadius !== undefined && (!Number.isFinite(s.cornerRadius) || s.cornerRadius < 0)) issues.push(warn(`${p}.cornerRadius`, 'cornerRadius should be non-negative px.'));
    if (s.borderWidth !== undefined && (!Number.isFinite(s.borderWidth) || s.borderWidth < 0 || s.borderWidth > 64)) issues.push(warn(`${p}.borderWidth`, 'borderWidth should be 0..64.'));
  });
}
const err = (path: string, message: string): ValidationIssue => ({ level: 'error', path, message });
const warn = (path: string, message: string): ValidationIssue => ({ level: 'warning', path, message });

function validateStyleRefAndTokens(e: PackElement, path: string, issues: ValidationIssue[]): void {
  const bundle = currentBundleRef;
  if (!bundle) return;
  if (e.styleRef && !bundle.theme?.styles?.[e.styleRef]) issues.push(warn(`${path}.styleRef`, `styleRef '${e.styleRef}' is not defined in theme.styles.`));
  const tokens = bundle.theme?.tokens ?? {};
  const refs = findTokenRefs(e.style ?? {});
  if (e.styleRef && bundle.theme?.styles?.[e.styleRef]) refs.push(...findTokenRefs(bundle.theme.styles[e.styleRef]));
  for (const ref of refs) if (!(ref in tokens)) issues.push(warn(`${path}.style`, `theme token '${ref}' is not defined.`));
}

let currentBundleRef: PackBundle | undefined;
