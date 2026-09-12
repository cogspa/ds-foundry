import { Category } from './types';
import { firstSolid, hasImageFill, rgbToHsl } from './util';

export interface ClassifyCtx {
  parentW: number;
  parentH: number;
  yInParent: number;
  topLevel: boolean;
}

export interface Classification {
  category: Category;
  text: string;
  fillHex: string | null;
  strokeHex: string | null;
  fingerprint: string;
  desc: string;
}

const VECTOR_TYPES = new Set(['VECTOR', 'BOOLEAN_OPERATION', 'STAR', 'POLYGON', 'LINE', 'ELLIPSE', 'RECTANGLE']);
const CONTAINER_TYPES = new Set(['FRAME', 'GROUP', 'INSTANCE', 'COMPONENT']);

/** True if node is a vector-only subtree (an icon candidate). */
export function isVectorSubtree(node: SceneNode, depth = 0): boolean {
  if (depth > 6) return false;
  if (node.type === 'VECTOR' || node.type === 'BOOLEAN_OPERATION' || node.type === 'STAR' || node.type === 'POLYGON' || node.type === 'LINE') return true;
  if (node.type === 'ELLIPSE' || node.type === 'RECTANGLE') return !hasImageFill(node.fills);
  if (node.type === 'GROUP' || node.type === 'FRAME' || node.type === 'INSTANCE' || node.type === 'COMPONENT') {
    const kids = (node as ChildrenMixin).children;
    if (kids.length === 0 || kids.length > 24) return false;
    return kids.every((k) => isVectorSubtree(k, depth + 1));
  }
  return false;
}

function ownFillHex(node: SceneNode): string | null {
  if (!('fills' in node)) return null;
  const s = firstSolid((node as GeometryMixin).fills);
  if (!s) return null;
  const { r, g, b } = s.color;
  const h = (v: number) => Math.round(v * 255).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`.toUpperCase();
}

function ownStrokeHex(node: SceneNode): string | null {
  if (!('strokes' in node)) return null;
  const s = firstSolid((node as GeometryMixin).strokes);
  if (!s) return null;
  const sw = (node as GeometryMixin).strokeWeight;
  if (typeof sw === 'number' && sw <= 0) return null;
  const { r, g, b } = s.color;
  const h = (v: number) => Math.round(v * 255).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`.toUpperCase();
}

function isLight(hex: string | null): boolean {
  if (!hex) return true;
  const r = parseInt(hex.slice(1, 3), 16) / 255, g = parseInt(hex.slice(3, 5), 16) / 255, b = parseInt(hex.slice(5, 7), 16) / 255;
  return rgbToHsl(r, g, b).l > 0.9;
}

function uniformRadius(node: SceneNode): number {
  if (!('cornerRadius' in node)) return 0;
  const cr = (node as CornerMixin).cornerRadius;
  if (typeof cr === 'number') return cr;
  const rn = node as RectangleCornerMixin;
  return Math.min(rn.topLeftRadius ?? 0, rn.topRightRadius ?? 0, rn.bottomLeftRadius ?? 0, rn.bottomRightRadius ?? 0);
}

function hasShadow(node: SceneNode): boolean {
  if (!('effects' in node)) return false;
  return (node as BlendMixin).effects.some((e) => e.visible !== false && (e.type === 'DROP_SHADOW' || e.type === 'INNER_SHADOW'));
}

/** Collect text nodes up to a shallow depth. */
function collectTexts(node: SceneNode, depth = 0, out: TextNode[] = []): TextNode[] {
  if (node.type === 'TEXT') { out.push(node); return out; }
  if (depth >= 3) return out;
  if ('children' in node) for (const k of node.children) collectTexts(k, depth + 1, out);
  return out;
}

function countDescendants(node: SceneNode, depth = 0): number {
  if (!('children' in node) || depth > 3) return 0;
  let n = node.children.length;
  for (const k of node.children) n += countDescendants(k, depth + 1);
  return n;
}

function textIsPlaceholderLike(t: TextNode): boolean {
  const seg = firstSolid(t.fills);
  if (!seg) return false;
  const { s, l } = rgbToHsl(seg.color.r, seg.color.g, seg.color.b);
  return s < 0.15 && l > 0.45 && l < 0.8;
}

/** Deterministic, human-readable description of a piece of geometry: "navy-outline-blob-56x30". */
export function describeShape(node: SceneNode, fillHex: string | null, strokeHex: string | null): string {
  const w = Math.round(node.width), h = Math.round(node.height);
  const aspect = h > 0 ? w / h : 1;
  const r = uniformRadius(node);
  let kind = 'shape';
  if (node.type === 'ELLIPSE') kind = aspect > 0.85 && aspect < 1.18 ? 'circle' : 'oval';
  else if (node.type === 'RECTANGLE') {
    if (r >= Math.min(w, h) / 2 - 0.5 && Math.min(w, h) > 0) kind = aspect > 0.85 && aspect < 1.18 ? 'circle' : 'pill';
    else if (r > 0) kind = aspect > 0.85 && aspect < 1.18 ? 'rounded-square' : 'rounded-rect';
    else kind = aspect > 0.85 && aspect < 1.18 ? 'square' : (aspect > 6 || aspect < 1 / 6 ? 'bar' : 'rect');
  }
  else if (node.type === 'LINE') kind = 'line';
  else if (node.type === 'STAR') kind = 'star';
  else if (node.type === 'POLYGON') kind = `${(node as PolygonNode).pointCount}-gon`;
  else if (node.type === 'VECTOR' || node.type === 'BOOLEAN_OPERATION') {
    let curved = false, closed = false, segs = 0, regions = 0;
    try {
      const vn = (node as VectorNode).vectorNetwork;
      if (vn) {
        segs = vn.segments.length;
        regions = vn.regions ? vn.regions.length : 0;
        closed = regions > 0;
        curved = vn.segments.some((sg) => (sg.tangentStart && (sg.tangentStart.x || sg.tangentStart.y)) || (sg.tangentEnd && (sg.tangentEnd.x || sg.tangentEnd.y)));
      }
    } catch { /* vectorNetwork unavailable on boolean ops */ }
    if (node.type === 'BOOLEAN_OPERATION') kind = 'compound';
    else if (segs === 0) kind = 'empty-path';
    else if (!closed) kind = curved ? 'curve' : (segs === 1 ? 'line' : 'polyline');
    else if (curved) kind = segs <= 4 ? 'blob' : 'outline';
    else kind = segs === 3 ? 'triangle' : segs === 4 ? 'quad' : 'polygon';
    if (Math.max(w, h) < 8) kind = 'speck';
  }
  const colour = fillHex ? colourWord(fillHex) : strokeHex ? `${colourWord(strokeHex)}-outline` : 'transparent';
  return `${colour}-${kind}-${w}x${h}`;
}

function colourWord(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16) / 255, g = parseInt(hex.slice(3, 5), 16) / 255, b = parseInt(hex.slice(5, 7), 16) / 255;
  const { h, s, l } = rgbToHsl(r, g, b);
  if (l > 0.95) return 'white';
  if (l < 0.08) return 'black';
  if (s < 0.12) return l > 0.6 ? 'light-gray' : l > 0.35 ? 'gray' : 'dark-gray';
  const base = h < 12 || h >= 345 ? 'red' : h < 40 ? 'orange' : h < 68 ? 'yellow' : h < 95 ? 'lime' : h < 155 ? 'green' : h < 190 ? 'teal' : h < 210 ? 'cyan' : h < 250 ? (l < 0.3 ? 'navy' : 'blue') : h < 275 ? 'indigo' : h < 300 ? 'purple' : 'pink';
  return l > 0.8 ? `pale-${base}` : l < 0.25 && base !== 'navy' ? `dark-${base}` : base;
}

/** Fallback description for a vector group: "navy-14-piece-250x270". */
function describeGroup(node: SceneNode): string {
  const st = vectorStats(node);
  let colour = 'mixed';
  if ('children' in node) {
    for (const k of (node as ChildrenMixin).children) {
      const h = ownFillHex(k) || ownStrokeHex(k);
      if (h) { colour = colourWord(h); break; }
    }
  }
  return `${colour}-${st.n}-piece-${Math.round(node.width)}x${Math.round(node.height)}`;
}

/** True if the subtree is (mostly) vectors and looks hand-drawn rather than UI: used to pick illustration vs symbol. */
function vectorStats(node: SceneNode, depth = 0, acc = { n: 0, text: 0 }): { n: number; text: number } {
  if (depth > 6) return acc;
  if (node.type === 'TEXT') { acc.text++; return acc; }
  if ('children' in node) { for (const k of (node as ChildrenMixin).children) vectorStats(k, depth + 1, acc); return acc; }
  acc.n++;
  return acc;
}

export function classify(node: SceneNode, ctx: ClassifyCtx): Classification {
  const w = node.width, h = node.height;
  const aspect = h > 0 ? w / h : 1;
  const fillHex = ownFillHex(node);
  const strokeHex = ownStrokeHex(node);
  const radius = uniformRadius(node);
  const fp = (cat: string, extra = '') => `${cat}|${Math.round(w / 8)}x${Math.round(h / 8)}|${fillHex || ''}|${strokeHex || ''}|${Math.round(radius)}${extra}`;

  // ---- text ----
  if (node.type === 'TEXT') {
    const t = node as TextNode;
    const chars = t.characters;
    const size = typeof t.fontSize === 'number' ? t.fontSize : 14;
    const lines = chars.split('\n').length;
    let cat: Category = 'text';
    if (chars.length > 90 || lines > 2 || (lines === 2 && chars.length > 60)) cat = 'copy';
    else if (size >= 14 && size < 34 && chars.trim().split(/\s+/).length >= 3 && chars.length <= 90 && !/[.!?]$/.test(chars.trim()) && !ctx.topLevel) cat = 'tagline';
    return { category: cat, text: chars, fillHex, strokeHex, fingerprint: fp(cat), desc: '' };
  }

  // ---- lines / dividers ----
  if (node.type === 'LINE' || ((node.type === 'RECTANGLE') && (h <= 2 || w <= 2) && Math.max(w, h) >= 24)) {
    return { category: 'divider', text: '', fillHex, strokeHex, fingerprint: fp('divider'), desc: '' };
  }

  // ---- image / avatar shapes ----
  if (node.type === 'RECTANGLE' || node.type === 'ELLIPSE') {
    if (hasImageFill(node.fills)) {
      const round = node.type === 'ELLIPSE' || radius >= Math.min(w, h) / 2 - 0.5;
      if (round && aspect > 0.8 && aspect < 1.25 && Math.max(w, h) <= 200) {
        return { category: 'avatar', text: '', fillHex, strokeHex, fingerprint: fp('avatar'), desc: '' };
      }
      return { category: 'image', text: '', fillHex, strokeHex, fingerprint: fp('image'), desc: '' };
    }
  }

  // ---- debris: fragments nobody meant to keep ----
  const ntype: string = node.type;
  if (VECTOR_TYPES.has(ntype) || ntype === 'GROUP') {
    const tiny = Math.max(w, h) < 6 || (w * h < 24 && ntype !== 'LINE');
    let empty = false;
    try { empty = ntype === 'VECTOR' && (node as VectorNode).vectorNetwork.segments.length === 0; } catch { /* ignore */ }
    const invisibleFill = ('fills' in node) && !fillHex && !strokeHex && ntype !== 'GROUP';
    const ghost = ('opacity' in node && (node as BlendMixin).opacity === 0) || (node.visible === false && Math.max(w, h) < 24);
    if (tiny || empty || ghost || (invisibleFill && Math.max(w, h) < 24)) {
      return { category: 'debris', text: '', fillHex, strokeHex, fingerprint: `debris|${node.type}|${Math.round(w)}x${Math.round(h)}`, desc: describeShape(node, fillHex, strokeHex) };
    }
  }

  // ---- vector art tiers: icon → symbol → illustration / logo ----
  if (VECTOR_TYPES.has(node.type) || CONTAINER_TYPES.has(node.type)) {
    const nameHint = node.name.toLowerCase();
    const vec = isVectorSubtree(node);
    const kids = 'children' in node ? countDescendants(node) : 0;
    // plain primitives (rect, ellipse, line, polygon, star) are shapes once they outgrow icon size — only paths and groups can be art
    const primitive = !CONTAINER_TYPES.has(node.type) && node.type !== 'VECTOR' && node.type !== 'BOOLEAN_OPERATION';
    const vfp = (cat: string) => `${cat}|${nameHint}|${Math.round(w)}x${Math.round(h)}|${kids}`;
    const artDesc = () => (CONTAINER_TYPES.has(node.type) ? describeGroup(node) : describeShape(node, fillHex, strokeHex));
    if (/\b(logo|wordmark|brand|logotype)\b/.test(nameHint) && (vec || CONTAINER_TYPES.has(node.type))) {
      return { category: 'logo', text: '', fillHex, strokeHex, fingerprint: vfp('logo'), desc: artDesc() };
    }
    if (vec) {
      if (Math.max(w, h) <= 64 && Math.min(w, h) >= 6 && aspect >= 0.5 && aspect <= 2) {
        return { category: 'icon', text: '', fillHex, strokeHex, fingerprint: vfp('icon'), desc: '' };
      }
      if (primitive) {
        return { category: 'shape', text: '', fillHex, strokeHex, fingerprint: fp('shape'), desc: describeShape(node, fillHex, strokeHex) };
      }
      // wide, short, several pieces: a wordmark or lockup drawn as outlines
      if (aspect >= 2.4 && h <= 160 && kids >= 3 && Math.max(w, h) > 64) {
        return { category: 'logo', text: '', fillHex, strokeHex, fingerprint: vfp('logo'), desc: artDesc() };
      }
      if (Math.max(w, h) <= 200 && kids <= 6 && aspect >= 0.4 && aspect <= 2.5 && Math.max(w, h) > 64) {
        return { category: 'symbol', text: '', fillHex, strokeHex, fingerprint: vfp('symbol'), desc: artDesc() };
      }
      if (Math.max(w, h) > 64 && (kids > 6 || Math.max(w, h) > 200)) {
        return { category: 'illustration', text: '', fillHex, strokeHex, fingerprint: vfp('illustration'), desc: artDesc() };
      }
      if (Math.max(w, h) > 64 && !CONTAINER_TYPES.has(node.type)) {
        // one big standalone path: could be a blob background or a silhouette — call it a symbol, keep the geometry name as fallback, let vision decide
        return { category: 'symbol', text: '', fillHex, strokeHex, fingerprint: vfp('symbol'), desc: describeShape(node, fillHex, strokeHex) };
      }
    }
    // a container that is mostly vectors plus a text node or two is a logo lockup (mark + wordmark)
    if (CONTAINER_TYPES.has(node.type)) {
      const st = vectorStats(node);
      if (st.n >= 2 && st.text >= 1 && st.text <= 2 && aspect >= 1.8 && h <= 160 && kids <= 30) {
        return { category: 'logo', text: collectTexts(node)[0]?.characters || '', fillHex, strokeHex, fingerprint: vfp('logo'), desc: artDesc() };
      }
    }
  }

  // ---- shapes that are not icons: describe the geometry ----
  if (!CONTAINER_TYPES.has(node.type)) {
    return { category: 'shape', text: '', fillHex, strokeHex, fingerprint: fp('shape'), desc: describeShape(node, fillHex, strokeHex) };
  }

  // ---- containers ----
  const c = node as FrameNode | GroupNode | InstanceNode | ComponentNode;
  const kids = c.children;
  const texts = collectTexts(node);
  const primaryText = texts.length ? texts[0].characters : '';
  const textLen = primaryText.length;
  const hasFill = !!fillHex;
  const hasStroke = !!strokeHex;
  const shadow = hasShadow(node);
  const layoutMode = 'layoutMode' in c ? c.layoutMode : 'NONE';
  const imageFill = 'fills' in c && hasImageFill(c.fills);

  if (ctx.topLevel && w >= 300 && h >= 300) {
    return { category: 'screen', text: primaryText, fillHex, strokeHex, fingerprint: fp('screen'), desc: '' };
  }

  if (imageFill && kids.length <= 2) {
    const round = radius >= Math.min(w, h) / 2 - 0.5;
    if (round && aspect > 0.8 && aspect < 1.25 && Math.max(w, h) <= 200) {
      return { category: 'avatar', text: '', fillHex, strokeHex, fingerprint: fp('avatar'), desc: '' };
    }
    return { category: 'image', text: '', fillHex, strokeHex, fingerprint: fp('image'), desc: '' };
  }

  // small controls
  if (Math.max(w, h) <= 32 && kids.length <= 2 && (hasFill || hasStroke)) {
    if (aspect >= 1.6 && aspect <= 2.6 && radius >= h / 2 - 0.5) {
      return { category: 'toggle', text: '', fillHex, strokeHex, fingerprint: fp('toggle'), desc: '' };
    }
    if (aspect > 0.8 && aspect < 1.25 && texts.length === 0) {
      return { category: 'checkbox', text: '', fillHex, strokeHex, fingerprint: fp('checkbox'), desc: '' };
    }
  }

  // button / badge / input: compact, one short text, visible surface
  if (texts.length >= 1 && texts.length <= 2 && kids.length <= 4 && h >= 18 && h <= 80 && w <= 520 && textLen > 0 && textLen <= 40 && (hasFill || hasStroke)) {
    if (h <= 28 && w <= 180) {
      return { category: 'badge', text: primaryText, fillHex, strokeHex, fingerprint: fp('badge'), desc: '' };
    }
    const looksInput = hasStroke && isLight(fillHex) && w >= 140 && (textIsPlaceholderLike(texts[0]) || /^(search|enter|type|email|password|your|placeholder)/i.test(primaryText));
    if (looksInput) {
      return { category: 'input', text: primaryText, fillHex, strokeHex, fingerprint: fp('input'), desc: '' };
    }
    return { category: 'button', text: primaryText, fillHex, strokeHex, fingerprint: fp('button', `|${Math.round(texts[0].fontSize === figma.mixed ? 0 : (texts[0].fontSize as number))}`), desc: '' };
  }

  // nav: wide, short, near the top of its parent, several children
  if (ctx.parentW > 0 && h <= 110 && w >= ctx.parentW * 0.6 && ctx.yInParent <= Math.max(16, ctx.parentH * 0.12) && kids.length >= 2 && !ctx.topLevel) {
    return { category: 'nav', text: primaryText, fillHex, strokeHex, fingerprint: fp('nav', `|${kids.length}`), desc: '' };
  }

  // avatar-like container (round, square-ish, small)
  if (aspect > 0.8 && aspect < 1.25 && Math.max(w, h) <= 120 && radius >= Math.min(w, h) / 2 - 0.5 && (hasFill || imageFill)) {
    return { category: 'avatar', text: primaryText, fillHex, strokeHex, fingerprint: fp('avatar'), desc: '' };
  }

  // list item: horizontal row spanning most of its parent
  if (ctx.parentW > 0 && layoutMode === 'HORIZONTAL' && w >= ctx.parentW * 0.7 && h <= 140 && h >= 32 && texts.length >= 1 && !ctx.topLevel) {
    return { category: 'list-item', text: primaryText, fillHex, strokeHex, fingerprint: fp('list-item', `|${kids.length}`), desc: '' };
  }

  // card: surfaced container with a few children
  if ((hasFill || hasStroke || shadow) && kids.length >= 2 && w >= 120 && h >= 72 && (ctx.parentW === 0 || w <= ctx.parentW * 0.95 || h <= ctx.parentH * 0.6)) {
    if (!(ctx.parentW > 0 && w >= ctx.parentW * 0.98 && h >= ctx.parentH * 0.9)) {
      return { category: 'card', text: primaryText, fillHex, strokeHex, fingerprint: fp('card', `|${kids.length}|${shadow ? 's' : ''}`), desc: '' };
    }
  }

  // section: large slab of a screen
  if (ctx.parentW > 0 && w >= ctx.parentW * 0.8 && h >= 120 && kids.length >= 1 && !ctx.topLevel) {
    return { category: 'section', text: primaryText, fillHex, strokeHex, fingerprint: fp('section'), desc: '' };
  }

  return { category: 'other', text: primaryText, fillHex, strokeHex, fingerprint: fp('other'), desc: '' };
}
