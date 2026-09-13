import { Inventory, Category } from './types';
import { AssetItem, AssetMap } from './asset-types';
import { extractIdentity, componentRelationship } from './identity';
import { layoutMetadata } from './layout-meta';
import { PD_ASSET_ID, PD_ASSET_VARIANT, PD_ASSET_CONFIDENCE, PD_ASSET_PROJECT, PD_CATEGORY, PD_GENERATED, cancelled, tick, post } from './util';

let prepared = new Map<string, AssetItem>();
let documentId = '';
let preparedProject = '';
export function invalidateAssets() { prepared.clear(); }
export async function prepareAssets(inv: Inventory, project: string, semantic: {ids:string[];name:string;kind:Category;description?:string}[] = []) {
  prepared.clear(); preparedProject=project;
  // Node IDs are file-local. An ephemeral document token avoids writing during resolution.
  documentId=figma.fileKey || figma.root.getPluginData('dsf.documentId') || 'session-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2);
  // Do not persist a shared fallback token: distinct files must never share the node-ID namespace.

  const byId = new Map(semantic.flatMap(s=>s.ids.map(id=>[id,s] as const)));
  const thumbs = new Map<string,string>(); let exports=0;
  const pool=[...inv.elements,...inv.icons,...inv.shapes];
  if (pool.length>10000) throw new Error('Canonical resolution supports 10,000 records per scan. Narrow the scope.');
  for (let i=0;i<pool.length;i++) {
    if (cancelled) throw new Error('cancelled');
    const r=pool[i];
    const n=await figma.getNodeByIdAsync(r.id);
    if (!n || n.removed || n.type==='PAGE' || n.type==='DOCUMENT') continue;
    let generated=false; for (let p: BaseNode|null=n;p;p=p.parent) if (p.getPluginData(PD_GENERATED)==='1') { generated=true; break; }
    if (generated || ('visible' in n && n.visible===false)) continue;
    const node=n as SceneNode, s=byId.get(r.id);
    const kind=(s?.kind || node.getPluginData(PD_CATEGORY) || r.category) as Category;
    if (kind==='debris' || kind==='other') continue;
    const features=extractIdentity(node), relationship=await componentRelationship(node);
    features.componentFamily=relationship.family;
    const layout=layoutMetadata(node); layout.componentFamily=relationship.family; layout.mainComponentId=relationship.mainComponentId; layout.parentSemanticRole=r.layout?.parentSemanticRole;
    const it:AssetItem={nodeId:r.id,kind,name:node.name,semanticName:s?.name || '',description:s?.description || '',fingerprint:r.fingerprint,width:node.width,height:node.height,page:r.page,features,layout};
    if (node.getPluginData(PD_ASSET_PROJECT)===project) {
      it.approvedAssetId=node.getPluginData(PD_ASSET_ID) || undefined;
      try { const old=JSON.parse(node.getPluginData(PD_ASSET_VARIANT));
        // Manual appearance edits apply only while the original deterministic features still match.
        if (old.featureSnapshot===JSON.stringify([features.geometrySignature,features.variant,features.visibleText])) it.approvedVariant=old.variant;
      } catch { /* legacy or invalid metadata: re-review */ }
    }
    const key=features.geometrySignature ? features.geometrySignature+JSON.stringify(features.variant) : r.id;
    if (thumbs.has(key)) it.image=thumbs.get(key);
    else if (exports<400 && node.width>0 && node.height>0) {
      try {
        const bytes=await node.exportAsync({format:'PNG',constraint:{type:node.width>=node.height?'WIDTH':'HEIGHT',value:256}});
        it.image=figma.base64Encode(bytes); thumbs.set(key,it.image); exports++;
      } catch { features.warnings.push('Thumbnail unavailable'); }
    }
    prepared.set(it.nodeId,it);
    if (i%25===0) { post({type:'progress',pct:Math.round(i/pool.length*100),msg:`Canonical features… ${i}/${pool.length}`}); await tick(); }
  }
  post({type:'assets_prepared',documentId,items:[...prepared.values()],project,warnings:exports>=400?['Thumbnail budget: 400 distinct appearances. All feature records retained.']:[]});
}

/** Validate the whole partition and stale geometry before any original-node write. */
export async function applyAssets(inv: Inventory, map: AssetMap, project: string) {
  if (project!==preparedProject || map.documentId!==documentId || !prepared.size) throw new Error('Scan/resolve again before applying this review');
  const seen=new Set<string>(), familyIds=new Set<string>();
  const writes: {node:SceneNode;values:[string,string][]}[]=[];
  for (const f of map.assets) {
    if (familyIds.has(f.assetId) || !/^[a-z0-9][a-z0-9/_-]{0,199}$/.test(f.assetId)) throw new Error('Invalid or duplicate asset ID');
    familyIds.add(f.assetId);
    if (f.referenceNodeId && !f.variants.some(v=>v.nodeId===f.referenceNodeId)) throw new Error('Invalid reference node');
    for (const v of f.variants) {
      if (seen.has(v.nodeId) || !prepared.has(v.nodeId) || v.assetId!==f.assetId || v.kind!==f.kind || v.canonicalName!==f.canonicalName) throw new Error('Invalid family membership');
      seen.add(v.nodeId);
      if (f.status!=='approved') continue;
      if (!Number.isFinite(v.identityConfidence) || v.identityConfidence<0 || v.identityConfidence>1) throw new Error('Invalid confidence');
      const node=await figma.getNodeByIdAsync(v.nodeId);
      if (!node || node.removed || node.type==='PAGE' || node.type==='DOCUMENT') throw new Error('A reviewed node was removed. Resolve again.');
      const before=prepared.get(v.nodeId)!; const now=extractIdentity(node as SceneNode);
      const comparable=(f:typeof now)=>JSON.stringify([f.geometrySignature,f.geometryReliable,f.visibleText,f.variant]);
      if (comparable(now)!==comparable(before.features) || ('width' in node && (node.width!==before.width || node.height!==before.height))) throw new Error('A reviewed node changed. Resolve again.');
      const layoutNow=layoutMetadata(node as SceneNode);
      if (JSON.stringify(layoutNow.absoluteBounds)!==JSON.stringify(before.layout?.absoluteBounds)) throw new Error('A reviewed node moved. Resolve again.');
      if (!now.geometryReliable) {
        if (!before.image) throw new Error('A non-vector asset has no review thumbnail. Narrow the scope and resolve again.');
        const n=node as SceneNode;
        const bytes=await n.exportAsync({format:'PNG',constraint:{type:n.width>=n.height?'WIDTH':'HEIGHT',value:256}});
        if (figma.base64Encode(bytes)!==before.image) throw new Error('A reviewed image changed. Resolve again.');
      }
      writes.push({node:node as SceneNode,values:[[PD_ASSET_ID,f.assetId],[PD_ASSET_VARIANT,JSON.stringify({version:1,variantId:v.variantId,kind:f.kind,canonicalName:f.canonicalName,variant:v.variant,referenceNodeId:f.referenceNodeId,featureSnapshot:JSON.stringify([before.features.geometrySignature,before.features.variant,before.features.visibleText])})],[PD_ASSET_CONFIDENCE,JSON.stringify({score:v.identityConfidence,evidence:v.identityEvidence})],[PD_ASSET_PROJECT,project]]});
    }
  }
  if (seen.size!==prepared.size) throw new Error('Review lost scanned nodes. Resolve again.');
  const undo:{node:BaseNode;key:string;value:string}[]=[];
  try {
    if (writes.length && !figma.fileKey && !figma.root.getPluginData('dsf.documentId')) {
      undo.push({node:figma.root,key:'dsf.documentId',value:''}); figma.root.setPluginData('dsf.documentId',documentId);
    }
    for (const w of writes) for (const [key,value] of w.values) { undo.push({node:w.node,key,value:w.node.getPluginData(key)}); w.node.setPluginData(key,value); }
  } catch (e) { for (const u of undo.reverse()) { try {u.node.setPluginData(u.key,u.value);} catch {} } throw e; }
  inv.assetMap=map;
  post({type:'assets_applied',count:writes.length,map,project});
}
