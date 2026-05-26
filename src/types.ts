export type Anchor =
  | 'top_left' | 'top_center' | 'top_right'
  | 'center_left' | 'center' | 'center_right'
  | 'bottom_left' | 'bottom_center' | 'bottom_right';
export type Shape = 'rectangle' | 'rounded_rectangle' | 'circle';
export type FillMode = 'filled' | 'outline' | 'filled_outline' | 'none';
export type ElementType = 'group' | 'input' | 'key' | 'mouse_button' | 'mouse_pad';
export type BackgroundType = 'none' | 'checkerboard' | 'grid' | 'dots' | 'image';
export type ImageFit = 'cover' | 'contain' | 'stretch' | 'center' | 'tile';
export type ScrollMode = 'fixed' | 'world';
export type TrailMode = 'wrap' | 'pan';
export type FollowMode = 'instant' | 'smooth';
export type ResetMode = 'none' | 'center_on_empty';
export type Smoothing = 'none' | 'catmull_rom' | 'chaikin';
export type TrailColorMode = 'fixed' | 'age_gradient' | 'button_state';
export type CursorType = 'none' | 'dot' | 'circle' | 'cursor_arrow';

export interface PackBundle {
  format: 'input_visualizer_pack';
  version: number;
  meta: { id: string; name: string; author?: string };
  settings?: Partial<LocalSettings>;
  profile: { canvas?: { referenceWidth?: number; referenceHeight?: number }; elements: PackElement[] };
  theme?: { tokens?: Record<string, unknown>; styles?: Record<string, unknown> };
}


export interface GameAdjustConfig {
  enabled?: boolean;
  storageKey?: string;
  allowMove?: boolean;
  allowScale?: boolean;
  lockAnchor?: boolean;
  minScale?: number;
  maxScale?: number;
}

export interface LocalSettings {
  version: number;
  enabled: boolean;
  activePack: string;
  globalScale: number;
  globalOffsetX: number;
  globalOffsetY: number;
  globalOpacity: number;
}

export interface BaseElement {
  id?: string;
  type: ElementType;
  anchor?: Anchor;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  scale?: number;
  opacity?: number;
  zIndex?: number;
  styleRef?: string;
  style?: Record<string, unknown>;
  gameAdjust?: GameAdjustConfig;
  children?: PackElement[];
}

export interface InputElement extends BaseElement {
  type: 'input' | 'key' | 'mouse_button';
  input?: { type: 'keyBinding'; name: string } | { type: 'keyCode'; code: string } | { type: 'mouseButton'; button: string };
  label?: string;
}

export interface MousePadElement extends BaseElement {
  type: 'mouse_pad';
  contentPadding?: number;
  clipShape?: 'visualShape' | 'rectangle';
  background?: MousePadBackground;
  trail?: TrailConfig;
}

export interface GroupElement extends BaseElement {
  type: 'group';
  children: PackElement[];
}

export type PackElement = GroupElement | InputElement | MousePadElement | BaseElement;

export interface ElementStyle {
  shape: Shape;
  cornerRadius: number;
  fillMode: FillMode;
  fillColor: string;
  borderColor: string;
  borderWidth: number;
  textColor: string;
  opacity: number;
  scale: number;
  offsetX: number;
  offsetY: number;
  fontScale: number;
  textShadow: boolean;
  horizontalAlign: 'left' | 'center' | 'right';
  verticalAlign: 'top' | 'middle' | 'bottom';
  textOffsetX: number;
  textOffsetY: number;
  shadow?: { enabled: boolean; offsetX: number; offsetY: number; color: string; alpha: number };
  glow?: { enabled: boolean; color: string; alpha: number; size: number };
}

export interface InputStyleSet {
  normal: ElementStyle;
  pressed: ElementStyle;
  disabled: ElementStyle;
  pressAnimation?: { enabled: boolean; type: 'none' | 'scale' | 'offset' | 'scale_offset' | 'glow_pulse'; durationMs: number; scale: number; offsetX: number; offsetY: number }; // glow_pulse is legacy-only and no longer exposed in the GUI.
  releaseEffect?: { type: 'none' | 'glow_fade' | 'border_fade'; durationMs: number; color: string; alpha: number; size: number }; // non-none values are legacy-only and are disabled by the web preview.
}

export interface MousePadBackground {
  type: BackgroundType;
  cellSize?: number;
  colorA?: string;
  colorB?: string;
  gridSize?: number;
  lineWidth?: number;
  lineColor?: string;
  spacing?: number;
  dotSize?: number;
  dotColor?: string;
  imagePath?: string;
  imageFit?: ImageFit;
  scrollMode?: ScrollMode;
  backgroundOpacity?: number;
}

export interface TrailConfig {
  enabled?: boolean;
  line?: boolean;
  glow?: { enabled?: boolean } | boolean;
  colorMode?: TrailColorMode;
  mode?: TrailMode;
  sensitivity?: number;
  lifetimeMs?: number;
  smoothing?: Smoothing;
  maxPoints?: number;
  maxRenderedSamples?: number;
  maxSmoothingSamples?: number;
  baseWidth?: number;
  tailWidth?: number;
  color?: string;
  glowColor?: string;
  glowWidthMultiplier?: number;
  glowEnabled?: boolean;
  tailColor?: string;
  maxTrailDistancePx?: number;
  dots?: { enabled?: boolean; spacing?: number; size?: number; color?: string; fadeWithAge?: boolean };
  dotSpacing?: number;
  dotSize?: number;
  dotColor?: string;
  cursor?: { type?: CursorType; size?: number; color?: string };
  cursorSize?: number;
  lmbHighlight?: { color?: string; widthMultiplier?: number; glowMultiplier?: number };
  rmbHighlight?: { color?: string; widthMultiplier?: number; glowMultiplier?: number };
  followMode?: FollowMode;
  deadZoneRatio?: number;
  followResponsiveness?: number;
  resetMode?: ResetMode;
}

export interface TextureAsset {
  path: string;
  file: File | Blob;
  url: string;
  image?: HTMLImageElement;
}

export interface EditorState {
  bundle: PackBundle;
  textures: Map<string, TextureAsset>;
}

export interface SimInputState {
  keys: Set<string>;
  mouseButtons: Set<string>;
  dx: number;
  dy: number;
  pointerLocked: boolean;
}

export interface ValidationIssue {
  level: 'error' | 'warning' | 'info';
  path: string;
  message: string;
}
