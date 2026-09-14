import {hasCurrentLogoApproval} from './logo-approval';
import {establishedName} from './asset-labels';
import {artworkRole} from './artwork';
import {logoUiCategory} from './classify';
import {readAssetName} from './asset-names';
import { Category, ElementRec, Inventory } from './types';
import { elementLabel } from './naming';
import { PD_CATEGORY, PD_GENERATED } from './util';

const categories = new Set<string>(['screen','section','nav','card','button','input','badge','avatar','image','icon','divider','list-item','checkbox','toggle','text','shape','logo','character','illustration','symbol','tagline','copy','debris','other']);
export function resolvedCategory(value: string, fallback: Category): Category {
  return categories.has(value) ? value as Category : fallback;
}
/** Final output gate: inspect original node plus snapshot labels, not only saved kind. */
export function auditedAssetCategory(rec:ElementRec,node:SceneNode):{category:Category;reason?:string}{
  if(rec.category!=='logo'&&!hasCurrentLogoApproval(node))return {category:rec.category};
  const names=[node.name,node.getPluginData('dsf.originalName'),node.getPluginData('dsf.semanticName'),rec.name,rec.semanticName||'',rec.text||''].join(' ').toLowerCase().replace(/[-_/]+/g,' ');
  const ui=logoUiCategory(node);
  if(ui)return {category:ui,reason:'UI structure or purpose'};
  // Also covers flattened instances / outlines whose original editable text is unavailable.
  if(/\b(status\s*bar|pagination|page indicator|page control)\b/.test(names))return {category:'nav',reason:'status/pagination role'};
  if(/\b(continue (with|wphone)|sign (in|up)|log in)\b/.test(names)||/continue wphone#/.test(names))return {category:'button',reason:'sign-in control'};
  if(/\b(arrow (left|right|up|down)|chevron|wifi|wi fi|battery|signal strength|hamburger|search icon|settings icon|close icon)\b/.test(names))return {category:'icon',reason:'utility icon role'};
  return hasCurrentLogoApproval(node)?{category:'logo'}:{category:'symbol',reason:'Unapproved logo candidate; inspect and approve before listing in Logos'};
}
export function hasGeneratedAncestor(node: BaseNode): boolean {
  let current: BaseNode | null = node;
  while (current && current.type !== 'DOCUMENT') {
    if (current.getPluginData(PD_GENERATED) === '1') return true;
    current = current.parent;
  }
  return false;
}
/** Never deduplicate unrelated artwork using size and a generic layer name. */
export function appearanceKey(rec: ElementRec): string {
  const f = rec.identity;
  return f?.geometryReliable && f.geometrySignature
    ? JSON.stringify([rec.category, f.geometrySignature, f.variant, rec.w, rec.h]) : rec.id;
}
export function sheetName(rec: ElementRec, prefix: string): string {
  const name = establishedName(rec, prefix);
  if (name) return name;
  if (rec.category === 'debris') return `Possible debris · ${rec.desc || 'empty or tiny vector'}`;
  if (['icon','logo','symbol','illustration','character','other'].includes(rec.category)) {
    return `Needs identification · ${rec.desc || rec.category} · ${rec.id}`;
  }
  return elementLabel(rec, '').replace(/\//g, ' · ');
}
/** Refresh the snapshot after AI naming, before any build can overwrite reviewed categories. */
export async function refreshIdentifications(inv: Inventory): Promise<void> {
  const records: ElementRec[] = [];
  const ordinary=new Set([...inv.elements,...inv.icons,...inv.shapes].map(r=>r.id));
  const candidates=new Map((inv.characterCandidates||[]).map(r=>[r.id,r]));
  const approved = new Map(inv.assetMap?.assets.filter(f => f.status === 'approved').flatMap(f => f.variants.map(v => [v.nodeId, f] as const)) || []);
  for (const rec of [...inv.elements, ...inv.icons, ...inv.shapes,...[...candidates.values()].filter(r=>!ordinary.has(r.id))]) {
    const node = await figma.getNodeByIdAsync(rec.id);
    if (!node || node.removed || hasGeneratedAncestor(node)) continue;
    rec.name = node.name;rec.assetName=readAssetName(node);if('width' in node)Object.assign(rec,artworkRole(node as SceneNode));
    const savedCategory = node.getPluginData(PD_CATEGORY);
    if (savedCategory !== 'debris' || node.getPluginData('dsf.semanticName')) rec.category = resolvedCategory(savedCategory, rec.category);
    const semantic = node.getPluginData('dsf.semanticName');
    rec.semanticName = semantic || undefined;
    rec.originalName = node.getPluginData('dsf.originalName') || undefined;
    try {
      const saved = JSON.parse(node.getPluginData('dsf.assetVariant'));
      const f = rec.identity;
      if (!semantic && f && saved.featureSnapshot === JSON.stringify([f.geometrySignature, f.variant, f.visibleText])) {
        if (typeof saved.canonicalName === 'string') rec.semanticName = saved.canonicalName;
        rec.category = resolvedCategory(saved.kind, rec.category);
      }
    } catch { /* Missing or stale approval leaves the reviewed semantic name in place. */ }
    const family = approved.get(rec.id);
    if (family && !semantic) {rec.category = family.kind; rec.semanticName = family.canonicalName;}
    if ('width' in node) rec.category = auditedAssetCategory(rec,node as SceneNode).category;
    if(candidates.has(rec.id)&&(rec.category!=='character'||rec.artworkRole==='part'))continue;
    records.push(rec);
  }
  const wholeCharacters=new Set(records.filter(r=>r.category==='character'&&r.artworkRole!=='part').map(r=>r.id));
  inv.elements = records.filter(r => r.category !== 'icon' && r.category !== 'shape' && !(candidates.has(r.id)&&r.characterAncestorIds?.some(id=>wholeCharacters.has(id))));
  inv.icons = records.filter(r => r.category === 'icon');
  inv.shapes = records.filter(r => r.category === 'shape');
}
