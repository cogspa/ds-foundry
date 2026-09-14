import {version as PLUGIN_VERSION} from '../package.json';
import {linkSheetCell} from './sheet-identify';
import { refreshIdentifications, appearanceKey, sheetName, auditedAssetCategory } from './contact-sheet';
import { Inventory, BuildOptions, BuildResult, ElementRec, ColorToken, Category } from './types';
import { elementLabel } from './naming';
import { PD_ORIGINAL, PD_CATEGORY, PD_GENERATED, progress, tick, cancelled, slug, rgbaCss, round } from './util';
import { buildTokenFiles } from './tokens';

// ---------------------------------------------------------------- fonts & primitives

const UI_FONT: FontName = { family: 'Inter', style: 'Regular' };
const UI_BOLD: FontName = { family: 'Inter', style: 'Semi Bold' };
const fontOk = new Map<string, boolean>();

async function loadFont(f: FontName): Promise<boolean> {
  const k = `${f.family}|${f.style}`;
  if (fontOk.has(k)) return fontOk.get(k)!;
  try { await figma.loadFontAsync(f); fontOk.set(k, true); return true; }
  catch { fontOk.set(k, false); return false; }
}

const INK: RGB = { r: 0.09, g: 0.09, b: 0.11 };
const MUTED: RGB = { r: 0.45, g: 0.46, b: 0.5 };
const PAPER: RGB = { r: 1, g: 1, b: 1 };
const HAIR: RGB = { r: 0.9, g: 0.9, b: 0.92 };
const CANVAS: RGB = { r: 0.965, g: 0.965, b: 0.97 };

async function mkText(chars: string, o: { bold?: boolean; size?: number; color?: RGB; font?: FontName } = {}): Promise<TextNode> {
  const t = figma.createText();
  let f = o.font || (o.bold ? UI_BOLD : UI_FONT);
  if (!(await loadFont(f))) { f = UI_FONT; await loadFont(f); }
  t.fontName = f;
  t.characters = chars;
  t.fontSize = o.size ?? 12;
  t.fills = [{ type: 'SOLID', color: o.color || INK }];
  t.textAutoResize = 'WIDTH_AND_HEIGHT';
  return t;
}

function mkFrame(name: string, o: { dir?: 'H' | 'V'; pad?: number | [number, number]; gap?: number; wrap?: boolean; fill?: RGB | null; w?: number; radius?: number; stroke?: RGB | null; align?: 'MIN' | 'CENTER' | 'MAX' } = {}): FrameNode {
  const f = figma.createFrame();
  f.name = name;
  f.layoutMode = o.dir === 'H' ? 'HORIZONTAL' : 'VERTICAL';
  const pad = o.pad ?? 0;
  const [px, py] = Array.isArray(pad) ? pad : [pad, pad];
  f.paddingLeft = f.paddingRight = px;
  f.paddingTop = f.paddingBottom = py;
  f.itemSpacing = o.gap ?? 0;
  f.counterAxisAlignItems = o.align || 'MIN';
  f.fills = o.fill === null || o.fill === undefined ? [] : [{ type: 'SOLID', color: o.fill }];
  if (o.stroke) { f.strokes = [{ type: 'SOLID', color: o.stroke }]; f.strokeWeight = 1; }
  if (o.radius) f.cornerRadius = o.radius;
  f.clipsContent = false;
  if (o.wrap) {
    f.layoutWrap = 'WRAP';
    f.counterAxisSpacing = o.gap ?? 0;
    f.primaryAxisSizingMode = 'FIXED';
    f.counterAxisSizingMode = 'AUTO';
    f.resize(o.w ?? 1200, 100);
  } else {
    f.primaryAxisSizingMode = 'AUTO';
    f.counterAxisSizingMode = 'AUTO';
    if (o.w) { f.counterAxisSizingMode = 'FIXED'; f.resize(o.w, 100); }
  }
  return f;
}

function mkRect(w: number, h: number, fill: RGB, o: { radius?: number; opacity?: number; stroke?: RGB | null } = {}): RectangleNode {
  const r = figma.createRectangle();
  r.resize(w, h);
  r.fills = [{ type: 'SOLID', color: fill, opacity: o.opacity ?? 1 }];
  if (o.radius !== undefined) r.cornerRadius = o.radius;
  if (o.stroke) { r.strokes = [{ type: 'SOLID', color: o.stroke }]; r.strokeWeight = 1; r.strokeAlign = 'INSIDE'; }
  return r;
}

async function mkSection(title: string, subtitle: string, page: PageNode, cursor: { y: number }): Promise<{ section: FrameNode; body: FrameNode }> {
  const section = mkFrame(title, { dir: 'V', pad: 48, gap: 28, fill: PAPER, radius: 24, stroke: HAIR });
  section.setPluginData(PD_GENERATED, '1');
  const head = mkFrame('title', { dir: 'V', gap: 6 });
  head.appendChild(await mkText(title, { bold: true, size: 22 }));
  if (subtitle) head.appendChild(await mkText(subtitle, { size: 12, color: MUTED }));
  section.appendChild(head);
  const body = mkFrame('content', { dir: 'V', gap: 20 });
  section.appendChild(body);
  page.appendChild(section);
  section.x = 0;
  section.y = cursor.y;
  return { section, body };
}

function finishSection(section: FrameNode, cursor: { y: number }) {
  cursor.y = section.y + section.height + 96;
}

async function getOrCreatePage(name: string): Promise<PageNode> {
  let page = figma.root.children.find((p) => p.name === name) as PageNode | undefined;
  if (!page) { page = figma.createPage(); page.name = name; return page; }
  await page.loadAsync();
  for (const c of [...page.children]) if (c.getPluginData(PD_GENERATED) === '1') c.remove();
  return page;
}

async function nodeById(id: string): Promise<SceneNode | null> {
  try {
    const n = await figma.getNodeByIdAsync(id);
    if (!n || n.removed || n.type === 'DOCUMENT' || n.type === 'PAGE') return null;
    return n as SceneNode;
  } catch { return null; }
}

function unlockSizing(n: SceneNode) {
  try {
    const a = n as any;
    const isAL = 'layoutMode' in n && (n as FrameNode).layoutMode !== 'NONE';
    if ('layoutSizingHorizontal' in a && a.layoutSizingHorizontal === 'FILL') a.layoutSizingHorizontal = isAL ? 'HUG' : 'FIXED';
    if ('layoutSizingVertical' in a && a.layoutSizingVertical === 'FILL') a.layoutSizingVertical = isAL ? 'HUG' : 'FIXED';
    if ('layoutPositioning' in a && a.layoutPositioning === 'ABSOLUTE') a.layoutPositioning = 'AUTO';
  } catch { /* ignore */ }
}

// ---------------------------------------------------------------- labels

export async function applyLabels(inv: Inventory, opts: BuildOptions): Promise<number> {
  let n = 0;
  const all = [...inv.elements, ...inv.icons, ...inv.shapes];
  for (let i = 0; i < all.length; i++) {
    if (cancelled) throw new Error('cancelled');
    const rec = all[i];
    if (rec.inInstance) continue;
    if ((rec.category === 'text' || rec.category === 'tagline' || rec.category === 'copy') && !opts.labelText) continue;
    const node = await nodeById(rec.id);
    if (!node) continue;
    try {
      if (!node.getPluginData(PD_ORIGINAL)) node.setPluginData(PD_ORIGINAL, node.name);
      if (!node.getPluginData(PD_CATEGORY)) node.setPluginData(PD_CATEGORY, rec.category);
      if (opts.rename && !node.getPluginData('dsf.semanticName') && !node.name.startsWith(opts.prefix)) node.name = elementLabel(rec, opts.prefix);
      n++;
    } catch { /* locked or read-only */ }
    if (i % 200 === 0) { progress(5 + (i / all.length) * 10, `Labelling layers… ${i}/${all.length}`); await tick(); }
  }
  return n;
}

export async function revertLabels(): Promise<number> {
  await figma.loadAllPagesAsync();
  let n = 0;
  for (const page of figma.root.children) {
    const hits = page.findAll((x) => !!x.getPluginData(PD_ORIGINAL));
    for (const node of hits) {
      try {
        node.name = node.getPluginData(PD_ORIGINAL);
        node.setPluginData(PD_ORIGINAL, '');
        node.setPluginData(PD_CATEGORY, '');
        node.setPluginData('dsf.semanticName', '');
        node.setPluginData('dsf.assetName', '');
        n++;
      } catch { /* ignore */ }
    }
    await tick();
  }
  return n;
}

// ---------------------------------------------------------------- variables

interface VarMaps { color: Map<string, Variable>; space: Map<number, Variable>; radius: Map<string, Variable>; count: number; }

export async function buildVariables(inv: Inventory, opts: BuildOptions, notes: string[]): Promise<VarMaps | null> {
  const maps: VarMaps = { color: new Map(), space: new Map(), radius: new Map(), count: 0 };
  const name = 'DS Foundry / Primitives';
  let col: VariableCollection;
  try {
    const cols = await figma.variables.getLocalVariableCollectionsAsync();
    col = cols.find((c) => c.name === name) || figma.variables.createVariableCollection(name);
  } catch (e) {
    notes.push('Variables could not be created (plan limit or permissions) — colour styles were created without variable bindings.');
    return null;
  }
  const mode = col.defaultModeId;
  const existing = (await figma.variables.getLocalVariablesAsync()).filter((v) => v.variableCollectionId === col.id);
  const byName = new Map(existing.map((v) => [v.name, v]));

  const getVar = (n: string, type: VariableResolvedDataType): Variable | null => {
    const found = byName.get(n);
    if (found && found.resolvedType === type) return found;
    try {
      const v = figma.variables.createVariable(n, col, type);
      byName.set(n, v);
      return v;
    } catch (e) {
      return null;
    }
  };

  let failed = 0;
  for (const c of inv.colors) {
    const v = getVar(`color/${c.name}`, 'COLOR');
    if (!v) { failed++; continue; }
    v.setValueForMode(mode, { r: c.r, g: c.g, b: c.b, a: c.a });
    try { v.scopes = ['ALL_FILLS', 'STROKE_COLOR', 'EFFECT_COLOR']; } catch { /* ignore */ }
    maps.color.set(c.key, v); maps.count++;
  }
  for (const s of inv.spacing) {
    const v = getVar(s.name, 'FLOAT');
    if (!v) { failed++; continue; }
    v.setValueForMode(mode, s.value);
    try { v.scopes = ['GAP', 'WIDTH_HEIGHT']; } catch { /* ignore */ }
    maps.space.set(s.value, v); maps.count++;
  }
  for (const r of inv.radii) {
    const v = getVar(r.name, 'FLOAT');
    if (!v) { failed++; continue; }
    v.setValueForMode(mode, r.value >= 999 ? 9999 : r.value);
    try { v.scopes = ['CORNER_RADIUS']; } catch { /* ignore */ }
    maps.radius.set(r.name, v); maps.count++;
  }
  if (failed) notes.push(`${failed} variables could not be created (plan limit reached?). Styles still cover every token.`);
  return maps;
}

// ---------------------------------------------------------------- styles

interface StyleMaps { paint: Map<string, PaintStyle>; text: Map<string, TextStyle>; effect: Map<string, EffectStyle>; }

export async function buildStyles(inv: Inventory, opts: BuildOptions, vars: VarMaps | null, notes: string[]): Promise<StyleMaps> {
  const maps: StyleMaps = { paint: new Map(), text: new Map(), effect: new Map() };
  const p = opts.prefix;

  const paints = await figma.getLocalPaintStylesAsync();
  for (const c of inv.colors) {
    const name = `${p}color/${c.name}`;
    let st = paints.find((s) => s.name === name);
    if (!st) { st = figma.createPaintStyle(); st.name = name; }
    let paint: SolidPaint = { type: 'SOLID', color: { r: c.r, g: c.g, b: c.b }, opacity: c.a };
    const v = vars?.color.get(c.key);
    if (v) { try { paint = figma.variables.setBoundVariableForPaint(paint, 'color', v); } catch { /* ignore */ } }
    st.paints = [paint];
    st.description = `${c.count} uses`;
    maps.paint.set(c.key, st);
  }
  await tick();

  const texts = await figma.getLocalTextStylesAsync();
  let skipped = 0;
  for (const t of inv.types) {
    const f: FontName = { family: t.family, style: t.style };
    if (!(await loadFont(f))) { skipped++; continue; }
    const name = `${p}text/${t.name}`;
    let st = texts.find((s) => s.name === name);
    if (!st) { st = figma.createTextStyle(); st.name = name; }
    try {
      st.fontName = f;
      st.fontSize = t.size;
      st.lineHeight = t.lineHeight;
      st.letterSpacing = t.letterSpacing;
      st.description = `${t.family} ${t.style} ${round(t.size)}px · ${t.count} uses`;
      maps.text.set(t.key, st);
    } catch { skipped++; }
  }
  if (skipped) notes.push(`${skipped} text styles skipped because their fonts are missing on this machine.`);
  await tick();

  const effects = await figma.getLocalEffectStylesAsync();
  for (const e of inv.effects) {
    const name = `${p}effect/${e.name}`;
    let st = effects.find((s) => s.name === name);
    if (!st) { st = figma.createEffectStyle(); st.name = name; }
    st.effects = e.effects;
    st.description = `${e.css} · ${e.count} uses`;
    maps.effect.set(e.key, st);
  }
  return maps;
}

// ---------------------------------------------------------------- foundations page

export async function buildFoundations(inv: Inventory, opts: BuildOptions, styles: StyleMaps | null, notes: string[]): Promise<PageNode> {
  const page = await getOrCreatePage('DS · Foundations');
  const cursor = { y: 0 };
  const primary = inv.colors.find((c) => c.role === 'primary') || inv.colors[0];
  const accent: RGB = primary ? { r: primary.r, g: primary.g, b: primary.b } : { r: 0.2, g: 0.3, b: 0.9 };

  // ---- colours ----
  if (inv.colors.length) {
    const { section, body } = await mkSection('Colour', `${inv.colors.length} colours found across ${inv.nodeCount.toLocaleString()} layers, grouped by role and ranked by lightness.`, page, cursor);
    const roles = [...new Set(inv.colors.map((c) => c.role))];
    for (const role of roles) {
      const group = mkFrame(role, { dir: 'V', gap: 10 });
      group.appendChild(await mkText(role, { bold: true, size: 13 }));
      const row = mkFrame('swatches', { dir: 'H', gap: 12, wrap: true, w: 1160 });
      for (const c of inv.colors.filter((x) => x.role === role)) {
        const cell = mkFrame(c.name, { dir: 'V', gap: 8 });
        const sw = mkRect(132, 84, { r: c.r, g: c.g, b: c.b }, { radius: 10, opacity: c.a, stroke: HAIR });
        const st = styles?.paint.get(c.key);
        if (st) { try { await sw.setFillStyleIdAsync(st.id); } catch { /* ignore */ } }
        cell.appendChild(sw);
        cell.appendChild(await mkText(c.name, { bold: true, size: 11 }));
        cell.appendChild(await mkText(`${rgbaCss(c.r, c.g, c.b, c.a)} · ${c.count}×`, { size: 10, color: MUTED }));
        row.appendChild(cell);
      }
      group.appendChild(row);
      body.appendChild(group);
    }
    finishSection(section, cursor);
    await tick();
  }

  // ---- typography ----
  if (inv.types.length) {
    const { section, body } = await mkSection('Typography', `${inv.types.length} text styles, named by role (display · heading · title · body · caption), size and weight.`, page, cursor);
    for (const t of inv.types) {
      const row = mkFrame(t.name, { dir: 'H', gap: 32, align: 'CENTER' });
      const label = mkFrame('label', { dir: 'V', gap: 2, w: 220 });
      label.appendChild(await mkText(t.name, { bold: true, size: 11 }));
      label.appendChild(await mkText(`${t.family} ${t.style} · ${round(t.size)}px`, { size: 10, color: MUTED }));
      row.appendChild(label);
      const f: FontName = { family: t.family, style: t.style };
      const ok = await loadFont(f);
      const specimen = await mkText(ok ? 'Sphinx of black quartz, judge my vow' : `${t.family} ${t.style} is not installed`, { font: ok ? f : UI_FONT, size: Math.min(t.size, 96), color: ok ? INK : MUTED });
      if (ok) {
        try { specimen.lineHeight = t.lineHeight; specimen.letterSpacing = t.letterSpacing; } catch { /* ignore */ }
        const st = styles?.text.get(t.key);
        if (st) { try { await specimen.setTextStyleIdAsync(st.id); } catch { /* ignore */ } }
      }
      row.appendChild(specimen);
      body.appendChild(row);
    }
    finishSection(section, cursor);
    await tick();
  }

  // ---- spacing ----
  if (inv.spacing.length) {
    const { section, body } = await mkSection('Spacing', `Auto-layout padding and gaps, snapped to a ${opts.baseGrid}px grid.`, page, cursor);
    for (const s of inv.spacing) {
      const row = mkFrame(s.name, { dir: 'H', gap: 20, align: 'CENTER' });
      const label = mkFrame('label', { dir: 'V', w: 120 });
      label.appendChild(await mkText(s.name, { bold: true, size: 11 }));
      row.appendChild(label);
      row.appendChild(mkRect(Math.max(2, s.value), 20, accent, { radius: 3 }));
      row.appendChild(await mkText(`${s.value}px · ${s.count}×`, { size: 10, color: MUTED }));
      body.appendChild(row);
    }
    finishSection(section, cursor);
  }

  // ---- radius ----
  if (inv.radii.length) {
    const { section, body } = await mkSection('Radius', 'Corner radii in use, smallest to largest.', page, cursor);
    const row = mkFrame('radii', { dir: 'H', gap: 24, wrap: true, w: 1160 });
    for (const r of inv.radii) {
      const cell = mkFrame(r.name, { dir: 'V', gap: 8, align: 'CENTER' });
      cell.appendChild(mkRect(88, 88, CANVAS, { radius: Math.min(r.value, 44), stroke: HAIR }));
      cell.appendChild(await mkText(r.name, { bold: true, size: 11 }));
      cell.appendChild(await mkText(r.value >= 999 ? 'full' : `${r.value}px`, { size: 10, color: MUTED }));
      row.appendChild(cell);
    }
    body.appendChild(row);
    finishSection(section, cursor);
  }

  // ---- effects ----
  if (inv.effects.length) {
    const { section, body } = await mkSection('Elevation & blur', 'Shadow and blur effects, ranked by depth.', page, cursor);
    const row = mkFrame('effects', { dir: 'H', gap: 40, wrap: true, w: 1160 });
    for (const e of inv.effects) {
      const cell = mkFrame(e.name, { dir: 'V', gap: 10 });
      const card = mkRect(180, 110, PAPER, { radius: 12 });
      card.effects = e.effects;
      const st = styles?.effect.get(e.key);
      if (st) { try { await card.setEffectStyleIdAsync(st.id); } catch { /* ignore */ } }
      cell.appendChild(card);
      cell.appendChild(await mkText(e.name, { bold: true, size: 11 }));
      cell.appendChild(await mkText(e.css.slice(0, 60), { size: 10, color: MUTED }));
      row.appendChild(cell);
    }
    body.appendChild(row);
    body.fills = [{ type: 'SOLID', color: CANVAS }];
    body.paddingLeft = body.paddingRight = body.paddingTop = body.paddingBottom = 32;
    body.cornerRadius = 16;
    finishSection(section, cursor);
  }
  return page;
}

// ---------------------------------------------------------------- components page

const COMPONENT_ORDER: Category[] = ['button', 'input', 'badge', 'checkbox', 'toggle', 'avatar', 'list-item', 'card', 'nav', 'section'];
const COMPONENT_LIMIT: Partial<Record<Category, number>> = { button: 14, input: 8, badge: 14, checkbox: 6, toggle: 6, avatar: 8, 'list-item': 8, card: 8, nav: 4, section: 4 };

function variantNames(recs: ElementRec[]): string[] {
  const base = recs.map((r) => {
    const style = r.fillRole || 'default';
    return `Style=${style}, Size=${r.sizeClass}`;
  });
  const dup = base.some((b, i) => base.indexOf(b) !== i);
  if (!dup) return base;
  const seen = new Map<string, number>();
  return base.map((b) => {
    const n = (seen.get(b) || 0) + 1;
    seen.set(b, n);
    return `${b}, Alt=${n}`;
  });
}

export async function buildComponents(inv: Inventory, opts: BuildOptions, notes: string[]): Promise<{ page: PageNode; sets: number; comps: number }> {
  const page = await getOrCreatePage('DS · Components');
  const cursor = { y: 0 };
  let sets = 0, comps = 0;

  for (const cat of COMPONENT_ORDER) {
    if (cancelled) throw new Error('cancelled');
    const pool = inv.elements.filter((e) => e.category === cat && !e.inInstance);
    if (!pool.length) continue;
    const seen = new Set<string>();
    const picks: ElementRec[] = [];
    for (const r of pool) {
      if (seen.has(appearanceKey(r))) continue;
      seen.add(appearanceKey(r));
      picks.push(r);
      if (picks.length >= (COMPONENT_LIMIT[cat] || 6)) break;
    }
    progress(60, `Building ${cat} components…`);
    await tick();

    const { section, body } = await mkSection(`${cat[0].toUpperCase()}${cat.slice(1)}`, `${pool.length} found · ${picks.length} distinct variant${picks.length === 1 ? '' : 's'} promoted to components.`, page, cursor);
    const stage = mkFrame('stage', { dir: 'H', gap: 40, wrap: true, w: 1160, align: 'MIN' });
    body.appendChild(stage);

    const made: ComponentNode[] = [];
    const names = variantNames(picks);
    for (let i = 0; i < picks.length; i++) {
      const src = await nodeById(picks[i].id);
      if (!src) continue;
      let clone: SceneNode;
      try { clone = src.clone(); } catch { continue; }
      try {
        stage.appendChild(clone);
        unlockSizing(clone);
        const comp = clone.type === 'COMPONENT' ? clone : figma.createComponentFromNode(clone);
        comp.name = names[i];
        comp.description = `From "${picks[i].name}" on page "${picks[i].page}"${picks[i].text ? ` — "${picks[i].text}"` : ''}`;
        comp.setPluginData(PD_GENERATED, '1');
        made.push(comp);
      } catch {
        try { clone.remove(); } catch { /* ignore */ }
      }
    }
    if (!made.length) { section.remove(); continue; }
    comps += made.length;
    if (made.length === 1) {
      made[0].name = `${opts.prefix}${cat}`;
    } else {
      try {
        const set = figma.combineAsVariants(made, stage);
        set.name = `${opts.prefix}${cat}`;
        set.description = `Auto-generated by DS Foundry. Variants were sampled from distinct ${cat} instances in the file.`;
        set.setPluginData(PD_GENERATED, '1');
        set.layoutMode = 'HORIZONTAL';
        set.layoutWrap = 'WRAP';
        set.itemSpacing = 24; set.counterAxisSpacing = 24;
        set.paddingLeft = set.paddingRight = set.paddingTop = set.paddingBottom = 24;
        set.primaryAxisSizingMode = 'FIXED';
        set.counterAxisSizingMode = 'AUTO';
        set.resize(1100, set.height);
      } catch (e) {
        notes.push(`Could not combine ${cat} into a variant set; components were left as individual components.`);
        made.forEach((m, i) => (m.name = `${opts.prefix}${cat}/${i + 1}`));
      }
    }
    sets++;
    finishSection(section, cursor);
  }

  // existing components gallery
  if (inv.components.length) {
    progress(70, 'Placing existing components…');
    await tick();
    const { section, body } = await mkSection('Components already in use', `${inv.components.length} components referenced by instances in the scanned scope. Library components are shown for reference.`, page, cursor);
    const stage = mkFrame('gallery', { dir: 'H', gap: 32, wrap: true, w: 1160 });
    body.appendChild(stage);
    let placed = 0;
    for (const ref of inv.components.slice(0, 60)) {
      try {
        const n = await figma.getNodeByIdAsync(ref.id);
        if (!n) continue;
        const comp = n.type === 'COMPONENT_SET' ? (n as ComponentSetNode).defaultVariant : n.type === 'COMPONENT' ? (n as ComponentNode) : null;
        if (!comp) continue;
        const cell = mkFrame(ref.name, { dir: 'V', gap: 8 });
        const inst = comp.createInstance();
        cell.appendChild(inst);
        unlockSizing(inst);
        cell.appendChild(await mkText(`${ref.name} · ${ref.count}× ${ref.remote ? '· library' : ''}`, { size: 10, color: MUTED }));
        stage.appendChild(cell);
        placed++;
      } catch { /* remote or unavailable */ }
    }
    if (!placed) section.remove(); else finishSection(section, cursor);
  }
  return { page, sets, comps };
}

// ---------------------------------------------------------------- icons page

export async function buildIcons(inv: Inventory, opts: BuildOptions, notes: string[]): Promise<{ page: PageNode; count: number }> {
  const page = await getOrCreatePage('DS · Icons');
  const cursor = { y: 0 };
  const seen = new Set<string>();
  const picks: ElementRec[] = [];
  for (const r of inv.icons) {
    if (r.inInstance || r.artworkRole==='part' || seen.has(appearanceKey(r))) continue;
    seen.add(appearanceKey(r));
    picks.push(r);
    if (picks.length >= 240) break;
  }
  if (!picks.length) return { page, count: 0 };

  const { section, body } = await mkSection('Icons', `${inv.icons.length} icon-like vectors found · ${picks.length} unique, each promoted to a component on a square frame.`, page, cursor);
  const grid = mkFrame('grid', { dir: 'H', gap: 20, wrap: true, w: 1160 });
  body.appendChild(grid);
  const usedNames = new Set<string>();
  let count = 0;
  for (let i = 0; i < picks.length; i++) {
    if (cancelled) throw new Error('cancelled');
    const rec = picks[i];
    const src = await nodeById(rec.id);
    if (!src) continue;
    let clone: SceneNode;
    try { clone = src.clone(); } catch { continue; }
    try {
      const size = Math.max(16, Math.ceil(Math.max(clone.width, clone.height) / 4) * 4);
      const cell = mkFrame(rec.name, { dir:'V', pad:12, gap:6, align:'CENTER', fill:{r:0.82,g:0.82,b:0.82} });
      grid.appendChild(cell);
      const box = figma.createFrame();
      box.resize(size, size);
      box.fills = [];
      box.clipsContent = false;
      cell.appendChild(box);
      box.appendChild(clone);
      unlockSizing(clone);
      clone.x = (size - clone.width) / 2;
      clone.y = (size - clone.height) / 2;
      const comp = figma.createComponentFromNode(box);
      let name = `${opts.prefix}icon/${slug(sheetName(rec, opts.prefix))}`;
      let n = 2;
      while (usedNames.has(name)) name = `${opts.prefix}icon/${slug(sheetName(rec, opts.prefix))}-${n++}`;
      usedNames.add(name);
      comp.name = name;
      comp.description = `${size}×${size} · from page "${rec.page}"`;
      comp.setPluginData(PD_GENERATED, '1');
      const caption=await mkText(sheetName(rec, opts.prefix), { size: 9, color: MUTED }); cell.appendChild(caption);
      linkSheetCell(cell,inv.icons.filter(r=>appearanceKey(r)===appearanceKey(rec)).map(r=>r.id),caption,rec.category,opts.prefix);
      count++;
    } catch {
      try { clone.remove(); } catch { /* ignore */ }
    }
    if (i % 25 === 0) { progress(75 + (i / picks.length) * 15, `Icons… ${i}/${picks.length}`); await tick(); }
  }
  finishSection(section, cursor);
  return { page, count };
}


// ---------------------------------------------------------------- assets contact sheet

const ASSET_SECTIONS: { key: string; title: string; cats: Category[]; cap: number; kind: 'vector' | 'text' | 'list' }[] = [
  { key: 'parts', title: 'Artwork parts', cats: [], cap: 120, kind: 'vector' },
  { key: 'logos', title: 'Logos', cats: ['logo'], cap: 40, kind: 'vector' },
  { key: 'characters', title: 'Characters', cats: ['character'], cap: 60, kind: 'vector' },
  { key: 'illustrations', title: 'Illustrations', cats: ['illustration'], cap: 60, kind: 'vector' },
  { key: 'symbols', title: 'Symbols & ornaments', cats: ['symbol'], cap: 80, kind: 'vector' },
  { key: 'icons', title: 'Icons', cats: ['icon'], cap: 240, kind: 'vector' },
  { key: 'components', title: 'Components', cats: ['button', 'badge', 'input', 'checkbox', 'toggle', 'card', 'list-item', 'nav', 'other'], cap: 120, kind: 'vector' },
  { key: 'taglines', title: 'Taglines', cats: ['tagline'], cap: 80, kind: 'text' },
  { key: 'copy', title: 'Copy', cats: ['copy'], cap: 40, kind: 'text' },
  { key: 'vectors', title: 'Vectors & shapes', cats: ['shape'], cap: 120, kind: 'vector' },
  { key: 'debris', title: 'Possible vector debris', cats: ['debris'], cap: 300, kind: 'vector' },
];

function stripPrefix(name: string, prefix: string): string {
  return prefix && name.startsWith(prefix) ? name.slice(prefix.length) : name;
}

export async function buildAssets(inv: Inventory, opts: BuildOptions, notes: string[]): Promise<{ page: PageNode; count: number }> {
  const builtAt=new Date().toISOString();
  const buildLabel=`Updated ${builtAt.slice(0,10)} ${builtAt.slice(11,19)} UTC · v${PLUGIN_VERSION}`;
  const page = await getOrCreatePage('DS · Assets');
  const cursor = { y: 0 };
  let count = 0;
  const pool: ElementRec[] = [...inv.elements, ...inv.icons, ...inv.shapes].filter((r) => !r.inInstance || r.nodeType === 'INSTANCE'||r.category==='character'&&r.artworkRole!=='part'&&!!r.semanticName);

  // the category a node has *now*: AI naming may have reclassified it (plugin data wins over the heuristic)
  const resolved: { rec: ElementRec; node: SceneNode; cat: Category }[] = [];
  for (let i = 0; i < pool.length; i++) {
    if (cancelled) throw new Error('cancelled');
    const rec = pool[i];
    const node = await nodeById(rec.id);
    if (!node) continue;
    const audit=auditedAssetCategory(rec,node);
    if(audit.reason){notes.push(`Logo audit: moved ${rec.semanticName||rec.name} (${rec.id}) to ${audit.category}: ${audit.reason}.`);rec.category=audit.category;}
    resolved.push({ rec, node, cat: audit.category });
    if (i % 300 === 0) { progress(80 + (i / pool.length) * 6, `Sorting assets… ${i}/${pool.length}`); await tick(); }
  }

  const intro = await mkSection('Assets', `Build: approved-logos-4. Final logo output checks applied. Every logo, character, illustration, symbol, icon, button, tagline, copy block and vector in the scanned scope, grouped by class and named. Possible debris is shown for review; source artwork is retained. Unrecognized artwork is marked Needs identification.`, page, cursor);
  intro.section.name = `Assets · index · ${buildLabel}`;
  intro.section.setPluginData('dsf.builtAt',builtAt);
  intro.section.setPluginData('dsf.buildVersion',PLUGIN_VERSION);
  const idx = mkFrame('index', { dir: 'H', gap: 24, wrap: true, w: 1160 });
  for (const sec of ASSET_SECTIONS) {
    const n = resolved.filter((r) => (sec.key==='parts'?r.rec.artworkRole==='part':r.rec.artworkRole!=='part'&&sec.cats.includes(r.cat))).length;
    idx.appendChild(await mkText(`${sec.title} · ${n}`, { size: 12, color: n ? INK : MUTED }));
  }
  intro.body.appendChild(idx);
  finishSection(intro.section, cursor);

  for (const sec of ASSET_SECTIONS) {
    if (cancelled) throw new Error('cancelled');
    let items = resolved.filter((r) => (sec.key==='parts'?r.rec.artworkRole==='part':r.rec.artworkRole!=='part'&&sec.cats.includes(r.cat)));
    if (!items.length) continue;
    // one of each distinct thing; identical layers collapse to a single cell with a count
    const seen = new Map<string, { rec: ElementRec; node: SceneNode; cat: Category; n: number; ids:string[] }>();
    for (const it of items) {
      const k = sec.kind === 'text' ? `${it.cat}|${it.rec.text.slice(0, 80)}` : `${it.cat}|${sheetName(it.rec, opts.prefix)}|${appearanceKey(it.rec)}`;
      const g = seen.get(k);
      if (g) {g.n++;g.ids.push(it.rec.id);} else seen.set(k, { ...it, n: 1,ids:[it.rec.id] });
    }
    const distinct = [...seen.values()].sort((a, b) => a.node.name.localeCompare(b.node.name)).slice(0, sec.cap);
    progress(86, `Assets · ${sec.title}…`);
    await tick();

    const { section, body } = await mkSection(sec.title, `${items.length} found · ${distinct.length} distinct${items.length > sec.cap ? ` · showing ${sec.cap}` : ''}\n${buildLabel}`, page, cursor);
    section.name = `Assets · ${sec.title} · ${buildLabel}`;
    section.setPluginData('dsf.builtAt',builtAt);
    section.setPluginData('dsf.buildVersion',PLUGIN_VERSION);

    if (sec.kind === 'list') {
      const col = mkFrame('list', { dir: 'V', gap: 4 });
      for (const d of distinct) {
        col.appendChild(await mkText(`${sheetName(d.rec, opts.prefix)} · ${Math.round(d.rec.w)}×${Math.round(d.rec.h)} · ${d.rec.page}${d.n > 1 ? ` · ×${d.n}` : ''}`, { size: 10, color: MUTED }));
      }
      body.appendChild(col);
      body.appendChild(await mkText('Tip: in the plugin\'s Elements tab, "Select debris" selects these on the current page so you can delete them.', { size: 10, color: MUTED }));
      finishSection(section, cursor);
      continue;
    }

    const grid = mkFrame('grid', { dir: 'H', gap: 24, wrap: true, w: 1160, align: 'MIN' });
    body.appendChild(grid);
    if (sec.key === 'debris') body.appendChild(await mkText('Possible debris · inspect before deleting. Hidden and empty paths may have no visible preview.', {size:10,color:MUTED}));
    for (const d of distinct) {
      let clone: SceneNode;
      try { clone = d.node.clone(); } catch { notes.push(`Could not copy ${d.node.name} (${d.node.id}) to its contact sheet.`); continue; }
      try {
        const cell = mkFrame(sheetName(d.rec, opts.prefix), { dir: 'V', pad:12, gap:8, align:'MIN', fill:{r:0.82,g:0.82,b:0.82} });
        grid.appendChild(cell);
        if (sec.kind === 'text') {
          cell.appendChild(clone);
          unlockSizing(clone);
          const t = clone as TextNode;
          try { if (t.width > 320) { t.textAutoResize = 'HEIGHT'; t.resize(320, t.height); } } catch { /* ignore */ }
        } else {
          const w = Math.max(24, Math.ceil(clone.width)), h = Math.max(24, Math.ceil(clone.height));
          const box = figma.createFrame();
          box.resize(Math.min(w, 480), Math.min(h, 480));
          box.fills = [];
          box.clipsContent = w > 480 || h > 480;
          cell.appendChild(box);
          box.appendChild(clone);
          unlockSizing(clone);
          fitArtworkPreview(d.node, clone, box);
          // vector-class assets become components so they can be reused; buttons stay as-is (they get variant sets on the Components page)
          if (['logos', 'characters', 'illustrations', 'symbols', 'icons', 'vectors'].includes(sec.key)) {
            const comp = figma.createComponentFromNode(box);
            comp.name = `${opts.prefix}${d.cat}/${slug(sheetName(d.rec, opts.prefix), 80)}`;
            comp.description = `${d.cat} · ${Math.round(d.rec.w)}×${Math.round(d.rec.h)} · from "${d.rec.page}"`;
            comp.setPluginData(PD_GENERATED, '1');
          }
        }
        const caption=await mkText(sheetName(d.rec, opts.prefix), { bold: true, size: 10 });cell.appendChild(caption);
        linkSheetCell(cell,d.ids,caption,d.cat,opts.prefix);
        cell.appendChild(await mkText(`${Math.round(d.rec.w)}×${Math.round(d.rec.h)}${d.n > 1 ? ` · ×${d.n}` : ''}`, { size: 9, color: MUTED }));
        count++;
      } catch (e) {
        notes.push(`Could not place ${d.node.name} (${d.node.id}): ${String(e)}`);
        try { clone.remove(); } catch { /* ignore */ }
      }
    }
    finishSection(section, cursor);
  }
  if (!count) notes.push('No assets were found for the contact sheet.');
  return { page, count };
}

// ---------------------------------------------------------------- tidy

export async function tidyScreens(inv: Inventory): Promise<number> {
  let moved = 0;
  for (const pid of inv.pageIds) {
    const page = (await figma.getNodeByIdAsync(pid)) as PageNode | null;
    if (!page) continue;
    await page.loadAsync();
    const frames = page.children.filter((c) => (c.type === 'FRAME' || c.type === 'COMPONENT' || c.type === 'COMPONENT_SET') && c.getPluginData(PD_GENERATED) !== '1' && !c.locked) as SceneNode[];
    if (frames.length < 2) continue;
    const cls = (w: number) => (w < 520 ? 0 : w < 1024 ? 1 : 2);
    const groups: SceneNode[][] = [[], [], []];
    for (const f of frames) groups[cls(f.width)].push(f);
    let y = Math.min(...frames.map((f) => f.y));
    const x0 = Math.min(...frames.map((f) => f.x));
    for (const g of groups) {
      if (!g.length) continue;
      g.sort((a, b) => a.name.localeCompare(b.name));
      let x = x0, rowH = 0;
      for (const f of g) {
        if (x - x0 + f.width > 6000 && x > x0) { x = x0; y += rowH + 160; rowH = 0; }
        f.x = x; f.y = y;
        x += f.width + 120;
        rowH = Math.max(rowH, f.height);
        moved++;
      }
      y += rowH + 240;
    }
    await tick();
  }
  return moved;
}

// ---------------------------------------------------------------- orchestrator

export async function build(inv: Inventory, opts: BuildOptions): Promise<BuildResult> {
  const notes: string[] = [];
  const res: Omit<BuildResult, 'files'> = { paintStyles: 0, textStyles: 0, effectStyles: 0, variables: 0, labeled: 0, componentSets: 0, components: 0, icons: 0, assets: 0, pages: [], notes };

  await refreshIdentifications(inv);
  if (!inv.elements.length && !inv.icons.length && !inv.shapes.length) throw new Error('No source artwork in this scan. Select the original design page or use Document scope, then scan again.');
  await loadFont(UI_FONT);
  await loadFont(UI_BOLD);

  if (opts.labels) {
    progress(5, 'Labelling layers…');
    res.labeled = await applyLabels(inv, opts);
  }

  let vars: VarMaps | null = null;
  if (opts.variables) {
    progress(18, 'Creating variables…');
    await tick();
    vars = await buildVariables(inv, opts, notes);
    res.variables = vars?.count || 0;
  }

  let styles: StyleMaps | null = null;
  if (opts.styles) {
    progress(28, 'Creating styles…');
    await tick();
    styles = await buildStyles(inv, opts, vars, notes);
    res.paintStyles = styles.paint.size;
    res.textStyles = styles.text.size;
    res.effectStyles = styles.effect.size;
  }

  let firstPage: PageNode | null = null;
  if (opts.foundations) {
    progress(40, 'Drawing foundations page…');
    await tick();
    const p = await buildFoundations(inv, opts, styles, notes);
    res.pages.push(p.name); firstPage = firstPage || p;
  }
  if (opts.components) {
    progress(58, 'Building components…');
    await tick();
    const r = await buildComponents(inv, opts, notes);
    res.componentSets = r.sets; res.components = r.comps;
    res.pages.push(r.page.name); firstPage = firstPage || r.page;
  }
  if (opts.icons) {
    progress(74, 'Building icons…');
    await tick();
    const r = await buildIcons(inv, opts, notes);
    res.icons = r.count;
    if (r.count) res.pages.push(r.page.name); else { try { if (r.page.children.length === 0) r.page.remove(); } catch { /* ignore */ } }
    firstPage = firstPage || (r.count ? r.page : null);
  }
  if (opts.assets) {
    progress(80, 'Building assets contact sheet…');
    await tick();
    const r = await buildAssets(inv, opts, notes);
    res.assets = r.count;
    if (r.count) res.pages.push(r.page.name); else { try { if (r.page.children.length === 0) r.page.remove(); } catch { /* ignore */ } }
    firstPage = firstPage || (r.count ? r.page : null);
  }
  if (opts.tidy) {
    progress(92, 'Tidying screens…');
    await tick();
    const moved = await tidyScreens(inv);
    notes.push(`${moved} top-level frames arranged by device width.`);
  }

  progress(96, 'Writing token files…');
  await tick();
  const files = buildTokenFiles(inv, opts, res);

  if (firstPage) { try { await figma.setCurrentPageAsync(firstPage); figma.viewport.scrollAndZoomIntoView(firstPage.children); } catch { /* ignore */ } }
  progress(100, 'Done');
  return { ...res, files };
}
import {fitArtworkPreview} from './artwork-preview';
