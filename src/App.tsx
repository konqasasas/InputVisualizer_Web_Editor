import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createDefaultBundle, defaultBackground, defaultElementStyle, defaultInputStyles, defaultPadStyle, defaultTrail } from './defaults';
import { addTextureFiles, exportIvizPack, importIvizPack, texturePathForFileName } from './packIo';
import { Anchor, EditorState, ElementStyle, InputElement, MousePadElement, PackBundle, PackElement, SimInputState, TrailConfig } from './types';
import { validateEditorState } from './validation';
import { downloadBlob } from './util';
import { anchorOffset, InputAnimState, measurePreviewLayout, PreviewElementBox, renderPreview } from './layoutEngine';
import { TrailRuntime } from './trailEngine';
import './styles.css';

const initialState: EditorState = { bundle: createDefaultBundle(), textures: new Map() };
type InspectorTab = 'global'|'element'|'layout'|'input'|'style'|'mousePad'|'trail'|'theme'|'advanced';
type StyleState = 'normal'|'pressed'|'disabled';
type PreviewStyleState = 'auto'|'normal'|'pressed'|'disabled';
type FlatElement = { path: number[]; depth: number; element: PackElement; label: string };
type ResizeHandle = 'nw'|'n'|'ne'|'e'|'se'|'s'|'sw'|'w';
type EditFrame = { left: number; top: number; width: number; height: number };
type DragInfo = {
  kind: 'move' | 'resize';
  handle?: ResizeHandle;
  path: string;
  startClientX: number;
  startClientY: number;
  startBox: PreviewElementBox;
  startBundle: PackBundle;
};

const anchors: Anchor[] = ['top_left','top_center','top_right','center_left','center','center_right','bottom_left','bottom_center','bottom_right'];
const commonKeys = ['W','A','S','D','SPACE','SHIFT','CTRL','ALT','TAB','Q','E','R','F','C','Z','X','1','2','3','4','5','ESCAPE'];
const keyBindings = ['key.forward','key.back','key.left','key.right','key.jump','key.sneak','key.sprint','key.attack','key.use','key.inventory','key.drop','key.swapOffhand'];
const mouseButtons = ['left','right','middle','button4','button5'];
const styleFields: Array<keyof ElementStyle> = ['shape','fillMode','fillColor','borderColor','borderWidth','cornerRadius','textColor','opacity','scale','offsetX','offsetY','fontScale','textShadow','horizontalAlign','verticalAlign','textOffsetX','textOffsetY'];

export default function App() {
  const [state, setState] = useState<EditorState>(initialState);
  const [jsonText, setJsonText] = useState(() => JSON.stringify(initialState.bundle, null, 2));
  const [bg, setBg] = useState(() => (state.bundle.profile?.canvas as { backgroundColor?: string } | undefined)?.backgroundColor ?? '#263142');
  const [guiScale, setGuiScale] = useState(1);
  const [lastError, setLastError] = useState('');
  const previewZoom = 1;
  const [selectedPath, setSelectedPath] = useState('0');
  const [tab, setTab] = useState<InspectorTab>('layout');
  const [styleState, setStyleState] = useState<StyleState>('normal');
  const [previewStyleState, setPreviewStyleState] = useState<PreviewStyleState>('auto');
  const [testOnly, setTestOnly] = useState(false);
  const [themeJson, setThemeJson] = useState('{}');
  const [selectedThemeStyle, setSelectedThemeStyle] = useState('');
  const [history, setHistory] = useState<{past: PackBundle[]; future: PackBundle[]}>({ past: [], future: [] });
  const [isDragging, setIsDragging] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const simRef = useRef<SimInputState>({ keys: new Set(), mouseButtons: new Set(), dx: 0, dy: 0, pointerLocked: false });
  const runtimeRef = useRef(new Map<string, TrailRuntime>());
  const lastTimeRef = useRef(performance.now());
  const inputAnimRef = useRef(new Map<string, InputAnimState>());
  const boxesRef = useRef<PreviewElementBox[]>([]);
  const dragRef = useRef<DragInfo | null>(null);

  const issues = useMemo(() => validateEditorState(state), [state]);
  const errorCount = issues.filter(i => i.level === 'error').length;
  const flatElements = useMemo(() => flattenElements(state.bundle.profile?.elements ?? []), [state.bundle]);
  const selected = getByPath(state.bundle.profile?.elements ?? [], parsePath(selectedPath));
  const themeStyleNames = Object.keys(state.bundle.theme?.styles ?? {});
  const imageTexturePaths = Array.from(state.textures.values()).filter(t => !!t.image).map(t => t.path);
  const screenW = Math.max(1, Math.round(state.bundle.profile.canvas?.referenceWidth ?? 854));
  const screenH = Math.max(1, Math.round(state.bundle.profile.canvas?.referenceHeight ?? 480));

  useEffect(() => setJsonText(JSON.stringify(state.bundle, null, 2)), [state.bundle]);
  useEffect(() => {
    const raw = selectedThemeStyle ? state.bundle.theme?.styles?.[selectedThemeStyle] ?? {} : {};
    setThemeJson(JSON.stringify(raw, null, 2));
  }, [selectedThemeStyle, state.bundle.theme?.styles]);
  useEffect(() => {
    if (!selected && flatElements[0]) setSelectedPath(flatElements[0].path.join('.'));
  }, [flatElements, selected]);

  const commitBundle = useCallback((mutator: (bundle: PackBundle) => void, clearRuntime = false) => {
    setState(prev => {
      const before = cloneJson(prev.bundle);
      const next = cloneJson(prev.bundle);
      mutator(next);
      setHistory(h => ({ past: [...h.past.slice(-99), before], future: [] }));
      return { ...prev, bundle: next };
    });
    if (clearRuntime) { runtimeRef.current.clear(); inputAnimRef.current.clear(); }
    setLastError('');
  }, []);

  useEffect(() => {
    let raf = 0;
    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - lastTimeRef.current) / 1000);
      lastTimeRef.current = now;
      const canvas = canvasRef.current;
      if (canvas) {
        renderPreview(canvas, state, simRef.current, runtimeRef.current, inputAnimRef.current, guiScale, now, dt, bg, screenW, screenH, previewZoom, { selectedPath, forcedStyleState: previewStyleState });
        boxesRef.current = measurePreviewLayout(canvas, state, guiScale, previewZoom, screenW, screenH);
        drawEditorOverlay(canvas, boxesRef.current, selectedPath, !!dragRef.current, testOnly);
      }
      simRef.current.dx = 0; simRef.current.dy = 0;
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [state, guiScale, bg, screenW, screenH, previewZoom, selectedPath, previewStyleState, testOnly]);

  useEffect(() => {
    const keydown = (ev: KeyboardEvent) => {
      if (ev.target instanceof HTMLInputElement || ev.target instanceof HTMLTextAreaElement || ev.target instanceof HTMLSelectElement) return;
      if (handleEditorHotkey(ev)) return;
      simRef.current.keys.add(normalizeKey(ev.key));
    };
    const keyup = (ev: KeyboardEvent) => { simRef.current.keys.delete(normalizeKey(ev.key)); };
    const mouseup = (ev: MouseEvent) => {
      setMouseButton(ev.button, false);
      finishDrag();
    };
    const mousemove = (ev: MouseEvent) => {
      if (document.pointerLockElement === canvasRef.current) {
        simRef.current.dx += ev.movementX;
        simRef.current.dy += ev.movementY;
      }
      if (dragRef.current) updateDrag(ev.clientX, ev.clientY);
    };
    const lock = () => { simRef.current.pointerLocked = document.pointerLockElement === canvasRef.current; };
    window.addEventListener('keydown', keydown); window.addEventListener('keyup', keyup);
    window.addEventListener('mouseup', mouseup); window.addEventListener('mousemove', mousemove);
    document.addEventListener('pointerlockchange', lock);
    return () => {
      window.removeEventListener('keydown', keydown); window.removeEventListener('keyup', keyup);
      window.removeEventListener('mouseup', mouseup); window.removeEventListener('mousemove', mousemove);
      document.removeEventListener('pointerlockchange', lock);
    };
  });

  function handleEditorHotkey(ev: KeyboardEvent): boolean {
    if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === 'z') { ev.preventDefault(); ev.shiftKey ? redo() : undo(); return true; }
    if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === 'y') { ev.preventDefault(); redo(); return true; }
    if (!selected || !['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(ev.key)) return false;
    ev.preventDefault();
    const step = ev.shiftKey ? 10 : 1;
    const dx = ev.key === 'ArrowLeft' ? -step : ev.key === 'ArrowRight' ? step : 0;
    const dy = ev.key === 'ArrowUp' ? -step : ev.key === 'ArrowDown' ? step : 0;
    commitBundle(b => {
      const el = getByPath(b.profile.elements, parsePath(selectedPath));
      if (!el) return;
      el.x = round1((el.x ?? 0) + dx);
      el.y = round1((el.y ?? 0) + dy);
    });
    return true;
  }

  function undo() {
    setHistory(h => {
      if (!h.past.length) return h;
      const previous = h.past[h.past.length - 1];
      const current = cloneJson(state.bundle);
      setState(s => ({ ...s, bundle: cloneJson(previous) }));
      runtimeRef.current.clear(); inputAnimRef.current.clear();
      return { past: h.past.slice(0, -1), future: [current, ...h.future] };
    });
  }

  function redo() {
    setHistory(h => {
      if (!h.future.length) return h;
      const next = h.future[0];
      const current = cloneJson(state.bundle);
      setState(s => ({ ...s, bundle: cloneJson(next) }));
      runtimeRef.current.clear(); inputAnimRef.current.clear();
      return { past: [...h.past, current], future: h.future.slice(1) };
    });
  }

  const applyJson = useCallback(() => {
    try {
      const bundle = sanitizeBundleForNoGrowEffects(JSON.parse(jsonText) as PackBundle);
      commitBundle(b => Object.assign(b, bundle), true);
      setLastError('');
    } catch (e) { setLastError(e instanceof Error ? e.message : String(e)); }
  }, [jsonText, commitBundle]);

  async function onImport(file?: File) {
    if (!file) return;
    try {
      const imported = await importIvizPack(file);
      imported.bundle = sanitizeBundleForNoGrowEffects(imported.bundle);
      const before = cloneJson(state.bundle);
      setState(imported); runtimeRef.current.clear(); inputAnimRef.current.clear(); setLastError(''); setSelectedPath('0');
      setHistory(h => ({ past: [...h.past.slice(-99), before], future: [] }));
    } catch (e) { setLastError(e instanceof Error ? e.message : String(e)); }
  }

  async function onTextures(files?: FileList | null) {
    if (!files) return;
    setState(await addTextureFiles(files, state));
  }

  async function onBackgroundImage(files?: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    const path = texturePathForFileName(file.name);
    try {
      const withTexture = await addTextureFiles([file], state);
      const before = cloneJson(state.bundle);
      const bundle = cloneJson(withTexture.bundle);
      const el = getByPath(bundle.profile.elements, parsePath(selectedPath));
      if (!el || !isMousePad(el)) throw new Error('Select a mouse_pad element before setting an image background.');
      el.background = {
        ...(el.background ?? defaultBackground),
        type: 'image',
        imagePath: path,
        imageFit: el.background?.imageFit ?? 'cover'
      };
      setState({ ...withTexture, bundle });
      runtimeRef.current.clear();
      setHistory(h => ({ past: [...h.past.slice(-99), before], future: [] }));
      setLastError('');
    } catch (e) { setLastError(e instanceof Error ? e.message : String(e)); }
  }

  async function onExport() {
    const exportState: EditorState = { ...state, bundle: sanitizeBundleForNoGrowEffects(cloneJson(state.bundle)) };
    const currentIssues = validateEditorState(exportState);
    if (currentIssues.some(i => i.level === 'error')) {
      setLastError('Export blocked: fix validation errors first.'); return;
    }
    const blob = await exportIvizPack(exportState);
    const name = `${state.bundle.meta?.id || 'input_visualizer_pack'}.ivizpack`;
    downloadBlob(blob, name);
  }

  function setMouseButton(button: number, down: boolean) {
    const map = ['left','middle','right','button4','button5'];
    const name = map[button] || 'left';
    down ? simRef.current.mouseButtons.add(name) : simRef.current.mouseButtons.delete(name);
  }


  function onCanvasMouseDown(ev: React.MouseEvent<HTMLCanvasElement>) {
    canvasRef.current?.focus();
    setMouseButton(ev.button, true);
    if (ev.button !== 0 || testOnly) return;
    const point = canvasPoint(ev);
    const selectedBox = boxesRef.current.find(b => b.path === selectedPath);
    const handle = selectedBox ? hitResizeHandle(selectedBox, point.x, point.y) : undefined;
    if (handle && selectedBox) {
      dragRef.current = { kind: 'resize', handle, path: selectedBox.path, startClientX: ev.clientX, startClientY: ev.clientY, startBox: selectedBox, startBundle: cloneJson(state.bundle) };
      setIsDragging(true);
      ev.preventDefault();
      return;
    }
    const hit = hitTest(boxesRef.current, point.x, point.y);
    if (hit) {
      setSelectedPath(hit.path);
      dragRef.current = { kind: 'move', path: hit.path, startClientX: ev.clientX, startClientY: ev.clientY, startBox: hit, startBundle: cloneJson(state.bundle) };
      setIsDragging(true);
      ev.preventDefault();
    }
  }

  function onCanvasMouseMove(ev: React.MouseEvent<HTMLCanvasElement>) {
    if (document.pointerLockElement !== canvasRef.current) {
      const z = Math.max(0.05, previewZoom);
      simRef.current.dx += ev.nativeEvent.movementX / z;
      simRef.current.dy += ev.nativeEvent.movementY / z;
    }
    if (dragRef.current) updateDrag(ev.clientX, ev.clientY);
  }

  function onCanvasMouseUp(ev: React.MouseEvent<HTMLCanvasElement>) {
    setMouseButton(ev.button, false);
    finishDrag();
  }

  function updateDrag(clientX: number, clientY: number) {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = clientX - drag.startClientX;
    const dy = clientY - drag.startClientY;
    const start = drag.startBox;
    let frame: EditFrame = { left: start.logicalLeft, top: start.logicalTop, width: start.elementWidth, height: start.elementHeight };
    if (drag.kind === 'move') {
      frame.left = start.logicalLeft + dx / Math.max(0.0001, start.parentScale);
      frame.top = start.logicalTop + dy / Math.max(0.0001, start.parentScale);
      frame = applySmartSnap(frame, start, boxesRef.current, 'move', drag.handle);
    } else {
      const scale = Math.max(0.0001, start.elementScale);
      let screenLeft = start.x;
      let screenTop = start.y;
      let screenRight = start.x + start.width;
      let screenBottom = start.y + start.height;
      const h = drag.handle ?? 'se';
      if (h.includes('w')) screenLeft += dx;
      if (h.includes('e')) screenRight += dx;
      if (h.includes('n')) screenTop += dy;
      if (h.includes('s')) screenBottom += dy;
      if (screenRight < screenLeft + 8) screenRight = screenLeft + 8;
      if (screenBottom < screenTop + 8) screenBottom = screenTop + 8;
      frame = {
        left: (screenLeft - start.parentX) / Math.max(0.0001, start.parentScale),
        top: (screenTop - start.parentY) / Math.max(0.0001, start.parentScale),
        width: Math.max(4, (screenRight - screenLeft) / scale),
        height: Math.max(4, (screenBottom - screenTop) / scale)
      };
      frame = applySmartSnap(frame, start, boxesRef.current, 'resize', drag.handle);
    }
    setState(prev => {
      const b = cloneJson(prev.bundle);
      const el = getByPath(b.profile.elements, parsePath(drag.path));
      if (!el) return prev;
      applyFrame(el, frame, start);
      return { ...prev, bundle: b };
    });
  }

  function finishDrag() {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    setIsDragging(false);
    setHistory(h => ({ past: [...h.past.slice(-99), drag.startBundle], future: [] }));
  }

  function addElement(kind: 'key'|'mouse_button'|'mouse_pad'|'group') {
    let newPath = '0';
    commitBundle(b => {
      const root = b.profile.elements;
      const parentPath = selected?.type === 'group' ? parsePath(selectedPath) : [];
      const parent = parentPath.length ? getByPath(root, parentPath) : undefined;
      const target = parent?.type === 'group' ? (parent.children ??= []) : root;
      target.push(createElement(kind));
      newPath = [...parentPath, target.length - 1].join('.');
    }, kind === 'mouse_pad');
    setSelectedPath(newPath);
  }

  function duplicateSelected() {
    const path = parsePath(selectedPath);
    if (!path.length || !selected) return;
    const clone = cloneJson(selected);
    clone.id = `${clone.id ?? clone.type}_copy`;
    let newPath = selectedPath;
    commitBundle(b => {
      const parent = path.length === 1 ? undefined : getByPath(b.profile.elements, path.slice(0,-1));
      const list: PackElement[] = parent?.type === 'group' ? (parent.children ??= []) : b.profile.elements;
      list.splice(path[path.length - 1] + 1, 0, clone);
      newPath = [...path.slice(0, -1), path[path.length - 1] + 1].join('.');
    }, selected.type === 'mouse_pad');
    setSelectedPath(newPath);
  }

  function deleteSelected() {
    const path = parsePath(selectedPath);
    if (!path.length) return;
    commitBundle(b => removeByPath(b.profile.elements, path), selected?.type === 'mouse_pad');
    setSelectedPath('0');
  }

  function moveSelected(dir: -1|1) {
    const path = parsePath(selectedPath);
    if (!path.length) return;
    let newPath = selectedPath;
    commitBundle(b => {
      if (moveByPath(b.profile.elements, path, dir)) newPath = [...path.slice(0, -1), path[path.length - 1] + dir].join('.');
    });
    setSelectedPath(newPath);
  }

  function moveIntoPreviousGroup() {
    const path = parsePath(selectedPath);
    if (!path.length || path[path.length - 1] === 0) return;
    let newPath = selectedPath;
    commitBundle(b => {
      const parent = path.length === 1 ? undefined : getByPath(b.profile.elements, path.slice(0,-1));
      const list: PackElement[] = parent?.type === 'group' ? (parent.children ??= []) : b.profile.elements;
      const idx = path[path.length - 1];
      const prev = list[idx - 1];
      if (prev?.type !== 'group') return;
      const [item] = list.splice(idx, 1);
      const children = prev.children ??= [];
      children.push(item);
      newPath = [...path.slice(0,-1), idx - 1, children.length - 1].join('.');
    });
    setSelectedPath(newPath);
  }

  function moveOutOfGroup() {
    const path = parsePath(selectedPath);
    if (path.length < 2) return;
    let newPath = selectedPath;
    commitBundle(b => {
      const parentPath = path.slice(0, -1);
      const grandPath = path.slice(0, -2);
      const parentIdx = parentPath[parentPath.length - 1];
      const parent = getByPath(b.profile.elements, parentPath);
      const grand = grandPath.length ? getByPath(b.profile.elements, grandPath) : undefined;
      const src = parent?.type === 'group' ? (parent.children ??= []) : undefined;
      const dst: PackElement[] = grand?.type === 'group' ? (grand.children ??= []) : b.profile.elements;
      if (!src) return;
      const [item] = src.splice(path[path.length - 1], 1);
      dst.splice(parentIdx + 1, 0, item);
      newPath = [...grandPath, parentIdx + 1].join('.');
    });
    setSelectedPath(newPath);
  }

  function setElementPatch(patch: Partial<PackElement>, clearRuntime = false) {
    commitBundle(b => {
      const el = getByPath(b.profile.elements, parsePath(selectedPath));
      if (el) Object.assign(el, patch);
    }, clearRuntime);
  }

  function setElementNested(path: Array<string | number>, value: unknown, clearRuntime = false) {
    commitBundle(b => {
      const el = getByPath(b.profile.elements, parsePath(selectedPath));
      if (el) setNested(el as unknown as Record<string, unknown>, path, value);
    }, clearRuntime);
  }

  function resetSample() {
    const b = createDefaultBundle();
    setHistory(h => ({ past: [...h.past.slice(-99), cloneJson(state.bundle)], future: [] }));
    setState({ bundle: b, textures: new Map() });
    setBg((b.profile?.canvas as { backgroundColor?: string } | undefined)?.backgroundColor ?? '#263142');
    runtimeRef.current.clear(); inputAnimRef.current.clear();
    setSelectedPath('0');
  }

  function createCommonStyleFromSelected() {
    if (!selected) return;
    const name = window.prompt('New common style name', `${selected.id ?? selected.type}_style`);
    if (!name) return;
    commitBundle(b => {
      b.theme ??= { tokens: {}, styles: {} };
      b.theme.styles ??= {};
      b.theme.styles[name] = cloneJson(selected.style ?? (isMousePad(selected) ? defaultPadStyle : defaultInputStyles));
      const el = getByPath(b.profile.elements, parsePath(selectedPath));
      if (el) el.styleRef = name;
    });
    setSelectedThemeStyle(name);
  }

  function applyThemeJson() {
    if (!selectedThemeStyle) return;
    try {
      const parsed = JSON.parse(themeJson);
      commitBundle(b => {
        b.theme ??= { tokens: {}, styles: {} };
        b.theme.styles ??= {};
        b.theme.styles[selectedThemeStyle] = parsed;
      });
      setLastError('');
    } catch (e) { setLastError(e instanceof Error ? e.message : String(e)); }
  }

  function createBlankThemeStyle() {
    const name = window.prompt('Common style name', 'common_button');
    if (!name) return;
    commitBundle(b => {
      b.theme ??= { tokens: {}, styles: {} };
      b.theme.styles ??= {};
      b.theme.styles[name] = cloneJson(defaultInputStyles);
    });
    setSelectedThemeStyle(name);
  }

  function deleteThemeStyle() {
    if (!selectedThemeStyle) return;
    commitBundle(b => { if (b.theme?.styles) delete b.theme.styles[selectedThemeStyle]; });
    setSelectedThemeStyle('');
  }

  const selectedIsInput = selected && isInput(selected);
  const selectedIsMousePad = selected && isMousePad(selected);

  return <div className="app">
    <header>
      <div><h1>Input Visualizer Web Editor</h1><p>JSON直編集ではなく、選択・ドラッグ・フォームでbundle.jsonを編集できます。</p></div>
      <div className="headerActions">
        <button onClick={undo} disabled={history.past.length === 0}>Undo</button>
        <button onClick={redo} disabled={history.future.length === 0}>Redo</button>
        <label className="button">Import .ivizpack<input type="file" accept=".ivizpack,.zip" hidden onChange={e => onImport(e.target.files?.[0])}/></label>
        <label className="button">Add textures/<input type="file" multiple accept="image/png,image/jpeg,image/webp" hidden onChange={e => onTextures(e.target.files)}/></label>
        <button onClick={onExport} disabled={errorCount > 0}>Export .ivizpack</button>
      </div>
    </header>
    <main className="editorShell">
      <aside className="leftPane">
        <section className="panel compact">
          <h2>Elements</h2>
          <div className="row wrap">
            <button onClick={() => addElement('key')}>+ Key</button>
            <button onClick={() => addElement('mouse_button')}>+ Mouse</button>
            <button onClick={() => addElement('mouse_pad')}>+ Pad</button>
            <button onClick={() => addElement('group')}>+ Group</button>
          </div>
          <div className="elementList">{flatElements.map(item => <button key={item.path.join('.')} className={selectedPath===item.path.join('.')?'selected':''} style={{paddingLeft: 10 + item.depth * 18}} onClick={() => setSelectedPath(item.path.join('.'))}>{item.label}</button>)}</div>
          <div className="row wrap">
            <button onClick={() => moveSelected(-1)}>↑</button>
            <button onClick={() => moveSelected(1)}>↓</button>
            <button onClick={duplicateSelected}>Duplicate</button>
            <button onClick={deleteSelected}>Delete</button>
            <button onClick={moveIntoPreviousGroup}>Into prev group</button>
            <button onClick={moveOutOfGroup}>Out of group</button>
          </div>
        </section>
        <section className="panel compact">
          <h2>Validation</h2>
          <p>{issues.length === 0 ? 'No issues found.' : `${issues.length} issue(s), ${errorCount} error(s).`}</p>
          <ul className="issues">{issues.map((i, idx) => <li key={idx} className={i.level}><b>{i.level}</b> <code>{i.path}</code> — {i.message}</li>)}</ul>
          {lastError && <p className="error">{lastError}</p>}
        </section>
      </aside>

      <section className="previewPane centerPane">
        <div className="toolbar">
          <label>Preview background <input value={bg} type="color" onChange={e => setBg(e.target.value)}/></label>
          <label>GUI scale <input type="range" min="0.5" max="3" step="0.25" value={guiScale} onChange={e => setGuiScale(Number(e.target.value))}/><span>{guiScale.toFixed(2)}x</span></label>
          <label className="toggle"><input type="checkbox" checked={testOnly} onChange={e => setTestOnly(e.target.checked)}/> Test input only</label>
          <button onClick={() => canvasRef.current?.requestPointerLock()}>Pointer Lock preview</button>
          <button onClick={() => document.exitPointerLock()}>Unlock</button>
          <button onClick={() => { runtimeRef.current.clear(); inputAnimRef.current.clear(); }}>Clear trail</button>
        </div>
        <div className="canvasScroll">
          <canvas
            ref={canvasRef}
            className="preview"
            style={{ width: `${screenW * previewZoom}px`, height: `${screenH * previewZoom}px` }}
            onMouseDown={onCanvasMouseDown}
            onMouseMove={onCanvasMouseMove}
            onMouseUp={onCanvasMouseUp}
            onContextMenu={e => e.preventDefault()}
            tabIndex={0}
          />
        </div>
        <div className="hintBar">
          <span>Live mouse trail: ON</span>
          <span>Drag selected elements directly. Use corner/edge handles to resize.</span>
          <span>Arrow keys: 1px / Shift: 10px</span>
          <span>{isDragging ? 'Editing… distance guides show detailed px gaps.' : 'Select an element to show main px distances.'}</span>
        </div>

      </section>

      <aside className="rightPane">
        <section className="panel inspector">
          <div className="tabBar">
            {(['global','element','layout','input','style','mousePad','trail','theme','advanced'] as const).map(t => <button key={t} className={tab===t?'active':''} onClick={() => setTab(t)}>{tabLabel(t)}</button>)}
          </div>
          {tab === 'global' && <GlobalInspector bundle={state.bundle} commitBundle={commitBundle} resetSample={resetSample}/>} 
          {tab === 'element' && selected && <ElementInspector selected={selected} selectedPath={selectedPath} themeStyleNames={themeStyleNames} setElementPatch={setElementPatch} createCommonStyleFromSelected={createCommonStyleFromSelected}/>} 
          {tab === 'layout' && selected && <LayoutInspector selected={selected} setElementPatch={setElementPatch}/>} 
          {tab === 'input' && <InputInspector selected={selected} setElementPatch={setElementPatch}/>} 
          {tab === 'style' && selected && <StyleInspector selected={selected} isInput={!!selectedIsInput} styleState={styleState} setStyleState={setStyleState} previewStyleState={previewStyleState} setPreviewStyleState={setPreviewStyleState} setElementNested={setElementNested} commitBundle={commitBundle} selectedPath={selectedPath}/>} 
          {tab === 'mousePad' && <MousePadInspector selected={selected} setElementNested={setElementNested} onBackgroundImage={onBackgroundImage} imageTexturePaths={imageTexturePaths}/>} 
          {tab === 'trail' && <TrailInspector selected={selected} setElementNested={setElementNested}/>} 
          {tab === 'theme' && <ThemeInspector names={themeStyleNames} selectedName={selectedThemeStyle} setSelectedName={setSelectedThemeStyle} json={themeJson} setJson={setThemeJson} applyJson={applyThemeJson} createBlank={createBlankThemeStyle} deleteStyle={deleteThemeStyle} applyToSelected={() => selectedThemeStyle && setElementPatch({ styleRef: selectedThemeStyle })}/>} 
          {tab === 'advanced' && <AdvancedInspector jsonText={jsonText} setJsonText={setJsonText} applyJson={applyJson} resetSample={resetSample}/>} 
        </section>
        <section className="panel compact">
          <h2>Textures</h2>
          <ul className="textures">{Array.from(state.textures.values()).map(t => <li key={t.path}><code>{t.path}</code>{t.image && <span>{t.image.width}×{t.image.height}</span>}</li>)}</ul>
        </section>
      </aside>
    </main>
  </div>;
}

function GlobalInspector({ bundle, commitBundle, resetSample }: { bundle: PackBundle; commitBundle: (mutator: (bundle: PackBundle) => void, clearRuntime?: boolean) => void; resetSample: () => void }) {
  const s = bundle.settings ?? {};
  return <div className="inspectorBody">
    <h2>Global</h2>
    <TextField label="Pack id" value={bundle.meta?.id ?? ''} onChange={v => commitBundle(b => { b.meta.id = v; })}/>
    <TextField label="Pack name" value={bundle.meta?.name ?? ''} onChange={v => commitBundle(b => { b.meta.name = v; })}/>
    <TextField label="Author" value={bundle.meta?.author ?? ''} onChange={v => commitBundle(b => { b.meta.author = v; })}/>
    <NumberField label="Global scale" value={s.globalScale ?? 1} step={0.05} onChange={v => commitBundle(b => { b.settings ??= {}; b.settings.globalScale = v; }, true)}/>
    <NumberField label="Global offset X" value={s.globalOffsetX ?? 0} onChange={v => commitBundle(b => { b.settings ??= {}; b.settings.globalOffsetX = v; })}/>
    <NumberField label="Global offset Y" value={s.globalOffsetY ?? 0} onChange={v => commitBundle(b => { b.settings ??= {}; b.settings.globalOffsetY = v; })}/>
    <NumberField label="Global opacity" value={s.globalOpacity ?? 1} step={0.05} onChange={v => commitBundle(b => { b.settings ??= {}; b.settings.globalOpacity = v; })}/>
    <div className="row"><button onClick={resetSample}>Reset sample</button></div>
  </div>;
}

function ElementInspector({ selected, selectedPath, themeStyleNames, setElementPatch, createCommonStyleFromSelected }: { selected: PackElement; selectedPath: string; themeStyleNames: string[]; setElementPatch: (patch: Partial<PackElement>, clearRuntime?: boolean) => void; createCommonStyleFromSelected: () => void }) {
  return <div className="inspectorBody">
    <h2>Element</h2>
    <p className="muted">Selected path: <code>{selectedPath}</code></p>
    <TextField label="id" value={selected.id ?? ''} onChange={v => setElementPatch({ id: v })}/>
    <ReadonlyField label="type" value={selected.type}/>
    <NumberField label="zIndex" value={selected.zIndex ?? 0} onChange={v => setElementPatch({ zIndex: v })}/>
    <NumberField label="scale" value={selected.scale ?? 1} step={0.05} onChange={v => setElementPatch({ scale: v }, true)}/>
    <NumberField label="opacity" value={selected.opacity ?? 1} step={0.05} onChange={v => setElementPatch({ opacity: v })}/>
    <SelectField label="styleRef" value={selected.styleRef ?? ''} options={['', ...themeStyleNames]} onChange={v => setElementPatch({ styleRef: v || undefined })}/>
    <div className="row wrap"><button onClick={createCommonStyleFromSelected}>Create common style from this element</button><button onClick={() => setElementPatch({ style: undefined as unknown as Record<string, unknown> })}>Clear individual style</button></div>
  </div>;
}

function LayoutInspector({ selected, setElementPatch }: { selected: PackElement; setElementPatch: (patch: Partial<PackElement>, clearRuntime?: boolean) => void }) {
  const gameAdjust = selected.gameAdjust ?? {};
  const updateGameAdjust = (patch: NonNullable<PackElement['gameAdjust']>) => setElementPatch({ gameAdjust: { ...gameAdjust, ...patch } } as Partial<PackElement>);
  return <div className="inspectorBody">
    <h2>Layout</h2>
    <SelectField label="anchor" value={selected.anchor ?? 'top_left'} options={anchors} onChange={v => setElementPatch({ anchor: v as Anchor })}/>
    <NumberField label="x" value={selected.x ?? 0} onChange={v => setElementPatch({ x: v })}/>
    <NumberField label="y" value={selected.y ?? 0} onChange={v => setElementPatch({ y: v })}/>
    <NumberField label="width" value={selected.width ?? 40} min={1} onChange={v => setElementPatch({ width: v }, selected.type === 'mouse_pad')}/>
    <NumberField label="height" value={selected.height ?? 40} min={1} onChange={v => setElementPatch({ height: v }, selected.type === 'mouse_pad')}/>
    {selected.type === 'group' && <>
      <h3>In-game group adjustment</h3>
      <p className="muted">将来mod側で、pack内のbase layoutとは別に、このgroup単位のゲーム内移動/拡大率をlocal設定へ保存するためのメタ情報です。</p>
      <CheckboxField label="gameAdjust.enabled" checked={gameAdjust.enabled === true} onChange={v => updateGameAdjust({ enabled: v, storageKey: gameAdjust.storageKey || selected.id || 'group' })}/>
      <TextField label="gameAdjust.storageKey" value={gameAdjust.storageKey ?? selected.id ?? ''} onChange={v => updateGameAdjust({ storageKey: v })}/>
      <CheckboxField label="gameAdjust.allowMove" checked={gameAdjust.allowMove !== false} onChange={v => updateGameAdjust({ allowMove: v })}/>
      <CheckboxField label="gameAdjust.allowScale" checked={gameAdjust.allowScale !== false} onChange={v => updateGameAdjust({ allowScale: v })}/>
      <CheckboxField label="gameAdjust.lockAnchor" checked={gameAdjust.lockAnchor !== false} onChange={v => updateGameAdjust({ lockAnchor: v })}/>
      <NumberField label="gameAdjust.minScale" value={gameAdjust.minScale ?? 0.5} step={0.05} min={0.05} onChange={v => updateGameAdjust({ minScale: v })}/>
      <NumberField label="gameAdjust.maxScale" value={gameAdjust.maxScale ?? 3} step={0.05} min={0.05} onChange={v => updateGameAdjust({ maxScale: v })}/>
    </>}
  </div>;
}

function InputInspector({ selected, setElementPatch }: { selected: PackElement | undefined; setElementPatch: (patch: Partial<PackElement>, clearRuntime?: boolean) => void }) {
  if (!selected || !isInput(selected)) return <EmptyTab title="Input" message="key / mouse_button elementを選択してください。"/>;
  const input: NonNullable<InputElement['input']> = selected.input ?? (selected.type === 'mouse_button' ? { type: 'mouseButton', button: 'left' } : { type: 'keyCode', code: 'W' });
  return <div className="inspectorBody">
    <h2>Input</h2>
    <TextField label="label" value={selected.label ?? ''} onChange={v => setElementPatch({ label: v } as Partial<PackElement>)}/>
    <SelectField label="input type" value={input.type} options={['keyCode','keyBinding','mouseButton']} onChange={v => {
      const next = v === 'mouseButton' ? { type: 'mouseButton' as const, button: 'left' } : v === 'keyBinding' ? { type: 'keyBinding' as const, name: 'key.forward' } : { type: 'keyCode' as const, code: 'W' };
      setElementPatch({ input: next } as Partial<PackElement>);
    }}/>
    {input.type === 'keyCode' && <ComboTextField label="key code" value={input.code} options={commonKeys} onChange={v => setElementPatch({ input: { type: 'keyCode', code: v.toUpperCase() } } as Partial<PackElement>)}/>} 
    {input.type === 'keyBinding' && <ComboTextField label="key binding" value={input.name} options={keyBindings} onChange={v => setElementPatch({ input: { type: 'keyBinding', name: v } } as Partial<PackElement>)}/>} 
    {input.type === 'mouseButton' && <SelectField label="mouse button" value={input.button} options={mouseButtons} onChange={v => setElementPatch({ input: { type: 'mouseButton', button: v } } as Partial<PackElement>)}/>} 
  </div>;
}

function StyleInspector({ selected, isInput, styleState, setStyleState, previewStyleState, setPreviewStyleState, setElementNested, commitBundle, selectedPath }: { selected: PackElement; isInput: boolean; styleState: StyleState; setStyleState: (s: StyleState) => void; previewStyleState: PreviewStyleState; setPreviewStyleState: (s: PreviewStyleState) => void; setElementNested: (path: Array<string | number>, value: unknown, clearRuntime?: boolean) => void; commitBundle: (mutator: (bundle: PackBundle) => void, clearRuntime?: boolean) => void; selectedPath: string }) {
  const base = isInput ? ((selected.style as Record<string, unknown> | undefined)?.[styleState] ?? {}) : (selected.style ?? {});
  const style = { ...(isInput ? defaultInputStyles[styleState] : defaultPadStyle), ...(base as Record<string, unknown>) } as ElementStyle;
  const prefix = isInput ? ['style', styleState] : ['style'];
  return <div className="inspectorBody">
    <h2>Style</h2>
    {isInput && <div className="tabBar mini">{(['normal','pressed','disabled'] as const).map(s => <button key={s} className={styleState===s?'active':''} onClick={() => setStyleState(s)}>{s}</button>)}</div>}
    {isInput && <SelectField label="preview state" value={previewStyleState} options={['auto','normal','pressed','disabled']} onChange={v => setPreviewStyleState(v as PreviewStyleState)}/>} 
    <StyleFields style={style} allowGlow={!isInput} onChange={(k, v) => setElementNested([...prefix, k], v, selected.type === 'mouse_pad')}/>
    {isInput && <div className="row wrap">
      <button onClick={() => commitBundle(b => {
        const el = getByPath(b.profile.elements, parsePath(selectedPath));
        if (!el) return;
        const styleObj = (el.style ??= {}) as Record<string, unknown>;
        styleObj[styleState] = cloneJson((styleObj.normal as Record<string, unknown>) ?? defaultInputStyles.normal);
      })}>Copy normal → {styleState}</button>
      <button onClick={() => commitBundle(b => {
        const el = getByPath(b.profile.elements, parsePath(selectedPath));
        if (!el) return;
        const styleObj = (el.style ??= {}) as Record<string, unknown>;
        const src = cloneJson((styleObj[styleState] as Record<string, unknown>) ?? defaultInputStyles[styleState]);
        styleObj.normal = cloneJson(src); styleObj.pressed = cloneJson(src); styleObj.disabled = cloneJson(src);
      })}>Apply this state to all</button>
    </div>}
    {isInput && <AnimationFields selected={selected} setElementNested={setElementNested}/>}
  </div>;
}


function AnimationFields({ selected, setElementNested }: { selected: PackElement; setElementNested: (path: Array<string | number>, value: unknown, clearRuntime?: boolean) => void }) {
  const raw = (selected.style ?? {}) as Record<string, unknown>;
  const press = { ...(defaultInputStyles.pressAnimation ?? {}), ...((raw.pressAnimation as Record<string, unknown> | undefined) ?? {}) } as NonNullable<typeof defaultInputStyles.pressAnimation>;
  const shownScale = Math.min(1, Number.isFinite(press.scale) ? press.scale : 0.94);
  return <div className="styleGrid sectionBox">
    <h3>Animation</h3>
    <CheckboxField label="pressAnimation.enabled" checked={press.enabled !== false} onChange={v => setElementNested(['style','pressAnimation','enabled'], v)}/>
    <NumberField label="pressAnimation.durationMs" value={press.durationMs ?? 70} step={10} min={0} onChange={v => setElementNested(['style','pressAnimation','durationMs'], v)}/>
    <NumberField label="pressAnimation.scale" value={shownScale} step={0.01} min={0.05} onChange={v => { setElementNested(['style','pressAnimation','type'], 'scale_offset'); setElementNested(['style','pressAnimation','scale'], Math.min(1, v)); }}/>
    <NumberField label="pressAnimation.offsetX" value={press.offsetX ?? 0} step={0.25} onChange={v => { setElementNested(['style','pressAnimation','type'], 'scale_offset'); setElementNested(['style','pressAnimation','offsetX'], v); }}/>
    <NumberField label="pressAnimation.offsetY" value={press.offsetY ?? 0} step={0.25} onChange={v => { setElementNested(['style','pressAnimation','type'], 'scale_offset'); setElementNested(['style','pressAnimation','offsetY'], v); }}/>
    <p className="muted fullRow">Grow / glow-pulse / release-effect はGUIから選べないようにしました。押下中は縮小・オフセットだけを形アニメーションとして扱います。</p>
  </div>;
}

function StyleFields({ style, onChange, allowGlow = true }: { style: ElementStyle; onChange: (key: keyof ElementStyle, value: unknown) => void; allowGlow?: boolean }) {
  return <div className="styleGrid">
    <SelectField label="shape" value={style.shape} options={['rectangle','rounded_rectangle','circle']} onChange={v => onChange('shape', v)}/>
    <SelectField label="fillMode" value={style.fillMode} options={['filled','outline','filled_outline','none']} onChange={v => onChange('fillMode', v)}/>
    <ColorField label="fillColor" value={style.fillColor} onChange={v => onChange('fillColor', v)}/>
    <ColorField label="borderColor" value={style.borderColor} onChange={v => onChange('borderColor', v)}/>
    <NumberField label="borderWidth" value={style.borderWidth} step={0.25} onChange={v => onChange('borderWidth', v)}/>
    <NumberField label="cornerRadius" value={style.cornerRadius} onChange={v => onChange('cornerRadius', v)}/>
    <ColorField label="textColor" value={style.textColor} onChange={v => onChange('textColor', v)}/>
    <NumberField label="opacity" value={style.opacity} step={0.05} onChange={v => onChange('opacity', v)}/>
    <NumberField label="style scale" value={style.scale} step={0.05} onChange={v => onChange('scale', v)}/>
    <NumberField label="offsetX" value={style.offsetX} onChange={v => onChange('offsetX', v)}/>
    <NumberField label="offsetY" value={style.offsetY} onChange={v => onChange('offsetY', v)}/>
    <NumberField label="fontScale" value={style.fontScale} step={0.05} onChange={v => onChange('fontScale', v)}/>
    <CheckboxField label="textShadow" checked={style.textShadow} onChange={v => onChange('textShadow', v)}/>
    <SelectField label="horizontalAlign" value={style.horizontalAlign} options={['left','center','right']} onChange={v => onChange('horizontalAlign', v)}/>
    <SelectField label="verticalAlign" value={style.verticalAlign} options={['top','middle','bottom']} onChange={v => onChange('verticalAlign', v)}/>
    <NumberField label="textOffsetX" value={style.textOffsetX} onChange={v => onChange('textOffsetX', v)}/>
    <NumberField label="textOffsetY" value={style.textOffsetY} onChange={v => onChange('textOffsetY', v)}/>
    {allowGlow && <>
      <CheckboxField label="glow.enabled" checked={!!style.glow?.enabled} onChange={v => onChange('glow', { ...(style.glow ?? {}), enabled: v })}/>
      <ColorField label="glow.color" value={style.glow?.color ?? '#66aaff'} onChange={v => onChange('glow', { ...(style.glow ?? {}), color: v })}/>
      <NumberField label="glow.size" value={style.glow?.size ?? 8} onChange={v => onChange('glow', { ...(style.glow ?? {}), size: v })}/>
    </>}
  </div>;
}

function MousePadInspector({ selected, setElementNested, onBackgroundImage, imageTexturePaths }: { selected: PackElement | undefined; setElementNested: (path: Array<string | number>, value: unknown, clearRuntime?: boolean) => void; onBackgroundImage: (files?: FileList | null) => void; imageTexturePaths: string[] }) {
  if (!selected || !isMousePad(selected)) return <EmptyTab title="Mouse Pad" message="mouse_pad elementを選択してください。"/>;
  const bg = { ...defaultBackground, ...(selected.background ?? {}) };
  return <div className="inspectorBody">
    <h2>Mouse Pad</h2>
    <NumberField label="contentPadding" value={selected.contentPadding ?? 0} onChange={v => setElementNested(['contentPadding'], v, true)}/>
    <SelectField label="clipShape" value={selected.clipShape ?? 'visualShape'} options={['visualShape','rectangle']} onChange={v => setElementNested(['clipShape'], v, true)}/>
    <h3>Background</h3>
    <SelectField label="type" value={bg.type} options={['none','checkerboard','grid','dots','image']} onChange={v => setElementNested(['background','type'], v, true)}/>
    <NumberField label="opacity" value={bg.backgroundOpacity ?? 1} step={0.05} onChange={v => setElementNested(['background','backgroundOpacity'], v, true)}/>
    <SelectField label="scrollMode" value={bg.scrollMode ?? 'fixed'} options={['fixed','world']} onChange={v => setElementNested(['background','scrollMode'], v, true)}/>
    <NumberField label="cellSize" value={bg.cellSize ?? 10} onChange={v => setElementNested(['background','cellSize'], v, true)}/>
    <ColorField label="colorA" value={bg.colorA ?? '#0b0f16'} onChange={v => setElementNested(['background','colorA'], v, true)}/>
    <ColorField label="colorB" value={bg.colorB ?? '#111722'} onChange={v => setElementNested(['background','colorB'], v, true)}/>
    <NumberField label="gridSize" value={bg.gridSize ?? 16} onChange={v => setElementNested(['background','gridSize'], v, true)}/>
    <NumberField label="spacing" value={bg.spacing ?? 18} onChange={v => setElementNested(['background','spacing'], v, true)}/>
    <NumberField label="dotSize" value={bg.dotSize ?? 2} onChange={v => setElementNested(['background','dotSize'], v, true)}/>
    <ColorField label="dotColor" value={bg.dotColor ?? '#ffffff'} onChange={v => setElementNested(['background','dotColor'], v, true)}/>
    <ComboTextField label="imagePath" value={bg.imagePath ?? ''} options={imageTexturePaths} onChange={v => setElementNested(['background','imagePath'], v, true)}/>
    <label className="field"><span>image upload</span><span className="uploadControl"><label className="button">Choose image<input type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={e => { onBackgroundImage(e.target.files); e.currentTarget.value = ''; }}/></label></span></label>
    <SelectField label="imageFit" value={bg.imageFit ?? 'cover'} options={['cover','contain','stretch','center','tile']} onChange={v => setElementNested(['background','imageFit'], v, true)}/>
  </div>;
}

function TrailInspector({ selected, setElementNested }: { selected: PackElement | undefined; setElementNested: (path: Array<string | number>, value: unknown, clearRuntime?: boolean) => void }) {
  if (!selected || !isMousePad(selected)) return <EmptyTab title="Trail" message="mouse_pad elementを選択してください。"/>;
  const trail = { ...defaultTrail, ...(selected.trail ?? {}) } as TrailConfig;
  const dots = { ...(defaultTrail.dots ?? {}), ...(selected.trail?.dots ?? {}) };
  const cursor = { ...(defaultTrail.cursor ?? {}), ...(selected.trail?.cursor ?? {}) };
  return <div className="inspectorBody">
    <h2>Trail</h2>
    <CheckboxField label="enabled" checked={trail.enabled !== false} onChange={v => setElementNested(['trail','enabled'], v, true)}/>
    <CheckboxField label="line" checked={trail.line !== false} onChange={v => setElementNested(['trail','line'], v, true)}/>
    <SelectField label="mode" value={trail.mode ?? 'wrap'} options={['wrap','pan']} onChange={v => setElementNested(['trail','mode'], v, true)}/>
    <SelectField label="colorMode" value={trail.colorMode ?? 'fixed'} options={['fixed','age_gradient','button_state']} onChange={v => setElementNested(['trail','colorMode'], v, true)}/>
    <NumberField label="sensitivity" value={trail.sensitivity ?? 1} step={0.05} onChange={v => setElementNested(['trail','sensitivity'], v, true)}/>
    <NumberField label="lifetimeMs" value={trail.lifetimeMs ?? 850} step={10} onChange={v => setElementNested(['trail','lifetimeMs'], v, true)}/>
    <SelectField label="smoothing" value={trail.smoothing ?? 'catmull_rom'} options={['none','catmull_rom','chaikin']} onChange={v => setElementNested(['trail','smoothing'], v, true)}/>
    <NumberField label="maxPoints" value={trail.maxPoints ?? 1024} step={16} onChange={v => setElementNested(['trail','maxPoints'], v, true)}/>
    <NumberField label="maxRenderedSamples" value={trail.maxRenderedSamples ?? 2048} step={16} onChange={v => setElementNested(['trail','maxRenderedSamples'], v, true)}/>
    <NumberField label="baseWidth" value={trail.baseWidth ?? 3} step={0.25} onChange={v => setElementNested(['trail','baseWidth'], v, true)}/>
    <NumberField label="tailWidth" value={trail.tailWidth ?? 0.15} step={0.05} onChange={v => setElementNested(['trail','tailWidth'], v, true)}/>
    <ColorField label="color" value={trail.color ?? '#eaf6ff'} onChange={v => setElementNested(['trail','color'], v, true)}/>
    <ColorField label="tailColor" value={trail.tailColor ?? '#55eaf6ff'} onChange={v => setElementNested(['trail','tailColor'], v, true)}/>
    <NumberField label="maxTrailDistancePx" value={trail.maxTrailDistancePx ?? 165} onChange={v => setElementNested(['trail','maxTrailDistancePx'], v, true)}/>
    <SelectField label="followMode" value={trail.followMode ?? 'instant'} options={['instant','smooth']} onChange={v => setElementNested(['trail','followMode'], v, true)}/>
    <NumberField label="deadZoneRatio" value={trail.deadZoneRatio ?? 0.6} step={0.05} onChange={v => setElementNested(['trail','deadZoneRatio'], v, true)}/>
    <NumberField label="followResponsiveness" value={trail.followResponsiveness ?? 9} step={0.25} onChange={v => setElementNested(['trail','followResponsiveness'], v, true)}/>
    <h3>Left / Right click highlight</h3>
    <ColorField label="lmbHighlight.color" value={trail.lmbHighlight?.color ?? '#9edbff'} onChange={v => setElementNested(['trail','lmbHighlight','color'], v, true)}/>
    <ColorField label="rmbHighlight.color" value={trail.rmbHighlight?.color ?? '#ffc08a'} onChange={v => setElementNested(['trail','rmbHighlight','color'], v, true)}/>
    <p className="muted fullRow">Trailのglow / width growは固定OFFです。クリック中は色だけ変えられます。</p>
    <h3>Dots</h3>
    <CheckboxField label="dots.enabled" checked={!!dots.enabled} onChange={v => setElementNested(['trail','dots','enabled'], v, true)}/>
    <NumberField label="dots.spacing" value={dots.spacing ?? 20} onChange={v => setElementNested(['trail','dots','spacing'], v, true)}/>
    <NumberField label="dots.size" value={dots.size ?? 2.4} step={0.25} onChange={v => setElementNested(['trail','dots','size'], v, true)}/>
    <ColorField label="dots.color" value={dots.color ?? '#eaf6ff'} onChange={v => setElementNested(['trail','dots','color'], v, true)}/>
    <h3>Cursor</h3>
    <SelectField label="cursor.type" value={cursor.type ?? 'dot'} options={['none','dot','circle','cursor_arrow']} onChange={v => setElementNested(['trail','cursor','type'], v, true)}/>
    <NumberField label="cursor.size" value={cursor.size ?? 5} step={0.25} onChange={v => setElementNested(['trail','cursor','size'], v, true)}/>
    <ColorField label="cursor.color" value={cursor.color ?? '#eaf6ff'} onChange={v => setElementNested(['trail','cursor','color'], v, true)}/>
  </div>;
}

function ThemeInspector({ names, selectedName, setSelectedName, json, setJson, applyJson, createBlank, deleteStyle, applyToSelected }: { names: string[]; selectedName: string; setSelectedName: (v: string) => void; json: string; setJson: (v: string) => void; applyJson: () => void; createBlank: () => void; deleteStyle: () => void; applyToSelected: () => void }) {
  return <div className="inspectorBody">
    <h2>Common styles</h2>
    <SelectField label="style" value={selectedName} options={['', ...names]} onChange={setSelectedName}/>
    <div className="row wrap"><button onClick={createBlank}>Create blank</button><button onClick={applyToSelected} disabled={!selectedName}>Apply styleRef to selected</button><button onClick={deleteStyle} disabled={!selectedName}>Delete</button></div>
    <textarea className="miniText" value={json} onChange={e => setJson(e.target.value)} spellCheck={false}/>
    <div className="row"><button onClick={applyJson} disabled={!selectedName}>Apply common style JSON</button></div>
  </div>;
}

function AdvancedInspector({ jsonText, setJsonText, applyJson, resetSample }: { jsonText: string; setJsonText: (v: string) => void; applyJson: () => void; resetSample: () => void }) {
  return <div className="inspectorBody">
    <h2>Advanced bundle.json</h2>
    <p className="muted">GUI操作では自動同期されます。手で編集した内容は Apply JSON を押すまで反映されません。</p>
    <textarea value={jsonText} onChange={e => setJsonText(e.target.value)} spellCheck={false}/>
    <div className="row"><button onClick={applyJson}>Apply JSON</button><button onClick={resetSample}>Reset sample</button></div>
  </div>;
}

function EmptyTab({ title, message }: { title: string; message: string }) {
  return <div className="inspectorBody"><h2>{title}</h2><p className="muted">{message}</p></div>;
}

function TextField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return <label className="field"><span>{label}</span><input value={value} onChange={e => onChange(e.target.value)}/></label>;
}
function ComboTextField({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (v: string) => void }) {
  return <label className="field"><span>{label}</span><input list={`${label}-list`} value={value} onChange={e => onChange(e.target.value)}/><datalist id={`${label}-list`}>{options.map(o => <option key={o} value={o}/>)}</datalist></label>;
}
function ReadonlyField({ label, value }: { label: string; value: string }) {
  return <label className="field"><span>{label}</span><input value={value} readOnly/></label>;
}
function NumberField({ label, value, onChange, step = 1, min }: { label: string; value: number; onChange: (v: number) => void; step?: number; min?: number }) {
  return <label className="field"><span>{label}</span><input type="number" step={step} min={min} value={Number.isFinite(value) ? value : 0} onChange={e => onChange(Number(e.target.value))}/></label>;
}
function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const safe = /^#[0-9a-fA-F]{6}$/.test(value) ? value : '#ffffff';
  return <label className="field"><span>{label}</span><span className="colorCombo"><input type="color" value={safe} onChange={e => onChange(e.target.value)}/><input value={value} onChange={e => onChange(e.target.value)}/></span></label>;
}
function SelectField({ label, value, options, onChange }: { label: string; value: string; options: readonly string[]; onChange: (v: string) => void }) {
  return <label className="field"><span>{label}</span><select value={value} onChange={e => onChange(e.target.value)}>{options.map(o => <option key={o} value={o}>{o || '(none)'}</option>)}</select></label>;
}
function CheckboxField({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return <label className="field checkbox"><span>{label}</span><input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)}/></label>;
}

function drawEditorOverlay(canvas: HTMLCanvasElement, boxes: PreviewElementBox[], selectedPath: string, detailed: boolean, testOnly: boolean) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const selected = boxes.find(b => b.path === selectedPath);
  if (!selected) { ctx.restore(); return; }
  ctx.lineWidth = 1;
  ctx.strokeStyle = testOnly ? 'rgba(255, 210, 110, .95)' : 'rgba(124, 184, 255, .95)';
  ctx.setLineDash([5, 3]);
  ctx.strokeRect(selected.x - .5, selected.y - .5, selected.width + 1, selected.height + 1);
  ctx.setLineDash([]);
  if (!testOnly) drawHandles(ctx, selected);
  drawCanvasDistances(ctx, selected, rect, detailed);
  if (detailed) drawNearestDistances(ctx, selected, boxes);
  const parent = selected.parentPath ? boxes.find(b => b.path === selected.parentPath) : undefined;
  if (parent) drawParentDistances(ctx, selected, parent);
  ctx.restore();
}

function drawHandles(ctx: CanvasRenderingContext2D, b: PreviewElementBox) {
  ctx.fillStyle = '#9fc9ff'; ctx.strokeStyle = '#07111f';
  for (const p of handlePoints(b)) { ctx.fillRect(p.x - 4, p.y - 4, 8, 8); ctx.strokeRect(p.x - 4, p.y - 4, 8, 8); }
}

function drawCanvasDistances(ctx: CanvasRenderingContext2D, b: PreviewElementBox, rect: DOMRect, detailed: boolean) {
  const scale = Math.max(0.0001, b.parentScale);
  const midY = b.y + b.height / 2;
  const midX = b.x + b.width / 2;
  guide(ctx, 0, midY, b.x, midY, `${Math.round((b.x - 0) / scale)}px`);
  guide(ctx, b.x + b.width, midY + 12, rect.width, midY + 12, `${Math.round((rect.width - b.x - b.width) / scale)}px`);
  if (detailed) {
    guide(ctx, midX, 0, midX, b.y, `${Math.round(b.y / scale)}px`);
    guide(ctx, midX + 12, b.y + b.height, midX + 12, rect.height, `${Math.round((rect.height - b.y - b.height) / scale)}px`);
  }
}

function drawParentDistances(ctx: CanvasRenderingContext2D, b: PreviewElementBox, p: PreviewElementBox) {
  const scale = Math.max(0.0001, b.parentScale);
  const y = b.y + b.height + 16;
  guide(ctx, p.x, y, b.x, y, `${Math.round((b.x - p.x) / scale)}px parent`);
  guide(ctx, b.x + b.width, y + 12, p.x + p.width, y + 12, `${Math.round((p.x + p.width - b.x - b.width) / scale)}px parent`);
}

function drawNearestDistances(ctx: CanvasRenderingContext2D, b: PreviewElementBox, boxes: PreviewElementBox[]) {
  const others = boxes.filter(o => o.path !== b.path && o.parentPath === b.parentPath && !isDescendantPath(o.path, b.path));
  const h = nearestHorizontalGap(b, others);
  const v = nearestVerticalGap(b, others);
  const scale = Math.max(0.0001, b.parentScale);
  if (h) guide(ctx, h.x1, h.y, h.x2, h.y, `${Math.round(Math.abs(h.x2 - h.x1) / scale)}px`);
  if (v) guide(ctx, v.x, v.y1, v.x, v.y2, `${Math.round(Math.abs(v.y2 - v.y1) / scale)}px`);
}

function guide(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, label: string) {
  if (Math.abs(x2 - x1) < 1 && Math.abs(y2 - y1) < 1) return;
  ctx.save();
  ctx.strokeStyle = 'rgba(125, 205, 255, .72)';
  ctx.fillStyle = 'rgba(12, 19, 32, .88)';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  ctx.fillStyle = '#dff3ff'; ctx.font = '11px ui-monospace, SFMono-Regular, Menlo, monospace';
  const lx = (x1 + x2) / 2, ly = (y1 + y2) / 2;
  const w = ctx.measureText(label).width + 8;
  ctx.fillStyle = 'rgba(8, 12, 18, .9)'; ctx.fillRect(lx - w / 2, ly - 9, w, 16);
  ctx.fillStyle = '#dff3ff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(label, lx, ly);
  ctx.restore();
}

function nearestHorizontalGap(b: PreviewElementBox, others: PreviewElementBox[]) {
  let best: { x1: number; x2: number; y: number; d: number } | undefined;
  for (const o of others) {
    const overlapY = Math.min(b.y + b.height, o.y + o.height) - Math.max(b.y, o.y);
    if (overlapY <= 0) continue;
    let x1 = b.x + b.width, x2 = o.x;
    if (o.x + o.width <= b.x) { x1 = o.x + o.width; x2 = b.x; }
    const d = Math.abs(x2 - x1);
    if (!best || d < best.d) best = { x1, x2, y: Math.max(b.y, o.y) + overlapY / 2, d };
  }
  return best;
}
function nearestVerticalGap(b: PreviewElementBox, others: PreviewElementBox[]) {
  let best: { x: number; y1: number; y2: number; d: number } | undefined;
  for (const o of others) {
    const overlapX = Math.min(b.x + b.width, o.x + o.width) - Math.max(b.x, o.x);
    if (overlapX <= 0) continue;
    let y1 = b.y + b.height, y2 = o.y;
    if (o.y + o.height <= b.y) { y1 = o.y + o.height; y2 = b.y; }
    const d = Math.abs(y2 - y1);
    if (!best || d < best.d) best = { x: Math.max(b.x, o.x) + overlapX / 2, y1, y2, d };
  }
  return best;
}

function handlePoints(b: PreviewElementBox): Array<{handle: ResizeHandle; x: number; y: number}> {
  const l = b.x, t = b.y, r = b.x + b.width, mX = b.x + b.width / 2, mY = b.y + b.height / 2, bot = b.y + b.height;
  return [
    { handle: 'nw', x: l, y: t }, { handle: 'n', x: mX, y: t }, { handle: 'ne', x: r, y: t },
    { handle: 'e', x: r, y: mY }, { handle: 'se', x: r, y: bot }, { handle: 's', x: mX, y: bot },
    { handle: 'sw', x: l, y: bot }, { handle: 'w', x: l, y: mY }
  ];
}
function hitResizeHandle(b: PreviewElementBox, x: number, y: number): ResizeHandle | undefined {
  return handlePoints(b).find(p => Math.abs(x - p.x) <= 7 && Math.abs(y - p.y) <= 7)?.handle;
}
function canvasPoint(ev: React.MouseEvent<HTMLCanvasElement>) {
  const rect = ev.currentTarget.getBoundingClientRect();
  return { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
}
function hitTest(boxes: PreviewElementBox[], x: number, y: number): PreviewElementBox | undefined {
  for (const b of [...boxes].reverse()) if (x >= b.x && x <= b.x + b.width && y >= b.y && y <= b.y + b.height) return b;
  return undefined;
}

function applySmartSnap(frame: EditFrame, box: PreviewElementBox, boxes: PreviewElementBox[], mode: 'move'|'resize', handle?: ResizeHandle): EditFrame {
  const threshold = 8;
  const out = { ...frame };
  const xTargets = [0, box.parentW / 2, box.parentW];
  const yTargets = [0, box.parentH / 2, box.parentH];
  for (const o of boxes) {
    if (o.path === box.path || o.parentPath !== box.parentPath || isDescendantPath(o.path, box.path)) continue;
    const ol = (o.x - box.parentX) / Math.max(0.0001, box.parentScale);
    const ot = (o.y - box.parentY) / Math.max(0.0001, box.parentScale);
    const or = (o.x + o.width - box.parentX) / Math.max(0.0001, box.parentScale);
    const ob = (o.y + o.height - box.parentY) / Math.max(0.0001, box.parentScale);
    xTargets.push(ol, (ol + or) / 2, or);
    yTargets.push(ot, (ot + ob) / 2, ob);
  }
  const xSources = mode === 'resize'
    ? (handle?.includes('w') ? [{ key: 'left', value: out.left }] : handle?.includes('e') ? [{ key: 'right', value: out.left + out.width }] : [])
    : [{ key: 'left', value: out.left }, { key: 'center', value: out.left + out.width / 2 }, { key: 'right', value: out.left + out.width }];
  const ySources = mode === 'resize'
    ? (handle?.includes('n') ? [{ key: 'top', value: out.top }] : handle?.includes('s') ? [{ key: 'bottom', value: out.top + out.height }] : [])
    : [{ key: 'top', value: out.top }, { key: 'center', value: out.top + out.height / 2 }, { key: 'bottom', value: out.top + out.height }];
  const sx = nearestSnap(xSources, xTargets, threshold);
  if (sx) {
    if (mode === 'resize' && sx.key === 'right') out.width += sx.delta;
    else if (mode === 'resize' && sx.key === 'left') { out.left += sx.delta; out.width -= sx.delta; }
    else out.left += sx.delta;
  }
  const sy = nearestSnap(ySources, yTargets, threshold);
  if (sy) {
    if (mode === 'resize' && sy.key === 'bottom') out.height += sy.delta;
    else if (mode === 'resize' && sy.key === 'top') { out.top += sy.delta; out.height -= sy.delta; }
    else out.top += sy.delta;
  }
  out.width = Math.max(4, out.width); out.height = Math.max(4, out.height);
  return out;
}
function nearestSnap(sources: Array<{key: string; value: number}>, targets: number[], threshold: number): {key: string; delta: number} | undefined {
  let best: {key: string; delta: number; abs: number} | undefined;
  for (const s of sources) for (const t of targets) {
    const delta = t - s.value, abs = Math.abs(delta);
    if (abs <= threshold && (!best || abs < best.abs)) best = { key: s.key, delta, abs };
  }
  return best;
}
function applyFrame(el: PackElement, frame: EditFrame, box: PreviewElementBox) {
  const w = round1(Math.max(4, frame.width));
  const h = round1(Math.max(4, frame.height));
  const o = anchorOffset(el.anchor ?? 'top_left', w, h, box.parentW, box.parentH);
  el.width = w; el.height = h;
  el.x = round1(frame.left - o.x);
  el.y = round1(frame.top - o.y);
}


function sanitizeBundleForNoGrowEffects(bundle: PackBundle): PackBundle {
  const out = cloneJson(bundle);
  const visitElements = (elements?: PackElement[]) => {
    (elements ?? []).forEach(e => {
      sanitizeStyleObject(e.style as Record<string, unknown> | undefined);
      if (isMousePad(e)) sanitizeTrailObject(e.trail as Record<string, unknown> | undefined);
      if (e.type === 'group') visitElements(e.children ?? []);
    });
  };
  visitElements(out.profile?.elements ?? []);
  const styles = out.theme?.styles ?? {};
  Object.values(styles).forEach(v => {
    if (v && typeof v === 'object' && !Array.isArray(v)) sanitizeStyleObject(v as Record<string, unknown>);
  });
  return out;
}

function sanitizeStyleObject(style: Record<string, unknown> | undefined): void {
  if (!style) return;
  const press = ensureRecord(style, 'pressAnimation');
  if (press) {
    if (press.type !== 'none') press.type = 'scale_offset';
    const sc = Number(press.scale ?? 0.94);
    press.scale = Number.isFinite(sc) ? Math.min(1, Math.max(0.05, sc)) : 0.94;
  }
  const release = ensureRecord(style, 'releaseEffect');
  if (release) {
    release.type = 'none';
    release.durationMs = 0;
    release.alpha = 0;
    release.size = 0;
  }
  for (const stateName of ['normal','pressed','disabled']) {
    const stateStyle = ensureRecord(style, stateName);
    const glow = stateStyle ? ensureRecord(stateStyle, 'glow') : undefined;
    if (glow) { glow.enabled = false; glow.alpha = 0; glow.size = 0; }
  }
}

function sanitizeTrailObject(trail: Record<string, unknown> | undefined): void {
  if (!trail) return;
  trail.glowEnabled = false;
  trail.glowWidthMultiplier = 1;
  const glow = ensureRecord(trail, 'glow');
  if (glow) glow.enabled = false;
  const lmb = ensureRecord(trail, 'lmbHighlight');
  if (lmb) { lmb.widthMultiplier = 1; lmb.glowMultiplier = 1; }
  const rmb = ensureRecord(trail, 'rmbHighlight');
  if (rmb) { rmb.widthMultiplier = 1; rmb.glowMultiplier = 1; }
}

function ensureRecord(parent: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
  const value = parent[key];
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function normalizeKey(key: string): string {
  if (key === ' ') return 'SPACE';
  if (key === 'Shift') return 'SHIFT';
  if (key === 'Control') return 'CTRL';
  if (key === 'Escape') return 'ESCAPE';
  return key.toUpperCase();
}
function flattenElements(elements: PackElement[], depth = 0, prefix: number[] = []): FlatElement[] {
  const out: FlatElement[] = [];
  elements.forEach((e, i) => {
    const path = [...prefix, i];
    out.push({ path, depth, element: e, label: `${e.id ?? '(no id)'} · ${e.type}` });
    if (e.type === 'group') out.push(...flattenElements(e.children ?? [], depth + 1, path));
  });
  return out;
}
function parsePath(path: string): number[] { return path.split('.').filter(Boolean).map(Number).filter(n => Number.isInteger(n) && n >= 0); }
function getByPath(elements: PackElement[], path: number[]): PackElement | undefined {
  let list = elements; let cur: PackElement | undefined;
  for (const idx of path) { cur = list[idx]; if (!cur) return undefined; list = cur.type === 'group' ? (cur.children ?? []) : []; }
  return cur;
}
function setNested(obj: Record<string, unknown>, path: Array<string | number>, value: unknown): void {
  let cur = obj;
  for (let i = 0; i < path.length - 1; i++) {
    const k = path[i];
    const next = cur[k as string];
    if (!next || typeof next !== 'object' || Array.isArray(next)) cur[k as string] = {};
    cur = cur[k as string] as Record<string, unknown>;
  }
  cur[path[path.length - 1] as string] = value;
}
function removeByPath(elements: PackElement[], path: number[]): void { const parent = path.length === 1 ? undefined : getByPath(elements, path.slice(0,-1)); const list: PackElement[] = parent?.type === 'group' ? (parent.children ??= []) : elements; list.splice(path[path.length-1], 1); }
function moveByPath(elements: PackElement[], path: number[], dir: -1|1): boolean { const parent = path.length === 1 ? undefined : getByPath(elements, path.slice(0,-1)); const list: PackElement[] = parent?.type === 'group' ? (parent.children ??= []) : elements; const i = path[path.length-1], j = i + dir; if (j < 0 || j >= list.length) return false; const [x] = list.splice(i,1); list.splice(j,0,x); return true; }
function cloneJson<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
function createElement(kind: 'key'|'mouse_button'|'mouse_pad'|'group'): PackElement {
  const suffix = Math.floor(Date.now() % 100000);
  if (kind === 'group') return { type: 'group', id: `group_${suffix}`, x: 0, y: 0, width: 160, height: 120, children: [] } as PackElement;
  if (kind === 'mouse_pad') return { type: 'mouse_pad', id: `mouse_pad_${suffix}`, anchor: 'bottom_right', x: -220, y: -170, width: 180, height: 140, contentPadding: 8, background: { ...defaultBackground }, trail: { ...defaultTrail } } as PackElement;
  if (kind === 'mouse_button') return { type: 'mouse_button', id: `mouse_${suffix}`, input: { type: 'mouseButton', button: 'left' }, label: 'LMB', x: 0, y: 0, width: 64, height: 30 } as PackElement;
  return { type: 'key', id: `key_${suffix}`, input: { type: 'keyCode', code: 'W' }, label: 'W', x: 0, y: 0, width: 36, height: 36 } as PackElement;
}
function isInput(e: PackElement): e is InputElement { return e.type === 'input' || e.type === 'key' || e.type === 'mouse_button'; }
function isMousePad(e: PackElement): e is MousePadElement { return e.type === 'mouse_pad'; }
function round1(v: number): number { return Math.round(v * 10) / 10; }
function isDescendantPath(path: string, ancestor: string): boolean { return path !== ancestor && path.startsWith(`${ancestor}.`); }
function tabLabel(t: InspectorTab): string { return ({ global: 'Global', element: 'Element', layout: 'Layout', input: 'Input', style: 'Style', mousePad: 'Mouse Pad', trail: 'Trail', theme: 'Common', advanced: 'Advanced JSON' } as Record<InspectorTab, string>)[t]; }
