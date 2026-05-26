import JSZip from 'jszip';
import { EditorState, PackBundle, TextureAsset } from './types';

export async function importIvizPack(file: File): Promise<EditorState> {
  const zip = await JSZip.loadAsync(file);
  const bundleEntry = zip.file('bundle.json');
  if (!bundleEntry) throw new Error('bundle.json is missing.');
  const text = await bundleEntry.async('string');
  const bundle = JSON.parse(text) as PackBundle;
  const textures = new Map<string, TextureAsset>();
  const entries = Object.keys(zip.files).filter(p => p.startsWith('textures/') && !zip.files[p].dir);
  for (const path of entries) {
    if (path.includes('..') || path.startsWith('/')) continue;
    const blob = await zip.file(path)!.async('blob');
    const url = URL.createObjectURL(blob);
    const asset: TextureAsset = { path, file: blob, url };
    if (/\.(png|jpg|jpeg|webp)$/i.test(path)) {
      asset.image = await loadImage(url).catch(() => undefined);
    }
    textures.set(path, asset);
  }
  return { bundle, textures };
}

export async function exportIvizPack(state: EditorState): Promise<Blob> {
  const zip = new JSZip();
  zip.file('bundle.json', JSON.stringify(state.bundle, null, 2));
  for (const [path, asset] of state.textures.entries()) {
    if (!path.startsWith('textures/') || path.includes('..') || path.startsWith('/')) continue;
    zip.file(path, asset.file);
  }
  return await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
}

export function texturePathForFileName(fileName: string): string {
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
  return `textures/${safeName}`;
}

export async function addTextureFiles(files: FileList | File[], state: EditorState): Promise<EditorState> {
  const textures = new Map(state.textures);
  for (const f of Array.from(files)) {
    const path = texturePathForFileName(f.name);
    const url = URL.createObjectURL(f);
    const asset: TextureAsset = { path, file: f, url };
    if (/\.(png|jpg|jpeg|webp)$/i.test(path)) asset.image = await loadImage(url).catch(() => undefined);
    textures.set(path, asset);
  }
  return { ...state, textures };
}

export function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}
