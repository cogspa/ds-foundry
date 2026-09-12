import { ColorToken, TypeToken, SpaceToken, RadiusToken, EffectToken, ElementRec, Category } from './types';
import { rgbToHsl, hueName, slug, clamp } from './util';

// ---------------- colours ----------------

function neutralStep(l: number): number {
  // light → 50/100, dark → 900/950 (0 and 1000 are reserved for pure white/black)
  const s = Math.round((1 - l) * 10) * 100;
  return clamp(s === 0 ? 50 : s, 50, 950);
}

/** Chromatic families anchor their most-used colour at 500; the rest spread by lightness. */
function chromaticStep(l: number, anchorL: number): number {
  const s = 500 + Math.round((anchorL - l) * 9) * 100;
  return clamp(s, 50, 950);
}

export function nameColors(colors: ColorToken[]): ColorToken[] {
  const families = new Map<string, ColorToken[]>();
  const neutrals: ColorToken[] = [];

  for (const c of colors) {
    const { s, l } = rgbToHsl(c.r, c.g, c.b);
    const isNeutral = s < 0.12 || l > 0.985 || l < 0.02 || (s < 0.28 && (l > 0.88 || l < 0.12));
    if (isNeutral) { neutrals.push(c); continue; }
    const { h } = rgbToHsl(c.r, c.g, c.b);
    const fam = hueName(h);
    if (!families.has(fam)) families.set(fam, []);
    families.get(fam)!.push(c);
  }

  // rank families by usage
  const ranked = [...families.entries()].sort((a, b) => sum(b[1]) - sum(a[1]));
  const roleOf = new Map<string, string>();
  const taken = new Set<string>();
  if (ranked[0]) { roleOf.set(ranked[0][0], 'primary'); taken.add('primary'); }
  if (ranked[1]) { roleOf.set(ranked[1][0], 'secondary'); taken.add('secondary'); }
  for (const [fam] of ranked.slice(2)) {
    let role = fam;
    if (fam === 'red' && !taken.has('error')) role = 'error';
    else if ((fam === 'green' || fam === 'lime') && !taken.has('success')) role = 'success';
    else if ((fam === 'yellow' || fam === 'orange') && !taken.has('warning')) role = 'warning';
    else if ((fam === 'blue' || fam === 'cyan') && !taken.has('info')) role = 'info';
    if (taken.has(role)) role = fam;
    if (taken.has(role)) role = `${fam}-2`;
    taken.add(role);
    roleOf.set(fam, role);
  }

  const out: ColorToken[] = [];
  for (const [fam, list] of families) {
    const role = roleOf.get(fam) || fam;
    assignSteps(list, role, out);
  }
  assignSteps(neutrals, 'neutral', out);

  // stable order: role groups by usage, then step ascending
  const order = ['primary', 'secondary', 'neutral'];
  out.sort((a, b) => {
    const ia = order.indexOf(a.role), ib = order.indexOf(b.role);
    const ra = ia === -1 ? 99 : ia, rb = ib === -1 ? 99 : ib;
    if (ra !== rb) return ra - rb;
    if (a.role !== b.role) return a.role < b.role ? -1 : 1;
    return a.step - b.step;
  });
  return out;
}

function sum(list: ColorToken[]) { return list.reduce((n, c) => n + c.count, 0); }

function assignSteps(list: ColorToken[], role: string, out: ColorToken[]) {
  if (!list.length) return;
  const sorted = [...list].sort((a, b) => rgbToHsl(b.r, b.g, b.b).l - rgbToHsl(a.r, a.g, a.b).l); // light → dark
  const anchor = [...list].sort((a, b) => b.count - a.count)[0];
  const anchorL = rgbToHsl(anchor.r, anchor.g, anchor.b).l;
  const used = new Set<number>();
  for (const c of sorted) {
    const { l } = rgbToHsl(c.r, c.g, c.b);
    let step: number;
    if (role === 'neutral' && l > 0.985) step = 0;
    else if (role === 'neutral' && l < 0.02) step = 1000;
    else if (role === 'neutral') step = neutralStep(l);
    else if (sorted.length === 1) step = 500;
    else step = chromaticStep(l, anchorL);
    // keep unique, bump downward (darker) in 50s
    while (used.has(step)) step += 50;
    used.add(step);
    c.role = role;
    c.step = step;
    c.name = `${role}/${step}`;
    if (c.a < 0.999) c.name += `-a${Math.round(c.a * 100)}`;
    out.push(c);
  }
}

// ---------------- typography ----------------

export function weightClass(style: string): { name: string; css: number } {
  const s = style.toLowerCase();
  if (/black|heavy|extra ?bold|ultra/.test(s)) return { name: 'black', css: 800 };
  if (/bold/.test(s) && !/semi/.test(s)) return { name: 'bold', css: 700 };
  if (/semi|demi/.test(s)) return { name: 'semibold', css: 600 };
  if (/medium/.test(s)) return { name: 'medium', css: 500 };
  if (/light|thin|hairline/.test(s)) return { name: 'light', css: 300 };
  return { name: 'regular', css: 400 };
}

export function typeRole(size: number): string {
  if (size >= 40) return 'display';
  if (size >= 24) return 'heading';
  if (size >= 18) return 'title';
  if (size >= 14) return 'body';
  return 'caption';
}

const SIZE_LABELS: Record<number, string[]> = {
  1: ['md'],
  2: ['lg', 'sm'],
  3: ['lg', 'md', 'sm'],
  4: ['xl', 'lg', 'md', 'sm'],
  5: ['xl', 'lg', 'md', 'sm', 'xs'],
  6: ['2xl', 'xl', 'lg', 'md', 'sm', 'xs'],
};

export function nameTypes(types: TypeToken[]): TypeToken[] {
  for (const t of types) {
    t.role = typeRole(t.size);
    const w = weightClass(t.style);
    t.weight = w.name;
    t.cssWeight = w.css;
  }
  const byRole = new Map<string, TypeToken[]>();
  for (const t of types) {
    if (!byRole.has(t.role)) byRole.set(t.role, []);
    byRole.get(t.role)!.push(t);
  }
  const used = new Set<string>();
  for (const [role, list] of byRole) {
    const sizes = [...new Set(list.map((t) => t.size))].sort((a, b) => b - a);
    const labels = SIZE_LABELS[sizes.length] || sizes.map((_, i) => String(sizes.length - i));
    const labelOf = new Map<number, string>();
    sizes.forEach((s, i) => labelOf.set(s, labels[i]));
    for (const t of list) {
      let name = `${role}/${labelOf.get(t.size)}/${t.weight}`;
      let n = 2;
      while (used.has(name)) name = `${role}/${labelOf.get(t.size)}/${t.weight}-${n++}`;
      used.add(name);
      t.name = name;
    }
  }
  const roleOrder = ['display', 'heading', 'title', 'body', 'caption'];
  types.sort((a, b) => {
    const r = roleOrder.indexOf(a.role) - roleOrder.indexOf(b.role);
    if (r !== 0) return r;
    if (a.size !== b.size) return b.size - a.size;
    return b.cssWeight - a.cssWeight;
  });
  return types;
}

// ---------------- spacing / radius / effects ----------------

export function nameSpacing(list: SpaceToken[]): SpaceToken[] {
  list.sort((a, b) => a.value - b.value);
  for (const s of list) s.name = `space/${s.value}`;
  return list;
}

const RADIUS_LABELS: Record<number, string[]> = {
  1: ['md'],
  2: ['sm', 'lg'],
  3: ['sm', 'md', 'lg'],
  4: ['sm', 'md', 'lg', 'xl'],
  5: ['xs', 'sm', 'md', 'lg', 'xl'],
  6: ['xs', 'sm', 'md', 'lg', 'xl', '2xl'],
  7: ['xs', 'sm', 'md', 'lg', 'xl', '2xl', '3xl'],
};

export function nameRadii(list: RadiusToken[]): RadiusToken[] {
  list.sort((a, b) => a.value - b.value);
  const full = list.filter((r) => r.value >= 999);
  const rest = list.filter((r) => r.value < 999);
  const labels = RADIUS_LABELS[rest.length] || rest.map((_, i) => String(i + 1));
  rest.forEach((r, i) => (r.name = `radius/${labels[i]}`));
  full.forEach((r) => (r.name = 'radius/full'));
  return [...rest, ...full];
}

export function nameEffects(list: EffectToken[]): EffectToken[] {
  const shadows = list.filter((e) => e.effects.some((x) => x.type === 'DROP_SHADOW' || x.type === 'INNER_SHADOW'));
  const blurs = list.filter((e) => !shadows.includes(e));
  const depth = (e: EffectToken) => e.effects.reduce((n, x) => n + x.radius + ('offset' in x ? Math.abs(x.offset.y) : 0), 0);
  shadows.sort((a, b) => depth(a) - depth(b));
  blurs.sort((a, b) => depth(a) - depth(b));
  shadows.forEach((e, i) => (e.name = `elevation/${i + 1}`));
  blurs.forEach((e, i) => (e.name = `blur/${i + 1}`));
  return [...shadows, ...blurs];
}

// ---------------- element labels ----------------

export function sizeClass(h: number): string {
  if (h <= 32) return 'sm';
  if (h <= 44) return 'md';
  return 'lg';
}

const DEFAULT_NAME = /^(vector|group|frame|rectangle|ellipse|line|polygon|star|boolean|union|subtract|intersect|exclude|path|shape|layer|image|mask)(\s*\d+)?(\s*copy(\s*\d+)?)?$/i;

/** Figma's auto names carry no meaning; a geometry description is better than "vector-123". */
export function isDefaultName(name: string): boolean { return DEFAULT_NAME.test(name.trim()); }

export function elementLabel(rec: ElementRec, prefix: string): string {
  const p = prefix;
  const s = isDefaultName(rec.name) && rec.desc ? rec.desc : slug(rec.name);
  const t = rec.text ? slug(rec.text, 24) : '';
  const cat: Category = rec.category;
  switch (cat) {
    case 'screen': return `${p}screen/${s}`;
    case 'section': return `${p}section/${s}`;
    case 'nav': return `${p}nav/${s}`;
    case 'card': return `${p}card/${s}`;
    case 'button': return `${p}button/${rec.fillRole || 'default'}-${rec.sizeClass}${t ? '/' + t : ''}`;
    case 'input': return `${p}input/${rec.sizeClass}${t ? '/' + t : ''}`;
    case 'badge': return `${p}badge/${rec.fillRole || 'default'}${t ? '/' + t : ''}`;
    case 'avatar': return `${p}avatar/${rec.sizeClass}`;
    case 'image': return `${p}image/${s}`;
    case 'icon': return `${p}icon/${s}`;
    case 'divider': return `${p}divider`;
    case 'list-item': return `${p}list-item/${s}`;
    case 'checkbox': return `${p}checkbox`;
    case 'toggle': return `${p}toggle`;
    case 'text': return `${p}text/${(rec.textRole || 'body').replace(/\//g, '-')}`;
    case 'tagline': return `${p}tagline/${t || s}`;
    case 'copy': return `${p}copy/${t || s}`;
    case 'logo': return `${p}logo/${t || s}`;
    case 'character': return `${p}character/${s}`;
    case 'illustration': return `${p}illustration/${s}`;
    case 'symbol': return `${p}symbol/${s}`;
    case 'shape': return `${p}shape/${rec.desc || s}`;
    case 'debris': return `${p}debris/${rec.desc || s}`;
    default: return `${p}${s}`;
  }
}
