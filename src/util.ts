export function clamp(v: number, min: number, max: number): number { return Math.max(min, Math.min(max, Number.isFinite(v) ? v : min)); }
export function num(v: unknown, fallback: number): number { return typeof v === 'number' && Number.isFinite(v) ? v : fallback; }
export function str(v: unknown, fallback: string): string { return typeof v === 'string' ? v : fallback; }
export function smoothstep01(t: number): number { const x = clamp(t, 0, 1); return x * x * (3 - 2 * x); }
export function deepMerge<T>(base: T, patch: unknown): T {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return base;
  const out: any = Array.isArray(base) ? [...base as any] : { ...(base as any) };
  for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
    const old = out[k];
    if (old && typeof old === 'object' && !Array.isArray(old) && v && typeof v === 'object' && !Array.isArray(v)) out[k] = deepMerge(old, v);
    else out[k] = v;
  }
  return out;
}
export function hexToRgba(input: string, opacity = 1): string {
  if (!input.startsWith('#')) return input;
  let hex = input.slice(1);
  if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
  const r = parseInt(hex.slice(0, 2) || 'ff', 16);
  const g = parseInt(hex.slice(2, 4) || 'ff', 16);
  const b = parseInt(hex.slice(4, 6) || 'ff', 16);
  const aHex = hex.length >= 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1;
  return `rgba(${r}, ${g}, ${b}, ${clamp(aHex * opacity, 0, 1)})`;
}
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
