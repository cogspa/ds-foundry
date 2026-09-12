This file is a merged representation of a subset of the codebase, containing files not matching ignore patterns, combined into a single document by Repomix.

# File Summary

## Purpose
This file contains a packed representation of a subset of the repository's contents that is considered the most important context.
It is designed to be easily consumable by AI systems for analysis, code review,
or other automated processes.

## File Format
The content is organized as follows:
1. This summary section
2. Repository information
3. Directory structure
4. Repository files (if enabled)
5. Multiple file entries, each consisting of:
  a. A header with the file path (## File: path/to/file)
  b. The full contents of the file in a code block

## Usage Guidelines
- This file should be treated as read-only. Any changes should be made to the
  original repository files, not this packed version.
- When processing this file, use the file path to distinguish
  between different files in the repository.
- Be aware that this file may contain sensitive information. Handle it with
  the same level of security as you would the original repository.

## Notes
- Some files may have been excluded based on .gitignore rules and Repomix's configuration
- Binary files are not included in this packed representation. Please refer to the Repository Structure section for a complete list of file paths, including binary files
- Files matching these patterns are excluded: **/dist/**, **/server.pid, **/server.log
- Files matching patterns in .gitignore are excluded
- Files matching default ignore patterns are excluded
- Files are sorted by Git change count (files with more changes are at the bottom)

# Directory Structure
```
ds-foundry/
  src/
    ai.ts
    build.ts
    classify.ts
    code.ts
    naming.ts
    scan.ts
    tokens.ts
    types.ts
    util.ts
  tools/
    copy-ui.mjs
  ui/
    ui.html
  .gitignore
  CHANGELOG.md
  IDE_PROMPT.md
  manifest.json
  package.json
  README.md
  tsconfig.json
ds-foundry-server/
  app/
    glossary.py
    graph.py
    main.py
    prompts.py
    providers.py
    schemas.py
  tests/
    test_graph.py
  .env.example
  .gitignore
  CHANGELOG.md
  IDE_PROMPT.md
  README.md
  requirements.txt
  run.sh
.gitignore
install-ds-foundry.sh
README.md
```

# Files

## File: ds-foundry/src/ai.ts
````typescript
import { Inventory, ElementRec, Category } from './types';
import { PD_ORIGINAL, PD_CATEGORY, post, tick, cancelled, slug } from './util';

export interface AiTargets { icons: boolean; art: boolean; images: boolean; screens: boolean; cards: boolean; components: boolean; text: boolean; shapes: boolean; }

export interface AiItem {
  key: string;          // fingerprint or node id
  ids: string[];        // every node that shares this fingerprint
  category: string;     // heuristic class: icon | symbol | logo | illustration | image | avatar | screen | section | nav | card | list-item | component | tagline | copy | shape
  name: string;         // current name
  desc: string;         // geometry description for shapes
  text: string;         // text content found inside
  w: number; h: number;
  page: string;
  png: Uint8Array;
}

export type Provider = 'anthropic' | 'gemini' | 'proxy' | 'proxyUrl';
const KEY_STORAGE: Record<Provider, string> = { anthropic: 'dsf.anthropicKey', gemini: 'dsf.geminiKey', proxy: 'dsf.proxyKey', proxyUrl: 'dsf.proxyUrl' };

export async function getApiKeys(): Promise<Record<Provider, string>> {
  const out: Record<Provider, string> = { anthropic: '', gemini: '', proxy: '', proxyUrl: '' };
  for (const k of Object.keys(KEY_STORAGE) as Provider[]) {
    try { out[k] = (await figma.clientStorage.getAsync(KEY_STORAGE[k])) || ''; } catch { /* ignore */ }
  }
  return out;
}
export async function setApiKey(provider: Provider, key: string): Promise<void> {
  const slot = KEY_STORAGE[provider];
  if (!slot) return;
  try { await figma.clientStorage.setAsync(slot, key || ''); } catch { /* ignore */ }
}

function pickDistinct(list: ElementRec[], limit: number): { rec: ElementRec; ids: string[] }[] {
  const groups = new Map<string, { rec: ElementRec; ids: string[] }>();
  for (const r of list) {
    if (r.inInstance) continue;
    const g = groups.get(r.fingerprint);
    if (g) g.ids.push(r.id);
    else groups.set(r.fingerprint, { rec: r, ids: [r.id] });
  }
  return [...groups.values()].slice(0, limit);
}

async function exportPng(node: SceneNode, target: number): Promise<Uint8Array | null> {
  try {
    if (node.width < 1 || node.height < 1) return null;
    const constraint: ExportSettingsConstraints = node.width >= node.height ? { type: 'WIDTH', value: target } : { type: 'HEIGHT', value: target };
    return await (node as ExportMixin).exportAsync({ format: 'PNG', constraint, useAbsoluteBounds: true });
  } catch { return null; }
}

/** Collect candidates, export thumbnails, stream them to the UI in chunks. */
export async function prepareAiItems(inv: Inventory, targets: AiTargets, maxItems: number): Promise<number> {
  const plan: { rec: ElementRec | null; ids: string[]; category: string; name: string; text: string; page: string; size: number; nodeId: string }[] = [];
  const cap = (n: number) => Math.max(0, Math.min(n, maxItems - plan.length));

  if (targets.icons) {
    for (const g of pickDistinct(inv.icons, cap(400))) plan.push({ rec: g.rec, ids: g.ids, category: 'icon', name: g.rec.name, text: '', page: g.rec.page, size: 256, nodeId: g.rec.id });
    for (const g of pickDistinct(inv.elements.filter((e) => e.category === 'symbol'), cap(200))) plan.push({ rec: g.rec, ids: g.ids, category: 'symbol', name: g.rec.name, text: '', page: g.rec.page, size: 320, nodeId: g.rec.id });
  }
  if (targets.art) for (const g of pickDistinct(inv.elements.filter((e) => e.category === 'logo' || e.category === 'character' || e.category === 'illustration'), cap(200))) plan.push({ rec: g.rec, ids: g.ids, category: g.rec.category, name: g.rec.name, text: g.rec.text, page: g.rec.page, size: 384, nodeId: g.rec.id });
  if (targets.text) for (const g of pickDistinct(inv.elements.filter((e) => e.category === 'tagline' || e.category === 'copy'), cap(200))) plan.push({ rec: g.rec, ids: g.ids, category: g.rec.category, name: g.rec.name, text: g.rec.text, page: g.rec.page, size: 320, nodeId: g.rec.id });
  if (targets.images) for (const g of pickDistinct(inv.elements.filter((e) => e.category === 'image' || e.category === 'avatar'), cap(200))) plan.push({ rec: g.rec, ids: g.ids, category: g.rec.category, name: g.rec.name, text: '', page: g.rec.page, size: 384, nodeId: g.rec.id });
  if (targets.screens) for (const g of pickDistinct(inv.elements.filter((e) => e.category === 'screen' || e.category === 'section' || e.category === 'nav'), cap(200))) plan.push({ rec: g.rec, ids: g.ids, category: g.rec.category, name: g.rec.name, text: g.rec.text, page: g.rec.page, size: 384, nodeId: g.rec.id });
  if (targets.cards) for (const g of pickDistinct(inv.elements.filter((e) => e.category === 'card' || e.category === 'list-item'), cap(200))) plan.push({ rec: g.rec, ids: g.ids, category: g.rec.category, name: g.rec.name, text: g.rec.text, page: g.rec.page, size: 384, nodeId: g.rec.id });
  if (targets.components) {
    for (const c of inv.components.filter((x) => !x.remote).slice(0, cap(200))) {
      plan.push({ rec: null, ids: [c.id], category: 'component', name: c.name, text: '', page: '', size: 384, nodeId: c.id });
    }
  }
  if (targets.shapes) for (const g of pickDistinct(inv.shapes, cap(200))) plan.push({ rec: g.rec, ids: g.ids, category: 'shape', name: g.rec.name, text: '', page: g.rec.page, size: 256, nodeId: g.rec.id });

  let chunk: AiItem[] = [];
  let sent = 0;
  for (let i = 0; i < plan.length; i++) {
    if (cancelled) throw new Error('cancelled');
    const p = plan[i];
    let node: SceneNode | null = null;
    try {
      const n = await figma.getNodeByIdAsync(p.nodeId);
      if (n && !n.removed && n.type !== 'DOCUMENT' && n.type !== 'PAGE') node = n as SceneNode;
    } catch { node = null; }
    if (!node) continue;
    // component sets export their default variant
    const exportNode: SceneNode = node.type === 'COMPONENT_SET' ? (node as ComponentSetNode).defaultVariant : node;
    const png = await exportPng(exportNode, p.size);
    if (!png) continue;
    chunk.push({ key: p.rec ? p.rec.fingerprint : p.nodeId, ids: p.ids, category: p.category, name: p.name, desc: p.rec ? p.rec.desc : '', text: p.text, w: Math.round(node.width), h: Math.round(node.height), page: p.page, png });
    sent++;
    if (chunk.length >= 6 || i === plan.length - 1) {
      post({ type: 'ai_items', items: chunk, sent, total: plan.length });
      chunk = [];
      await tick();
    }
  }
  post({ type: 'ai_items', items: [], sent, total: plan.length, done: true });
  return sent;
}

const PATH_FOR: Record<string, string> = {
  icon: 'icon', symbol: 'symbol', logo: 'logo', character: 'character', illustration: 'illustration', image: 'image', avatar: 'avatar',
  screen: 'screen', section: 'section', nav: 'nav', card: 'card', 'list-item': 'list-item', button: 'button', badge: 'badge',
  tagline: 'tagline', copy: 'copy', shape: 'shape', debris: 'debris', component: '',
};

/** Apply names chosen in the UI. Returns number of renamed layers. */
export async function applyAiNames(renames: { ids: string[]; name: string; category: string; kind?: string }[], prefix: string, usePrefix: boolean): Promise<number> {
  let n = 0;
  for (let i = 0; i < renames.length; i++) {
    if (cancelled) throw new Error('cancelled');
    const r = renames[i];
    const clean = slug(r.name, 40);
    if (!clean) continue;
    // the model may reclassify (a "symbol" that is really a logo, an "illustration" that is a character)
    const cat = r.kind && PATH_FOR[r.kind] !== undefined ? r.kind : r.category;
    const path = PATH_FOR[cat] ?? cat;
    const finalName = usePrefix ? `${prefix}${path ? path + '/' : ''}${clean}` : clean;
    for (const id of r.ids) {
      try {
        const node = await figma.getNodeByIdAsync(id);
        if (!node || node.removed || node.type === 'DOCUMENT' || node.type === 'PAGE') continue;
        // never rename a variant inside a component set — that would rewrite its properties
        if (node.type === 'COMPONENT' && node.parent && node.parent.type === 'COMPONENT_SET') continue;
        if (!node.getPluginData(PD_ORIGINAL)) node.setPluginData(PD_ORIGINAL, node.name);
        node.setPluginData(PD_CATEGORY, cat as Category);
        node.name = finalName;
        n++;
      } catch { /* locked / read-only */ }
    }
    if (i % 25 === 0) { post({ type: 'progress', pct: Math.round((i / renames.length) * 100), msg: `Renaming… ${i}/${renames.length}` }); await tick(); }
  }
  return n;
}
````

## File: ds-foundry/src/build.ts
````typescript
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
      node.setPluginData(PD_CATEGORY, rec.category);
      if (opts.rename && !node.name.startsWith(opts.prefix)) node.name = elementLabel(rec, opts.prefix);
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
      if (seen.has(r.fingerprint)) continue;
      seen.add(r.fingerprint);
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
        const comp = figma.createComponentFromNode(clone);
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
    if (r.inInstance || seen.has(r.fingerprint)) continue;
    seen.add(r.fingerprint);
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
      const cell = mkFrame(rec.name, { dir: 'V', gap: 6, align: 'CENTER' });
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
      let name = `${opts.prefix}icon/${slug(rec.name)}`;
      let n = 2;
      while (usedNames.has(name)) name = `${opts.prefix}icon/${slug(rec.name)}-${n++}`;
      usedNames.add(name);
      comp.name = name;
      comp.description = `${size}×${size} · from page "${rec.page}"`;
      comp.setPluginData(PD_GENERATED, '1');
      cell.appendChild(await mkText(slug(rec.name).slice(0, 18), { size: 9, color: MUTED }));
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
  { key: 'logos', title: 'Logos', cats: ['logo'], cap: 40, kind: 'vector' },
  { key: 'characters', title: 'Characters', cats: ['character'], cap: 60, kind: 'vector' },
  { key: 'illustrations', title: 'Illustrations', cats: ['illustration'], cap: 60, kind: 'vector' },
  { key: 'symbols', title: 'Symbols & ornaments', cats: ['symbol'], cap: 80, kind: 'vector' },
  { key: 'icons', title: 'Icons', cats: ['icon'], cap: 240, kind: 'vector' },
  { key: 'buttons', title: 'Buttons & badges', cats: ['button', 'badge'], cap: 40, kind: 'vector' },
  { key: 'taglines', title: 'Taglines', cats: ['tagline'], cap: 80, kind: 'text' },
  { key: 'copy', title: 'Copy', cats: ['copy'], cap: 40, kind: 'text' },
  { key: 'vectors', title: 'Vectors & shapes', cats: ['shape'], cap: 120, kind: 'vector' },
  { key: 'debris', title: 'Debris', cats: ['debris'], cap: 300, kind: 'list' },
];

function stripPrefix(name: string, prefix: string): string {
  return prefix && name.startsWith(prefix) ? name.slice(prefix.length) : name;
}

export async function buildAssets(inv: Inventory, opts: BuildOptions, notes: string[]): Promise<{ page: PageNode; count: number }> {
  const page = await getOrCreatePage('DS · Assets');
  const cursor = { y: 0 };
  let count = 0;
  const pool: ElementRec[] = [...inv.elements, ...inv.icons, ...inv.shapes].filter((r) => !r.inInstance);

  // the category a node has *now*: AI naming may have reclassified it (plugin data wins over the heuristic)
  const resolved: { rec: ElementRec; node: SceneNode; cat: Category }[] = [];
  for (let i = 0; i < pool.length; i++) {
    if (cancelled) throw new Error('cancelled');
    const rec = pool[i];
    const node = await nodeById(rec.id);
    if (!node) continue;
    const pd = node.getPluginData(PD_CATEGORY) as Category | '';
    resolved.push({ rec, node, cat: pd || rec.category });
    if (i % 300 === 0) { progress(80 + (i / pool.length) * 6, `Sorting assets… ${i}/${pool.length}`); await tick(); }
  }

  const intro = await mkSection('Assets', `Every logo, character, illustration, symbol, icon, button, tagline, copy block and vector in the scanned scope, grouped by class and named. Debris is listed so it can be selected and deleted from the plugin.`, page, cursor);
  intro.section.name = 'Assets · index';
  const idx = mkFrame('index', { dir: 'H', gap: 24, wrap: true, w: 1160 });
  for (const sec of ASSET_SECTIONS) {
    const n = resolved.filter((r) => sec.cats.includes(r.cat)).length;
    idx.appendChild(await mkText(`${sec.title} · ${n}`, { size: 12, color: n ? INK : MUTED }));
  }
  intro.body.appendChild(idx);
  finishSection(intro.section, cursor);

  for (const sec of ASSET_SECTIONS) {
    if (cancelled) throw new Error('cancelled');
    let items = resolved.filter((r) => sec.cats.includes(r.cat));
    if (!items.length) continue;
    // one of each distinct thing; identical layers collapse to a single cell with a count
    const seen = new Map<string, { rec: ElementRec; node: SceneNode; cat: Category; n: number }>();
    for (const it of items) {
      const k = sec.kind === 'text' ? `${it.cat}|${it.rec.text.slice(0, 80)}` : `${it.cat}|${it.node.name}|${it.rec.fingerprint}`;
      const g = seen.get(k);
      if (g) g.n++; else seen.set(k, { ...it, n: 1 });
    }
    const distinct = [...seen.values()].sort((a, b) => a.node.name.localeCompare(b.node.name)).slice(0, sec.cap);
    progress(86, `Assets · ${sec.title}…`);
    await tick();

    const { section, body } = await mkSection(sec.title, `${items.length} found · ${distinct.length} distinct${items.length > sec.cap ? ` · showing ${sec.cap}` : ''}`, page, cursor);
    section.name = `Assets · ${sec.title}`;

    if (sec.kind === 'list') {
      const col = mkFrame('list', { dir: 'V', gap: 4 });
      for (const d of distinct) {
        col.appendChild(await mkText(`${stripPrefix(d.node.name, opts.prefix)} · ${Math.round(d.rec.w)}×${Math.round(d.rec.h)} · ${d.rec.page}${d.n > 1 ? ` · ×${d.n}` : ''}`, { size: 10, color: MUTED }));
      }
      body.appendChild(col);
      body.appendChild(await mkText('Tip: in the plugin\'s Elements tab, "Select debris" selects these on the current page so you can delete them.', { size: 10, color: MUTED }));
      finishSection(section, cursor);
      continue;
    }

    const grid = mkFrame('grid', { dir: 'H', gap: 24, wrap: true, w: 1160, align: 'MIN' });
    body.appendChild(grid);
    for (const d of distinct) {
      let clone: SceneNode;
      try { clone = d.node.clone(); } catch { continue; }
      try {
        const cell = mkFrame(stripPrefix(d.node.name, opts.prefix), { dir: 'V', gap: 8, align: 'MIN' });
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
          if (w > 480 || h > 480) { const sc = Math.min(480 / w, 480 / h); try { (clone as any).rescale(sc); } catch { /* ignore */ } }
          clone.x = 0; clone.y = 0;
          // vector-class assets become components so they can be reused; buttons stay as-is (they get variant sets on the Components page)
          if (['logos', 'characters', 'illustrations', 'symbols', 'icons', 'vectors'].includes(sec.key)) {
            const comp = figma.createComponentFromNode(box);
            comp.name = d.node.name.startsWith(opts.prefix) ? d.node.name : `${opts.prefix}${d.cat}/${slug(d.node.name)}`;
            comp.description = `${d.cat} · ${Math.round(d.rec.w)}×${Math.round(d.rec.h)} · from "${d.rec.page}"`;
            comp.setPluginData(PD_GENERATED, '1');
          }
        }
        cell.appendChild(await mkText(stripPrefix(d.node.name, opts.prefix), { bold: true, size: 10 }));
        cell.appendChild(await mkText(`${Math.round(d.rec.w)}×${Math.round(d.rec.h)}${d.n > 1 ? ` · ×${d.n}` : ''}`, { size: 9, color: MUTED }));
        count++;
      } catch {
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
````

## File: ds-foundry/src/classify.ts
````typescript
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
````

## File: ds-foundry/src/code.ts
````typescript
import { Inventory, InventorySummary, BuildOptions, Scope } from './types';
import { scan } from './scan';
import { build, revertLabels } from './build';
import { elementLabel } from './naming';
import { post, setCancelled, rgbaCss, round } from './util';
import { prepareAiItems, applyAiNames, getApiKeys, setApiKey } from './ai';

figma.showUI(__html__, { width: 440, height: 680, themeColors: true });

let inventory: Inventory | null = null;
let busy = false;

function summarize(inv: Inventory, prefix: string): InventorySummary {
  const elements: InventorySummary['elements'] = {};
  for (const e of inv.elements) {
    const slot = (elements[e.category] = elements[e.category] || { count: 0, samples: [] });
    slot.count++;
    if (slot.samples.length < 6) {
      const label = elementLabel(e, prefix);
      if (!slot.samples.includes(label)) slot.samples.push(label);
    }
  }
  const iconSamples: string[] = [];
  for (const i of inv.icons) { const l = elementLabel(i, prefix); if (iconSamples.length < 8 && !iconSamples.includes(l)) iconSamples.push(l); }
  return {
    scope: inv.scope,
    pages: inv.pages,
    nodeCount: inv.nodeCount,
    colors: inv.colors.map((c) => ({ hex: rgbaCss(c.r, c.g, c.b, c.a), a: c.a, name: c.name, count: c.count, role: c.role })),
    types: inv.types.map((t) => ({ name: t.name, family: t.family, style: t.style, size: round(t.size), count: t.count })),
    spacing: inv.spacing.map((s) => ({ name: s.name, value: s.value, count: s.count })),
    radii: inv.radii.map((r) => ({ name: r.name, value: r.value, count: r.count })),
    effects: inv.effects.map((e) => ({ name: e.name, css: e.css, count: e.count })),
    elements,
    icons: { count: inv.icons.length, samples: iconSamples },
    shapes: { count: inv.shapes.length, samples: inv.shapes.slice(0, 8).map((r) => elementLabel(r, prefix)) },
    debris: inv.elements.filter((e) => e.category === 'debris').length,
    components: inv.components.slice(0, 40).map((c) => ({ name: c.name, remote: c.remote, count: c.count })),
    fonts: inv.fonts.map((f) => `${f.family} ${f.style}`),
    missingFonts: inv.missingFonts,
  };
}

figma.ui.onmessage = async (msg: { type: string; [k: string]: any }) => {
  try {
    if (msg.type === 'cancel') { setCancelled(true); return; }

    if (msg.type === 'scan') {
      if (busy) return;
      busy = true; setCancelled(false);
      const scope: Scope = msg.scope;
      if (scope === 'selection' && figma.currentPage.selection.length === 0) {
        post({ type: 'error', msg: 'Select one or more frames first, or switch the scope to Page or Document.' });
        busy = false; return;
      }
      post({ type: 'progress', pct: 2, msg: 'Loading pages…' });
      inventory = await scan(scope, msg.baseGrid || 4);
      post({ type: 'scanned', summary: summarize(inventory, msg.prefix || 'ds/') });
      busy = false; return;
    }

    if (msg.type === 'relabel') {
      if (inventory) post({ type: 'scanned', summary: summarize(inventory, msg.prefix || 'ds/') });
      return;
    }

    if (msg.type === 'build') {
      if (busy) return;
      if (!inventory) { post({ type: 'error', msg: 'Scan the file first.' }); return; }
      busy = true; setCancelled(false);
      const opts: BuildOptions = msg.options;
      const result = await build(inventory, opts);
      post({ type: 'built', result });
      figma.notify(`DS Foundry: ${result.paintStyles + result.textStyles + result.effectStyles} styles · ${result.variables} variables · ${result.componentSets} component sets · ${result.icons} icons`);
      busy = false; return;
    }

    if (msg.type === 'revert') {
      if (busy) return;
      busy = true;
      const n = await revertLabels();
      post({ type: 'reverted', count: n });
      figma.notify(`Restored ${n} layer names`);
      busy = false; return;
    }

    if (msg.type === 'ai_key_get') { post({ type: 'ai_keys', keys: await getApiKeys() }); return; }
    if (msg.type === 'ai_key_set') { await setApiKey(msg.provider, msg.key || ''); return; }

    if (msg.type === 'ai_prepare') {
      if (busy) return;
      if (!inventory) { post({ type: 'error', msg: 'Scan the file first.' }); return; }
      busy = true; setCancelled(false);
      await prepareAiItems(inventory, msg.targets, msg.maxItems || 300);
      busy = false; return;
    }

    if (msg.type === 'ai_apply') {
      if (busy) return;
      busy = true; setCancelled(false);
      const n = await applyAiNames(msg.renames || [], msg.prefix || 'ds/', !!msg.usePrefix);
      post({ type: 'ai_applied', count: n });
      figma.notify(`Renamed ${n} layers`);
      busy = false; return;
    }

    if (msg.type === 'select') {
      if (!inventory) return;
      const cat = msg.category as string;
      const here = figma.currentPage.name;
      const recs = [...inventory.elements, ...inventory.icons, ...inventory.shapes].filter((r) => r.category === cat && !r.inInstance);
      const onPage = recs.filter((r) => r.page === here);
      const nodes: SceneNode[] = [];
      for (const r of onPage) { const n = await figma.getNodeByIdAsync(r.id); if (n && !n.removed && n.type !== 'PAGE' && n.type !== 'DOCUMENT') nodes.push(n as SceneNode); }
      figma.currentPage.selection = nodes;
      if (nodes.length) figma.viewport.scrollAndZoomIntoView(nodes);
      figma.notify(nodes.length ? `Selected ${nodes.length} ${cat} layer${nodes.length === 1 ? '' : 's'} on this page` : `No ${cat} on this page${recs.length ? ` (${recs.length} on other pages)` : ''}`);
      return;
    }

    if (msg.type === 'resize') { figma.ui.resize(440, Math.max(480, Math.min(900, msg.height | 0))); return; }
    if (msg.type === 'close') { figma.closePlugin(); return; }
  } catch (e: any) {
    busy = false;
    const m = String(e && e.message ? e.message : e);
    if (m === 'cancelled') post({ type: 'error', msg: 'Stopped. Nothing else was changed.' });
    else post({ type: 'error', msg: m });
  }
};
````

## File: ds-foundry/src/naming.ts
````typescript
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
````

## File: ds-foundry/src/scan.ts
````typescript
import { Scope, Inventory, ColorToken, TypeToken, SpaceToken, RadiusToken, EffectToken, ElementRec, ComponentRef } from './types';
import { classify, ClassifyCtx } from './classify';
import { nameColors, nameTypes, nameSpacing, nameRadii, nameEffects, sizeClass } from './naming';
import { toHex, effectKey, effectCss, tick, progress, cancelled, snap, rgbToHsl } from './util';

interface WalkItem { node: SceneNode; ctx: ClassifyCtx; inInstance: boolean; page: string; }

const SKIP_TYPES = new Set(['SLICE', 'STICKY', 'CONNECTOR', 'SHAPE_WITH_TEXT', 'CODE_BLOCK', 'WIDGET', 'EMBED', 'LINK_UNFURL', 'MEDIA', 'TABLE']);

export async function scan(scope: Scope, baseGrid: number): Promise<Inventory> {
  const colors = new Map<string, ColorToken>();
  const types = new Map<string, TypeToken>();
  const spacing = new Map<number, SpaceToken>();
  const radii = new Map<number, RadiusToken>();
  const effects = new Map<string, EffectToken>();
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
    if (SKIP_TYPES.has(node.type) || node.removed) continue;
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
    if (node.type === 'INSTANCE') {
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

    const cls = classify(node, item.ctx);
    if (cls.category !== 'other') {
      const rec: ElementRec = {
        id: node.id,
        category: cls.category,
        name: node.name,
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
      };
      if (cls.category === 'icon') icons.push(rec);
      else if (cls.category === 'shape') { if (shapes.length < 4000) shapes.push(rec); }
      else elements.push(rec);
    }

    // descend (icons and images are leaves for our purposes; still collect their colours)
    if ('children' in node && cls.category !== 'icon') {
      const kids = (node as ChildrenMixin).children;
      const pw = node.width, ph = node.height;
      for (let i = kids.length - 1; i >= 0; i--) {
        const k = kids[i];
        stack.push({ node: k, ctx: { parentW: pw, parentH: ph, yInParent: k.y, topLevel: false }, inInstance: inInstance || node.type === 'INSTANCE', page: item.page });
      }
    } else if ('children' in node && cls.category === 'icon') {
      // still harvest colours inside icons
      const inner: SceneNode[] = [...(node as ChildrenMixin).children];
      while (inner.length) {
        const k = inner.pop()!;
        if ('fills' in k) addPaints((k as GeometryMixin).fills);
        if ('strokes' in k) addPaints((k as GeometryMixin).strokes, true, (k as GeometryMixin).strokeWeight);
        if ('children' in k) inner.push(...(k as ChildrenMixin).children);
      }
    }
  }

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
````

## File: ds-foundry/src/tokens.ts
````typescript
import { Inventory, BuildOptions, BuildResult } from './types';
import { rgbaCss, round } from './util';

const cssName = (s: string) => s.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase();

function lineHeightCss(lh: LineHeight): string {
  if (lh.unit === 'AUTO') return 'normal';
  return lh.unit === 'PERCENT' ? `${round(lh.value / 100, 3)}` : `${round(lh.value)}px`;
}
function letterSpacingCss(ls: LetterSpacing): string {
  if (!ls.value) return '0';
  return ls.unit === 'PERCENT' ? `${round(ls.value / 100, 3)}em` : `${round(ls.value)}px`;
}

function setDeep(obj: Record<string, any>, path: string[], value: any) {
  let cur = obj;
  for (let i = 0; i < path.length - 1; i++) {
    cur[path[i]] = cur[path[i]] || {};
    cur = cur[path[i]];
  }
  cur[path[path.length - 1]] = value;
}

export function buildTokenFiles(inv: Inventory, opts: BuildOptions, result: Omit<BuildResult, 'files'>): Record<string, string> {
  const files: Record<string, string> = {};
  const generatedAt = new Date().toISOString();
  const source = { plugin: 'DS Foundry', version: '1.4.0', generatedAt, scope: inv.scope, pages: inv.pages };

  // -------- DTCG tokens.json --------
  const dtcg: Record<string, any> = { $schema: 'https://tr.designtokens.org/format/', $extensions: { 'com.cogspa.dsfoundry': source } };
  for (const c of inv.colors) {
    setDeep(dtcg, ['color', ...c.name.split('/')], { $type: 'color', $value: rgbaCss(c.r, c.g, c.b, c.a), $extensions: { usage: c.count } });
  }
  for (const s of inv.spacing) {
    setDeep(dtcg, ['space', String(s.value)], { $type: 'dimension', $value: `${s.value}px`, $extensions: { usage: s.count } });
  }
  for (const r of inv.radii) {
    setDeep(dtcg, ['radius', r.name.split('/')[1]], { $type: 'dimension', $value: r.value >= 999 ? '9999px' : `${r.value}px`, $extensions: { usage: r.count } });
  }
  for (const e of inv.effects) {
    const shadows = e.effects.filter((x) => x.type === 'DROP_SHADOW' || x.type === 'INNER_SHADOW') as (DropShadowEffect | InnerShadowEffect)[];
    if (shadows.length) {
      setDeep(dtcg, ['shadow', ...e.name.split('/')], {
        $type: 'shadow',
        $value: shadows.map((s) => ({
          color: rgbaCss(s.color.r, s.color.g, s.color.b, s.color.a),
          offsetX: `${round(s.offset.x)}px`, offsetY: `${round(s.offset.y)}px`,
          blur: `${round(s.radius)}px`, spread: `${round(s.spread || 0)}px`, inset: s.type === 'INNER_SHADOW',
        })),
        $extensions: { usage: e.count },
      });
    } else {
      setDeep(dtcg, ['blur', ...e.name.split('/')], { $type: 'dimension', $value: `${round(e.effects[0].radius)}px`, $extensions: { usage: e.count } });
    }
  }
  for (const t of inv.types) {
    setDeep(dtcg, ['typography', ...t.name.split('/')], {
      $type: 'typography',
      $value: {
        fontFamily: t.family, fontWeight: t.cssWeight, fontStyle: /italic|oblique/i.test(t.style) ? 'italic' : 'normal',
        fontSize: `${round(t.size)}px`, lineHeight: lineHeightCss(t.lineHeight), letterSpacing: letterSpacingCss(t.letterSpacing),
      },
      $extensions: { figmaStyle: t.style, usage: t.count },
    });
  }
  files['tokens.json'] = JSON.stringify(dtcg, null, 2);

  // -------- tokens.css --------
  const css: string[] = [`/* Generated by DS Foundry — ${generatedAt} */`, ':root {'];
  css.push('  /* colour */');
  for (const c of inv.colors) css.push(`  --color-${cssName(c.name)}: ${rgbaCss(c.r, c.g, c.b, c.a)};`);
  css.push('', '  /* spacing */');
  for (const s of inv.spacing) css.push(`  --space-${s.value}: ${s.value}px;`);
  css.push('', '  /* radius */');
  for (const r of inv.radii) css.push(`  --${cssName(r.name)}: ${r.value >= 999 ? '9999px' : r.value + 'px'};`);
  css.push('', '  /* effects */');
  for (const e of inv.effects) css.push(`  --${cssName(e.name)}: ${e.css};`);
  css.push('', '  /* typography */');
  for (const t of inv.types) {
    const n = cssName(t.name);
    css.push(`  --font-${n}: ${t.cssWeight} ${round(t.size)}px/${lineHeightCss(t.lineHeight)} "${t.family}", sans-serif;`);
    if (t.letterSpacing.value) css.push(`  --font-${n}-tracking: ${letterSpacingCss(t.letterSpacing)};`);
  }
  css.push('}', '');
  css.push('/* Utility classes for typography */');
  for (const t of inv.types) {
    const n = cssName(t.name);
    css.push(`.text-${n} { font: var(--font-${n});${t.letterSpacing.value ? ` letter-spacing: var(--font-${n}-tracking);` : ''} }`);
  }
  files['tokens.css'] = css.join('\n') + '\n';

  // -------- tailwind --------
  const tw: any = { theme: { extend: { colors: {}, spacing: {}, borderRadius: {}, boxShadow: {}, fontSize: {}, fontFamily: {} } } };
  for (const c of inv.colors) setDeep(tw.theme.extend.colors, c.name.split('/').map(cssName), rgbaCss(c.r, c.g, c.b, c.a));
  for (const s of inv.spacing) tw.theme.extend.spacing[String(s.value)] = `${s.value}px`;
  for (const r of inv.radii) tw.theme.extend.borderRadius[r.name.split('/')[1]] = r.value >= 999 ? '9999px' : `${r.value}px`;
  for (const e of inv.effects) if (e.name.startsWith('elevation')) tw.theme.extend.boxShadow[cssName(e.name)] = e.css;
  for (const t of inv.types) tw.theme.extend.fontSize[cssName(t.name)] = [`${round(t.size)}px`, { lineHeight: lineHeightCss(t.lineHeight), letterSpacing: letterSpacingCss(t.letterSpacing), fontWeight: String(t.cssWeight) }];
  const fams = [...new Set(inv.types.map((t) => t.family))];
  fams.forEach((f, i) => (tw.theme.extend.fontFamily[i === 0 ? 'sans' : cssName(f)] = [f, 'sans-serif']));
  files['tailwind.tokens.cjs'] = `/** Generated by DS Foundry — ${generatedAt}. Merge into tailwind.config.js */\nmodule.exports = ${JSON.stringify(tw, null, 2)};\n`;

  // -------- markdown doc --------
  const md: string[] = [];
  md.push(`# Design system — ${inv.pages.join(', ')}`);
  md.push('', `Generated by DS Foundry on ${generatedAt.slice(0, 10)} from ${inv.nodeCount.toLocaleString()} layers (${inv.scope}).`, '');
  md.push('## What was built', '');
  md.push(`- ${result.paintStyles} colour styles, ${result.textStyles} text styles, ${result.effectStyles} effect styles`);
  md.push(`- ${result.variables} variables in the "DS Foundry / Primitives" collection`);
  md.push(`- ${result.componentSets} component sets (${result.components} variants) and ${result.icons} icon components`);
  md.push(`- ${result.labeled} layers labelled with the \`${opts.prefix}\` prefix`);
  if (result.notes.length) { md.push('', '### Notes', ''); for (const n of result.notes) md.push(`- ${n}`); }
  md.push('', '## Colour', '', '| Token | Value | Uses |', '|---|---|---|');
  for (const c of inv.colors) md.push(`| \`${c.name}\` | \`${rgbaCss(c.r, c.g, c.b, c.a)}\` | ${c.count} |`);
  md.push('', '## Typography', '', '| Token | Font | Size | Line height | Tracking | Uses |', '|---|---|---|---|---|---|');
  for (const t of inv.types) md.push(`| \`${t.name}\` | ${t.family} ${t.style} | ${round(t.size)}px | ${lineHeightCss(t.lineHeight)} | ${letterSpacingCss(t.letterSpacing)} | ${t.count} |`);
  md.push('', '## Spacing', '', '| Token | Value | Uses |', '|---|---|---|');
  for (const s of inv.spacing) md.push(`| \`${s.name}\` | ${s.value}px | ${s.count} |`);
  md.push('', '## Radius', '', '| Token | Value | Uses |', '|---|---|---|');
  for (const r of inv.radii) md.push(`| \`${r.name}\` | ${r.value >= 999 ? 'full' : r.value + 'px'} | ${r.count} |`);
  md.push('', '## Effects', '', '| Token | CSS | Uses |', '|---|---|---|');
  for (const e of inv.effects) md.push(`| \`${e.name}\` | \`${e.css}\` | ${e.count} |`);
  md.push('', '## Elements found', '', '| Category | Count |', '|---|---|');
  const counts = new Map<string, number>();
  for (const e of inv.elements) counts.set(e.category, (counts.get(e.category) || 0) + 1);
  counts.set('icon', inv.icons.length);
  for (const [k, v] of [...counts.entries()].sort((a, b) => b[1] - a[1])) md.push(`| ${k} | ${v} |`);
  if (inv.components.length) {
    md.push('', '## Components already in use', '', '| Component | Instances | Source |', '|---|---|---|');
    for (const c of inv.components.slice(0, 80)) md.push(`| ${c.name} | ${c.count} | ${c.remote ? 'library' : 'local'} |`);
  }
  if (inv.missingFonts.length) md.push('', `> Missing fonts: ${inv.missingFonts.join(', ')} — text styles for these were skipped.`);
  files['DESIGN_SYSTEM.md'] = md.join('\n') + '\n';

  // -------- raw inventory --------
  files['inventory.json'] = JSON.stringify({
    source,
    elements: inv.elements.map((e) => ({ id: e.id, page: e.page, category: e.category, name: e.name, text: e.text, w: round(e.w), h: round(e.h), fillRole: e.fillRole, size: e.sizeClass, inInstance: e.inInstance })),
    icons: inv.icons.map((e) => ({ id: e.id, page: e.page, name: e.name, w: round(e.w), h: round(e.h) })),
    components: inv.components,
    fonts: inv.fonts,
  }, null, 2);

  return files;
}
````

## File: ds-foundry/src/types.ts
````typescript
export type Scope = 'selection' | 'page' | 'document';

export type Category =
  | 'screen'
  | 'section'
  | 'nav'
  | 'card'
  | 'button'
  | 'input'
  | 'badge'
  | 'avatar'
  | 'image'
  | 'icon'
  | 'divider'
  | 'list-item'
  | 'checkbox'
  | 'toggle'
  | 'text'
  | 'shape'
  | 'logo'
  | 'character'
  | 'illustration'
  | 'symbol'
  | 'tagline'
  | 'copy'
  | 'debris'
  | 'other';

export interface ColorToken {
  key: string;        // hex+alpha
  hex: string;
  r: number; g: number; b: number; a: number;
  count: number;
  name: string;       // e.g. primary/500
  role: string;       // primary | neutral | success ...
  step: number;
}

export interface TypeToken {
  key: string;
  family: string;
  style: string;
  size: number;
  lineHeight: LineHeight;
  letterSpacing: LetterSpacing;
  count: number;
  name: string;       // e.g. heading/lg/bold
  role: string;       // display | heading | title | body | caption
  weight: string;     // light | regular | medium | semibold | bold
  cssWeight: number;
}

export interface SpaceToken { value: number; count: number; name: string; }
export interface RadiusToken { value: number; count: number; name: string; }

export interface EffectToken {
  key: string;
  effects: Effect[];
  count: number;
  name: string;
  css: string;
}

export interface ElementRec {
  id: string;
  category: Category;
  name: string;         // original name
  text: string;         // primary text content (if any)
  w: number;
  h: number;
  fingerprint: string;
  inInstance: boolean;
  fillRole: string;     // for buttons/badges: primary | neutral | outline | ghost ...
  sizeClass: string;    // sm | md | lg
  textRole: string;     // for text nodes: heading/lg/bold
  desc: string;         // deterministic description for shapes/vectors (e.g. navy-outline-blob-56x30)
  page: string;
}

export interface ComponentRef { id: string; name: string; remote: boolean; count: number; }

export interface Inventory {
  scope: Scope;
  pages: string[];
  pageIds: string[];
  nodeCount: number;
  colors: ColorToken[];
  types: TypeToken[];
  spacing: SpaceToken[];
  radii: RadiusToken[];
  effects: EffectToken[];
  elements: ElementRec[];
  icons: ElementRec[];
  shapes: ElementRec[];      // plain geometry that is not an icon, divider or image — every one gets a descriptive name
  components: ComponentRef[];
  fonts: { family: string; style: string }[];
  missingFonts: string[];
}

export interface BuildOptions {
  prefix: string;
  labels: boolean;
  labelText: boolean;
  rename: boolean;
  styles: boolean;
  variables: boolean;
  foundations: boolean;
  components: boolean;
  icons: boolean;
  tidy: boolean;
  assets: boolean;       // build the DS · Assets contact sheet
  baseGrid: number;
}

export interface BuildResult {
  paintStyles: number;
  textStyles: number;
  effectStyles: number;
  variables: number;
  labeled: number;
  componentSets: number;
  components: number;
  icons: number;
  assets: number;
  pages: string[];
  notes: string[];
  files: Record<string, string>;
}

/** Compact inventory summary sent to the UI */
export interface InventorySummary {
  scope: Scope;
  pages: string[];
  nodeCount: number;
  colors: { hex: string; a: number; name: string; count: number; role: string }[];
  types: { name: string; family: string; style: string; size: number; count: number }[];
  spacing: { name: string; value: number; count: number }[];
  radii: { name: string; value: number; count: number }[];
  effects: { name: string; css: string; count: number }[];
  elements: Record<string, { count: number; samples: string[] }>;
  icons: { count: number; samples: string[] };
  shapes: { count: number; samples: string[] };
  debris: number;
  components: { name: string; remote: boolean; count: number }[];
  fonts: string[];
  missingFonts: string[];
}
````

## File: ds-foundry/src/util.ts
````typescript
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
      return `${e.type}:${round(e.radius)}`;
    })
    .join('|');
}

export function snap(v: number, grid: number): number {
  if (grid <= 1) return Math.round(v);
  return Math.max(0, Math.round(v / grid) * grid);
}
````

## File: ds-foundry/tools/copy-ui.mjs
````
import { copyFileSync, mkdirSync } from 'node:fs';
mkdirSync('dist', { recursive: true });
copyFileSync('ui/ui.html', 'dist/ui.html');
console.log('dist/ui.html updated');
````

## File: ds-foundry/ui/ui.html
````html
<!doctype html>
<meta charset="utf-8" />
<style>
  :root {
    --bg: var(--figma-color-bg, #fff);
    --bg2: var(--figma-color-bg-secondary, #f5f5f5);
    --bg3: var(--figma-color-bg-tertiary, #ebebeb);
    --hover: var(--figma-color-bg-hover, #f0f0f0);
    --ink: var(--figma-color-text, #1e1e1e);
    --ink2: var(--figma-color-text-secondary, #6b6b6b);
    --ink3: var(--figma-color-text-tertiary, #9a9a9a);
    --line: var(--figma-color-border, #e6e6e6);
    --brand: var(--figma-color-bg-brand, #0d99ff);
    --brand-ink: var(--figma-color-text-onbrand, #fff);
    --danger: var(--figma-color-text-danger, #f24822);
    /* token-class hues (the one place colour is spent) */
    --k-colour: #d84a3c; --k-type: #3b5bdb; --k-space: #2b9a8e; --k-radius: #d69e2e;
    --k-effect: #7048e8; --k-elem: #2f9e44; --k-icon: #868e96;
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; height: 100%; }
  body {
    font: 11px/1.45 Inter, -apple-system, "Segoe UI", system-ui, sans-serif;
    color: var(--ink); background: var(--bg);
    font-variant-numeric: tabular-nums; -webkit-font-smoothing: antialiased;
    display: flex; flex-direction: column;
  }
  button, input, select { font: inherit; color: inherit; }
  button { cursor: pointer; }
  button:focus-visible, input:focus-visible, .seg label:focus-within { outline: 2px solid var(--brand); outline-offset: 1px; }

  header { display: flex; align-items: center; gap: 8px; padding: 12px 16px 10px; border-bottom: 1px solid var(--line); }
  header h1 { font-size: 13px; font-weight: 600; margin: 0; letter-spacing: -0.01em; }
  header .ver { color: var(--ink3); }
  header .grow { flex: 1; }

  .row { display: flex; align-items: center; gap: 8px; }
  .seg { display: inline-flex; background: var(--bg2); border-radius: 6px; padding: 2px; }
  .seg label { padding: 4px 10px; border-radius: 4px; color: var(--ink2); cursor: pointer; user-select: none; }
  .seg input { position: absolute; opacity: 0; width: 0; height: 0; }
  .seg input:checked + span { color: var(--ink); }
  .seg label:has(input:checked) { background: var(--bg); box-shadow: 0 1px 2px rgba(0,0,0,.12); }

  .btn { border: 1px solid var(--line); background: var(--bg); border-radius: 6px; padding: 6px 12px; font-weight: 500; }
  .btn:hover { background: var(--hover); }
  .btn.primary { background: var(--brand); color: var(--brand-ink); border-color: transparent; }
  .btn.primary:hover { filter: brightness(1.05); }
  .btn.primary:disabled, .btn:disabled { opacity: .45; cursor: default; filter: none; }
  .btn.quiet { border-color: transparent; color: var(--ink2); }
  .btn.small { padding: 4px 8px; font-weight: 400; }

  main { flex: 1; overflow: auto; }
  section { padding: 14px 16px; border-bottom: 1px solid var(--line); }
  section h2 { font-size: 11px; font-weight: 600; margin: 0 0 10px; }
  section h2 small { color: var(--ink3); font-weight: 400; margin-left: 6px; }
  .hint { color: var(--ink2); margin: 0; }
  .empty { padding: 28px 16px; color: var(--ink2); }
  .empty p { margin: 0 0 6px; }

  /* ledger */
  .ledger { display: flex; height: 10px; border-radius: 5px; overflow: hidden; background: var(--bg3); margin: 4px 0 10px; }
  .ledger i { display: block; height: 100%; transition: width .5s cubic-bezier(.2,.8,.2,1); min-width: 0; }
  .legend { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px 10px; }
  .legend div { display: flex; align-items: baseline; gap: 6px; color: var(--ink2); }
  .legend b { font-weight: 600; color: var(--ink); font-size: 13px; }
  .legend em { font-style: normal; width: 8px; height: 8px; border-radius: 2px; align-self: center; flex: none; }

  .tabs { display: flex; gap: 2px; margin: 12px 0 8px; border-bottom: 1px solid var(--line); }
  .tabs button { border: 0; background: none; padding: 6px 8px; color: var(--ink2); border-bottom: 2px solid transparent; margin-bottom: -1px; }
  .tabs button[aria-selected="true"] { color: var(--ink); border-bottom-color: var(--ink); }
  .list { max-height: 210px; overflow: auto; margin: 0 -16px; padding: 0 16px; }
  .item { display: grid; grid-template-columns: 22px 1fr auto; gap: 8px; align-items: center; padding: 4px 0; border-bottom: 1px solid var(--line); }
  .item:last-child { border-bottom: 0; }
  .item .sw { width: 22px; height: 22px; border-radius: 5px; border: 1px solid rgba(0,0,0,.08); background-image: linear-gradient(45deg,#ddd 25%,transparent 25%,transparent 75%,#ddd 75%),linear-gradient(45deg,#ddd 25%,transparent 25%,transparent 75%,#ddd 75%); background-size: 8px 8px; background-position: 0 0, 4px 4px; position: relative; overflow: hidden; }
  .item .sw i { position: absolute; inset: 0; }
  .item .name { font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .item .sub { color: var(--ink2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .item .n { color: var(--ink3); }
  .item.cat .sw { border: 0; background: var(--bg2); display: grid; place-items: center; color: var(--ink2); font-size: 10px; }
  .chips { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 4px; }
  .chip { background: var(--bg2); border-radius: 4px; padding: 1px 6px; color: var(--ink2); max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  /* options */
  .opts { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 14px; margin: 8px 0 12px; }
  .opts label { display: flex; align-items: center; gap: 7px; padding: 3px 0; cursor: pointer; }
  .opts label.sub { margin-left: 20px; color: var(--ink2); }
  .opts input[type=checkbox] { accent-color: var(--brand); margin: 0; }
  .field { display: flex; align-items: center; gap: 8px; }
  .field input[type=text] { flex: 1; border: 1px solid var(--line); border-radius: 6px; padding: 5px 8px; background: var(--bg); min-width: 0; }
  .field label { color: var(--ink2); width: 52px; }

  .progress { height: 4px; border-radius: 2px; background: var(--bg3); overflow: hidden; margin-top: 10px; }
  .progress i { display: block; height: 100%; width: 0; background: var(--brand); transition: width .25s ease; }
  .status { color: var(--ink2); margin-top: 6px; min-height: 16px; }
  .status.err { color: var(--danger); }

  .stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-bottom: 10px; }
  .stats div { background: var(--bg2); border-radius: 6px; padding: 8px 10px; }
  .stats b { display: block; font-size: 15px; font-weight: 600; }
  .stats span { color: var(--ink2); }
  .notes { margin: 0 0 10px; padding-left: 16px; color: var(--ink2); }
  .files { display: flex; flex-wrap: wrap; gap: 6px; }

  /* AI naming */
  .ai-head { display: flex; align-items: center; gap: 8px; }
  .ai-head .field { flex: 1; }
  .field input[type=password], .field select { border: 1px solid var(--line); border-radius: 6px; padding: 5px 8px; background: var(--bg); min-width: 0; }
  .field input[type=password] { flex: 1; font-family: ui-monospace, Menlo, monospace; font-size: 10px; }
  .ai-rows { max-height: 260px; overflow: auto; margin: 8px -16px 0; padding: 0 16px; }
  .ai-row { display: grid; grid-template-columns: 18px 44px 1fr; gap: 8px; align-items: center; padding: 5px 0; border-bottom: 1px solid var(--line); }
  .ai-row img { width: 44px; height: 44px; object-fit: contain; border-radius: 5px; background: #fff; border: 1px solid var(--line); }
  .ai-row .old { color: var(--ink3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ai-row .old b { font-weight: 500; color: var(--ink2); }
  .ai-row input[type=text] { width: 100%; border: 1px solid transparent; border-radius: 4px; padding: 2px 4px; background: transparent; font-weight: 500; }
  .ai-row input[type=text]:hover, .ai-row input[type=text]:focus { border-color: var(--line); background: var(--bg); }
  .ai-row .what { color: var(--ink2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ai-foot { display: flex; gap: 8px; align-items: center; margin-top: 10px; }
  .ai-foot .grow { flex: 1; color: var(--ink2); }

  footer { display: flex; gap: 8px; align-items: center; padding: 10px 16px; border-top: 1px solid var(--line); background: var(--bg); }
  footer .grow { flex: 1; }
  @media (prefers-reduced-motion: reduce) { .ledger i, .progress i { transition: none; } }
</style>

<header>
  <h1>DS Foundry</h1><span class="ver">1.4.0</span>
  <span class="grow"></span>
  <div class="seg" role="radiogroup" aria-label="Scope">
    <label><input type="radio" name="scope" value="selection" /><span>Selection</span></label>
    <label><input type="radio" name="scope" value="page" checked /><span>Page</span></label>
    <label><input type="radio" name="scope" value="document" /><span>Document</span></label>
  </div>
  <button class="btn primary" id="scan">Scan</button>
</header>

<main>
  <div class="empty" id="empty">
    <p>Scan a page, a selection, or the whole file.</p>
    <p>DS Foundry reads every layer, collects colours, type, spacing, radii and effects, recognises buttons, inputs, cards, nav bars, icons and more, then builds styles, variables, component sets and documented foundation pages from what it finds.</p>
    <p>Nothing in the file changes until you press Build.</p>
  </div>

  <section id="inventory" hidden>
    <h2>Inventory <small id="invMeta"></small></h2>
    <div class="ledger" id="ledger"></div>
    <div class="legend" id="legend"></div>
    <div class="tabs" role="tablist" id="tabs">
      <button role="tab" data-tab="colors" aria-selected="true">Colours</button>
      <button role="tab" data-tab="types">Type</button>
      <button role="tab" data-tab="scale">Scale</button>
      <button role="tab" data-tab="elements">Elements</button>
      <button role="tab" data-tab="components">Components</button>
    </div>
    <div class="list" id="list"></div>
  </section>

  <section id="aiSec" hidden>
    <h2>AI naming <small>names layers by what they look like</small></h2>
    <div class="ai-head">
      <div class="field"><select id="provider">
        <option value="anthropic">Claude</option>
        <option value="gemini">Gemini</option>
        <option value="proxy">Proxy (LangGraph server)</option>
      </select></div>
      <div class="field"><input type="password" id="apiKey" placeholder="Anthropic API key (sk-ant-…)" autocomplete="off" spellcheck="false" /></div>
      <div class="field"><select id="model"></select></div>
    </div>
    <div class="field" id="customModelRow" hidden style="margin-top:6px"><label for="customModel">Model ID</label><input type="text" id="customModel" placeholder="model id — in proxy mode use provider:model, e.g. gemini:gemini-3.8-flash" spellcheck="false" /></div>
    <div class="row" id="proxyRow" hidden style="margin-top:6px;gap:10px">
      <div class="field" style="flex:1"><label for="proxyUrl">Server</label><input type="text" id="proxyUrl" value="http://localhost:8000" spellcheck="false" /></div>
      <div class="field"><label for="project" style="width:auto">Project</label><input type="text" id="project" value="default" style="width:90px" spellcheck="false" /></div>
      <label style="display:flex;align-items:center;gap:6px;color:var(--ink2)"><input type="checkbox" id="p_critic" checked /> Critic</label>
      <label style="display:flex;align-items:center;gap:6px;color:var(--ink2)"><input type="checkbox" id="p_learn" checked /> Learn</label>
    </div>
    <div class="opts">
      <label><input type="checkbox" id="t_icons" checked /> Icons and symbols</label>
      <label><input type="checkbox" id="t_art" checked /> Logos, characters, illustrations</label>
      <label><input type="checkbox" id="t_images" checked /> Images and avatars</label>
      <label><input type="checkbox" id="t_screens" checked /> Screens, sections, nav</label>
      <label><input type="checkbox" id="t_cards" checked /> Cards and list items</label>
      <label><input type="checkbox" id="t_components" checked /> Components</label>
      <label><input type="checkbox" id="t_text" /> Taglines and copy</label>
      <label><input type="checkbox" id="t_shapes" /> Plain shapes (already get geometry names)</label>
      <label><input type="checkbox" id="t_prefix" checked /> Add prefix and category path</label>
      <label class="field" style="gap:6px"><span style="color:var(--ink2)">Max items</span><input type="text" id="t_max" value="300" style="width:52px;border:1px solid var(--line);border-radius:6px;padding:3px 6px;background:var(--bg)" /></label>
    </div>
    <p class="hint" id="aiHint">Identical layers are named once and renamed together. Items the model can't name honestly are flagged for you instead of guessed; confidently named characters and logos are used as references to recognise their other views. Keys are stored only on this device and sent straight to the provider you pick. Proxy mode sends batches to your own DS Foundry server, which adds a critic pass, a shared glossary and a cache. Thumbnails are small (≤ 384 px) to keep cost low.</p>
    <div class="ai-foot">
      <button class="btn" id="aiSuggest">Suggest names</button>
      <span class="grow" id="aiStatus"></span>
      <button class="btn small" id="aiAll" hidden>Select all</button>
      <button class="btn primary" id="aiApply" hidden>Apply names</button>
    </div>
    <div class="ai-rows" id="aiRows"></div>
  </section>

  <section id="buildSec" hidden>
    <h2>Build</h2>
    <div class="row" style="gap:14px">
      <div class="field" style="flex:1"><label for="prefix">Prefix</label><input type="text" id="prefix" value="ds/" spellcheck="false" /></div>
      <div class="field"><label style="width:auto">Grid</label>
        <div class="seg" role="radiogroup" aria-label="Base grid">
          <label><input type="radio" name="grid" value="4" checked /><span>4</span></label>
          <label><input type="radio" name="grid" value="8" /><span>8</span></label>
        </div>
      </div>
    </div>
    <div class="opts">
      <label><input type="checkbox" id="o_labels" checked /> Label layers</label>
      <label><input type="checkbox" id="o_styles" checked /> Colour, text and effect styles</label>
      <label class="sub"><input type="checkbox" id="o_rename" checked /> Rename (off = tag only)</label>
      <label><input type="checkbox" id="o_variables" checked /> Variables collection</label>
      <label class="sub"><input type="checkbox" id="o_labelText" /> Include text layers</label>
      <label><input type="checkbox" id="o_foundations" checked /> Foundations page</label>
      <label><input type="checkbox" id="o_tidy" /> Arrange screens by width</label>
      <label><input type="checkbox" id="o_components" checked /> Components page</label>
      <label></label>
      <label><input type="checkbox" id="o_icons" checked /> Icons page</label>
      <label><input type="checkbox" id="o_assets" checked /> Assets contact sheet</label>
    </div>
    <p class="hint">Layer names are kept, so labels can be reverted. Re-running a build replaces the pages it generated and updates styles in place.</p>
  </section>

  <section id="results" hidden>
    <h2>Built</h2>
    <div class="stats" id="stats"></div>
    <ul class="notes" id="notes"></ul>
    <h2>Token files</h2>
    <div class="files" id="files"></div>
  </section>
</main>

<footer>
  <div style="flex:1">
    <div class="progress" id="progress" hidden><i></i></div>
    <div class="status" id="status"></div>
  </div>
  <button class="btn quiet" id="revert" hidden>Revert labels</button>
  <button class="btn quiet" id="cancel" hidden>Stop</button>
  <button class="btn primary" id="build" disabled>Build design system</button>
</footer>

<script>
  const $ = (s) => document.querySelector(s);
  const send = (m) => parent.postMessage({ pluginMessage: m }, '*');
  let summary = null, built = null, tab = 'colors';

  const scope = () => document.querySelector('input[name=scope]:checked').value;
  const grid = () => +document.querySelector('input[name=grid]:checked').value;
  const opts = () => ({
    prefix: normPrefix($('#prefix').value), baseGrid: grid(),
    labels: $('#o_labels').checked, rename: $('#o_rename').checked, labelText: $('#o_labelText').checked,
    styles: $('#o_styles').checked, variables: $('#o_variables').checked,
    foundations: $('#o_foundations').checked, components: $('#o_components').checked, icons: $('#o_icons').checked,
    assets: $('#o_assets').checked, tidy: $('#o_tidy').checked,
  });
  function normPrefix(p) { p = (p || '').trim(); if (!p) return ''; return p.endsWith('/') ? p : p + '/'; }

  // ---------- state ----------
  function setBusy(on, label) {
    $('#scan').disabled = on; $('#build').disabled = on || !summary; $('#revert').disabled = on;
    $('#cancel').hidden = !on;
    $('#progress').hidden = !on;
    if (!on) { $('#progress i').style.width = '0%'; }
    if (label !== undefined) status(label);
  }
  function status(msg, err) { const s = $('#status'); s.textContent = msg || ''; s.classList.toggle('err', !!err); }

  $('#scan').onclick = () => { built = null; $('#results').hidden = true; setBusy(true, 'Scanning…'); send({ type: 'scan', scope: scope(), baseGrid: grid(), prefix: normPrefix($('#prefix').value) }); };
  $('#build').onclick = () => { setBusy(true, 'Building…'); send({ type: 'build', options: opts() }); };
  $('#cancel').onclick = () => { send({ type: 'cancel' }); status('Stopping…'); };
  $('#revert').onclick = () => { setBusy(true, 'Restoring layer names…'); send({ type: 'revert' }); };
  $('#prefix').addEventListener('change', () => { if (summary) send({ type: 'relabel', prefix: normPrefix($('#prefix').value) }); });
  $('#o_labels').addEventListener('change', (e) => { $('#o_rename').disabled = $('#o_labelText').disabled = !e.target.checked; });
  $('#tabs').addEventListener('click', (e) => { const b = e.target.closest('[data-tab]'); if (!b) return; tab = b.dataset.tab; renderTabs(); renderList(); });
  $('#list').addEventListener('click', (e) => { const b = e.target.closest('[data-select]'); if (b) send({ type: 'select', category: b.dataset.select }); });

  window.onmessage = (e) => {
    const m = e.data.pluginMessage; if (!m) return;
    if (m.type === 'progress') { $('#progress').hidden = false; $('#progress i').style.width = m.pct + '%'; status(m.msg); }
    if (m.type === 'scanned') { summary = m.summary; setBusy(false, `Scanned ${summary.nodeCount.toLocaleString()} layers on ${summary.pages.length} page${summary.pages.length === 1 ? '' : 's'}.`); renderInventory(); }
    if (m.type === 'built') { built = m.result; setBusy(false, 'Design system built.'); renderResults(); }
    if (m.type === 'reverted') { setBusy(false, `Restored ${m.count} layer names.`); }
    if (m.type === 'error') { setBusy(false); aiBusy = false; aiStatus(m.msg, true); status(m.msg, true); }
    if (m.type === 'ai_keys') { aiKeys = m.keys || {}; $('#apiKey').value = aiKeys[provider()] || ''; }
    if (m.type === 'ai_items') { aiReceive(m); }
    if (m.type === 'ai_applied') { setBusy(false, `Renamed ${m.count} layers.`); aiStatus(`Renamed ${m.count} layers. Revert labels restores the originals.`); $('#aiApply').hidden = true; $('#aiAll').hidden = true; $('#aiRows').innerHTML = ''; }
  };
  send({ type: 'ai_key_get' });

  // ---------- inventory ----------
  const K = [
    ['colors', 'colours', 'var(--k-colour)'], ['types', 'text styles', 'var(--k-type)'], ['spacing', 'spacing', 'var(--k-space)'],
    ['radii', 'radii', 'var(--k-radius)'], ['effects', 'effects', 'var(--k-effect)'], ['elements', 'elements', 'var(--k-elem)'], ['icons', 'icons', 'var(--k-icon)'],
  ];
  function counts() {
    const el = Object.values(summary.elements).reduce((n, c) => n + c.count, 0);
    return { colors: summary.colors.length, types: summary.types.length, spacing: summary.spacing.length, radii: summary.radii.length, effects: summary.effects.length, elements: el, icons: summary.icons.count };
  }
  function renderInventory() {
    $('#empty').hidden = true; $('#inventory').hidden = false; $('#aiSec').hidden = false; $('#buildSec').hidden = false; $('#revert').hidden = false;
    aiReset();
    $('#invMeta').textContent = summary.pages.length === 1 ? summary.pages[0] : `${summary.pages.length} pages`;
    const c = counts();
    // ledger: log-scaled so a thousand elements doesn't flatten the token classes
    const w = K.map(([k]) => Math.log2(1 + c[k]));
    const tot = w.reduce((a, b) => a + b, 0) || 1;
    $('#ledger').innerHTML = K.map(([k, , col], i) => `<i style="width:0;background:${col}" data-w="${(w[i] / tot * 100).toFixed(2)}"></i>`).join('');
    requestAnimationFrame(() => document.querySelectorAll('#ledger i').forEach((el) => (el.style.width = el.dataset.w + '%')));
    $('#legend').innerHTML = K.map(([k, label, col]) => `<div><em style="background:${col}"></em><b>${c[k]}</b>${label}</div>`).join('') +
      `<div><b>${summary.components.length}</b>components in use</div>` +
      (summary.missingFonts.length ? `<div style="grid-column:span 3;color:var(--danger)">Missing fonts: ${esc(summary.missingFonts.join(', '))}</div>` : '');
    renderTabs(); renderList();
  }
  function renderTabs() { document.querySelectorAll('#tabs [data-tab]').forEach((b) => b.setAttribute('aria-selected', b.dataset.tab === tab)); }
  function esc(s) { return String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch])); }
  function renderList() {
    const L = $('#list'); let h = '';
    if (tab === 'colors') {
      h = summary.colors.map((c) => `<div class="item"><span class="sw"><i style="background:${c.hex}"></i></span><div><div class="name">${esc(c.name)}</div><div class="sub">${esc(c.hex)}</div></div><span class="n">${c.count}×</span></div>`).join('');
    } else if (tab === 'types') {
      h = summary.types.map((t) => `<div class="item cat"><span class="sw">Aa</span><div><div class="name">${esc(t.name)}</div><div class="sub">${esc(t.family)} ${esc(t.style)} · ${t.size}px</div></div><span class="n">${t.count}×</span></div>`).join('');
    } else if (tab === 'scale') {
      h = summary.spacing.map((s) => `<div class="item cat"><span class="sw">▭</span><div><div class="name">${esc(s.name)}</div><div class="sub">${s.value}px gap or padding</div></div><span class="n">${s.count}×</span></div>`).join('')
        + summary.radii.map((r) => `<div class="item cat"><span class="sw">◜</span><div><div class="name">${esc(r.name)}</div><div class="sub">${r.value >= 999 ? 'full' : r.value + 'px'}</div></div><span class="n">${r.count}×</span></div>`).join('')
        + summary.effects.map((e) => `<div class="item cat"><span class="sw">◐</span><div><div class="name">${esc(e.name)}</div><div class="sub">${esc(e.css)}</div></div><span class="n">${e.count}×</span></div>`).join('');
    } else if (tab === 'elements') {
      const cats = Object.entries(summary.elements).sort((a, b) => b[1].count - a[1].count);
      h = cats.map(([k, v]) => `<div class="item cat" style="grid-template-columns:1fr auto"><div><div class="name">${esc(k)}</div><div class="chips">${v.samples.map((s) => `<span class="chip" title="${esc(s)}">${esc(s)}</span>`).join('')}</div></div><span class="n">${v.count}</span></div>`).join('');
      if (summary.icons.count) h += `<div class="item cat" style="grid-template-columns:1fr auto"><div><div class="name">icon</div><div class="chips">${summary.icons.samples.map((s) => `<span class="chip" title="${esc(s)}">${esc(s)}</span>`).join('')}</div></div><span class="n">${summary.icons.count}</span></div>`;
      if (summary.shapes.count) h += `<div class="item cat" style="grid-template-columns:1fr auto"><div><div class="name">shape <span style="font-weight:400;color:var(--ink3)">— every vector gets a geometry name</span></div><div class="chips">${summary.shapes.samples.map((s) => `<span class="chip" title="${esc(s)}">${esc(s)}</span>`).join('')}</div></div><span class="n">${summary.shapes.count}</span></div>`;
      h += `<div class="item cat" style="grid-template-columns:1fr auto auto"><div><div class="name">debris <span style="font-weight:400;color:var(--ink3)">— specks, empty paths, ghosts</span></div></div><span class="n">${summary.debris}</span><button class="btn small" data-select="debris" ${summary.debris ? '' : 'disabled'}>Select on page</button></div>`;
    } else if (tab === 'components') {
      h = summary.components.length ? summary.components.map((c) => `<div class="item cat"><span class="sw">◈</span><div><div class="name">${esc(c.name)}</div><div class="sub">${c.remote ? 'library component' : 'local component'}</div></div><span class="n">${c.count}×</span></div>`).join('') : `<p class="hint">No instances of existing components in this scope.</p>`;
    }
    L.innerHTML = h || `<p class="hint">Nothing in this category.</p>`;
  }

  // ---------- results ----------
  function renderResults() {
    $('#results').hidden = false;
    const r = built;
    $('#stats').innerHTML = [
      [r.paintStyles + r.textStyles + r.effectStyles, 'styles'], [r.variables, 'variables'], [r.labeled, 'layers labelled'],
      [r.componentSets, 'component sets'], [r.components, 'variants'], [r.icons, 'icon components'],
    ].map(([n, l]) => `<div><b>${n}</b><span>${l}</span></div>`).join('');
    $('#notes').innerHTML = (r.pages.length ? [`Pages: ${r.pages.join(', ')}`] : []).concat(r.notes).map((n) => `<li>${esc(n)}</li>`).join('');
    const names = Object.keys(r.files);
    $('#files').innerHTML = names.map((n) => `<button class="btn small" data-file="${esc(n)}">${esc(n)}</button>`).join('') + `<button class="btn small primary" data-zip="1">All as .zip</button>`;
    $('#files').onclick = (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.zip) download('design-tokens.zip', zip(r.files), 'application/zip');
      else download(b.dataset.file, r.files[b.dataset.file], 'text/plain');
    };
    $('#results').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function download(name, data, mime) {
    const blob = data instanceof Blob ? data : new Blob([data], { type: mime });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  // ---------- AI naming ----------
  const PROVIDERS = {
    anthropic: {
      label: 'Claude', keyHint: 'Anthropic API key (sk-ant-…)',
      models: [['claude-sonnet-5', 'Sonnet 5'], ['claude-haiku-4-5', 'Haiku 4.5 (cheapest)'], ['claude-opus-5', 'Opus 5']],
    },
    gemini: {
      label: 'Gemini', keyHint: 'Gemini API key (AIza…)',
      models: [['gemini-3.7-flash', 'Gemini 3.7 Flash'], ['gemini-3.8-flash', 'Gemini 3.8 Flash'], ['gemini-3.5-flash-lite', 'Gemini 3.5 Flash-Lite (cheapest)'], ['gemini-3.1-pro-preview', 'Gemini 3.1 Pro (preview)']],
    },
    proxy: {
      label: 'Proxy', keyHint: 'Upstream API key (optional if the server has one)',
      // value = "<upstream provider>:<model or blank for server default>"
      models: [['anthropic:', 'Claude · server default'], ['anthropic:claude-sonnet-5', 'Claude · Sonnet 5'], ['anthropic:claude-haiku-4-5', 'Claude · Haiku 4.5'],
               ['gemini:', 'Gemini · server default'], ['gemini:gemini-3.7-flash', 'Gemini · 3.7 Flash'], ['gemini:gemini-3.5-flash-lite', 'Gemini · 3.5 Flash-Lite'],
               ['ollama:', 'Ollama · server default (local)']],
    },
  };
  const CLAUDE_URL = 'https://api.anthropic.com/v1/messages';
  const GEMINI_URL = (model) => `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const BATCH = 10, CONCURRENCY = 3, MAX_EDGE = 384;
  let aiKeys = {};
  const provider = () => $('#provider').value;
  const proxyUrl = () => $('#proxyUrl').value.trim().replace(/\/+$/, '');
  const modelId = () => ($('#model').value === '__custom' ? (provider() === 'proxy' ? '__custom' : $('#customModel').value.trim()) : $('#model').value);
  function renderModels() {
    const p = PROVIDERS[provider()];
    $('#model').innerHTML = p.models.map(([id, label]) => `<option value="${id}">${label}</option>`).join('') + `<option value="__custom">Custom model ID…</option>`;
    $('#apiKey').placeholder = p.keyHint;
    $('#apiKey').value = aiKeys[provider()] || '';
    $('#customModelRow').hidden = true;
    $('#proxyRow').hidden = provider() !== 'proxy';
    if (provider() === 'proxy' && aiKeys.proxyUrl) $('#proxyUrl').value = aiKeys.proxyUrl;
  }
  $('#proxyUrl').addEventListener('change', () => { aiKeys.proxyUrl = proxyUrl(); send({ type: 'ai_key_set', provider: 'proxyUrl', key: aiKeys.proxyUrl }); });
  $('#provider').addEventListener('change', renderModels);
  $('#model').addEventListener('change', () => { $('#customModelRow').hidden = $('#model').value !== '__custom'; if (!$('#customModelRow').hidden) $('#customModel').focus(); });
  renderModels();
  let aiItems = [], aiBusy = false, aiExpected = 0, aiDoneStreaming = false;
  const GENERIC = new Set(['icon', 'image', 'frame', 'group', 'vector', 'rectangle', 'shape', 'component', 'layer', 'screen', 'card', 'element', 'item', 'picture', 'graphic']);

  function aiStatus(msg, err) { const s = $('#aiStatus'); s.textContent = msg || ''; s.style.color = err ? 'var(--danger)' : ''; }
  function aiReset() { aiItems = []; aiBusy = false; $('#aiRows').innerHTML = ''; $('#aiApply').hidden = true; $('#aiAll').hidden = true; aiStatus(''); }
  const targets = () => ({ icons: $('#t_icons').checked, art: $('#t_art').checked, images: $('#t_images').checked, screens: $('#t_screens').checked, cards: $('#t_cards').checked, components: $('#t_components').checked, text: $('#t_text').checked, shapes: $('#t_shapes').checked });

  $('#apiKey').addEventListener('change', () => { aiKeys[provider()] = $('#apiKey').value.trim(); send({ type: 'ai_key_set', provider: provider(), key: aiKeys[provider()] }); });
  $('#aiSuggest').onclick = () => {
    const key = $('#apiKey').value.trim();
    if (!key && provider() !== 'proxy') { aiStatus(`Paste a ${PROVIDERS[provider()].label} API key first.`, true); $('#apiKey').focus(); return; }
    if (!modelId() && provider() !== 'proxy') { aiStatus('Enter a model ID.', true); $('#customModel').focus(); return; }
    if (provider() === 'proxy' && !/^https?:\/\//.test(proxyUrl())) { aiStatus('Enter the server URL, e.g. http://localhost:8000', true); $('#proxyUrl').focus(); return; }
    if (aiBusy) return;
    aiItems = []; aiExpected = 0; aiDoneStreaming = false; aiBusy = true;
    $('#aiRows').innerHTML = ''; $('#aiApply').hidden = true; $('#aiAll').hidden = true;
    setBusy(true, 'Exporting thumbnails…'); aiStatus('Exporting thumbnails…');
    send({ type: 'ai_prepare', targets: targets(), maxItems: Math.max(1, Math.min(2000, +$('#t_max').value || 300)) });
  };
  $('#aiAll').onclick = () => { const boxes = [...document.querySelectorAll('#aiRows input[type=checkbox]')]; const all = boxes.every((b) => b.checked); boxes.forEach((b) => (b.checked = !all)); updateApplyCount(); };
  $('#aiApply').onclick = () => {
    const renames = [];
    document.querySelectorAll('#aiRows .ai-row').forEach((row) => {
      if (!row.querySelector('input[type=checkbox]').checked) return;
      const it = aiItems[+row.dataset.i]; const name = row.querySelector('input[type=text]').value.trim();
      if (name) renames.push({ ids: it.ids, name, category: it.category, kind: it.kind && it.kind !== 'abstract' ? it.kind : it.category });
    });
    if (!renames.length) return;
    setBusy(true, 'Renaming…'); aiStatus('Renaming…');
    send({ type: 'ai_apply', renames, prefix: normPrefix($('#prefix').value), usePrefix: $('#t_prefix').checked });
  };
  $('#aiRows').addEventListener('change', (e) => { if (e.target.type === 'checkbox') updateApplyCount(); });
  $('#aiRows').addEventListener('input', (e) => { if (e.target.type === 'text') { const cb = e.target.closest('.ai-row').querySelector('input[type=checkbox]'); cb.checked = !!e.target.value.trim(); updateApplyCount(); } });
  function updateApplyCount() { const n = document.querySelectorAll('#aiRows input[type=checkbox]:checked').length; $('#aiApply').textContent = `Apply ${n} name${n === 1 ? '' : 's'}`; $('#aiApply').disabled = !n; }

  async function aiReceive(m) {
    for (const it of m.items) {
      try { it.dataUrl = await toThumb(it.png, it.category === 'icon'); } catch { it.dataUrl = null; }
      delete it.png;
      if (it.dataUrl) aiItems.push(it);
    }
    aiExpected = m.total;
    aiStatus(`Exported ${aiItems.length} of ${m.total} thumbnails…`);
    if (m.done) { aiDoneStreaming = true; setBusy(false); await aiRun(); }
  }

  // composite on white, cap the long edge, return a PNG data URL
  async function toThumb(bytes, pad) {
    const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    const scale = Math.min(1, MAX_EDGE / Math.max(bmp.width, bmp.height));
    const p = pad ? 16 : 8;
    const c = document.createElement('canvas'); c.width = Math.round(bmp.width * scale) + p * 2; c.height = Math.round(bmp.height * scale) + p * 2;
    const g = c.getContext('2d'); g.fillStyle = '#ffffff'; g.fillRect(0, 0, c.width, c.height);
    g.drawImage(bmp, p, p, Math.round(bmp.width * scale), Math.round(bmp.height * scale));
    bmp.close && bmp.close();
    return c.toDataURL('image/png');
  }

  const SYSTEM = `You name layers in a Figma design file. You will receive numbered images with a context line for each (category, current layer name, text found inside).
For every image return a short, specific, lowercase kebab-case name (1-4 words) describing what it visually depicts or, for UI pieces, what it is for.
Rules:
- Icons: name the pictogram by its meaning: search, arrow-left, settings, heart-filled, chevron-down, user-circle.
- Images and avatars: name the subject: mountain-lake-hero, woman-headshot, product-shoe-red.
- Screens, sections, nav: name the purpose: login, checkout-summary, hero-banner, footer-links, top-nav.
- Cards and list items: name the content: pricing-plan-pro, order-row, testimonial-quote.
- Components: name the role and variant hint: primary-button, search-input, avatar-with-status.
- Plain shapes: describe them: rounded-panel-bg, circle-badge, divider-line.
- Taglines and copy: name by the message, not the words: welcome-tagline, pricing-intro, footer-legal.
- Never use generic words alone (icon, image, frame, vector, rectangle, shape, component). Do not include prefixes or slashes. Do not invent brand names you cannot see — but if a wordmark is legible, use it (owting-logo). If text is visible, prefer names that use it.
Also classify each item with "kind", choosing the best of: icon, symbol, logo, character, illustration, image, avatar, screen, section, nav, card, list-item, button, badge, input, tagline, copy, shape, debris, abstract. The provided category is a guess from geometry — correct it when the picture says otherwise (a "symbol" that is clearly a mascot is a character; a "illustration" that is a wordmark is a logo; a stray speck is debris).
- A character is a figure with a face, body or pose (mascot, animal, person). An illustration is a scene or object without a face. A logo is a mark, wordmark or lockup that identifies a brand.
- If a shape is too abstract to name honestly, set "kind": "abstract" and "name": "" — the designer will name it. Do not guess.
- REFERENCES, when provided, are already-named characters and logos from this project. If an item is another view, crop, pose or partial of a reference (its back, its side, a detail), name it <reference-name>-<view>, e.g. owl-mascot-back, and use the same kind.
Return ONLY a JSON array, no prose, no code fence: [{"i":0,"name":"search","what":"magnifying glass outline","kind":"icon","confidence":0.95}, ...] with one entry per image, in order. Confidence 0-1.`;

  async function aiRun() {
    if (!aiItems.length) { aiBusy = false; aiStatus('Nothing to name in the selected categories.'); return; }
    const key = $('#apiKey').value.trim(), model = modelId();
    const batches = []; for (let i = 0; i < aiItems.length; i += BATCH) batches.push(aiItems.slice(i, i + BATCH));
    let done = 0, failed = 0;
    aiStatus(`Naming ${aiItems.length} items in ${batches.length} calls…`);
    let cursor = 0;
    async function worker() {
      while (cursor < batches.length) {
        const b = batches[cursor++];
        try { await aiName(b, key, model); } catch (e) { failed += b.length; b.forEach((it) => (it.error = String(e.message || e))); }
        done++; aiStatus(`Named batch ${done}/${batches.length}${failed ? ` · ${failed} failed` : ''}`);
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, batches.length) }, worker));
    try { await reconcileCharacters(key, model); } catch {}
    dedupeNames();
    // rows that need a human first, then low confidence, then the rest
    aiItems.sort((a, b) => (b.needsName ? 1 : 0) - (a.needsName ? 1 : 0) || (a.confidence || 0) - (b.confidence || 0));
    renderAi();
    aiBusy = false;
    const ok = aiItems.filter((it) => it.suggested).length, todo = aiItems.filter((it) => it.needsName).length;
    aiStatus(ok ? `${ok} names suggested${todo ? ` · ${todo} need your name (listed first)` : ''}. Edit any, untick what to skip, then apply.` : `No names came back. ${aiItems[0] && aiItems[0].error ? aiItems[0].error : ''}`, !ok);
  }

  function contextLine(it, i) { return `#${i} · category: ${it.category} · current name: "${it.name}"${it.desc ? ` · geometry: ${it.desc}` : ''}${it.text ? ` · text: "${it.text.slice(0, 60)}"` : ''} · ${it.w}×${it.h}px`; }
  const closing = (n) => `Name and classify all ${n} images (#0 to #${n - 1}). JSON array only.`;
  // provider-neutral message: [{text}|{image}] — references (already-named characters/logos) go first
  function segmentsFor(batch, refs) {
    const seg = [];
    if (refs && refs.length) {
      seg.push({ text: 'REFERENCES — characters and logos already named in this project. Do not name these; use them to recognise other views of the same thing.' });
      refs.forEach((r, i) => { seg.push({ text: `R${i}: "${r.suggested}" — ${r.what || ''} (${r.kind || ''})` }); seg.push({ image: r.dataUrl }); });
      seg.push({ text: 'Items to name follow.' });
    }
    batch.forEach((it, i) => { seg.push({ text: contextLine(it, i) }); seg.push({ image: it.dataUrl }); });
    seg.push({ text: closing(batch.length) });
    return seg;
  }

  async function postJson(url, headers, body, retry) {
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
    if (res.status === 429 || res.status >= 500) {
      if (retry > 0) { await new Promise((r) => setTimeout(r, 2500)); return postJson(url, headers, body, retry - 1); }
      throw new Error(`API ${res.status}: rate limited or unavailable`);
    }
    if (!res.ok) {
      let msg = `API ${res.status}`;
      try { const j = await res.json(); msg = (j.error && j.error.message) || msg; } catch {}
      throw new Error(msg);
    }
    return res.json();
  }

  async function callClaude(segments, key, model) {
    const content = segments.map((s) => s.image ? { type: 'image', source: { type: 'base64', media_type: 'image/png', data: s.image.split(',')[1] } } : { type: 'text', text: s.text });
    const data = await postJson(CLAUDE_URL, { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
      { model, max_tokens: 1500, system: SYSTEM, messages: [{ role: 'user', content }] }, 1);
    return (data.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('');
  }

  async function callGemini(segments, key, model) {
    const parts = segments.map((s) => s.image ? { inlineData: { mimeType: 'image/png', data: s.image.split(',')[1] } } : { text: s.text });
    const data = await postJson(GEMINI_URL(model), { 'x-goog-api-key': key },
      { systemInstruction: { parts: [{ text: SYSTEM }] }, contents: [{ role: 'user', parts }], generationConfig: { responseMimeType: 'application/json', temperature: 0.2, maxOutputTokens: 4096 } }, 1);
    const cand = (data.candidates || [])[0];
    if (!cand) throw new Error((data.promptFeedback && data.promptFeedback.blockReason) ? `Blocked: ${data.promptFeedback.blockReason}` : 'Empty response');
    return ((cand.content && cand.content.parts) || []).map((p) => p.text || '').join('');
  }

  async function callProxy(batch, key, model, refs) {
    const [up, upModel] = (model === '__custom' ? $('#customModel').value.trim() : model).split(':');
    const body = {
      provider: up || 'anthropic', model: upModel || null, api_key: key || null,
      project: $('#project').value.trim() || 'default', critic: $('#p_critic').checked, learn: $('#p_learn').checked,
      items: batch.map((it) => ({ key: it.key, category: it.category, name: it.name, text: it.text || '', desc: it.desc || '', w: it.w, h: it.h, image: it.dataUrl.split(',')[1] })),
      references: (refs || []).map((r) => ({ name: r.suggested, what: r.what || '', kind: r.kind || r.category, image: r.dataUrl.split(',')[1] })),
    };
    const data = await postJson(`${proxyUrl()}/name`, {}, body, 1);
    const byKey = new Map((data.results || []).map((r) => [r.key, r]));
    for (const it of batch) {
      const r = byKey.get(it.key); if (!r) continue;
      it.kind = r.kind || it.category; it.source = r.source; it.confidence = r.confidence;
      if (r.kind === 'abstract' || !r.name) { it.suggested = ''; it.needsName = true; it.what = r.what || 'too abstract to name'; continue; }
      it.suggested = r.name; it.what = r.what || ''; it.needsName = false;
      if (r.note) it.what = `${it.what}${it.what ? ' · ' : ''}${r.note}`;
    }
  }

  const KINDS = new Set(['icon', 'symbol', 'logo', 'character', 'illustration', 'image', 'avatar', 'screen', 'section', 'nav', 'card', 'list-item', 'button', 'badge', 'input', 'tagline', 'copy', 'shape', 'debris', 'abstract']);
  function applyRows(batch, arr) {
    for (const e of arr) {
      const it = batch[+e.i]; if (!it) continue;
      const kind = KINDS.has(e.kind) ? e.kind : it.category;
      const conf = typeof e.confidence === 'number' ? Math.max(0, Math.min(1, e.confidence)) : 0.7;
      const name = String(e.name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
      it.kind = kind; it.confidence = conf; it.what = String(e.what || '').slice(0, 90);
      if (kind === 'abstract' || !name || GENERIC.has(name)) { it.suggested = ''; it.needsName = true; it.kind = kind === 'abstract' ? it.category : kind; if (!it.what) it.what = 'too abstract to name'; }
      else { it.suggested = name; it.needsName = false; }
    }
  }

  async function aiName(batch, key, model, refs = []) {
    if (provider() === 'proxy') { await callProxy(batch, key, model === '__custom' ? '__custom' : model, refs); return; }
    const segments = segmentsFor(batch, refs);
    const text = provider() === 'gemini' ? await callGemini(segments, key, model) : await callClaude(segments, key, model);
    const m = text.match(/\[[\s\S]*\]/);
    if (!m) throw new Error('Model did not return JSON');
    let arr; try { arr = JSON.parse(m[0]); } catch { throw new Error('Could not parse model JSON'); }
    applyRows(batch, arr);
  }

  // second look: low-confidence characters/illustrations/symbols get another pass with the confidently-named characters and logos as references
  async function reconcileCharacters(key, model) {
    const refs = aiItems.filter((it) => it.suggested && (it.kind === 'character' || it.kind === 'logo') && (it.confidence || 0) >= 0.8).slice(0, 6);
    const cands = aiItems.filter((it) => ['character', 'illustration', 'symbol', 'abstract'].includes(it.kind || it.category) && (it.needsName || (it.confidence || 0) < 0.7) && !refs.includes(it));
    if (!refs.length || !cands.length) return 0;
    aiStatus(`Second look at ${cands.length} items using ${refs.length} reference character${refs.length === 1 ? '' : 's'}…`);
    let changed = 0;
    for (let i = 0; i < cands.length; i += 8) {
      const b = cands.slice(i, i + 8);
      const before = b.map((it) => it.suggested);
      try { await aiName(b, key, model, refs); } catch (e) { continue; }
      b.forEach((it, n) => { if (it.suggested && it.suggested !== before[n]) { changed++; it.source = 'reference'; } });
    }
    return changed;
  }

  function dedupeNames() {
    const seen = new Map();
    for (const it of aiItems) {
      if (!it.suggested) continue;
      const k = `${it.category}|${it.suggested}`; const n = (seen.get(k) || 0) + 1; seen.set(k, n);
      if (n > 1) it.suggested = `${it.suggested}-${n}`;
    }
  }

  function renderAi() {
    $('#aiRows').innerHTML = aiItems.map((it, i) => `<div class="ai-row" data-i="${i}" ${it.needsName ? 'style="background:var(--bg2);margin:0 -16px;padding:5px 16px"' : ''}>
      <input type="checkbox" ${it.suggested ? 'checked' : ''} ${it.suggested || it.needsName ? '' : 'disabled'} />
      <img src="${it.dataUrl}" alt="" />
      <div>
        <input type="text" value="${esc(it.suggested || '')}" placeholder="${it.needsName ? 'Too abstract for the model — name it' : it.error ? esc(it.error) : 'no suggestion'}" ${it.suggested || it.needsName ? '' : 'disabled'} ${it.needsName ? 'style="border-color:var(--line)"' : ''} />
        <div class="old"><b>${esc(it.kind && it.kind !== it.category ? `${it.category} → ${it.kind}` : it.category)}</b>${it.source ? ` · ${esc(it.source)}` : ''}${typeof it.confidence === 'number' ? ` · ${Math.round(it.confidence * 100)}%` : ''} · was "${esc(it.name)}"${it.ids.length > 1 ? ` · ${it.ids.length} layers` : ''}${it.what ? ` · ${esc(it.what)}` : ''}</div>
      </div>
    </div>`).join('');
    $('#aiApply').hidden = false; $('#aiAll').hidden = false;
    updateApplyCount();
    $('#aiSec').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ---------- tiny store-only zip writer ----------
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc32(u8) { let c = 0xFFFFFFFF; for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
  function zip(files) {
    const enc = new TextEncoder(), parts = [], central = []; let offset = 0;
    const u16 = (n) => [n & 255, (n >> 8) & 255], u32 = (n) => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255];
    const d = new Date(), dosTime = ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)) & 0xFFFF, dosDate = (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xFFFF;
    for (const [name, content] of Object.entries(files)) {
      const n = enc.encode(name), data = enc.encode(content), crc = crc32(data);
      const head = new Uint8Array([0x50, 0x4B, 3, 4, ...u16(20), ...u16(0x800), ...u16(0), ...u16(dosTime), ...u16(dosDate), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(n.length), ...u16(0)]);
      parts.push(head, n, data);
      central.push(new Uint8Array([0x50, 0x4B, 1, 2, ...u16(20), ...u16(20), ...u16(0x800), ...u16(0), ...u16(dosTime), ...u16(dosDate), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(n.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset)]), n);
      offset += head.length + n.length + data.length;
    }
    const cdSize = central.reduce((a, b) => a + b.length, 0);
    const end = new Uint8Array([0x50, 0x4B, 5, 6, ...u16(0), ...u16(0), ...u16(central.length / 2), ...u16(central.length / 2), ...u32(cdSize), ...u32(offset), ...u16(0)]);
    return new Blob([...parts, ...central, end], { type: 'application/zip' });
  }
</script>
````

## File: ds-foundry/.gitignore
````
node_modules/
.DS_Store
````

## File: ds-foundry/CHANGELOG.md
````markdown
# Changelog

## 1.4.0 — 2026-09-12

- **Every vector gets a name.** New classes `symbol`, `illustration`, `logo`, `character`, `tagline`, `copy`, `shape`, `debris`; geometry-derived fallback names (`navy-outline-blob-56x30`, `navy-14-piece-250x270`) replace Figma auto names so nothing stays "Vector 123".
- **Debris detection** (specks, empty paths, invisible fragments) with **Select on page** in the Elements tab.
- **AI naming returns `kind`** and may reclassify; `abstract` answers are queued for the designer instead of guessed; a **reference pass** re-examines low-confidence characters, illustrations and symbols against confidently named characters and logos (other views: `owl-mascot-back`). Proxy mode sends and receives references.
- New AI targets: logos/characters/illustrations, taglines/copy.
- **`DS · Assets` contact sheet**: index plus Logos, Characters, Illustrations, Symbols, Icons, Buttons & badges, Taglines, Copy, Vectors & shapes, Debris; distinct items only, vector classes promoted to components.

## 1.3.2 — 2026-09-12

- Manifest fix: `devAllowedDomains` now lists only `http://localhost:8000`. Figma's manifest validator accepts domain and localhost patterns but not IP literals, and `http://127.0.0.1:8000` made Figma flag the plugin with "Manifest issue".

## 1.3.1 — 2026-09-12

- Packaging only: removed a stray empty `{src,ui,dist,tools}` folder that shipped in earlier zips. No code changes.

## 1.3.0 — 2026-09-11

- **Proxy provider** for AI naming: talk to the companion `ds-foundry-server` (FastAPI + LangGraph) with project namespaces, critic and learn toggles, upstream provider/model selection, and source/confidence shown per row.
- Manifest `devAllowedDomains` for `localhost:8000` / `127.0.0.1:8000`.

## 1.2.0 — 2026-09-11

- **Gemini support** for AI naming: choose Claude or Gemini per run, with separate stored keys. Gemini calls use `generateContent` with system instructions, inline PNG parts and JSON response mode.
- **Custom model ID** option for both providers.
- Manifest allows `generativelanguage.googleapis.com` in addition to `api.anthropic.com`.

## 1.1.0 — 2026-09-11

- **AI naming**: name icons, images, screens, sections, nav bars, cards, list items, local components and plain shapes by what they visually show, using the Claude API with your own key (stored in Figma client storage). Distinct items are thumbnailed, batched 10 per request, reviewed in an editable list, then applied with the same reversible label mechanism.
- Inventory now records plain shapes (for AI naming only).
- Manifest allows network access to `api.anthropic.com` only.

## 1.0.0 — 2026-09-11

First release.

- Scan selection, page or document; non-blocking with Stop.
- Inventory: colours, text styles, spacing, radii, effects, elements by category, icons, components in use, missing fonts.
- Semantic naming: colour roles (primary/secondary/neutral/error/success/warning/info) with 500-anchored steps; type roles by size and weight; spacing snapped to a 4 or 8 grid; radius t-shirt sizes; elevation ranking.
- Build: layer labels (reversible), colour/text/effect styles, `DS Foundry / Primitives` variables bound to colour styles, `DS · Foundations`, `DS · Components` (variant sets sampled from the file + existing-component gallery), `DS · Icons`, optional screen arrangement.
- Export: DTCG `tokens.json`, `tokens.css`, `tailwind.tokens.cjs`, `DESIGN_SYSTEM.md`, `inventory.json`, single-zip download.
````

## File: ds-foundry/IDE_PROMPT.md
````markdown
# IDE prompt — DS Foundry

Paste this into Claude Code / Cursor when working in this repo.

---

You are working on **DS Foundry**, a Figma plugin (TypeScript, esbuild, `@figma/plugin-typings`) that scans a Figma file and generates a design system from it. Read `README.md` first.

Architecture:
- `src/code.ts` — main-thread entry; routes `scan`, `relabel`, `build`, `revert`, `cancel` messages from the UI.
- `src/scan.ts` — iterative walk of the selected scope; collects `Inventory` (colours, type, spacing, radii, effects, elements, icons, components in use). Must stay non-blocking: call `await tick()` every few hundred nodes and check `cancelled`.
- `src/classify.ts` — pure heuristics returning a `Category` per node plus a `desc` (geometry description used as the fallback name: `describeShape` for primitives/paths, `describeGroup` for vector groups). Tiers: icon ≤ 64 px → symbol ≤ 200 px / few pieces → illustration; logo by lockup shape or name; debris for specks/empty/invisible; tagline/copy for text. `character` is only ever assigned by AI naming (`kind`). Keep it deterministic and free of side effects; `isDefaultName` in `naming.ts` decides when a Figma auto name is replaced by `desc`.
- `src/naming.ts` — token names (`primary/500`, `heading/lg/semibold`, `space/8`, `radius/md`, `elevation/2`) and layer labels (`ds/button/primary-md/sign-up`).
- `src/build.ts` — creates styles, variables, the four `DS · …` pages (Foundations, Components, Icons, Assets — `buildAssets` reads `dsf.category` plugin data first so AI reclassifications regroup the contact sheet), component sets, icon components; everything it creates carries plugin data `dsf.generated = "1"` so a rebuild can replace it. Never mutate the user's original nodes except renaming (which stores `dsf.originalName`).
- `src/ai.ts` — AI naming. Main thread picks distinct candidates (icons, images, screens/sections/nav, cards/list items, local components, shapes), exports PNG thumbnails with `exportAsync`, streams them to the UI as `ai_items` chunks, and applies chosen names on `ai_apply`. The UI (`ui/ui.html`) composites thumbnails on white, calls the chosen provider directly — Claude at `https://api.anthropic.com/v1/messages` (BYOK, header `anthropic-dangerous-direct-browser-access: true`, IDs `claude-sonnet-5` / `claude-haiku-4-5` / `claude-opus-5`) or Gemini at `https://generativelanguage.googleapis.com/v1beta/models/{id}:generateContent` (`x-goog-api-key`, `systemInstruction`, `inlineData` parts, `responseMimeType: application/json`; IDs `gemini-3.7-flash` / `gemini-3.8-flash` / `gemini-3.5-flash-lite` / `gemini-3.1-pro-preview`, plus a custom-ID field) — 10 images per request, 3 concurrent, then renders an editable review list. Providers are a `PROVIDERS` table plus `callClaude` / `callGemini` / `callProxy` (the last posts `NameRequest` batches to the companion `ds-foundry-server` and reads `NameResponse`); add a provider by adding an entry and a caller that returns the model's text. Keys live per provider in `figma.clientStorage`.
- `src/tokens.ts` — DTCG `tokens.json`, `tokens.css`, `tailwind.tokens.cjs`, `DESIGN_SYSTEM.md`, `inventory.json`.
- `ui/ui.html` — single-file panel; copied verbatim to `dist/ui.html`. Uses Figma theme CSS variables. Downloads are built client-side (includes a store-only zip writer).

Constraints:
- `manifest.json` uses `documentAccess: "dynamic-page"`: use the `*Async` APIs (`getNodeByIdAsync`, `getLocalPaintStylesAsync`, `setTextStyleIdAsync`, `loadAllPagesAsync`, `setCurrentPageAsync`). Load a page with `page.loadAsync()` before touching its children.
- Load fonts with `figma.loadFontAsync` before setting `characters`, `fontName` or text-style properties; fall back to Inter Regular.
- `networkAccess.allowedDomains` is `["https://api.anthropic.com", "https://generativelanguage.googleapis.com"]` only — no other external requests or scripts in the UI.
- Run `npm run check` (tsc + esbuild) before finishing. `dist/` is committed so the plugin imports without a build step.
- Semver: bump `package.json`, `README.md` heading, the version in `src/tokens.ts` and the header in `ui/ui.html` together; add a `CHANGELOG.md` entry; release as `ds-foundry-vX.Y.Z.zip` excluding `node_modules`.

Roadmap candidates (pick one at a time):
1. Semantic variable collection (`bg/surface`, `text/primary`, `border/subtle`) aliased to primitives, with light/dark modes inferred from screen fills.
2. "Replace originals with instances" — swap sampled buttons/badges in the source screens for instances of the generated variants, matching by fingerprint.
3. Gradient and image-fill tokens; per-corner radius tokens.
4. Export to Style Dictionary / Tokens Studio JSON and a Storybook MDX doc.
5. Smarter icon dedupe using `vectorNetwork` hashing instead of name + size + child count.
6. Per-category confidence scores in the inventory tab, with a manual override before Build.
7. AI naming v2: let the model also re-classify (button vs badge vs input) and describe component variants as `Prop=Value` names; use the Message Batches API for very large files.
````

## File: ds-foundry/manifest.json
````json
{
  "name": "DS Foundry",
  "id": "1000000000000000101",
  "api": "1.0.0",
  "main": "dist/code.js",
  "ui": "dist/ui.html",
  "editorType": ["figma"],
  "documentAccess": "dynamic-page",
  "networkAccess": {
    "allowedDomains": ["https://api.anthropic.com", "https://generativelanguage.googleapis.com"],
    "devAllowedDomains": ["http://localhost:8000"],
    "reasoning": "Optional AI naming sends layer thumbnails to the Claude API or the Gemini API using the user's own API key, or to a local DS Foundry naming server (LangGraph) on localhost."
  }
}
````

## File: ds-foundry/package.json
````json
{
  "name": "ds-foundry",
  "version": "1.4.0",
  "description": "Figma plugin that scans any file, labels and organises its layers, and builds a design system (styles, variables, components, icons, token files) from what it finds.",
  "private": true,
  "scripts": {
    "build": "esbuild src/code.ts --bundle --target=es2020 --format=iife --outfile=dist/code.js && node tools/copy-ui.mjs",
    "watch": "esbuild src/code.ts --bundle --target=es2020 --format=iife --outfile=dist/code.js --watch",
    "typecheck": "tsc --noEmit",
    "check": "npm run typecheck && npm run build"
  },
  "devDependencies": {
    "@figma/plugin-typings": "^1.100.0",
    "esbuild": "^0.23.0",
    "typescript": "^5.5.4"
  }
}
````

## File: ds-foundry/README.md
````markdown
# DS Foundry 1.4.0

A Figma plugin that reads any file (or app, or selection), labels and tags its layers, and builds a design system from what it finds: colour, text and effect styles; a variables collection; component sets sampled from real buttons, inputs, cards and nav bars; an icon library; documented foundation pages; and token files ready for code.

Nothing in the file changes until you press **Build**. Labels are reversible.

## Install (development plugin, no build step needed)

1. Unzip. `dist/` already contains the compiled plugin.
2. In the Figma desktop app: **Plugins → Development → Import plugin from manifest…**
3. Pick `manifest.json` from this folder.
4. Open any file and run **Plugins → Development → DS Foundry**.

## Use

1. Choose a scope — **Selection**, **Page** or **Document** — and press **Scan**.
   The inventory shows everything found: colours (with proposed names), text styles, spacing scale, radii, effects, recognised elements, icons, and components already in use.
2. Set the **prefix** (default `ds/`) and the **grid** spacing snaps to (4 or 8).
3. Tick what to build and press **Build design system**.
4. Download the token files: `tokens.json` (W3C DTCG), `tokens.css`, `tailwind.tokens.cjs`, `DESIGN_SYSTEM.md`, `inventory.json`, or all of them as one zip.

Re-running Build replaces the pages it generated and updates styles and variables in place, so you can scan → tweak → rebuild without duplicates. **Revert labels** restores every original layer name.

## AI naming (optional)

Heuristic labels tell you *what kind* of thing a layer is. AI naming tells you *what it shows*: `ds/icon/arrow-left` instead of `ds/icon/vector-14`, `ds/screen/checkout-summary` instead of `ds/screen/frame-3`, `ds/image/mountain-lake-hero`, `ds/card/pricing-plan-pro`, `ds/primary-button` for a component.

1. Scan, then pick a provider in the **AI naming** section — **Claude** (Anthropic API key) or **Gemini** (Google AI Studio key) — and paste the key. Keys are saved in Figma's client storage on this machine only and sent straight to that provider — nothing goes anywhere else.
2. Pick a model and tick what to name: icons, images and avatars, screens/sections/nav, cards and list items, local components, plain shapes.
   - Claude: Sonnet 5 (default), Haiku 4.5 (cheapest), Opus 5.
   - Gemini: 3.7 Flash (default), 3.8 Flash, 3.5 Flash-Lite (cheapest), 3.1 Pro preview.
   - **Custom model ID…** lets you type any model ID either provider offers, so new releases work without a plugin update.
   - **Proxy (LangGraph server)** sends batches to the companion `ds-foundry-server` on `http://localhost:8000` instead. That adds a critic pass, a per-project glossary that keeps names consistent across files, and a cache, and lets you route to Claude, Gemini or a local Ollama model from one place. Each review row then shows its source (`model`, `critic`, `glossary`, `cache`) and confidence. Localhost access is allowed via `devAllowedDomains` in the manifest, which Figma honours for development plugins. Keep the server on `localhost` (not `127.0.0.1`) — Figma's manifest validator only accepts domain and localhost patterns.
3. **Suggest names** exports a small thumbnail of each distinct item (identical layers are grouped by fingerprint and named once), composites it on white, and sends batches of 10 images per request, three requests at a time. Each item comes back with a name and a five-word description.
4. Review the list — edit any name inline, untick anything you don't want — then **Apply names**. Original names are stored, so **Revert labels** undoes this too.

Variants inside a component set are never renamed (that would rewrite their properties); the set itself is. With **Add prefix and category path** on, names become `ds/<category>/<name>`; off, the bare name is used.

Cost is small: thumbnails are capped at 384 px, so a 300-item run is roughly 300 images and 30 short requests. Both providers are called directly from the plugin panel (Claude with the `anthropic-dangerous-direct-browser-access` header, Gemini via `generateContent` in JSON mode). To route through your own proxy instead, change `CLAUDE_URL` / `GEMINI_URL` in `ui/ui.html` and the domains in `manifest.json`.

## Assets: every vector named, nothing left as "Vector 123"

The scan sorts drawn things into tiers by geometry, and every one gets a name even before AI runs:

| Class | How it's recognised | Fallback name |
|---|---|---|
| **icon** | vector-only, ≤ 64 px, roughly square | `ds/icon/<layer-name>` |
| **symbol** | vector-only, 64–200 px, few pieces (ornaments, marks, single big paths) | `ds/symbol/navy-outline-160x120` |
| **illustration** | vector-only, > 200 px or many pieces (scenes, objects, drawn figures) | `ds/illustration/navy-14-piece-250x270` |
| **logo** | wide vector lockup with several pieces, a vector mark + text, or "logo/wordmark/brand" in the name | `ds/logo/<wordmark-text>` |
| **character** | assigned by AI naming when the picture has a face, body or pose | `ds/character/owl-mascot` |
| **tagline** | short multi-word text, 14–34 px, no terminal punctuation | `ds/tagline/<words>` |
| **copy** | text over 90 chars or more than two lines | `ds/copy/<first-words>` |
| **shape** | plain rect/ellipse/line/polygon/star or leftover path | `ds/shape/navy-pill-120x40`, `ds/shape/cyan-blob-56x30` |
| **debris** | specks under 6 px, empty paths, invisible or zero-opacity fragments | `ds/debris/black-speck-3x2` |

Geometry names read colour + form + size: `pale-blue-blob`, `navy-outline-curve`, `orange-circle`, `white-rounded-rect`, `gray-line`. Figma's auto names (Vector 12, Group 7) are treated as meaningless and replaced; a name you gave a layer is kept.

**Debris** is listed on the contact sheet and, in the plugin's Elements tab, **Select on page** selects every debris layer on the current page so you can delete it in one keystroke.

**AI naming** now also returns a `kind` for each item and may reclassify — a "symbol" that is clearly a mascot becomes a `character`, an "illustration" that is a wordmark becomes a `logo`. Two more behaviours:

- **Too abstract → you name it.** The model is told to answer `abstract` instead of guessing. Those rows appear first in the review list, highlighted, with an empty box; type a name and it's applied with the rest.
- **Other views of a character.** Characters and logos named with ≥ 80% confidence become references. Low-confidence characters, illustrations and symbols get a second look with those references attached, so the back of the owl becomes `owl-mascot-back` rather than "green-bird-shape". In Proxy mode the server keeps references (with thumbnails) per project, so the next file recognises the mascot on the first pass.

**Assets contact sheet** (`DS · Assets`, on by default) lays all of this out on one page: an index, then Logos, Characters, Illustrations, Symbols & ornaments, Icons, Buttons & badges, Taglines, Copy, Vectors & shapes, Debris — one cell per distinct thing (identical layers collapse with a ×count), each vector-class cell promoted to a component carrying its name. Run AI naming and apply before building it and the sheet uses those names and reclassifications.

## What gets built

| Option | Result |
|---|---|
| Label layers | Every recognised element gets tagged with its category in plugin data and, if *Rename* is on, renamed to a searchable path such as `ds/button/primary-md/sign-up`, `ds/card/pricing`, `ds/icon/arrow-left`, `ds/screen/home`. Original names are stored so they can be restored. Text layers are optional (renaming them turns off Figma's auto-naming). |
| Styles | Local colour styles (`ds/color/primary/500`), text styles (`ds/text/heading/lg/semibold`) and effect styles (`ds/effect/elevation/2`). Colour styles are bound to variables when a variable was created. |
| Variables | A `DS Foundry / Primitives` collection with `color/…`, `space/…` and `radius/…` variables, scoped appropriately. Falls back gracefully on plans with variable limits. |
| Foundations page | `DS · Foundations` — swatch boards grouped by role, type specimens using the real styles, spacing bars, radius tiles and elevation cards. |
| Components page | `DS · Components` — for each category (button, input, badge, checkbox, toggle, avatar, list item, card, nav, section) distinct instances are cloned, promoted to components and combined into a variant set named `ds/button`, with `Style` and `Size` properties. A gallery of components already used in the file is placed below. Originals are never modified. |
| Icons page | `DS · Icons` — every unique icon-like vector is centred on a square frame and made a component named `ds/icon/<name>`. |
| Assets contact sheet | `DS · Assets` — see the Assets section above. |
| Arrange screens | Optional: top-level frames on the scanned pages are lined up in rows by device width (mobile / tablet / desktop). Off by default because it moves things. |

## How it decides what things are

Classification is heuristic and needs no naming conventions in the source file:

- **Colour roles** — greys become `neutral` (white = `neutral/0`, black = `neutral/1000`). The most-used chromatic hue family becomes `primary`, the next `secondary`; remaining families map to `error` (red), `success` (green), `warning` (yellow/orange), `info` (blue) or their hue name. Within a family the most-used colour anchors at `500` and the rest spread by lightness.
- **Typography** — unique combinations of font, style, size, line height and letter spacing. Roles by size: `display` ≥ 40, `heading` ≥ 24, `title` ≥ 18, `body` ≥ 14, `caption` below. Sizes inside a role get `xl/lg/md/sm/xs`; weight from the font style.
- **Spacing** — auto-layout padding and gaps, snapped to the chosen grid. **Radius** — corner radii, `full` for pill shapes. **Effects** — shadows ranked by depth as `elevation/n`, blurs as `blur/n`.
- **Elements** — buttons are compact containers with one short text and a fill or stroke; inputs are light, stroked and wide with placeholder-coloured text; badges are ≤ 28px tall; cards are surfaced containers with several children; nav bars are wide, short and near the top of their parent; icons are vector-only subtrees ≤ 64px; avatars are round image fills; screens are top-level frames ≥ 300px.

Instances of existing components are inventoried but never renamed or re-componentised.

## Develop

```bash
npm install
npm run check      # typecheck + build → dist/
npm run watch      # rebuild code.js on change (copy ui.html with `node tools/copy-ui.mjs`)
```

- `src/scan.ts` — walks the document and collects the inventory
- `src/classify.ts` — element heuristics
- `src/naming.ts` — token and label naming
- `src/build.ts` — styles, variables, pages, components, icons, tidy
- `src/tokens.ts` — DTCG / CSS / Tailwind / Markdown exports
- `src/ai.ts` — AI naming: candidate selection, thumbnail export, applying names
- `ui/ui.html` — the panel (single file; copied to `dist/`), including the Claude API client for AI naming

## Known limits

- Gradients and image fills are not tokenised (solid fills and strokes only).
- Text styles for fonts not installed on the machine are skipped and listed in the notes.
- Variant sets sample up to 14 distinct buttons / badges, 8 inputs / cards, 4 nav bars; icons up to 240. Raise the limits in `src/build.ts` if needed.
- Generated pages are placed from `(0, 0)`; if you already have a page named `DS · Foundations`, `DS · Components` or `DS · Icons`, only frames the plugin created are replaced.
- Very large documents: scanning a whole file with tens of thousands of layers takes a while; the panel stays responsive and **Stop** works at any time.
````

## File: ds-foundry/tsconfig.json
````json
{
  "compilerOptions": {
    "target": "ES2020",
    "lib": ["ES2020"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "typeRoots": ["./node_modules/@types", "./node_modules/@figma"]
  },
  "include": ["src/**/*.ts"]
}
````

## File: ds-foundry-server/app/glossary.py
````python
from __future__ import annotations

import json
import os
import re
import threading
import time
from pathlib import Path
from typing import Optional

from .schemas import GlossaryEntry

DATA_DIR = Path(os.environ.get("DSF_DATA_DIR", "data"))
_lock = threading.Lock()

_STOP = {"a", "an", "the", "of", "with", "and", "on", "in", "for", "to", "outline", "filled", "solid", "line", "style"}


def _tokens(s: str) -> set[str]:
    return {t for t in re.split(r"[^a-z0-9]+", s.lower()) if t and t not in _STOP}


def _jaccard(a: set[str], b: set[str]) -> float:
    if not a or not b:
        return 0.0
    return len(a & b) / len(a | b)


def _slug(s: str) -> str:
    return re.sub(r"-+", "-", re.sub(r"[^a-z0-9]+", "-", s.lower())).strip("-")[:40]


class Glossary:
    """Names already accepted for a project, per category, with the descriptions that earned them.

    Matching is deliberately simple: token overlap between the new name+description and each entry's
    name+aliases+description. It keeps "search" from drifting to "magnifier" without needing an embedding model.
    Swap `similar()` for a vector lookup if you outgrow it.
    """

    def __init__(self, project: str):
        self.path = DATA_DIR / "glossary" / f"{_slug(project) or 'default'}.json"
        self.entries: dict[str, GlossaryEntry] = {}
        self._load()

    def _key(self, category: str, name: str) -> str:
        return f"{category}|{name}"

    def _load(self) -> None:
        if self.path.exists():
            try:
                raw = json.loads(self.path.read_text())
                self.entries = {self._key(e["category"], e["name"]): GlossaryEntry(**e) for e in raw}
            except Exception:
                self.entries = {}

    def save(self) -> None:
        with _lock:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            self.path.write_text(json.dumps([e.model_dump() for e in self.entries.values()], indent=2))

    def terms(self, category: Optional[str] = None) -> list[str]:
        out = [e for e in self.entries.values() if category is None or e.category == category]
        out.sort(key=lambda e: -e.uses)
        return [e.name for e in out]

    def similar(self, category: str, name: str, what: str, threshold: float = 0.5) -> Optional[GlossaryEntry]:
        """Return the closest existing entry in the same category, if it is close enough."""
        probe = _tokens(name) | _tokens(what)
        best, score = None, 0.0
        for e in self.entries.values():
            if e.category != category:
                continue
            if e.name == name:
                return e
            ref = _tokens(e.name) | _tokens(e.what) | {t for a in e.aliases for t in _tokens(a)}
            s = _jaccard(probe, ref)
            # exact name-token containment is a strong signal on its own
            if _tokens(e.name) and _tokens(e.name) <= _tokens(name):
                s = max(s, 0.75)
            if s > score:
                best, score = e, s
        return best if best and score >= threshold else None

    def learn(self, category: str, name: str, what: str, alias: Optional[str] = None) -> None:
        k = self._key(category, name)
        e = self.entries.get(k)
        if e:
            e.uses += 1
            if alias and alias != name and alias not in e.aliases:
                e.aliases.append(alias)
            if not e.what and what:
                e.what = what
        else:
            self.entries[k] = GlossaryEntry(category=category, name=name, what=what, aliases=[alias] if alias and alias != name else [], uses=1)

    def upsert(self, entry: GlossaryEntry) -> None:
        self.entries[self._key(entry.category, entry.name)] = entry

    def remove(self, category: str, name: str) -> bool:
        return self.entries.pop(self._key(category, name), None) is not None


class Refs:
    """Confidently named characters and logos, with thumbnails, so later batches and later files can
    recognise their other views. Capped per project; most-used first."""

    MAX = 24

    def __init__(self, project: str):
        self.path = DATA_DIR / "refs" / f"{_slug(project) or 'default'}.json"
        self.rows: list[dict] = []
        if self.path.exists():
            try:
                self.rows = json.loads(self.path.read_text())
            except Exception:
                self.rows = []

    def all(self) -> list[dict]:
        return sorted(self.rows, key=lambda r: -r.get("uses", 0))[: self.MAX]

    def add(self, name: str, what: str, kind: str, image: str) -> None:
        for r in self.rows:
            if r["name"] == name:
                r["uses"] = r.get("uses", 0) + 1
                if what and not r.get("what"):
                    r["what"] = what
                return
        self.rows.append({"name": name, "what": what, "kind": kind, "image": image, "uses": 1, "ts": int(time.time())})
        self.rows = sorted(self.rows, key=lambda r: -r.get("uses", 0))[: self.MAX * 2]

    def save(self) -> None:
        with _lock:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            self.path.write_text(json.dumps(self.rows))


class Cache:
    """fingerprint → accepted result, per project. Re-running on a file you've named is free."""

    def __init__(self, project: str):
        self.path = DATA_DIR / "cache" / f"{_slug(project) or 'default'}.json"
        self.rows: dict[str, dict] = {}
        if self.path.exists():
            try:
                self.rows = json.loads(self.path.read_text())
            except Exception:
                self.rows = {}

    def get(self, key: str) -> Optional[dict]:
        return self.rows.get(key)

    def put(self, key: str, value: dict) -> None:
        self.rows[key] = {**value, "ts": int(time.time())}

    def save(self) -> None:
        with _lock:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            self.path.write_text(json.dumps(self.rows))
````

## File: ds-foundry-server/app/graph.py
````python
from __future__ import annotations

import json
import re
from typing import Any, Optional, TypedDict

from langchain_core.language_models import BaseChatModel
from langchain_core.messages import HumanMessage, SystemMessage
from langgraph.graph import END, StateGraph

from .glossary import Cache, Glossary, Refs, _slug
from .prompts import CRITIC_SYSTEM, NAMER_SYSTEM, glossary_block
from .schemas import KINDS, Item, NameResult, Proposal, Reference, Usage, Verdict

GENERIC = {"icon", "image", "frame", "group", "vector", "rectangle", "shape", "component", "layer", "screen", "card", "element", "item", "picture", "graphic", "button", "text"}
MAX_ROUNDS = 2
REF_KINDS = {"character", "logo"}
RECONCILE_KINDS = {"character", "illustration", "symbol", "abstract"}


class State(TypedDict, total=False):
    items: list[Item]
    references: list[Reference]        # plugin-supplied + stored per project
    pending: list[int]                 # indexes still needing a proposal
    proposals: dict[int, Proposal]
    verdicts: dict[int, Verdict]
    feedback: dict[int, str]           # critic reasons fed back into the next proposal round
    results: dict[int, NameResult]
    round: int
    usage: Usage
    critic: bool
    learn: bool
    use_cache: bool


def _extract_json_array(text: str) -> list[dict[str, Any]]:
    m = re.search(r"\[[\s\S]*\]", text or "")
    if not m:
        raise ValueError("model did not return a JSON array")
    return json.loads(m.group(0))


def _context_line(it: Item, i: int) -> str:
    text = f' · text: "{it.text[:60]}"' if it.text else ""
    geo = f" · geometry: {it.desc}" if it.desc else ""
    return f'#{i} · category: {it.category} · current name: "{it.name}"{geo}{text} · {it.w}×{it.h}px'


def _clean_name(name: str) -> str:
    return _slug(name)


def _message_text(msg: Any) -> str:
    c = getattr(msg, "content", msg)
    if isinstance(c, str):
        return c
    if isinstance(c, list):
        return "".join(p.get("text", "") if isinstance(p, dict) else str(p) for p in c)
    return str(c)


def _reference_blocks(refs: list[Reference]) -> list[dict[str, Any]]:
    if not refs:
        return []
    out: list[dict[str, Any]] = [{"type": "text", "text": "REFERENCES — characters and logos already named in this project. Do not name these; use them to recognise other views of the same thing."}]
    for n, r in enumerate(refs):
        out.append({"type": "text", "text": f'R{n}: "{r.name}" — {r.what} ({r.kind})'})
        out.append({"type": "image_url", "image_url": {"url": f"data:image/png;base64,{r.image}"}})
    out.append({"type": "text", "text": "Items to name follow."})
    return out


def _parse_proposals(rows: list[dict[str, Any]], pending: list[int]) -> dict[int, Proposal]:
    out: dict[int, Proposal] = {}
    for row in rows:
        try:
            n = int(row.get("i"))
        except Exception:
            continue
        if n < 0 or n >= len(pending):
            continue
        i = pending[n]
        kind = str(row.get("kind", "") or "")
        if kind not in KINDS:
            kind = ""
        name = _clean_name(str(row.get("name", "") or ""))
        conf = float(row.get("confidence", 0.7) or 0.7)
        if kind == "abstract":
            name, conf = "", min(conf, 0.3)
        elif not name or name in GENERIC:
            conf = min(conf, 0.3)
        out[i] = Proposal(i=i, name=name, what=str(row.get("what", ""))[:120], kind=kind, confidence=max(0.0, min(1.0, conf)))
    return out


def build_graph(namer: BaseChatModel, critic: Optional[BaseChatModel], glossary: Glossary, cache: Cache, refs: Optional[Refs] = None):
    """Wire the naming pipeline around injected models so it can run against fakes in tests."""
    refs = refs or Refs("__ephemeral__")

    # ---------------------------------------------------------------- nodes

    def lookup_cache(state: State) -> State:
        items = state["items"]
        results: dict[int, NameResult] = {}
        pending: list[int] = []
        usage = state.get("usage") or Usage()
        for i, it in enumerate(items):
            hit = cache.get(it.key) if state.get("use_cache", True) else None
            if hit:
                results[i] = NameResult(key=it.key, name=hit["name"], what=hit.get("what", ""), kind=hit.get("kind", it.category), confidence=hit.get("confidence", 0.8), source="cache")
                usage.cached += 1
            else:
                pending.append(i)
        # references: what the plugin sent plus what this project has learned, deduped by name
        seen: set[str] = set()
        merged: list[Reference] = []
        for r in list(state.get("references") or []) + [Reference(**{k: v for k, v in row.items() if k in ("name", "what", "kind", "image")}) for row in refs.all()]:
            if r.name in seen:
                continue
            seen.add(r.name)
            merged.append(r)
        return {"results": results, "pending": pending, "usage": usage, "round": 1, "proposals": {}, "verdicts": {}, "feedback": {}, "references": merged[:12]}

    def propose(state: State) -> State:
        pending = state["pending"]
        if not pending:
            return {}
        items = state["items"]
        usage = state["usage"]
        content: list[dict[str, Any]] = []
        for n, i in enumerate(pending):
            it = items[i]
            line = _context_line(it, n)
            fb = state.get("feedback", {}).get(i)
            if fb:
                line += f" · previous attempt rejected: {fb}"
            content.append({"type": "text", "text": line})
            content.append({"type": "image_url", "image_url": {"url": f"data:image/png;base64,{it.image}"}})
        content.append({"type": "text", "text": f"Name and classify all {len(pending)} images (#0 to #{len(pending) - 1}). JSON array only."})
        content = _reference_blocks(state.get("references") or []) + content
        terms = sorted({t for it in (items[i] for i in pending) for t in glossary.terms(it.category)[:40]})
        msgs = [SystemMessage(content=NAMER_SYSTEM.format(glossary=glossary_block(terms))), HumanMessage(content=content)]
        reply = namer.invoke(msgs)
        usage.calls += 1
        proposals = dict(state.get("proposals", {}))
        try:
            rows = _extract_json_array(_message_text(reply))
        except Exception as e:  # keep going with whatever we have; finalize will fall back
            usage.rounds = state["round"]
            for i in pending:
                proposals.setdefault(i, Proposal(i=i, name="", what=f"parse error: {e}", confidence=0.0))
            return {"proposals": proposals, "usage": usage}
        proposals.update(_parse_proposals(rows, pending))
        for i in pending:
            proposals.setdefault(i, Proposal(i=i, name="", what="no proposal returned", confidence=0.0))
        return {"proposals": proposals, "usage": usage}

    def critique(state: State) -> State:
        pending = state["pending"]
        if not pending or critic is None or not state.get("critic", True):
            return {"verdicts": {i: Verdict(i=i, action="keep") for i in pending}}
        items = state["items"]
        usage = state["usage"]
        lines = []
        for n, i in enumerate(pending):
            it, p = items[i], state["proposals"][i]
            text = f' · text: "{it.text[:60]}"' if it.text else ""
            lines.append(f'#{n} · category: {it.category} · current: "{it.name}"{text} · proposed: "{p.name}" · what: "{p.what}" · confidence: {p.confidence:.2f}')
        terms = sorted({t for it in (items[i] for i in pending) for t in glossary.terms(it.category)[:40]})
        msgs = [SystemMessage(content=CRITIC_SYSTEM.format(glossary=glossary_block(terms))), HumanMessage(content="\n".join(lines) + f"\n\nReview all {len(pending)} items. JSON array only.")]
        reply = critic.invoke(msgs)
        usage.calls += 1
        verdicts: dict[int, Verdict] = {i: Verdict(i=i, action="keep") for i in pending}
        try:
            for row in _extract_json_array(_message_text(reply)):
                n = int(row.get("i", -1))
                if n < 0 or n >= len(pending):
                    continue
                i = pending[n]
                action = row.get("action", "keep")
                name = _clean_name(str(row.get("name") or "")) if action == "rename" else None
                if action == "rename" and (not name or name in GENERIC):
                    action, name = "reject", None
                verdicts[i] = Verdict(i=i, action=action if action in ("keep", "rename", "reject") else "keep", name=name, reason=str(row.get("reason", ""))[:160])
        except Exception:
            pass  # a broken critic reply just means "keep everything"
        # empty or generic proposals are rejected regardless of what the critic said — except deliberate "abstract"
        for i in pending:
            p = state["proposals"][i]
            if p.kind == "abstract":
                verdicts[i] = Verdict(i=i, action="keep")
            elif not p.name or p.name in GENERIC:
                if verdicts[i].action != "rename":
                    verdicts[i] = Verdict(i=i, action="reject", reason=verdicts[i].reason or "empty or generic name")
        return {"verdicts": verdicts, "usage": usage}

    def route_after_critique(state: State) -> str:
        rejected = [i for i in state["pending"] if state["verdicts"][i].action == "reject"]
        if rejected and state["round"] < MAX_ROUNDS:
            return "retry"
        return "align"

    def prepare_retry(state: State) -> State:
        pending = state["pending"]
        verdicts = state["verdicts"]
        results = dict(state["results"])
        feedback: dict[int, str] = {}
        still: list[int] = []
        usage = state["usage"]
        for i in pending:
            v = verdicts[i]
            p = state["proposals"][i]
            it = state["items"][i]
            if v.action == "reject":
                still.append(i)
                feedback[i] = v.reason or "too generic"
            else:
                name = v.name if v.action == "rename" else p.name
                src = "critic" if v.action == "rename" else "model"
                if v.action == "rename":
                    usage.critic_changes += 1
                results[i] = NameResult(key=it.key, name=name, what=p.what, kind=p.kind or it.category, confidence=p.confidence, source=src, note=v.reason if v.action == "rename" else "")
        return {"results": results, "pending": still, "feedback": feedback, "round": state["round"] + 1, "usage": usage}

    def align(state: State) -> State:
        """Fold proposals + verdicts into results, then pull names toward the glossary and dedupe within the batch."""
        items = state["items"]
        results = dict(state["results"])
        usage = state["usage"]
        usage.rounds = state["round"]
        for i in state["pending"]:
            it = items[i]
            p = state["proposals"].get(i) or Proposal(i=i, name="", what="", confidence=0.0)
            v = state["verdicts"].get(i) or Verdict(i=i, action="keep")
            if p.kind == "abstract":
                # the model declined honestly: hand it to the designer, with the geometry description as a hint
                results[i] = NameResult(key=it.key, name="", what=p.what or it.desc or "too abstract to name", kind="abstract", confidence=p.confidence, source="model", note="abstract: needs a human name")
                usage.abstract += 1
                continue
            if v.action == "reject" or not p.name:
                # deterministic fallback so the plugin still gets something reviewable
                fallback = _clean_name(it.text) if it.text else (it.desc or _clean_name(it.name))
                results[i] = NameResult(key=it.key, name=fallback or f"{it.category}-{i + 1}", what=p.what, kind=p.kind or it.category, confidence=0.2, source="model", note=f"unresolved: {v.reason or 'no usable proposal'}")
                continue
            name = v.name if v.action == "rename" else p.name
            src = "critic" if v.action == "rename" else "model"
            if v.action == "rename":
                usage.critic_changes += 1
            results[i] = NameResult(key=it.key, name=name, what=p.what, kind=p.kind or it.category, confidence=p.confidence, source=src, note=v.reason if v.action == "rename" else "")

        # glossary alignment: reuse an existing term when it clearly means the same thing
        for i, r in results.items():
            if r.source == "cache" or r.confidence < 0.2 or not r.name:
                continue
            it = items[i]
            hit = glossary.similar(it.category, r.name, r.what)
            if hit and hit.name != r.name:
                r.note = (r.note + "; " if r.note else "") + f"aligned to glossary term (was {r.name})"
                r.name = hit.name
                r.source = "glossary"
                usage.glossary_hits += 1

        # within-batch uniqueness per category, but identical keys may legitimately share a name
        seen: dict[str, str] = {}
        for i in sorted(results):
            r, it = results[i], items[i]
            if not r.name:
                continue
            k = f"{it.category}|{r.name}"
            if k in seen and seen[k] != it.key:
                n = 2
                while f"{it.category}|{r.name}-{n}" in seen:
                    n += 1
                r.name = f"{r.name}-{n}"
                k = f"{it.category}|{r.name}"
            seen.setdefault(k, it.key)
        return {"results": results, "usage": usage}

    def reconcile(state: State) -> State:
        """Second look: items that might be another view of a known character/logo, judged against references
        (stored + plugin-supplied + anything named confidently in this very batch)."""
        items = state["items"]
        results = state["results"]
        usage = state["usage"]
        refs: list[Reference] = list(state.get("references") or [])
        seen = {r.name for r in refs}
        for i, r in results.items():
            if r.name and r.kind in REF_KINDS and r.confidence >= 0.8 and r.name not in seen:
                refs.append(Reference(name=r.name, what=r.what, kind=r.kind, image=items[i].image))
                seen.add(r.name)
        refs = refs[:8]
        cands = [i for i, r in results.items() if (r.kind in RECONCILE_KINDS or items[i].category in RECONCILE_KINDS) and r.source != "cache" and (not r.name or r.confidence < 0.7) and r.name not in seen]
        if not refs or not cands:
            return {}
        for start in range(0, len(cands), 8):
            pend = cands[start:start + 8]
            content: list[dict[str, Any]] = _reference_blocks(refs)
            for n, i in enumerate(pend):
                it = items[i]
                content.append({"type": "text", "text": _context_line(it, n) + (f' · earlier proposal: "{results[i].name}" ({results[i].what})' if results[i].name else " · earlier attempt: abstract")})
                content.append({"type": "image_url", "image_url": {"url": f"data:image/png;base64,{it.image}"}})
            content.append({"type": "text", "text": f"Decide for each of the {len(pend)} items whether it is another view of a reference. If yes, name it <reference-name>-<view>. If not, name it on its own merits or mark it abstract. JSON array only."})
            reply = namer.invoke([SystemMessage(content=NAMER_SYSTEM.format(glossary="")), HumanMessage(content=content)])
            usage.calls += 1
            try:
                props = _parse_proposals(_extract_json_array(_message_text(reply)), pend)
            except Exception:
                continue
            for i, p in props.items():
                r = results[i]
                if p.kind == "abstract" or not p.name:
                    continue
                if p.name == r.name and p.confidence <= r.confidence:
                    continue
                matched = any(p.name.startswith(ref.name + "-") or p.name == ref.name for ref in refs)
                r.name, r.what, r.kind, r.confidence = p.name, p.what or r.what, p.kind or r.kind, p.confidence
                r.source = "reference" if matched else r.source
                r.note = "matched to a reference" if matched else r.note
                if matched:
                    usage.reference_matches += 1
        return {"results": results, "usage": usage}

    def finalize(state: State) -> State:
        items = state["items"]
        for i, r in state["results"].items():
            it = items[i]
            if r.source == "cache" or not r.name or r.confidence < 0.5 or r.note.startswith("unresolved"):
                continue
            cache.put(it.key, {"name": r.name, "what": r.what, "kind": r.kind, "confidence": r.confidence})
            if state.get("learn", True):
                glossary.learn(it.category, r.name, r.what)
                if r.kind in REF_KINDS and r.confidence >= 0.8:
                    refs.add(r.name, r.what, r.kind, it.image)
        cache.save()
        if state.get("learn", True):
            glossary.save()
            refs.save()
        return {}

    # ---------------------------------------------------------------- graph

    g = StateGraph(State)
    g.add_node("lookup_cache", lookup_cache)
    g.add_node("propose", propose)
    g.add_node("critique", critique)
    g.add_node("prepare_retry", prepare_retry)
    g.add_node("align", align)
    g.add_node("reconcile", reconcile)
    g.add_node("finalize", finalize)

    g.set_entry_point("lookup_cache")
    g.add_edge("lookup_cache", "propose")
    g.add_edge("propose", "critique")
    g.add_conditional_edges("critique", route_after_critique, {"retry": "prepare_retry", "align": "align"})
    g.add_edge("prepare_retry", "propose")
    g.add_edge("align", "reconcile")
    g.add_edge("reconcile", "finalize")
    g.add_edge("finalize", END)
    return g.compile()


def run_naming(items: list[Item], namer: BaseChatModel, critic: Optional[BaseChatModel], glossary: Glossary, cache: Cache, use_critic: bool, learn: bool, use_cache: bool, refs: Optional[Refs] = None, references: Optional[list[Reference]] = None) -> tuple[list[NameResult], Usage]:
    graph = build_graph(namer, critic, glossary, cache, refs)
    final = graph.invoke({"items": items, "references": references or [], "critic": use_critic, "learn": learn, "use_cache": use_cache, "usage": Usage()})
    results = [final["results"][i] for i in range(len(items))]
    return results, final["usage"]
````

## File: ds-foundry-server/app/main.py
````python
from __future__ import annotations

import os

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from .glossary import Cache, Glossary, Refs
from .graph import run_naming
from .providers import DEFAULT_MODELS, configured_providers, get_chat_model, get_critic_model
from .schemas import GlossaryEntry, NameRequest, NameResponse

VERSION = "0.2.0"

app = FastAPI(title="DS Foundry naming service", version=VERSION)

# The Figma plugin panel runs in a sandboxed iframe whose origin is "null", so the wildcard is required.
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


@app.get("/health")
def health():
    return {"ok": True, "version": VERSION, "providers": configured_providers(), "defaults": DEFAULT_MODELS}


@app.post("/name", response_model=NameResponse)
def name(req: NameRequest):
    key = req.api_key or None
    if req.provider == "anthropic" and not (key or os.environ.get("ANTHROPIC_API_KEY")):
        raise HTTPException(400, "No Anthropic key: set ANTHROPIC_API_KEY on the server or send api_key")
    if req.provider == "gemini" and not (key or os.environ.get("GOOGLE_API_KEY")):
        raise HTTPException(400, "No Gemini key: set GOOGLE_API_KEY on the server or send api_key")
    try:
        namer = get_chat_model(req.provider, req.model, key)
        critic = get_critic_model(req.provider, req.model, key) if req.critic else None
    except Exception as e:
        raise HTTPException(400, f"Could not create model: {e}")
    glossary = Glossary(req.project)
    cache = Cache(req.project)
    refs = Refs(req.project)
    try:
        results, usage = run_naming(req.items, namer, critic, glossary, cache, req.critic, req.learn, req.use_cache, refs, req.references)
    except Exception as e:
        raise HTTPException(502, f"Naming failed: {e}")
    return NameResponse(results=results, usage=usage)


@app.get("/glossary/{project}")
def get_glossary(project: str):
    return [e.model_dump() for e in Glossary(project).entries.values()]


@app.post("/glossary/{project}")
def upsert_glossary(project: str, entry: GlossaryEntry):
    g = Glossary(project)
    g.upsert(entry)
    g.save()
    return {"ok": True, "count": len(g.entries)}


@app.delete("/glossary/{project}/{category}/{name}")
def delete_glossary(project: str, category: str, name: str):
    g = Glossary(project)
    ok = g.remove(category, name)
    g.save()
    return {"ok": ok}


@app.get("/references/{project}")
def get_references(project: str):
    return [{k: v for k, v in r.items() if k != "image"} for r in Refs(project).all()]


@app.delete("/references/{project}/{name}")
def delete_reference(project: str, name: str):
    r = Refs(project)
    before = len(r.rows)
    r.rows = [x for x in r.rows if x["name"] != name]
    r.save()
    return {"ok": len(r.rows) < before}


@app.delete("/cache/{project}")
def clear_cache(project: str):
    c = Cache(project)
    n = len(c.rows)
    c.rows = {}
    c.save()
    return {"ok": True, "cleared": n}
````

## File: ds-foundry-server/app/prompts.py
````python
NAMER_SYSTEM = """You name layers in a Figma design file. You receive numbered images, each with a context line (category, current layer name, text found inside, size).
For every image return a short, specific, lowercase kebab-case name (1-4 words) describing what it visually depicts or, for UI pieces, what it is for.

Rules:
- Icons: name the pictogram by its meaning: search, arrow-left, settings, heart-filled, chevron-down, user-circle.
- Images and avatars: name the subject: mountain-lake-hero, woman-headshot, product-shoe-red.
- Screens, sections, nav: name the purpose: login, checkout-summary, hero-banner, footer-links, top-nav.
- Cards and list items: name the content: pricing-plan-pro, order-row, testimonial-quote.
- Components: name the role and variant hint: primary-button, search-input, avatar-with-status.
- Plain shapes: describe them: rounded-panel-bg, circle-badge, divider-line.
- Taglines and copy: name by the message, not the words: welcome-tagline, pricing-intro, footer-legal.
- Never use generic words alone (icon, image, frame, vector, rectangle, shape, component). No prefixes, no slashes. Do not invent brand names you cannot see — but if a wordmark is legible, use it (owting-logo). If text is visible, prefer names that use it.
- Classify each item with "kind", the best of: icon, symbol, logo, character, illustration, image, avatar, screen, section, nav, card, list-item, button, badge, input, tagline, copy, shape, debris, abstract. The given category is a guess from geometry; correct it when the picture says otherwise. A character has a face, body or pose; an illustration is a scene or object without one; a logo is a mark, wordmark or lockup that identifies a brand; a stray speck is debris.
- If a shape is too abstract to name honestly, set "kind": "abstract" and "name": "". The designer will name it. Do not guess.
- REFERENCES, when shown, are already-named characters and logos from this project. If an item is another view, crop, pose or partial of one (its back, side, a detail), name it <reference-name>-<view>, e.g. owl-mascot-back, with the same kind.
- Confidence is 0-1: 0.9+ when the depiction is unmistakable, 0.5 or less when you are guessing.
{glossary}
Return ONLY a JSON array, no prose, no code fence:
[{{"i": 0, "name": "search", "what": "magnifying glass outline", "kind": "icon", "confidence": 0.95}}, ...]
with one entry per image, in order."""

CRITIC_SYSTEM = """You review proposed layer names for a Figma design system. You see, for each item: its category, the current layer name, any text inside it, the proposed name, the proposer's description, and their confidence.

Reject or rename when a proposal:
- is a generic word (icon, image, frame, vector, shape, element, item) or a bare category;
- contradicts visible text (text says "Sign up" but the name is "login-button");
- uses the wrong convention (not kebab-case, longer than 4 words, contains a slash or prefix, mentions a brand that is not in the text);
- duplicates another item's name in the same category when the descriptions clearly differ;
- drifts from an existing glossary term that means the same thing (prefer the glossary term).

Items with an empty proposed name and kind "abstract" were deliberately left for the designer: keep them.
Keep everything else. Do not rename merely for taste. When you rename, obey the same rules and reuse glossary terms where they fit.
{glossary}
Return ONLY a JSON array, no prose, no code fence:
[{{"i": 0, "action": "keep"}}, {{"i": 1, "action": "rename", "name": "arrow-left", "reason": "..."}}, {{"i": 2, "action": "reject", "reason": "..."}}]
with one entry per item."""


def glossary_block(terms: list[str]) -> str:
    if not terms:
        return ""
    joined = ", ".join(terms[:120])
    return f"\nGlossary — names already used in this project; reuse them when the meaning matches: {joined}\n"
````

## File: ds-foundry-server/app/providers.py
````python
from __future__ import annotations

import os
from typing import Optional

from langchain_core.language_models import BaseChatModel

DEFAULT_MODELS = {
    "anthropic": os.environ.get("DSF_ANTHROPIC_MODEL", "claude-sonnet-5"),
    "gemini": os.environ.get("DSF_GEMINI_MODEL", "gemini-3.7-flash"),
    "ollama": os.environ.get("DSF_OLLAMA_MODEL", "llama3.2-vision"),
}

# a cheaper text-only model for the critic pass, per provider (falls back to the namer model)
CRITIC_MODELS = {
    "anthropic": os.environ.get("DSF_ANTHROPIC_CRITIC", "claude-haiku-4-5"),
    "gemini": os.environ.get("DSF_GEMINI_CRITIC", "gemini-3.5-flash-lite"),
    "ollama": os.environ.get("DSF_OLLAMA_CRITIC", ""),
}


def configured_providers() -> dict[str, bool]:
    return {
        "anthropic": bool(os.environ.get("ANTHROPIC_API_KEY")),
        "gemini": bool(os.environ.get("GOOGLE_API_KEY")),
        "ollama": True,
    }


def get_chat_model(provider: str, model: Optional[str] = None, api_key: Optional[str] = None, temperature: float = 0.2, max_tokens: int = 2048) -> BaseChatModel:
    model = model or DEFAULT_MODELS[provider]
    if provider == "anthropic":
        from langchain_anthropic import ChatAnthropic

        kwargs = {"model": model, "temperature": temperature, "max_tokens": max_tokens}
        if api_key:
            kwargs["api_key"] = api_key
        return ChatAnthropic(**kwargs)
    if provider == "gemini":
        from langchain_google_genai import ChatGoogleGenerativeAI

        kwargs = {"model": model, "temperature": temperature, "max_output_tokens": max_tokens}
        if api_key:
            kwargs["google_api_key"] = api_key
        return ChatGoogleGenerativeAI(**kwargs)
    if provider == "ollama":
        from langchain_ollama import ChatOllama

        return ChatOllama(model=model, temperature=temperature, base_url=os.environ.get("OLLAMA_HOST", "http://localhost:11434"))
    raise ValueError(f"unknown provider {provider}")


def get_critic_model(provider: str, model: Optional[str], api_key: Optional[str]) -> BaseChatModel:
    critic = CRITIC_MODELS.get(provider) or model
    return get_chat_model(provider, critic, api_key, temperature=0.0, max_tokens=1500)
````

## File: ds-foundry-server/app/schemas.py
````python
from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field, field_validator

Provider = Literal["anthropic", "gemini", "ollama"]

KINDS = ["icon", "symbol", "logo", "character", "illustration", "image", "avatar", "screen", "section", "nav", "card", "list-item", "button", "badge", "input", "tagline", "copy", "shape", "debris", "abstract"]


class Item(BaseModel):
    """One layer thumbnail the plugin wants named."""

    key: str = Field(description="Fingerprint or node id; used for caching and for mapping results back")
    category: str = Field(description="icon | image | avatar | screen | section | nav | card | list-item | component | shape")
    name: str = Field(default="", description="Current layer name")
    desc: str = Field(default="", description="Geometry description from the plugin, e.g. navy-outline-blob-56x30")
    text: str = Field(default="", description="Text found inside the layer, if any")
    w: int = 0
    h: int = 0
    image: str = Field(description="Base64 PNG, no data-URL prefix")

    @field_validator("image")
    @classmethod
    def strip_prefix(cls, v: str) -> str:
        return v.split(",", 1)[1] if v.startswith("data:") else v


class Reference(BaseModel):
    """An already-named character or logo the model should recognise other views of."""

    name: str
    what: str = ""
    kind: str = "character"
    image: str = Field(description="Base64 PNG")

    @field_validator("image")
    @classmethod
    def strip_prefix(cls, v: str) -> str:
        return v.split(",", 1)[1] if v.startswith("data:") else v


class NameRequest(BaseModel):
    provider: Provider = "anthropic"
    model: Optional[str] = Field(default=None, description="Model id; server default for the provider when omitted")
    api_key: Optional[str] = Field(default=None, description="Optional per-request key; falls back to server env")
    items: list[Item] = Field(min_length=1, max_length=40)
    critic: bool = Field(default=True, description="Run the critic pass")
    learn: bool = Field(default=True, description="Add accepted names to the glossary")
    use_cache: bool = True
    project: str = Field(default="default", description="Glossary/cache namespace")
    references: list[Reference] = Field(default_factory=list, description="Optional references from the plugin; the server also keeps its own per project")


class Proposal(BaseModel):
    i: int
    name: str
    what: str = ""
    kind: str = ""
    confidence: float = Field(default=0.7, ge=0, le=1)


class Verdict(BaseModel):
    i: int
    action: Literal["keep", "rename", "reject"] = "keep"
    name: Optional[str] = None
    reason: str = ""


class NameResult(BaseModel):
    key: str
    name: str = Field(default="", description="Empty when kind is 'abstract': the designer should name it")
    what: str = ""
    kind: str = ""
    confidence: float = 0.7
    source: Literal["model", "cache", "glossary", "critic", "reference"] = "model"
    note: str = ""


class Usage(BaseModel):
    calls: int = 0
    cached: int = 0
    glossary_hits: int = 0
    critic_changes: int = 0
    reference_matches: int = 0
    abstract: int = 0
    rounds: int = 1


class NameResponse(BaseModel):
    results: list[NameResult]
    usage: Usage


class GlossaryEntry(BaseModel):
    category: str
    name: str
    what: str = ""
    aliases: list[str] = Field(default_factory=list)
    uses: int = 0
````

## File: ds-foundry-server/tests/test_graph.py
````python
"""Runs the whole graph and the HTTP layer against fake chat models — no API keys, no network."""
import json, os, tempfile
os.environ["DSF_DATA_DIR"] = tempfile.mkdtemp()

from fastapi.testclient import TestClient
from langchain_core.language_models.fake_chat_models import FakeListChatModel

from app.glossary import Cache, Glossary
from app.graph import run_naming
from app.schemas import Item
from app import main as main_mod

PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="

def items():
    return [
        Item(key="fp-search", category="icon", name="Vector 12", image=PNG, w=24, h=24),
        Item(key="fp-arrow", category="icon", name="Vector 13", image=PNG, w=24, h=24),
        Item(key="fp-btn", category="component", name="Button/Primary", text="Sign up", image=PNG, w=120, h=40),
    ]

def test_critic_rename_retry_and_glossary_alignment():
    namer = FakeListChatModel(responses=[
        # round 1: one good, one generic, one contradicting the visible text
        json.dumps([{"i": 0, "name": "search", "what": "magnifying glass", "confidence": 0.95},
                    {"i": 1, "name": "icon", "what": "arrow pointing left", "confidence": 0.4},
                    {"i": 2, "name": "login-button", "what": "blue primary button", "confidence": 0.8}]),
        # round 2: only the rejected item comes back (as #0 of the new batch)
        json.dumps([{"i": 0, "name": "arrow-left", "what": "arrow pointing left", "confidence": 0.9}]),
    ])
    critic = FakeListChatModel(responses=[
        json.dumps([{"i": 0, "action": "keep"},
                    {"i": 1, "action": "reject", "reason": "generic"},
                    {"i": 2, "action": "rename", "name": "sign-up-button", "reason": "text says Sign up"}]),
        json.dumps([{"i": 0, "action": "keep"}]),
    ])
    g, c = Glossary("test-a"), Cache("test-a")
    results, usage = run_naming(items(), namer, critic, g, c, use_critic=True, learn=True, use_cache=True)
    by = {r.key: r for r in results}
    assert by["fp-search"].name == "search" and by["fp-search"].source == "model"
    assert by["fp-arrow"].name == "arrow-left" and usage.rounds == 2
    assert by["fp-btn"].name == "sign-up-button" and by["fp-btn"].source == "critic"
    assert usage.calls == 4 and usage.critic_changes == 1

    # second run: everything is cached, no model calls at all
    results2, usage2 = run_naming(items(), FakeListChatModel(responses=["[]"]), None, Glossary("test-a"), Cache("test-a"), True, True, True)
    assert usage2.cached == 3 and usage2.calls == 0 and all(r.source == "cache" for r in results2)

    # a new file proposing "magnifier" for the same kind of icon is pulled back to the glossary term
    namer3 = FakeListChatModel(responses=[json.dumps([{"i": 0, "name": "magnifier", "what": "magnifying glass search", "confidence": 0.9}])])
    r3, u3 = run_naming([Item(key="fp-new", category="icon", name="Vector 99", image=PNG)], namer3, None, Glossary("test-a"), Cache("test-a"), False, True, True)
    assert r3[0].name == "search" and r3[0].source == "glossary" and u3.glossary_hits == 1

def test_http_layer_with_injected_models(monkeypatch):
    fake = FakeListChatModel(responses=[json.dumps([{"i": 0, "name": "checkout-summary", "what": "order review screen", "confidence": 0.9}])])
    monkeypatch.setattr(main_mod, "get_chat_model", lambda *a, **k: fake)
    monkeypatch.setattr(main_mod, "get_critic_model", lambda *a, **k: None)
    monkeypatch.setenv("ANTHROPIC_API_KEY", "x")
    client = TestClient(main_mod.app)
    assert client.get("/health").json()["ok"] is True
    r = client.post("/name", json={"provider": "anthropic", "project": "http", "critic": False,
                                   "items": [{"key": "k1", "category": "screen", "name": "Frame 3", "image": "data:image/png;base64," + PNG}]})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["results"][0]["name"] == "checkout-summary" and body["usage"]["calls"] == 1
    assert client.get("/glossary/http").json()[0]["name"] == "checkout-summary"
    assert client.delete("/cache/http").json()["cleared"] == 1


def test_abstract_and_reference_reconcile():
    """Front of the owl is named confidently; the back view starts low-confidence and is matched via the reference pass.
    An abstract blob is left for the designer instead of guessed."""
    from app.glossary import Refs
    owl_front = Item(key="fp-owl-front", category="illustration", name="Group 7", image=PNG, w=200, h=240)
    owl_back = Item(key="fp-owl-back", category="symbol", name="Vector 44", image=PNG, w=180, h=230)
    blob = Item(key="fp-blob", category="shape", name="Vector 9", desc="pale-blue-blob-56x30", image=PNG, w=56, h=30)
    namer = FakeListChatModel(responses=[
        json.dumps([{"i": 0, "name": "owl-mascot", "what": "green owl mascot facing front", "kind": "character", "confidence": 0.95},
                    {"i": 1, "name": "green-bird-shape", "what": "rounded green figure from behind", "kind": "illustration", "confidence": 0.45},
                    {"i": 2, "name": "", "what": "soft blue blob", "kind": "abstract", "confidence": 0.2}]),
        # reconcile pass for the low-confidence item, references attached
        json.dumps([{"i": 0, "name": "owl-mascot-back", "what": "the owl mascot seen from behind", "kind": "character", "confidence": 0.85}]),
    ])
    g, c, r = Glossary("test-ref"), Cache("test-ref"), Refs("test-ref")
    results, usage = run_naming([owl_front, owl_back, blob], namer, None, g, c, False, True, True, r)
    by = {x.key: x for x in results}
    assert by["fp-owl-front"].name == "owl-mascot" and by["fp-owl-front"].kind == "character"
    assert by["fp-owl-back"].name == "owl-mascot-back" and by["fp-owl-back"].source == "reference" and usage.reference_matches == 1
    assert by["fp-blob"].name == "" and by["fp-blob"].kind == "abstract" and usage.abstract == 1
    assert usage.calls == 2
    # the front view is now a stored reference for future files, thumbnail included
    stored = Refs("test-ref").all()
    assert stored and stored[0]["name"] == "owl-mascot" and stored[0]["image"] == PNG
    # a later file: the back view alone comes in and is matched against the stored reference on the first pass
    namer2 = FakeListChatModel(responses=[json.dumps([{"i": 0, "name": "owl-mascot-side", "what": "owl mascot in profile", "kind": "character", "confidence": 0.9}])])
    r2, u2 = run_naming([Item(key="fp-owl-side", category="symbol", name="Vector 50", image=PNG)], namer2, None, Glossary("test-ref"), Cache("test-ref"), False, True, True, Refs("test-ref"))
    assert r2[0].name == "owl-mascot-side" and u2.calls == 1
````

## File: ds-foundry-server/.env.example
````
# Server-side keys (the plugin can also send its own per request)
ANTHROPIC_API_KEY=
GOOGLE_API_KEY=

# Defaults per provider (any current model id works)
DSF_ANTHROPIC_MODEL=claude-sonnet-5
DSF_ANTHROPIC_CRITIC=claude-haiku-4-5
DSF_GEMINI_MODEL=gemini-3.7-flash
DSF_GEMINI_CRITIC=gemini-3.5-flash-lite
DSF_OLLAMA_MODEL=llama3.2-vision
OLLAMA_HOST=http://localhost:11434

# Where glossary/ and cache/ live
DSF_DATA_DIR=data

# Optional LangSmith tracing
# LANGSMITH_TRACING=true
# LANGSMITH_API_KEY=
# LANGSMITH_PROJECT=ds-foundry
````

## File: ds-foundry-server/.gitignore
````
.venv/
__pycache__/
.pytest_cache/
data/
.env
````

## File: ds-foundry-server/CHANGELOG.md
````markdown
# Changelog

## 0.2.0 — 2026-09-12

- `kind` on proposals and results; `abstract` results left unnamed for the designer (`usage.abstract`).
- Per-project **references** with thumbnails (`Refs`), sent to the namer on every batch; new `reconcile` node re-examines low-confidence characters/illustrations/symbols against them (`source: reference`, `usage.reference_matches`).
- `/references/{project}` endpoints. Item `desc` (geometry description) passed through as context.

## 0.1.0 — 2026-09-11

First release: `/name` pipeline (cache → propose → critic → retry → glossary align → dedupe → learn), `/glossary` CRUD, `/cache` clear, `/health`. Providers: Claude, Gemini, Ollama. Tests with fake models.
````

## File: ds-foundry-server/IDE_PROMPT.md
````markdown
# IDE prompt — DS Foundry naming server

You are working on the **DS Foundry naming server**: FastAPI + LangGraph + Pydantic v2, Python 3.11+. It backs the "Proxy" provider in the DS Foundry Figma plugin. Read `README.md` first.

Pipeline (`app/graph.py`): `lookup_cache → propose → critique → (retry once) → align → reconcile → finalize`. `reconcile` gives low-confidence character/illustration/symbol items a second look with references (stored `Refs` + plugin-supplied + confidently named in this batch); `finalize` stores new character/logo references with thumbnails. `build_graph(namer, critic, glossary, cache)` takes injected LangChain chat models so `tests/test_graph.py` runs with `FakeListChatModel` and no keys. Keep that property: never construct models inside nodes.

Conventions:
- All I/O shapes are Pydantic models in `app/schemas.py`; the plugin depends on `NameRequest` / `NameResponse` exactly — bump the plugin if you change them.
- Model replies are parsed as a JSON array (`_extract_json_array`) rather than `with_structured_output`, because that works identically across Claude, Gemini and Ollama with image inputs. Keep the fallback behaviour: a broken reply never fails the request, it degrades to a low-confidence deterministic name with an `unresolved:` note.
- Generic names (`GENERIC` set) are always rejected regardless of what the critic says.
- Glossary and cache are per-project JSON files under `DSF_DATA_DIR`. `Glossary.similar()` is the only place matching lives — replace it with embeddings (e.g. `langchain-huggingface` + a local MiniLM) without touching the graph.
- Run `pytest -q` before finishing.

Roadmap candidates:
1. Embedding-based glossary matching with a per-project FAISS index.
2. A `/classify` node that lets the model correct the plugin's heuristic category (button vs badge vs input) and returns it alongside the name.
3. Batch API mode for very large files (submit, poll, plugin fetches results later).
4. A tiny web UI at `/` to browse and edit the glossary.
5. LangSmith eval dataset: a folder of thumbnails with gold names; `make eval` reports agreement per category.
````

## File: ds-foundry-server/README.md
````markdown
# DS Foundry naming server 0.2.0

A small FastAPI + LangGraph service that the DS Foundry Figma plugin (v1.3.0+) can use instead of calling Claude or Gemini directly. It turns "name this thumbnail" into a pipeline:

```
lookup_cache → propose (vision, with references) → critique (cheap text model) ─┬─ reject? → retry once with feedback
                                                                                 └─ align to glossary → dedupe → reconcile (second look vs references) → finalize (cache + learn + store references)
```

What that buys you over the in-plugin calls:

- **Critic pass** — a second, cheaper model rejects generic names, catches contradictions with visible text, enforces kebab-case, and prefers glossary terms. Rejected items are re-proposed once with the reason attached.
- **Glossary** — accepted names are remembered per project, so "search" stays "search" across files instead of drifting to "magnifier". Matching is token overlap; swap `Glossary.similar()` for embeddings if you outgrow it.
- **Kinds and abstraction** — every result carries a `kind` (icon, symbol, logo, character, illustration, tagline, copy, shape, debris…) the model may correct; items the model can't name honestly come back as `kind: abstract` with an empty name for the designer, never a guess.
- **References** — characters and logos named with ≥ 80% confidence are stored per project with their thumbnail (`data/refs/`). They're shown to the model on every later batch and file, and a `reconcile` pass re-examines low-confidence characters/illustrations/symbols against them, so the back of a mascot becomes `owl-mascot-back`. `GET /references/{project}` lists them; `DELETE /references/{project}/{name}` forgets one.
- **Cache** — fingerprint → name. Re-running on a file you've already named makes zero model calls.
- **Provider routing** — Claude, Gemini or a local Ollama vision model behind one endpoint. Keys live on the server or come with each request.
- **Structured, typed** — Pydantic v2 models for every message; LangSmith tracing with two env vars.

## Run

```bash
cp .env.example .env     # add ANTHROPIC_API_KEY and/or GOOGLE_API_KEY
./run.sh                 # venv + install + uvicorn on http://127.0.0.1:8000
```

Then in the plugin: **AI naming → Provider: Proxy**, server `http://localhost:8000`, pick an upstream (Claude / Gemini / Ollama, server default or a specific model), set a **Project** name (this is the glossary and cache namespace), and Suggest names as usual. Each row shows where its name came from — `model`, `critic`, `glossary` or `cache` — and the confidence.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/health` | Version, which providers have keys, default models |
| `POST` | `/name` | `{provider, model?, api_key?, project, critic, learn, use_cache, items[]}` → `{results[], usage}` |
| `GET` | `/glossary/{project}` | Current terms |
| `POST` | `/glossary/{project}` | Upsert a term `{category, name, what, aliases[]}` — seed house conventions before the first run |
| `DELETE` | `/glossary/{project}/{category}/{name}` | Remove a term |
| `DELETE` | `/cache/{project}` | Forget cached names |

Items: `{key, category, name, desc, text, w, h, image}` where `image` is base64 PNG. Up to 40 per request. Optional `references: [{name, what, kind, image}]` from the plugin are merged with the stored ones.

## Layout

- `app/schemas.py` — request/response models
- `app/providers.py` — `get_chat_model(provider, model, key)` for Claude / Gemini / Ollama, plus per-provider critic defaults
- `app/prompts.py` — namer and critic system prompts
- `app/glossary.py` — JSON-backed glossary and cache under `DSF_DATA_DIR`
- `app/graph.py` — the LangGraph state machine; `build_graph()` takes injected models so tests run against fakes
- `app/main.py` — FastAPI routes, CORS open (the Figma plugin iframe has a `null` origin)
- `tests/test_graph.py` — full graph + HTTP layer with `FakeListChatModel`, no network: `pytest -q`

## Notes

- The critic sees text only (proposals, descriptions, context), not images — it's cheap. If you want it to look, pass the images in `critique()` the same way `propose()` does.
- Gemini and Ollama image input uses the standard `image_url` data-URL content block, which `langchain-google-genai` and `langchain-ollama` both accept.
- Ollama needs a vision model (`ollama pull llama3.2-vision`) and `pip install langchain-ollama`.
````

## File: ds-foundry-server/requirements.txt
````
fastapi>=0.115
uvicorn[standard]>=0.30
pydantic>=2.7
langgraph>=0.2
langchain-core>=0.3
langchain-anthropic>=0.3
langchain-google-genai>=2.0
# optional local models: pip install langchain-ollama
pytest>=8
httpx>=0.27
````

## File: ds-foundry-server/run.sh
````bash
#!/usr/bin/env bash
# One-shot: create venv, install, run on :8000 with reload.
set -e
cd "$(dirname "$0")"
[ -d .venv ] || python3 -m venv .venv
source .venv/bin/activate
pip install -q -r requirements.txt
[ -f .env ] && set -a && source .env && set +a
exec uvicorn app.main:app --host 127.0.0.1 --port "${PORT:-8000}" --reload
````

## File: install-ds-foundry.sh
````bash
#!/usr/bin/env bash
# install-ds-foundry.sh — installs, updates and controls the DS Foundry plugin + naming server on macOS.
#
#   ./install-ds-foundry.sh                       # install/update both from the newest zips next to this script (or ~/Downloads)
#   ./install-ds-foundry.sh install --launchd     # same, and register the server to start at login
#   ./install-ds-foundry.sh start|stop|status|logs|test
#
# Options for install:
#   --plugin <zip>        path to ds-foundry-vX.Y.Z.zip           (default: newest found)
#   --server <zip>        path to ds-foundry-server-vX.Y.Z.zip    (default: newest found)
#   --dest <dir>          install root                            (default: ~/Figma Plugins)
#   --anthropic-key <k>   write ANTHROPIC_API_KEY into the server .env (or set the env var before running)
#   --gemini-key <k>      write GOOGLE_API_KEY into the server .env    (or set GOOGLE_API_KEY)
#   --port <n>            server port                             (default: 8000 — matches the plugin's devAllowedDomains)
#   --launchd             run the server as a login item via launchd instead of a background process
#   --ollama              pull llama3.2-vision and install langchain-ollama for local naming
#   --test                run the server's pytest suite after install (no tokens spent)
#   --no-start            install only
#   --no-figma            don't open Figma at the end
#
# Everything is idempotent: re-running updates code in place and keeps .env, data/ (glossary + cache) and .venv.

set -euo pipefail

DEST="${DS_FOUNDRY_HOME:-$HOME/Figma Plugins}"
PORT=8000
PLUGIN_ZIP=""; SERVER_ZIP=""
ANTHROPIC="${ANTHROPIC_API_KEY:-}"; GEMINI="${GOOGLE_API_KEY:-}"
USE_LAUNCHD=0; WANT_OLLAMA=0; RUN_TESTS=0; START=1; OPEN_FIGMA=1
LABEL="com.cogspa.ds-foundry-server"

CMD="install"
if [[ $# -gt 0 && "$1" != --* ]]; then CMD="$1"; shift; fi
while [[ $# -gt 0 ]]; do
  case "$1" in
    --plugin) PLUGIN_ZIP="$2"; shift 2;;
    --server) SERVER_ZIP="$2"; shift 2;;
    --dest) DEST="$2"; shift 2;;
    --anthropic-key) ANTHROPIC="$2"; shift 2;;
    --gemini-key) GEMINI="$2"; shift 2;;
    --port) PORT="$2"; shift 2;;
    --launchd) USE_LAUNCHD=1; shift;;
    --ollama) WANT_OLLAMA=1; shift;;
    --test) RUN_TESTS=1; shift;;
    --no-start) START=0; shift;;
    --no-figma) OPEN_FIGMA=0; shift;;
    -h|--help) sed -n '2,24p' "$0"; exit 0;;
    *) echo "unknown option: $1" >&2; exit 2;;
  esac
done

SERVER_DIR="$DEST/ds-foundry-server"
PLUGIN_DIR="$DEST/ds-foundry"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
PIDFILE="$SERVER_DIR/server.pid"
LOG="$SERVER_DIR/server.log"

say()  { printf '\033[1m%s\033[0m\n' "$*"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; }
die()  { printf '  \033[31m✗\033[0m %s\n' "$*" >&2; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }

# ---------------------------------------------------------------- helpers

newest_zip() { # newest_zip <prefix>  → path of highest-version zip found next to the script or in ~/Downloads
  local here; here="$(cd "$(dirname "$0")" && pwd)"
  ls -1 "$here"/"$1"-v*.zip "$HOME"/Downloads/"$1"-v*.zip 2>/dev/null | sort -t v -k2 -V | tail -n1 || true
}

py_ok() { # python 3.11+
  have python3 || return 1
  python3 -c 'import sys; sys.exit(0 if sys.version_info >= (3, 11) else 1)'
}

health() { curl -fsS "http://127.0.0.1:$PORT/health" 2>/dev/null; }

server_running() {
  if [[ -f "$PIDFILE" ]] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then return 0; fi
  health >/dev/null 2>&1
}

wait_healthy() {
  local i; for i in $(seq 1 40); do
    if health >/dev/null 2>&1; then return 0; fi
    sleep 0.5
  done
  return 1
}

unpack_server() {
  [[ -f "$SERVER_ZIP" ]] || die "server zip not found: ${SERVER_ZIP:-<none>} (pass --server <zip>)"
  local keep; keep="$(mktemp -d)"
  if [[ -d "$SERVER_DIR" ]]; then
    for k in .env data .venv; do [[ -e "$SERVER_DIR/$k" ]] && mv "$SERVER_DIR/$k" "$keep/"; done
    rm -rf "$SERVER_DIR"
  fi
  mkdir -p "$DEST"
  local tmp; tmp="$(mktemp -d)"
  unzip -q "$SERVER_ZIP" -d "$tmp"
  mv "$tmp/ds-foundry-server" "$SERVER_DIR"; rm -rf "$tmp"
  for k in .env data .venv; do [[ -e "$keep/$k" ]] && rm -rf "$SERVER_DIR/$k" && mv "$keep/$k" "$SERVER_DIR/"; done
  rm -rf "$keep"
  ok "server unpacked → $SERVER_DIR ($(basename "$SERVER_ZIP"))"
}

unpack_plugin() {
  [[ -f "$PLUGIN_ZIP" ]] || die "plugin zip not found: ${PLUGIN_ZIP:-<none>} (pass --plugin <zip>)"
  mkdir -p "$DEST"
  local tmp; tmp="$(mktemp -d)"
  unzip -q "$PLUGIN_ZIP" -d "$tmp"
  rm -rf "$PLUGIN_DIR"; mv "$tmp/ds-foundry" "$PLUGIN_DIR"; rm -rf "$tmp"
  ok "plugin unpacked → $PLUGIN_DIR ($(basename "$PLUGIN_ZIP"))"
}

write_env() {
  cd "$SERVER_DIR"
  [[ -f .env ]] || cp .env.example .env
  set_kv() { # set_kv KEY VALUE — replace or append in .env
    if grep -q "^$1=" .env; then
      sed -i '' -e "s|^$1=.*|$1=$2|" .env 2>/dev/null || sed -i -e "s|^$1=.*|$1=$2|" .env
    else echo "$1=$2" >> .env; fi
  }
  # prompt only when interactive and nothing was supplied and nothing is set yet
  if [[ -z "$ANTHROPIC" && -t 0 ]] && ! grep -q '^ANTHROPIC_API_KEY=.\+' .env; then
    read -r -s -p "  Anthropic API key (Enter to skip): " ANTHROPIC; echo
  fi
  if [[ -z "$GEMINI" && -t 0 ]] && ! grep -q '^GOOGLE_API_KEY=.\+' .env; then
    read -r -s -p "  Gemini API key (Enter to skip): " GEMINI; echo
  fi
  [[ -n "$ANTHROPIC" ]] && set_kv ANTHROPIC_API_KEY "$ANTHROPIC"
  [[ -n "$GEMINI" ]] && set_kv GOOGLE_API_KEY "$GEMINI"
  chmod 600 .env
  local have_a have_g
  grep -q '^ANTHROPIC_API_KEY=.\+' .env && have_a=yes || have_a=no
  grep -q '^GOOGLE_API_KEY=.\+' .env && have_g=yes || have_g=no
  ok ".env ready (Anthropic key: $have_a · Gemini key: $have_g). Keys can also be pasted in the plugin per run."
}

install_deps() {
  cd "$SERVER_DIR"
  py_ok || die "Python 3.11+ is required. On macOS: brew install python@3.12"
  [[ -d .venv ]] || python3 -m venv .venv
  ./.venv/bin/pip install -q --upgrade pip
  ./.venv/bin/pip install -q -r requirements.txt
  ok "python deps installed in $SERVER_DIR/.venv"
  if [[ $WANT_OLLAMA -eq 1 ]]; then
    ./.venv/bin/pip install -q langchain-ollama && ok "langchain-ollama installed"
    if have ollama; then ollama pull llama3.2-vision && ok "ollama model llama3.2-vision ready"
    else warn "ollama not installed — get it from https://ollama.com, then: ollama pull llama3.2-vision"; fi
  fi
}

run_tests() {
  cd "$SERVER_DIR"
  ./.venv/bin/python -m pytest -q tests && ok "pipeline tests pass"
}

start_bg() {
  cd "$SERVER_DIR"
  if server_running; then ok "server already running on :$PORT"; return; fi
  set -a; [[ -f .env ]] && source .env; set +a
  nohup ./.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port "$PORT" >>"$LOG" 2>&1 &
  echo $! > "$PIDFILE"
  wait_healthy && ok "server up: http://127.0.0.1:$PORT  (log: $LOG)" || die "server did not become healthy — see $LOG"
}

stop_bg() {
  if [[ -f "$PIDFILE" ]]; then kill "$(cat "$PIDFILE")" 2>/dev/null || true; rm -f "$PIDFILE"; fi
  # anything else bound to the port from an earlier run
  if have lsof; then lsof -ti "tcp:$PORT" -sTCP:LISTEN 2>/dev/null | xargs kill 2>/dev/null || true; fi
  ok "server stopped"
}

install_launchd() {
  have launchctl || die "--launchd is macOS only"
  mkdir -p "$HOME/Library/LaunchAgents"
  cat > "$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array>
    <string>/bin/bash</string><string>-lc</string>
    <string>cd "$SERVER_DIR" &amp;&amp; set -a &amp;&amp; [ -f .env ] &amp;&amp; . ./.env; set +a; exec ./.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port $PORT</string>
  </array>
  <key>WorkingDirectory</key><string>$SERVER_DIR</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
</dict></plist>
PL
  launchctl bootout "gui/$(id -u)" "$PLIST" 2>/dev/null || true
  stop_bg >/dev/null
  launchctl bootstrap "gui/$(id -u)" "$PLIST"
  wait_healthy && ok "server registered with launchd ($LABEL) and running on :$PORT — starts at login" || die "launchd job failed — see $LOG"
}

status() {
  say "DS Foundry status"
  [[ -d "$PLUGIN_DIR" ]] && ok "plugin: $PLUGIN_DIR (v$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$PLUGIN_DIR/package.json"))" || warn "plugin not installed"
  [[ -d "$SERVER_DIR" ]] && ok "server: $SERVER_DIR" || warn "server not installed"
  if h="$(health)"; then ok "server healthy on :$PORT → $h"; else warn "server not responding on :$PORT"; fi
  [[ -f "$PLIST" ]] && ok "launchd: $PLIST" || true
}

figma_handoff() {
  say "Plugin → Figma (the one step that can't be scripted)"
  if have pbcopy; then printf '%s' "$PLUGIN_DIR/manifest.json" | pbcopy; ok "manifest path copied to clipboard"; fi
  echo "  1. In Figma: Plugins → Development → Import plugin from manifest…"
  echo "  2. In the file dialog press ⌘⇧G, paste (⌘V), press Enter, then Open."
  echo "     $PLUGIN_DIR/manifest.json"
  echo "  3. Plugins → Development → DS Foundry → Scan → AI naming → Provider: Proxy → Suggest names."
  echo "  (Already imported from this path before? Skip 1–2 — Figma picks up the new build automatically.)"
  if [[ $OPEN_FIGMA -eq 1 ]] && have open && [[ -d "/Applications/Figma.app" ]]; then open -a Figma && ok "Figma opened"; fi
}

# ---------------------------------------------------------------- commands

case "$CMD" in
  install|update)
    say "DS Foundry installer"
    [[ -n "$PLUGIN_ZIP" ]] || PLUGIN_ZIP="$(newest_zip ds-foundry)"
    [[ -n "$SERVER_ZIP" ]] || SERVER_ZIP="$(newest_zip ds-foundry-server)"
    have unzip || die "unzip not found"
    have curl || die "curl not found"
    say "Server"
    unpack_server
    write_env
    install_deps
    [[ $RUN_TESTS -eq 1 ]] && run_tests
    if [[ $START -eq 1 ]]; then
      if [[ $USE_LAUNCHD -eq 1 ]]; then install_launchd; else start_bg; fi
      ok "health: $(health)"
    fi
    say "Plugin"
    unpack_plugin
    figma_handoff
    ;;
  start)   if [[ -f "$PLIST" ]]; then launchctl bootstrap "gui/$(id -u)" "$PLIST" 2>/dev/null || true; wait_healthy && ok "running on :$PORT"; else start_bg; fi;;
  stop)    if [[ -f "$PLIST" ]]; then launchctl bootout "gui/$(id -u)" "$PLIST" 2>/dev/null || true; fi; stop_bg;;
  restart) "$0" stop --port "$PORT" --dest "$DEST"; "$0" start --port "$PORT" --dest "$DEST";;
  status)  status;;
  logs)    tail -n 80 -f "$LOG";;
  test)    run_tests;;
  uninstall-launchd) launchctl bootout "gui/$(id -u)" "$PLIST" 2>/dev/null || true; rm -f "$PLIST"; ok "launchd job removed";;
  *) die "unknown command: $CMD (install|start|stop|restart|status|logs|test|uninstall-launchd)";;
esac
````

## File: README.md
````markdown
# DS Foundry

An automated **design system generator, asset organizer, and AI-assisted layer namer** for Figma.

DS Foundry scans any Figma file (or page, or selection), heuristically inventories its visual language and UI components, names unnamed layers and vectors using multimodal AI, and constructs a complete, production-ready design system with styles, variables, component sets, and token exports.

---

## Repository Structure

```
.
├── ds-foundry/               # Figma Plugin (TypeScript + esbuild + UI panel)
│   ├── src/                  # Plugin backend logic (scanner, classifier, builder, tokens)
│   ├── ui/                   # Single-file HTML/CSS/JS plugin panel
│   ├── dist/                 # Pre-built plugin bundles (code.js, ui.html)
│   ├── manifest.json         # Figma manifest configuration
│   └── package.json
│
├── ds-foundry-server/        # Companion AI Naming Proxy (FastAPI + LangGraph)
│   ├── app/                  # LangGraph pipeline, prompts, glossary, FastAPI routes
│   ├── tests/                # Automated pytest test suite
│   ├── requirements.txt      # Python dependencies
│   ├── run.sh                # Server launch script
│   └── .env.example          # Environment template for Anthropic / Google keys
│
└── install-ds-foundry.sh     # macOS installer & lifecycle management script
```

---

## Key Features

### 1. Automated Design System Construction
* **Foundations**: Automatically derives color roles (`primary`, `secondary`, `neutral`, `error`, etc.), typography scales, spacing grids (4px or 8px), and corner radius tokens.
* **Figma Variables & Styles**: Generates local Color, Text, and Effect styles, plus a `DS Foundry / Primitives` Variables collection.
* **Component Sets**: Recognizes buttons, inputs, badges, cards, and avatars; clones distinct instances and organizes them into component sets with variant properties (`Style`, `Size`).
* **Icons & Assets Sheet**: Centers vector icons on standard frames, promotes brand marks and illustrations into an indexed contact sheet, and identifies "debris" (invisible or micro-specks under 6px) for one-click cleanup.
* **Token Export**: Generates W3C DTCG `tokens.json`, `tokens.css`, `tailwind.tokens.cjs`, `DESIGN_SYSTEM.md`, and `inventory.json`.

### 2. Multimodal AI Visual Naming (`ds-foundry-server`)
Heuristics categorize layers by geometry, but AI visual naming inspects thumbnails and labels what they actually show (e.g. `ds/icon/arrow-left` instead of `vector-14`, or `ds/card/pricing-plan` instead of `frame-3`).
* **LangGraph Pipeline**: `Cache lookup → Propose → Critic pass → Align with glossary → Reconcile references → Finalize`.
* **Critic Pass**: Rejects generic labels, enforces kebab-case conventions, and retries ambiguous candidates.
* **Glossary & Consistency**: Preserves accepted names across files to avoid naming drift (e.g. keeps "search" consistent rather than drifting to "magnifier").
* **Reference Learning**: Identifies mascots, logos, and characters to maintain consistent naming across multiple perspectives and poses.
* **Provider Flexibility**: Supports Claude (Anthropic), Gemini (Google AI), or local Ollama vision models.

### 3. Safe & Non-Destructive
* **Build confirmation**: Nothing in the Figma document changes until you click **Build design system**.
* **Reversible**: Original layer names are preserved in plugin data; clicking **Revert labels** restores them at any point.

---

## Quick Start

### 1. Start the Naming Server

You can start the server directly using the helper script:

```bash
./install-ds-foundry.sh start
```

Or run manually:

```bash
cd ds-foundry-server
cp .env.example .env     # Add ANTHROPIC_API_KEY and/or GOOGLE_API_KEY
./run.sh
```

The server runs on `http://localhost:8000`. Test health with:
```bash
curl http://localhost:8000/health
```

### 2. Import Plugin into Figma

1. Open the Figma desktop app.
2. Navigate to: **Plugins → Development → Import plugin from manifest…**
3. Select `ds-foundry/manifest.json`.
4. Open any design file and launch **Plugins → Development → DS Foundry**.

### 3. Run a Scan & Generate

1. Choose a scan scope (**Selection**, **Page**, or **Document**) and click **Scan**.
2. (Optional) In **AI naming**, choose **Provider: Proxy** (`http://localhost:8000`), select your preferred model, and click **Suggest names**. Review and apply.
3. Configure your prefix (default `ds/`) and spacing grid.
4. Click **Build design system** and download your exported tokens (`tokens.json`, `tokens.css`, `tailwind.tokens.cjs`).

---

## Development

### Figma Plugin
```bash
cd ds-foundry
npm install
npm run check    # Typecheck with tsc & bundle via esbuild
npm run watch    # Watch mode for active development
```

### Naming Server
```bash
cd ds-foundry-server
pytest -q tests  # Run tests against injected mock chat models
```

---

## License

MIT License. See individual package documentation for further details.
````

## File: .gitignore
````
# Environment & Secrets (CRITICAL)
.env
.env.local
.env.*.local
*.env
!*.env.example
!.env.example

# Operating System
.DS_Store
**/.DS_Store
Thumbs.db

# Python
__pycache__/
*.py[cod]
*$py.class
.venv/
venv/
.pytest_cache/
.coverage
htmlcov/

# Node
node_modules/
npm-debug.log*
yarn-debug.log*
yarn-error.log*

# Server runtime state & logs
ds-foundry-server/data/
ds-foundry-server/server.pid
ds-foundry-server/server.log
*.log

# Repomix output
repomix-output.*

# IDE
.idea/
.vscode/
*.swp
*.swo
````
