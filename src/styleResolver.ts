import { EditorState } from './types';
import { deepMerge } from './util';

export function resolveElementStylePatch(state: EditorState, element: { styleRef?: string; style?: Record<string, unknown> }): Record<string, unknown> {
  const themeStyle = getThemeStyle(state, element.styleRef);
  const merged = deepMerge(themeStyle, element.style ?? {});
  return resolveTokens(merged, state.bundle.theme?.tokens ?? {}) as Record<string, unknown>;
}

export function getThemeStyle(state: EditorState, styleRef?: string): Record<string, unknown> {
  if (!styleRef) return {};
  const raw = state.bundle.theme?.styles?.[styleRef];
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
}

export function resolveTokens(value: unknown, tokens: Record<string, unknown>): unknown {
  if (typeof value === 'string') return resolveTokenString(value, tokens);
  if (Array.isArray(value)) return value.map(v => resolveTokens(v, tokens));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = resolveTokens(v, tokens);
    return out;
  }
  return value;
}

function resolveTokenString(value: string, tokens: Record<string, unknown>): unknown {
  const tokenName = value.startsWith('$') ? value.slice(1) : value.startsWith('token:') ? value.slice('token:'.length) : value.startsWith('{') && value.endsWith('}') ? value.slice(1, -1) : '';
  if (!tokenName) return value;
  const resolved = tokens[tokenName];
  return resolved === undefined ? value : resolved;
}

export function findTokenRefs(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') {
    const tokenName = value.startsWith('$') ? value.slice(1) : value.startsWith('token:') ? value.slice('token:'.length) : value.startsWith('{') && value.endsWith('}') ? value.slice(1, -1) : '';
    if (tokenName) out.push(tokenName);
  } else if (Array.isArray(value)) value.forEach(v => findTokenRefs(v, out));
  else if (value && typeof value === 'object') Object.values(value as Record<string, unknown>).forEach(v => findTokenRefs(v, out));
  return out;
}
