import {AssetName,normalizeAssetName,assetName,readAssetName} from './asset-names';
import {shapeFeatures, ShapeFeatures} from './similarity';
import { appearanceKey, refreshIdentifications } from './contact-sheet';
import {establishedName} from './asset-labels';
import {artworkRole} from './artwork';
import {logoUiCategory} from './classify';
import { Inventory, ElementRec, Category } from './types';
import { PD_ORIGINAL, PD_CATEGORY, post, tick, cancelled, slug } from './util';

export interface AiTargets { icons: boolean; art: boolean; images: boolean; screens: boolean; cards: boolean; components: boolean; text: boolean; shapes: boolean; }

export interface AiItem {
  characterSearch?: boolean;
  existingName?: string;
  existingAssetName?: AssetName | null;
  artworkRole?: 'whole'|'part';
  characterAncestorIds?: string[];
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

function pickDistinct(list: ElementRec[], nested = false): { rec: ElementRec; ids: string[] }[] {
  const groups = new Map<string, { rec: ElementRec; ids: string[] }>();
  for (const r of list) {
    if (!nested && r.inInstance && r.nodeType !== 'INSTANCE') continue;
    // Identical artwork with conflicting established identities stays separate.
    // Keep occurrences separate during character review: an identical wrapper
    // and its child need independent ancestry checks before selecting a copy.
    const key = JSON.stringify([appearanceKey(r), establishedName(r) || '', nested ? r.id : '']);
    const g = groups.get(key);
    if (g) g.ids.push(r.id);
    else groups.set(key, { rec: r, ids: [r.id] });
  }
  return [...groups.values()];
}

async function exportPng(node: SceneNode, target: number): Promise<Uint8Array | null> {
  try {
    if (node.width < 1 || node.height < 1) return null;
    const constraint: ExportSettingsConstraints = node.width >= node.height ? { type: 'WIDTH', value: target } : { type: 'HEIGHT', value: target };
    return await (node as ExportMixin).exportAsync({ format: 'PNG', constraint, useAbsoluteBounds: true });
  } catch { return null; }
}

/** Collect candidates, export thumbnails, stream them to the UI in chunks. */
export async function prepareAiItems(inv: Inventory, targets: AiTargets, maxItems: number, charactersOnly=false): Promise<number> {
  await refreshIdentifications(inv);
  const plan: { rec: ElementRec | null; ids: string[]; category: string; name: string; text: string; page: string; size: number; nodeId: string }[] = [];
  // Collect before limiting: named icons must not consume the illustration budget.

  if (targets.icons) {
    for (const g of pickDistinct(inv.icons)) plan.push({ rec: g.rec, ids: g.ids, category: 'icon', name: g.rec.name, text: '', page: g.rec.page, size: 256, nodeId: g.rec.id });
    for (const g of pickDistinct(inv.elements.filter((e) => e.category === 'symbol'))) plan.push({ rec: g.rec, ids: g.ids, category: 'symbol', name: g.rec.name, text: '', page: g.rec.page, size: 320, nodeId: g.rec.id });
  }
  if (targets.art) for (const g of pickDistinct(inv.elements.filter((e) => e.category === 'logo' || e.category === 'character' || e.category === 'illustration'))) plan.push({ rec: g.rec, ids: g.ids, category: g.rec.category, name: g.rec.name, text: g.rec.text, page: g.rec.page, size: 384, nodeId: g.rec.id });
  if (targets.text) for (const g of pickDistinct(inv.elements.filter((e) => e.category === 'tagline' || e.category === 'copy'))) plan.push({ rec: g.rec, ids: g.ids, category: g.rec.category, name: g.rec.name, text: g.rec.text, page: g.rec.page, size: 320, nodeId: g.rec.id });
  if (targets.images) for (const g of pickDistinct(inv.elements.filter((e) => e.category === 'image' || e.category === 'avatar'))) plan.push({ rec: g.rec, ids: g.ids, category: g.rec.category, name: g.rec.name, text: '', page: g.rec.page, size: 384, nodeId: g.rec.id });
  if (targets.screens) for (const g of pickDistinct(inv.elements.filter((e) => e.category === 'screen' || e.category === 'section' || e.category === 'nav'))) plan.push({ rec: g.rec, ids: g.ids, category: g.rec.category, name: g.rec.name, text: g.rec.text, page: g.rec.page, size: 384, nodeId: g.rec.id });
  if (targets.cards) for (const g of pickDistinct(inv.elements.filter((e) => e.category === 'card' || e.category === 'list-item'))) plan.push({ rec: g.rec, ids: g.ids, category: g.rec.category, name: g.rec.name, text: g.rec.text, page: g.rec.page, size: 384, nodeId: g.rec.id });
  if (targets.components) {
    for (const g of pickDistinct(inv.elements.filter(e => ['button','input','badge','checkbox','toggle','other'].includes(e.category)))) plan.push({rec:g.rec,ids:g.ids,category:g.rec.category,name:g.rec.name,text:g.rec.text,page:g.rec.page,size:384,nodeId:g.rec.id});
    for (const c of inv.components.filter((x) => !x.remote)) {
      if (!plan.some(p => p.ids.includes(c.id))) plan.push({ rec: null, ids: [c.id], category: 'component', name: c.name, text: '', page: '', size: 384, nodeId: c.id });
    }
  }
  if (targets.shapes) for (const g of pickDistinct(inv.shapes)) plan.push({ rec: g.rec, ids: g.ids, category: 'shape', name: g.rec.name, text: '', page: g.rec.page, size: 256, nodeId: g.rec.id });

  if(charactersOnly){
    plan.length=0;
    const records=[...new Map([...inv.elements,...inv.icons,...(inv.characterCandidates||[])].map(r=>[r.id,r])).values()];
    for(const g of pickDistinct(records.filter(r=>['character','illustration','symbol','icon'].includes(r.category)&&r.artworkRole!=='part'),true))
      plan.push({rec:g.rec,ids:g.ids,category:g.rec.category,name:g.rec.name,text:g.rec.text,page:g.rec.page,size:384,nodeId:g.rec.id});
    maxItems=Math.min(maxItems,120);
  }
  const named = (p: typeof plan[number]) => establishedName(p.rec || {name:p.name,category:'other'});
  const trustedCharacter = (p: typeof plan[number]) => p.category==='character'&&p.rec?.artworkRole!=='part'&&!!named(p);
  const unknown = plan.filter(p => charactersOnly?!trustedCharacter(p):!named(p));
  const art = (p: typeof plan[number]) => ['logo','character','illustration'].includes(p.category);
  unknown.sort((a,b) => Number(art(b)) - Number(art(a)));
  // Target checkboxes control what gets named, not which established examples
  // can identify it. A small Ollie classified as an icon still teaches poses.
  const referencePlan = charactersOnly?plan.filter(trustedCharacter):pickDistinct([...inv.elements,...inv.icons].filter(r =>
    r.artworkRole!=='part'&&['logo','character','illustration','symbol','icon'].includes(r.category) && establishedName(r)
  )).map(g => ({rec:g.rec,ids:g.ids,category:g.rec.category,name:g.rec.name,text:g.rec.text,page:g.rec.page,size:384,nodeId:g.rec.id}));
  const references = referencePlan.sort((a,b) =>
    Number(b.category==='character') - Number(a.category==='character') || Number(art(b)) - Number(art(a))
  ).slice(0,32);
  const selected = [...references,...unknown.slice(0,maxItems)];
  const deferred = Math.max(0,unknown.length-maxItems);
  const preserved = plan.length-unknown.length;
  let exportFailures = 0;
  let chunk: AiItem[] = [];
  let sent = 0;
  for (let i = 0; i < selected.length; i++) {
    if (cancelled) throw new Error('cancelled');
    const p = selected[i];
    let node: SceneNode | null = null;
    try {
      const n = await figma.getNodeByIdAsync(p.nodeId);
      if (n && !n.removed && n.type !== 'DOCUMENT' && n.type !== 'PAGE') node = n as SceneNode;
    } catch { node = null; }
    if (!node) { exportFailures++; continue; }
    // component sets export their default variant
    const exportNode: SceneNode = node.type === 'COMPONENT_SET' ? (node as ComponentSetNode).defaultVariant : node;
    const png = await exportPng(exportNode, p.size);
    if (!png) { exportFailures++; continue; }
    const preservedName=named(p);
    const referenceName=preservedName && (!charactersOnly||trustedCharacter(p)) && ['character','illustration','logo','symbol','icon'].includes(p.category)?preservedName:undefined;
    const desc=(p.rec?.desc||'')+(charactersOnly?' Character search: classify the entire isolated group. One complete figure is character; multiple figures/scenery are illustration; detached body/wing/eye parts are symbol. Use visible color and pose for unnamed characters.':'');
    chunk.push({ assetName:readAssetName(node),existingAssetName:charactersOnly?readAssetName(node):undefined,artworkRole:artworkRole(node).artworkRole,characterSearch:charactersOnly,existingName:charactersOnly?preservedName:undefined,characterAncestorIds:p.rec?.characterAncestorIds,referenceName,features:shapeFeatures(exportNode), key:(charactersOnly?'character-v1:':'')+(p.rec ? appearanceKey(p.rec) : p.nodeId), ids: p.ids, category: p.category, name: p.name, desc, text: p.text, w: Math.round(node.width), h: Math.round(node.height), page: p.page, png });
    sent++;
    if (chunk.length >= 6 || i === selected.length - 1) {
      post({ type: 'ai_items', items: chunk, sent, total: selected.length });
      chunk = [];
      await tick();
    }
  }
  if (chunk.length) post({type:'ai_items',items:chunk,sent,total:selected.length});
  post({ type: 'ai_items', items: [], sent, total: selected.length, done: true, deferred:deferred+(charactersOnly?(inv.characterCandidatesDeferred||0):0), preserved, exportFailures,charactersOnly,nestedCandidates:inv.characterCandidates?.length||0 });
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
