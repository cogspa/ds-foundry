import {artworkRole} from './artwork';
import {logoUiCategory} from './classify';
import {readAssetName} from './asset-names';
import { Category, ElementRec, Inventory } from './types';
import { elementLabel, isDefaultName } from './naming';
import { PD_CATEGORY, PD_GENERATED } from './util';

const categories = new Set<string>(['screen','section','nav','card','button','input','badge','avatar','image','icon','divider','list-item','checkbox','toggle','text','shape','logo','character','illustration','symbol','tagline','copy','debris','other']);
export function resolvedCategory(value: string, fallback: Category): Category {
  return categories.has(value) ? value as Category : fallback;
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
  if (rec.semanticName) return rec.semanticName;
  const path = prefix && rec.name.startsWith(prefix) ? rec.name.slice(prefix.length) : rec.name;
  const name = path.replace(new RegExp('^' + rec.category + '/'), '').replace(/-/g, ' ');
  if (!isDefaultName(name)) return path;
  if (rec.category === 'debris') return `Possible debris · ${rec.desc || 'empty or tiny vector'}`;
  if (['icon','logo','symbol','illustration','character','other'].includes(rec.category)) {
    return `Needs identification · ${rec.desc || rec.category} · ${rec.id}`;
  }
  return elementLabel(rec, '').replace(/\//g, ' · ');
}
/** Refresh the snapshot after AI naming, before any build can overwrite reviewed categories. */
export async function refreshIdentifications(inv: Inventory): Promise<void> {
  const records: ElementRec[] = [];
  const approved = new Map(inv.assetMap?.assets.filter(f => f.status === 'approved').flatMap(f => f.variants.map(v => [v.nodeId, f] as const)) || []);
  for (const rec of [...inv.elements, ...inv.icons, ...inv.shapes]) {
    const node = await figma.getNodeByIdAsync(rec.id);
    if (!node || node.removed || hasGeneratedAncestor(node)) continue;
    rec.name = node.name;rec.assetName=readAssetName(node);if('width' in node)Object.assign(rec,artworkRole(node as SceneNode));
    const savedCategory = node.getPluginData(PD_CATEGORY);
    if (savedCategory !== 'debris' || node.getPluginData('dsf.semanticName')) rec.category = resolvedCategory(savedCategory, rec.category);
    const semantic = node.getPluginData('dsf.semanticName');
    if (semantic) rec.semanticName = semantic;
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
    if (rec.category === 'logo' && 'width' in node) rec.category = logoUiCategory(node as SceneNode) || rec.category;
    records.push(rec);
  }
  inv.elements = records.filter(r => r.category !== 'icon' && r.category !== 'shape');
  inv.icons = records.filter(r => r.category === 'icon');
  inv.shapes = records.filter(r => r.category === 'shape');
}
