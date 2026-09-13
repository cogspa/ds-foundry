export const PD_ASSET_ID = 'dsf.assetId';
export const PD_ASSET_VARIANT = 'dsf.assetVariant';
export const PD_ASSET_CONFIDENCE = 'dsf.assetConfidence';
export const PD_ASSET_PROJECT = 'dsf.assetProject';

export const PD_ORIGINAL = 'dsf.originalName';
export const PD_CATEGORY = 'dsf.category';
export const PD_GENERATED = 'dsf.generated';

export let cancelled = false;
export function setCancelled(v: boolean) { cancelled = v; }

export function post(msg: unknown) { figma.ui.postMessage(msg); }

export function progress(pct: number, msg: string) {
  post({ type: 'progress', pct: Math.max(0, Math.min(100, Math.round(pct))), msg });
}

/** Let the UI breathe and let cancel messages arrive. */
export function tick(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}

export function slug(s: string, max = 32): string {
  const out = (s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/g, '');
  return out || 'item';
}

export function round(n: number, places = 2): number {
  const p = Math.pow(10, places);
  return Math.round(n * p) / p;
}

export function clamp(n: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, n)); }

// ---------- colour ----------

export function toHex(r: number, g: number, b: number): string {
  const h = (v: number) => clamp(Math.round(v * 255), 0, 255).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`.toUpperCase();
}

export function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return { h: h * 60, s, l };
}

export function hueName(h: number): string {
  if (h < 12 || h >= 345) return 'red';
  if (h < 40) return 'orange';
  if (h < 68) return 'yellow';
  if (h < 95) return 'lime';
  if (h < 155) return 'green';
  if (h < 190) return 'teal';
  if (h < 210) return 'cyan';
  if (h < 250) return 'blue';
  if (h < 275) return 'indigo';
  if (h < 300) return 'purple';
  return 'pink';
}

export function relLum(r: number, g: number, b: number): number {
  const f = (c: number) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

export function rgbaCss(r: number, g: number, b: number, a: number): string {
  if (a >= 0.999) return toHex(r, g, b);
  return `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, ${round(a, 3)})`;
}

export function paintHex(p: Paint): string | null {
  if (p.type !== 'SOLID' || p.visible === false) return null;
  return toHex(p.color.r, p.color.g, p.color.b);
}

export function firstSolid(paints: ReadonlyArray<Paint> | PluginAPI['mixed'] | undefined): SolidPaint | null {
  if (!paints || paints === figma.mixed) return null;
  for (const p of paints) if (p.type === 'SOLID' && p.visible !== false) return p;
  return null;
}

export function hasImageFill(paints: ReadonlyArray<Paint> | PluginAPI['mixed'] | undefined): boolean {
  if (!paints || paints === figma.mixed) return false;
  return paints.some((p) => (p.type === 'IMAGE' || p.type === 'VIDEO') && p.visible !== false);
}

export function effectCss(e: Effect): string {
  if (e.type === 'DROP_SHADOW' || e.type === 'INNER_SHADOW') {
    const c = e.color;
    const inset = e.type === 'INNER_SHADOW' ? 'inset ' : '';
    return `${inset}${round(e.offset.x)}px ${round(e.offset.y)}px ${round(e.radius)}px ${round(e.spread || 0)}px ${rgbaCss(c.r, c.g, c.b, c.a)}`;
  }
  if (e.type === 'LAYER_BLUR') return `blur(${round(e.radius)}px)`;
  if (e.type === 'BACKGROUND_BLUR') return `backdrop-blur(${round(e.radius)}px)`;
  return '';
}

export function effectKey(effects: ReadonlyArray<Effect>): string {
  return effects
    .filter((e) => e.visible !== false)
    .map((e) => {
      if (e.type === 'DROP_SHADOW' || e.type === 'INNER_SHADOW') {
        return `${e.type}:${round(e.offset.x)}:${round(e.offset.y)}:${round(e.radius)}:${round(e.spread || 0)}:${rgbaCss(e.color.r, e.color.g, e.color.b, e.color.a)}`;
      }
      return `${e.type}:${'radius' in e ? round(e.radius) : JSON.stringify(e)}`;
    })
    .join('|');
}

export function snap(v: number, grid: number): number {
  if (grid <= 1) return Math.round(v);
  return Math.max(0, Math.round(v / grid) * grid);
}
