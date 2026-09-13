/** Pure review operations, bundled for both UI and key-free tests. */
import { AssetMap, AssetFamily, VariantProperties } from './asset-types';

export function renameFamily(f: AssetFamily, name: string): void {
  name = name.trim(); if (!name || name.length > 120) throw new Error('Enter a name of 1–120 characters');
  if (!f.aliases.includes(f.canonicalName)) f.aliases.push(f.canonicalName);
  f.canonicalName = name; f.status = 'pending';
  for (const v of f.variants) v.canonicalName = name;
}
export function mergeFamilies(map: AssetMap, targetId: string, sourceId: string, evidence: string[] = [], confidence?: number): void {
  const target = map.assets.find(f => f.assetId === targetId), source = map.assets.find(f => f.assetId === sourceId);
  if (!target || !source || target === source) throw new Error('Choose two different families');
  if (target.kind !== source.kind) throw new Error('Families must have the same category');
  const locks = new Set([...target.variants,...source.variants].map(v => v.variant.lockup).filter(Boolean));
  if (locks.has('mark') && locks.size > 1) throw new Error('Mark and wordmark must stay separate. Set the same brand family instead.');
  for (const v of source.variants) {
    v.assetId = target.assetId; v.canonicalName = target.canonicalName;
    v.identityEvidence = [...v.identityEvidence, 'designer merged families'];
    target.variants.push(v);
  }
  target.aliases = [...new Set([...target.aliases,source.canonicalName,...source.aliases])].slice(0,100);
  target.supersedes = [...new Set([...target.supersedes,source.assetId,...source.supersedes])];
  target.referenceNodeId ||= source.referenceNodeId;
  target.status='pending';
  if (evidence.length && confidence!==undefined && Number.isFinite(confidence)) {
    for (const v of target.variants) { v.identityEvidence=[...new Set([...v.identityEvidence,...evidence])]; v.identityConfidence=Math.max(v.identityConfidence,Math.max(0,Math.min(1,confidence))); }
  }
  target.confidence=Math.min(...target.variants.map(v=>v.identityConfidence));
  map.assets=map.assets.filter(f => f!==source);
  map.proposals=map.proposals.filter(p => p.left!==sourceId && p.right!==sourceId);
}
export function splitFamily(map: AssetMap, id: string, nodeIds: string[], newId: string): AssetFamily {
  const f=map.assets.find(f => f.assetId===id);
  if (!f || !nodeIds.length || map.assets.some(f => f.assetId===newId)) throw new Error('Invalid split');
  const chosen=new Set(nodeIds), variants=f.variants.filter(v=>chosen.has(v.nodeId));
  if (!variants.length || variants.length===f.variants.length) throw new Error('Select some, but not all, variants to split');
  const next: AssetFamily={...f,assetId:newId,canonicalName:f.canonicalName+' (split)',variants,aliases:[],supersedes:[],status:'pending',referenceNodeId:variants[0].nodeId};
  for (const v of variants) { v.assetId=newId; v.canonicalName=next.canonicalName; v.identityEvidence=[...v.identityEvidence,'designer split family']; }
  f.variants=f.variants.filter(v=>!chosen.has(v.nodeId)); f.status='pending';
  if (!f.variants.some(v=>v.nodeId===f.referenceNodeId)) f.referenceNodeId=f.variants[0].nodeId;
  map.assets.push(next); map.proposals=map.proposals.filter(p=>p.left!==id && p.right!==id);
  return next;
}
export function editVariant(f: AssetFamily, nodeId: string, patch: VariantProperties): void {
  const v=f.variants.find(v=>v.nodeId===nodeId); if (!v) throw new Error('Unknown variant');
  v.variant={...v.variant,...patch}; f.status='pending';
}
export function approveFamily(f: AssetFamily): void {
  if (!f.variants.length) throw new Error('A reference-only family has no current nodes to approve');
  f.status='approved';
  for (const v of f.variants) if (!v.identityEvidence.includes('designer approved family')) v.identityEvidence.push('designer approved family');
}
export function exportAssetMap(map: AssetMap): string {
  // Images are evidence for review, not layout data. Retain every node and explicit approval status.
  return JSON.stringify({...map,assets:map.assets.map(f=>({...f,variants:f.variants.map(({image,...v})=>v)}))},null,2);
}
