// Photo treatments, baked once (handoff v2 photo-treatment.js, ported as is). Pure
// functions over RGBA bytes (ImageData.data, or sharp's raw output), with no imports,
// so the baking script (scripts/bake-deck.mjs) runs this same file under Node.
//
//   'tinted'   (default)  the photo keeps its colour at reduced saturation, pulled part-way
//                         toward a tritone of the suit ink. Survives any ink and any subject.
//   'tritone'             shadow ink -> suit ink -> card stock. The old 'duotone', fixed so a
//                         mid-tone ink (red) still gets the full tonal range.
//   'natural'             untouched. The vignette and frame still apply in CSS.
//
// Why the old duotone failed in red: it mapped black to the ink itself, and #BE3228 is a
// mid-tone, so every photo was squeezed into the lighter half of the range. Tritone maps black
// to the ink mixed 85% toward rim ink, and holds the pure ink back to the lower-middle tones.

export type PhotoTreatment = 'tinted' | 'tritone' | 'natural';

type RGB = [number, number, number];

const RIM_INK = '#1F2723';

export function hexToRgb(hex: string): RGB {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const luma = (c: RGB) => (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255;

export interface Ramp {
  dark: RGB;
  mid: RGB;
  light: RGB;
  /** Where the pure ink sits on the 0..1 tone scale. */
  at: number;
}

/** The three stops of the ramp for one ink on one stock. */
export function ramp(ink: string, stock: string): Ramp {
  const mid = hexToRgb(ink);
  const light = hexToRgb(stock);
  const dark = mix(mid, hexToRgb(RIM_INK), 0.85);
  // Where the pure ink sits on the 0..1 tone scale: at its own lightness between the ends.
  // Pushed up from the ink's own lightness, so the lower third of a red photo sits in deep ink
  // rather than pale tints of it. A black ink is its own shadow, so its stop stays near zero
  // and the ramp is the plain two-colour one that already tested well.
  const own = (luma(mid) - luma(dark)) / (luma(light) - luma(dark));
  const at = Math.min(0.5, Math.max(0.02, own * 2.3));
  return { dark, mid, light, at };
}

function tone(r: Ramp, t: number): RGB {
  return t < r.at ? mix(r.dark, r.mid, t / r.at) : mix(r.mid, r.light, (t - r.at) / (1 - r.at));
}

/** Stretch levels so the 2nd and 98th percentile of lightness become 0 and 1. */
function levels(data: ArrayLike<number>): { lo: number; span: number } {
  const hist = new Uint32Array(256);
  for (let i = 0; i < data.length; i += 4) hist[Math.round(luma([data[i], data[i + 1], data[i + 2]]) * 255)]++;
  const total = data.length / 4;
  let lo = 0;
  let hi = 255;
  let seen = 0;
  for (let v = 0; v < 256; v++) { seen += hist[v]; if (seen >= total * 0.02) { lo = v; break; } }
  seen = 0;
  for (let v = 255; v >= 0; v--) { seen += hist[v]; if (seen >= total * 0.02) { hi = v; break; } }
  if (hi - lo < 40) { lo = Math.max(0, lo - 20); hi = Math.min(255, hi + 20); } // flat photo: do not over-stretch
  return { lo: lo / 255, span: Math.max(0.01, (hi - lo) / 255) };
}

export interface TreatOptions {
  treatment?: PhotoTreatment;
  ink: string;
  stock: string;
  saturation?: number;
  strength?: number;
}

/**
 * data: RGBA bytes (Uint8ClampedArray, or a Uint8Array/Buffer from sharp), changed in
 * place and returned. Values written are rounded and clamped to 0..255.
 */
export function treat<T extends { length: number; [i: number]: number }>(
  data: T,
  { treatment = 'tinted', ink, stock, saturation = 0.65, strength = 0.22 }: TreatOptions,
): T {
  if (treatment === 'natural') return data;
  const r = ramp(ink, stock);
  const lv = levels(data);
  const put = (v: number) => Math.min(255, Math.max(0, Math.round(v)));
  for (let i = 0; i < data.length; i += 4) {
    const c: RGB = [data[i], data[i + 1], data[i + 2]];
    const y = luma(c);
    const t = Math.min(1, Math.max(0, (y - lv.lo) / lv.span));
    const tri = tone(r, t);
    let out = tri;
    if (treatment === 'tinted') {
      const grey: RGB = [y * 255, y * 255, y * 255];
      out = mix(mix(grey, c, saturation), tri, strength);
    }
    data[i] = put(out[0]); data[i + 1] = put(out[1]); data[i + 2] = put(out[2]);
  }
  return data;
}

// A court needs at most two renders per treatment: its two-colour ink and its
// four-colour ink. Store tinted always, for the mini-slot.
