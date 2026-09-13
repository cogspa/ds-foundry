import {AssetName,normalizeAssetName,assetName,readAssetName} from './asset-names';
import {shapeFeatures, ShapeFeatures} from './similarity';
import { appearanceKey } from './contact-sheet';
import {logoUiCategory} from './classify';
import { Inventory, ElementRec, Category } from './types';
import { PD_ORIGINAL, PD_CATEGORY, post, tick, cancelled, slug } from './util';

export interface AiTargets { icons: boolean; art: boolean; images: boolean; screens: boolean; cards: boolean; components: boolean; text: boolean; shapes: boolean; }

export interface AiItem {
  assetName?: AssetName | null;
  referenceName?: string;
  features?: ShapeFeatures;
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
    if (r.inInstance && r.nodeType !== 'INSTANCE') continue;
    const g = groups.get(appearanceKey(r));
    if (g) g.ids.push(r.id);
    else groups.set(appearanceKey(r), { rec: r, ids: [r.id] });
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
    for (const g of pickDistinct(inv.elements.filter(e => ['button','input','badge','checkbox','toggle','other'].includes(e.category)), cap(200))) plan.push({rec:g.rec,ids:g.ids,category:g.rec.category,name:g.rec.name,text:g.rec.text,page:g.rec.page,size:384,nodeId:g.rec.id});
    for (const c of inv.components.filter((x) => !x.remote).slice(0, cap(200))) {
      if (!plan.some(p => p.ids.includes(c.id))) plan.push({ rec: null, ids: [c.id], category: 'component', name: c.name, text: '', page: '', size: 384, nodeId: c.id });
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
    const semantic=node.getPluginData('dsf.semanticName');
    const existing=semantic || node.name.split('/').pop() || '';
    const meaningful=existing && !/^(vector|group|frame|path|shape|illustration|symbol|icon)([ -]*\d+)?$/i.test(existing) && !/(piece-\d|\d+x\d+|needs.identification)/i.test(existing);
    const referenceName=meaningful && ['character','illustration','logo','symbol','icon'].includes(p.category)?existing:undefined;
    chunk.push({ assetName:readAssetName(node),referenceName,features:shapeFeatures(exportNode), key: p.rec ? appearanceKey(p.rec) : p.nodeId, ids: p.ids, category: p.category, name: p.name, desc: p.rec ? p.rec.desc : '', text: p.text, w: Math.round(node.width), h: Math.round(node.height), page: p.page, png });
    sent++;
    if (chunk.length >= 6 || i === plan.length - 1) {
      post({ type: 'ai_items', items: chunk, sent, total: plan.length });
      chunk = [];
      await tick();
    }
  }
  if (chunk.length) post({type:'ai_items',items:chunk,sent,total:plan.length});
  post({ type: 'ai_items', items: [], sent, total: plan.length, done: true });
  return sent;
}

const PATH_FOR: Record<string, string> = {
  icon: 'icon', symbol: 'symbol', logo: 'logo', character: 'character', illustration: 'illustration', image: 'image', avatar: 'avatar',
  screen: 'screen', section: 'section', nav: 'nav', card: 'card', 'list-item': 'list-item', button: 'button', badge: 'badge',
  input: 'input', checkbox: 'checkbox', toggle: 'toggle', tagline: 'tagline', copy: 'copy', shape: 'shape', debris: 'debris', component: '',
};

/** Apply names chosen in the UI. Returns number of renamed layers. */
export async function applyAiNames(renames: { ids: string[]; name: string; category: string; kind?: string; assetName?: AssetName }[], prefix: string, usePrefix: boolean): Promise<number> {
  let n = 0;
  for (let i = 0; i < renames.length; i++) {
    if (cancelled) throw new Error('cancelled');
    const r = renames[i];
    const structured=normalizeAssetName(r.assetName);
    const clean = structured?assetName(structured):slug(r.name, 100);
    if (!clean) continue;
    // the model may reclassify (a "symbol" that is really a logo, an "illustration" that is a character)
    const cat = r.kind && PATH_FOR[r.kind] !== undefined ? r.kind : r.category;
    for (const id of r.ids) {
      try {
        const node = await figma.getNodeByIdAsync(id);
        if (!node || node.removed || node.type === 'DOCUMENT' || node.type === 'PAGE') continue;
        // never rename a variant inside a component set — that would rewrite its properties
        if (node.type === 'COMPONENT' && node.parent && node.parent.type === 'COMPONENT_SET') continue;
        const safeCategory = cat === 'logo' ? logoUiCategory(node as SceneNode) || cat : cat;
        const path = PATH_FOR[safeCategory] ?? safeCategory;
        const finalName = usePrefix ? `${prefix}${path ? path + '/' : ''}${clean}` : clean;
        if (!node.getPluginData(PD_ORIGINAL)) node.setPluginData(PD_ORIGINAL, node.name);
        node.setPluginData(PD_CATEGORY, safeCategory as Category);
        node.setPluginData('dsf.semanticName', clean);
        node.setPluginData('dsf.assetName',structured?JSON.stringify(structured):'');
        node.name = finalName;
        n++;
      } catch { /* locked / read-only */ }
    }
    if (i % 25 === 0) { post({ type: 'progress', pct: Math.round((i / renames.length) * 100), msg: `Renaming… ${i}/${renames.length}` }); await tick(); }
  }
  return n;
}
