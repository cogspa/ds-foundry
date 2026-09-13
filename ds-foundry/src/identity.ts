import { IdentityFeatures, VariantProperties } from './asset-types';
import { hueName, rgbToHsl } from './util';

const q = (v: number) => Math.round(v * 10000) / 10000;
export function identityHash(s: string): string {
  // Two independent 32-bit accumulators; versioned, non-cryptographic feature hash.
  let a = 2166136261, b = 5381;
  for (let i = 0; i < s.length; i++) { a = Math.imul(a ^ s.charCodeAt(i), 16777619); b = Math.imul(b, 33) ^ s.charCodeAt(i); }
  return (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0');
}
export function normalizeVisibleText(s: string): string {
  return s.normalize('NFKC').toLowerCase().replace(/[™®©]/g, '').replace(/[‐‑–—-]/g, ' ').replace(/\s+/g, ' ').trim();
}
const CTA = /^(learn more|read more|buy now|shop now|click here|sign up|log in|get started|submit|next|back|download|continue)$/;
export function identityText(s: string): string { const t = normalizeVisibleText(s); return t.length >= 2 && t.length <= 120 && !CTA.test(t) ? t : ''; }

/** Preserve indexed topology, tangents and winding rules. Reordered networks may miss, never silently simplify. */
export function normalizeNetwork(v: VectorNetwork, w: number, h: number): unknown {
  if (!v.vertices.length || !v.segments.length || w <= 0 || h <= 0) throw new Error('empty geometry');
  const ox = Math.min(...v.vertices.map(p => p.x)), oy = Math.min(...v.vertices.map(p => p.y));
  return {
    vertices: v.vertices.map(p => [q((p.x - ox) / w), q((p.y - oy) / h), p.strokeCap || '', p.strokeJoin || '', q((p.cornerRadius || 0) / Math.max(w, h))]),
    segments: v.segments.map(s => [s.start, s.end, q((s.tangentStart?.x || 0) / w), q((s.tangentStart?.y || 0) / h), q((s.tangentEnd?.x || 0) / w), q((s.tangentEnd?.y || 0) / h)]),
    regions: (v.regions || []).map(r => [r.windingRule, r.loops]),
  };
}

export function extractIdentity(node: SceneNode): IdentityFeatures {
  let reliable = true, nodes = 0, geometryPoints = 0, vectors = 0, textCount = 0, filled = false, stroked = false, unknownPaint = false;
  const texts: string[] = [], colors = new Set<string>(), warnings: string[] = [];
  const walk = (n: SceneNode, depth: number): unknown => {
    if (++nodes > 1500 || depth > 24) { reliable = false; return 'truncated'; }
    if (n.visible === false || ('opacity' in n && n.opacity === 0)) return null;
    const w = n.width, h = n.height;
    if (!(w > 0 && h > 0)) reliable = false;
    for (const key of ['fills', 'strokes'] as const) {
      if (!(key in n)) continue;
      if (key === 'strokes' && 'strokeWeight' in n && n.strokeWeight === 0) continue;
      const paints = (n as GeometryMixin)[key];
      if (!Array.isArray(paints)) { unknownPaint = true; continue; }
      for (const paint of paints) {
        if (paint.visible === false || paint.opacity === 0) continue;
        if (key === 'fills') filled = true; else stroked = true;
        if (paint.type === 'SOLID') {
          colors.add([paint.color.r, paint.color.g, paint.color.b].map(v => Math.round(v * 255)).join(','));
        } else { unknownPaint = true; if (paint.type === 'IMAGE' || paint.type === 'VIDEO') reliable = false; }
      }
    }
    const o: Record<string, unknown> = { type: ['GROUP', 'FRAME', 'COMPONENT', 'INSTANCE'].includes(n.type) ? 'CONTAINER' : n.type, aspect: q(w / (h || 1)), mask: 'isMask' in n ? n.isMask : false };
    if ('clipsContent' in n) o.clips = n.clipsContent;
    if (n.type === 'VECTOR') {
      vectors++;
      try { const network=n.vectorNetwork; geometryPoints+=network.vertices.length+network.segments.length; if (geometryPoints>20000) throw new Error('geometry budget'); o.network = normalizeNetwork(network, w, h); } catch { reliable = false; }
    } else if (n.type === 'TEXT') {
      textCount++; texts.push(n.characters);
      o.text = normalizeVisibleText(n.characters);
      // Typography prevents equal text in different fonts counting as identical geometry.
      o.font = n.fontName; o.fontSize = typeof n.fontSize === 'number' ? q(n.fontSize / (h || 1)) : 'mixed';
      if (typeof n.fontName === 'symbol' || typeof n.fontSize === 'symbol') reliable = false;
    } else if (['RECTANGLE', 'ELLIPSE', 'POLYGON', 'STAR', 'LINE'].includes(n.type)) {
      const a = n as any;
      o.corners = ['topLeftRadius', 'topRightRadius', 'bottomRightRadius', 'bottomLeftRadius'].map(k => q((a[k] || 0) / (Math.max(w, h) || 1)));
      o.points = a.pointCount; o.inner = a.innerRadius; o.arc = a.arcData;
    } else if (!('children' in n)) reliable = false;
    if (n.type === 'BOOLEAN_OPERATION') o.operation = n.booleanOperation;
    if ('children' in n) {
      const budget=Math.max(0,1500-nodes);
      if (n.children.length>budget) reliable=false;
      o.children = n.children.slice(0,budget).filter(k => k.visible !== false && (!('opacity' in k) || k.opacity !== 0)).map(k => {
        const t = k.relativeTransform;
        return { bounds: [q(k.width / (w || 1)), q(k.height / (h || 1))], transform: [q(t[0][0]), q(t[0][1]), q(t[0][2] / (w || 1)), q(t[1][0]), q(t[1][1]), q(t[1][2] / (h || 1))], geometry: walk(k, depth + 1) };
      });
    }
    return o;
  };
  const geometry = walk(node, 0);
  // A plain rectangle is a container, not reliable evidence of the identity of an image/logo.
  if (!vectors && !textCount) reliable = false;
  if (!reliable) warnings.push('Geometry incomplete or non-distinctive; requires other evidence');
  const variant: VariantProperties = {};
  if (!unknownPaint && colors.size) {
    if (colors.size > 1) variant.color = 'multi';
    else {
      const [r, g, b] = [...colors][0].split(',').map(v => +v / 255);
      const { h, s, l } = rgbToHsl(r, g, b);
      variant.color = l < .08 ? 'black' : l > .95 ? 'white' : s < .12 ? 'gray' : hueName(h);
    }
    if (!filled && stroked) variant.treatment = 'outline';
    else if (colors.size === 1 && variant.color !== 'white') variant.treatment = 'monochrome';
  }
  const aspect = node.width / (node.height || 1);
  variant.orientation = aspect >= 1.8 ? 'horizontal' : aspect <= .55 ? 'vertical' : aspect >= .85 && aspect <= 1.18 ? 'square' : undefined;
  if (textCount && !vectors) variant.lockup = 'wordmark';
  else if (textCount && vectors) variant.lockup = textCount > 1 ? 'tagline-lockup' : 'mark-wordmark';
  if (textCount && vectors && 'layoutMode' in node && node.layoutMode==='VERTICAL' && 'children' in node && node.children.length<=4) variant.orientation='stacked';
  // Outlined text cannot be distinguished from a mark without semantic/visual evidence.
  return { version: 1, geometrySignature: reliable ? 'g1:' + identityHash(JSON.stringify(geometry)) : undefined, geometryReliable: reliable, visibleText: identityText(texts.join(' ')), variant, warnings };
}

export async function componentRelationship(node: SceneNode): Promise<{ family?: string; mainComponentId?: string }> {
  let main: ComponentNode | null = node.type === 'COMPONENT' ? node : null;
  if (node.type === 'INSTANCE') { try { main = await node.getMainComponentAsync(); } catch { /* inaccessible library */ } }
  if (!main) return {};
  const set = main.parent?.type === 'COMPONENT_SET' ? main.parent : main;
  return { family: set.key ? 'component:' + set.key : undefined, mainComponentId: main.id };
}
