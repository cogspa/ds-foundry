import {artworkBoundary,artworkRole} from './artwork';
import {characterGroupCandidate,sourceAncestors} from './character-discovery';
import {readAssetName} from './asset-names';
import { Scope, Inventory, ColorToken, TypeToken, SpaceToken, RadiusToken, EffectToken, ElementRec, ComponentRef } from './types';
import { classify, ClassifyCtx, logoUiCategory } from './classify';
import { nameColors, nameTypes, nameSpacing, nameRadii, nameEffects, sizeClass } from './naming';
import { toHex, effectKey, effectCss, tick, progress, cancelled, snap, rgbToHsl } from './util';

import { hasGeneratedAncestor, resolvedCategory } from './contact-sheet';
import { extractIdentity } from './identity';
import { layoutMetadata } from './layout-meta';

interface WalkItem { node: SceneNode; ctx: ClassifyCtx; inInstance: boolean; page: string; artworkOwner?:string; artworkCategory?:string; }

const SKIP_TYPES = new Set(['SLICE', 'STICKY', 'CONNECTOR', 'SHAPE_WITH_TEXT', 'CODE_BLOCK', 'WIDGET', 'EMBED', 'LINK_UNFURL', 'MEDIA', 'TABLE']);

export async function scan(scope: Scope, baseGrid: number): Promise<Inventory> {
  const colors = new Map<string, ColorToken>();
  const types = new Map<string, TypeToken>();
  const spacing = new Map<number, SpaceToken>();
  const radii = new Map<number, RadiusToken>();
  const effects = new Map<string, EffectToken>();
  const artworkParts:NonNullable<Inventory['artworkParts']>=[];
  const characterCandidates:ElementRec[]=[];
  let characterCandidatesDeferred=0;
  const elements: ElementRec[] = [];
  const icons: ElementRec[] = [];
  const shapes: ElementRec[] = [];
  const SHAPE_TYPES = new Set(['RECTANGLE', 'ELLIPSE', 'POLYGON', 'STAR', 'VECTOR', 'BOOLEAN_OPERATION']);
  const components = new Map<string, ComponentRef>();
  const fonts = new Map<string, { family: string; style: string }>();
  const missingFonts = new Set<string>();
  const pages: string[] = [];
  const pageIds: string[] = [];

  // ---- roots ----
  const stack: WalkItem[] = [];
  const pushRoots = (nodes: ReadonlyArray<SceneNode>, page: PageNode, topLevel: boolean) => {
    for (const n of nodes) {
      stack.push({ node: n, ctx: { parentW: 0, parentH: 0, yInParent: 0, topLevel }, inInstance: n.type === 'INSTANCE', page: page.name });
    }
  };

  if (scope === 'document') {
    await figma.loadAllPagesAsync();
    for (const p of figma.root.children) {
      pages.push(p.name); pageIds.push(p.id);
      pushRoots(p.children, p, true);
    }
  } else if (scope === 'page') {
    const p = figma.currentPage;
    pages.push(p.name); pageIds.push(p.id);
    pushRoots(p.children, p, true);
  } else {
    const p = figma.currentPage;
    pages.push(p.name); pageIds.push(p.id);
    const sel = p.selection;
    for (const n of sel) {
      const topLevel = n.parent?.type === 'PAGE';
      const pw = n.parent && 'width' in n.parent ? (n.parent as FrameNode).width : 0;
      const ph = n.parent && 'height' in n.parent ? (n.parent as FrameNode).height : 0;
      stack.push({ node: n, ctx: { parentW: pw, parentH: ph, yInParent: n.y, topLevel }, inInstance: n.type === 'INSTANCE', page: p.name });
    }
  }

  const rootCount = stack.length;
  let visited = 0;
  let sinceTick = 0;

  const addColor = (paint: SolidPaint) => {
    const { r, g, b } = paint.color;
    const a = paint.opacity === undefined ? 1 : paint.opacity;
    const hex = toHex(r, g, b);
    const key = a >= 0.999 ? hex : `${hex}@${Math.round(a * 100)}`;
    const t = colors.get(key);
    if (t) t.count++;
    else colors.set(key, { key, hex, r, g, b, a, count: 1, name: '', role: '', step: 0 });
  };

  const addPaints = (paints: ReadonlyArray<Paint> | PluginAPI['mixed'] | undefined, isStroke = false, weight?: number | PluginAPI['mixed']) => {
    if (!paints || paints === figma.mixed) return;
    if (isStroke && typeof weight === 'number' && weight <= 0) return;
    for (const p of paints) if (p.type === 'SOLID' && p.visible !== false) addColor(p);
  };

  const addSpace = (v: number) => {
    if (!isFinite(v) || v <= 0) return;
    const s = snap(v, baseGrid);
    if (s <= 0) return;
    const t = spacing.get(s);
    if (t) t.count++; else spacing.set(s, { value: s, count: 1, name: '' });
  };

  const addRadius = (v: number) => {
    if (!isFinite(v) || v <= 0) return;
    const r = v >= 999 ? 999 : Math.round(v);
    const t = radii.get(r);
    if (t) t.count++; else radii.set(r, { value: r, count: 1, name: '' });
  };

  const addEffects = (list: ReadonlyArray<Effect>) => {
    const vis = list.filter((e) => e.visible !== false);
    if (!vis.length) return;
    const key = effectKey(vis);
    const t = effects.get(key);
    if (t) t.count++;
    else {
      // strip variable bindings so the effect can be re-applied to styles verbatim
      const clean = vis.map((e) => { const { boundVariables, ...rest } = e as any; return rest as Effect; });
      effects.set(key, { key, effects: clean, count: 1, name: '', css: vis.map(effectCss).filter(Boolean).join(', ') });
    }
  };

  const textRoleOf = (node: TextNode): string => {
    // register typography segments; return the key of the first segment
    let firstKey = '';
    type Seg = Pick<StyledTextSegment, 'characters' | 'start' | 'end' | 'fontName' | 'fontSize' | 'lineHeight' | 'letterSpacing' | 'fills'>;
    let segs: Seg[] | null = null;
    try {
      segs = node.getStyledTextSegments(['fontName', 'fontSize', 'lineHeight', 'letterSpacing', 'fills']) as Seg[];
    } catch { segs = null; }
    if (!segs || !segs.length) return '';
    for (const s of segs) {
      const fn = s.fontName;
      const lh = s.lineHeight;
      const ls = s.letterSpacing;
      const lhKey = lh.unit === 'AUTO' ? 'auto' : `${Math.round(lh.value * 100) / 100}${lh.unit === 'PERCENT' ? '%' : 'px'}`;
      const lsKey = `${Math.round(ls.value * 100) / 100}${ls.unit === 'PERCENT' ? '%' : 'px'}`;
      const key = `${fn.family}|${fn.style}|${s.fontSize}|${lhKey}|${lsKey}`;
      if (!firstKey) firstKey = key;
      const t = types.get(key);
      if (t) t.count += Math.max(1, s.characters.length > 0 ? 1 : 0);
      else types.set(key, { key, family: fn.family, style: fn.style, size: s.fontSize, lineHeight: lh, letterSpacing: ls, count: 1, name: '', role: '', weight: '', cssWeight: 400 });
      fonts.set(`${fn.family}|${fn.style}`, { family: fn.family, style: fn.style });
      if (node.hasMissingFont) missingFonts.add(`${fn.family} ${fn.style}`);
      addPaints(s.fills);
    }
    return firstKey;
  };

  const fillRoleOf = (hex: string | null, strokeHex: string | null): string => {
    if (!hex) return strokeHex ? 'outline' : 'ghost';
    const r = parseInt(hex.slice(1, 3), 16) / 255, g = parseInt(hex.slice(3, 5), 16) / 255, b = parseInt(hex.slice(5, 7), 16) / 255;
    const { s, l } = rgbToHsl(r, g, b);
    if (l > 0.94 && s < 0.2) return strokeHex ? 'outline' : 'ghost';
    if (s < 0.1) return 'neutral';
    return '__' + hex; // resolved to a role after colour naming
  };

  // ---- walk ----
  while (stack.length) {
    if (cancelled) throw new Error('cancelled');
    const item = stack.pop()!;
    const node = item.node;
    if (SKIP_TYPES.has(node.type) || node.removed || hasGeneratedAncestor(node)) continue;
    visited++;
    sinceTick++;
    if (sinceTick >= 400) {
      sinceTick = 0;
      const pct = rootCount ? Math.min(85, 5 + (visited / Math.max(visited + stack.length, 1)) * 80) : 50;
      progress(pct, `Scanning… ${visited.toLocaleString()} layers`);
      await tick();
    }

    const inInstance = item.inInstance;

    // tokens
    if ('fills' in node) {
      if (node.type !== 'TEXT') addPaints((node as GeometryMixin).fills);
    }
    if ('strokes' in node) addPaints((node as GeometryMixin).strokes, true, (node as GeometryMixin).strokeWeight);
    if ('effects' in node) addEffects((node as BlendMixin).effects);
    if ('cornerRadius' in node) {
      const cr = (node as CornerMixin).cornerRadius;
      if (typeof cr === 'number') addRadius(cr);
      else {
        const rn = node as RectangleCornerMixin;
        [rn.topLeftRadius, rn.topRightRadius, rn.bottomLeftRadius, rn.bottomRightRadius].forEach((v) => typeof v === 'number' && addRadius(v));
      }
    }
    if ('layoutMode' in node && (node as FrameNode).layoutMode !== 'NONE') {
      const f = node as FrameNode;
      addSpace(f.paddingLeft); addSpace(f.paddingRight); addSpace(f.paddingTop); addSpace(f.paddingBottom);
      if (typeof f.itemSpacing === 'number' && f.primaryAxisAlignItems !== 'SPACE_BETWEEN') addSpace(f.itemSpacing);
      if (f.layoutWrap === 'WRAP' && typeof f.counterAxisSpacing === 'number') addSpace(f.counterAxisSpacing);
    }

    // components in use
    if (node.type === 'INSTANCE' && !item.artworkOwner) {
      try {
        const mc = await (node as InstanceNode).getMainComponentAsync();
        if (mc) {
          const target: ComponentNode | ComponentSetNode = mc.parent && mc.parent.type === 'COMPONENT_SET' ? mc.parent : mc;
          const ref = components.get(target.id);
          if (ref) ref.count++;
          else components.set(target.id, { id: target.id, name: target.name, remote: target.remote, count: 1 });
        }
      } catch { /* detached or inaccessible */ }
    }

    // classify
    let textRole = '';
    if (node.type === 'TEXT') textRole = textRoleOf(node as TextNode);

    const nestedCandidate=!!item.artworkOwner&&!['character','logo'].includes(item.artworkCategory||'')&&characterGroupCandidate(node)&&artworkRole(node).artworkRole!=='part';
    const keepCandidate=nestedCandidate&&characterCandidates.length<500;
    if(nestedCandidate&&!keepCandidate)characterCandidatesDeferred++;
    const cls = item.artworkOwner ? {category:'illustration' as const,text:'',fillHex:null,strokeHex:null,fingerprint:'',desc:'Nested vector group; review whether this is one whole character, a scene or a fragment.'} : classify(node, item.ctx);
    const savedCategory = node.getPluginData('dsf.category');
    if (!item.artworkOwner && (savedCategory !== 'debris' || node.getPluginData('dsf.semanticName'))) cls.category = resolvedCategory(savedCategory, cls.category);
    if (!item.artworkOwner && cls.category === 'logo') cls.category = logoUiCategory(node) || cls.category;
    if(!item.artworkOwner&&readAssetName(node)?.appearance.crop&&cls.category==='debris')cls.category='symbol';
    const boundary=!item.artworkOwner&&artworkBoundary(node,cls.category);
    const artContainer='children' in node&&['icon','logo','character','illustration','symbol'].includes(cls.category);
    if(item.artworkOwner)artworkParts.push({nodeId:node.id,ownerId:item.artworkOwner,name:node.name,nodeType:node.type,layout:layoutMetadata(node)});
    if (keepCandidate || !item.artworkOwner && (!artContainer || boundary) && (cls.category !== 'other' || node.type === 'COMPONENT' || node.type === 'INSTANCE' || node.type === 'COMPONENT_SET')) {
      const rec: ElementRec = {
        id: node.id,
        nodeType: node.type,
        characterAncestorIds:sourceAncestors(node),
        ...(['icon','logo','character','illustration','symbol'].includes(cls.category)?artworkRole(node):{}),
        assetName:readAssetName(node),
        category: cls.category,
        name: node.name,
        originalName: node.getPluginData('dsf.originalName') || undefined,
        semanticName: node.getPluginData('dsf.semanticName') || undefined,
        text: cls.text.slice(0, 80),
        w: node.width,
        h: node.height,
        fingerprint: cls.fingerprint,
        inInstance,
        fillRole: cls.category === 'button' || cls.category === 'badge' ? fillRoleOf(cls.fillHex, cls.strokeHex) : '',
        sizeClass: sizeClass(node.height),
        textRole,
        desc: cls.desc,
        page: item.page,
        identity: extractIdentity(node),
        layout: layoutMetadata(node),
      };
      if(keepCandidate)characterCandidates.push(rec);
      else if (cls.category === 'icon') icons.push(rec);
      else if (cls.category === 'shape') { if (shapes.length < 4000) shapes.push(rec); }
      else elements.push(rec);
    }

    // Walk internal nodes for token extraction and part metadata, not asset classification.
    if ('children' in node) {
      for (let i=node.children.length-1;i>=0;i--) {
        const k=node.children[i];
        const reviewedCharacter=keepCandidate&&node.getPluginData('dsf.category')==='character'&&artworkRole(node).artworkRole!=='part';
        stack.push({node:k,ctx:{parentW:node.width,parentH:node.height,yInParent:k.y,topLevel:false},inInstance:inInstance||node.type==='INSTANCE',page:item.page,artworkOwner:item.artworkOwner||(boundary?node.id:undefined),artworkCategory:reviewedCharacter?'character':item.artworkCategory||(boundary?cls.category:undefined)});
      }
    }
  }

  const roles = new Map([...elements, ...icons, ...shapes].map(r => [r.id, r.category]));
  for (const r of [...elements, ...icons, ...shapes]) if (r.layout?.parentId) r.layout.parentSemanticRole = roles.get(r.layout.parentId);

  progress(90, 'Naming tokens…');
  await tick();

  const namedColors = nameColors([...colors.values()]);
  const hexRole = new Map<string, string>();
  for (const c of namedColors) if (!hexRole.has(c.hex)) hexRole.set(c.hex, c.role);
  for (const e of elements) {
    if (e.fillRole.startsWith('__')) e.fillRole = hexRole.get(e.fillRole.slice(2)) || 'custom';
  }
  const namedTypes = nameTypes([...types.values()]);
  const typeName = new Map<string, string>();
  for (const t of namedTypes) typeName.set(t.key, t.name);
  for (const e of elements) if (e.category === 'text' && e.textRole) e.textRole = typeName.get(e.textRole) || 'body';

  const inv: Inventory = {
    artworkParts,
    characterCandidates,characterCandidatesDeferred,
    scope,
    pages,
    pageIds,
    nodeCount: visited,
    colors: namedColors,
    types: namedTypes,
    spacing: nameSpacing([...spacing.values()]),
    radii: nameRadii([...radii.values()]),
    effects: nameEffects([...effects.values()]),
    elements,
    icons,
    shapes,
    components: [...components.values()].sort((a, b) => b.count - a.count),
    fonts: [...fonts.values()],
    missingFonts: [...missingFonts],
  };
  progress(100, 'Scan complete');
  return inv;
}
