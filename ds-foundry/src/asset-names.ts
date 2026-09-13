/** Identity and appearance are explicit data; legacy names are never split by guessing. */
export const APPEARANCE_FIELDS=['color','pose','crop','treatment','orientation'] as const;
export type Appearance=Partial<Record<typeof APPEARANCE_FIELDS[number],string>>;
export interface AssetName {identity:string;appearance:Appearance;}
const clean=(s:unknown)=>String(s||'').trim().toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'');
export function normalizeAssetName(value:unknown):AssetName|null {
  if(!value||typeof value!=='object')return null;
  const v=value as any,identity=clean(v.identity).slice(0,40);if(!identity)return null;
  const appearance:Appearance={};for(const k of APPEARANCE_FIELDS){const s=clean(v.appearance?.[k]).slice(0,30);if(s)appearance[k]=s;}
  return {identity,appearance};
}
export function assetName(value:AssetName):string {
  return [value.identity,...APPEARANCE_FIELDS.map(k=>value.appearance[k]).filter(Boolean)].join('-');
}
export function readAssetName(node:BaseNode):AssetName|null {
  try{return normalizeAssetName(JSON.parse(node.getPluginData('dsf.assetName')));}catch{return null;}
}
