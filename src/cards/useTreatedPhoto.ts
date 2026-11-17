// A court photo treated in the browser, for a deck with no baked renders yet (a future
// upload, or tokens changed since the bake). The same photoTreatment.ts the baking
// script runs, on a canvas at the stored size (at most 800 x 1000, never upscaled).
// Results are cached for the session as object URLs; null until ready or on failure.
import { useEffect, useState } from 'react';
import { type PhotoTreatment, treat } from './photoTreatment';

const cache = new Map<string, Promise<string | null>>();
const done = new Map<string, string | null>();

function render(src: string, treatment: PhotoTreatment, ink: string, stock: string): Promise<string | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      try {
        const scale = Math.min(1, 800 / img.naturalWidth, 1000 / img.naturalHeight);
        const w = Math.max(1, Math.round(img.naturalWidth * scale));
        const h = Math.max(1, Math.round(img.naturalHeight * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) return resolve(null);
        ctx.drawImage(img, 0, 0, w, h);
        const px = ctx.getImageData(0, 0, w, h);
        treat(px.data, { treatment, ink, stock });
        ctx.putImageData(px, 0, 0);
        canvas.toBlob((b) => resolve(b ? URL.createObjectURL(b) : null), 'image/jpeg', 0.85);
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

export function useTreatedPhoto(src: string | null, treatment: PhotoTreatment, ink: string, stock: string): string | null {
  const key = src ? `${src}|${treatment}|${ink}|${stock}` : '';
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!src || treatment === 'natural' || done.has(key)) return;
    let alive = true;
    let p = cache.get(key);
    if (!p) {
      p = render(src, treatment, ink, stock).then((url) => {
        done.set(key, url);
        return url;
      });
      cache.set(key, p);
    }
    p.then(() => alive && setTick((n) => n + 1));
    return () => {
      alive = false;
    };
  }, [key, src, treatment, ink, stock]);
  return src ? done.get(key) ?? null : null;
}
