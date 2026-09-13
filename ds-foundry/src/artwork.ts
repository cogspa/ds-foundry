import {Category} from './types';
import {readAssetName} from './asset-names';
const ART=new Set<Category>(['icon','logo','character','illustration','symbol']);
/** Respect grouped artwork, but do not swallow galleries of separate drawings. */
export function artworkBoundary(node:SceneNode,category:Category):boolean {
  if(!('children' in node)||!node.children.length||!ART.has(category))return false;
  if(category==='logo')return true; // Keep a reviewed/named mark and wordmark together.
  if(node.type==='COMPONENT'||node.type==='INSTANCE'||node.type==='BOOLEAN_OPERATION')return true;
  const explicit=node.getPluginData('dsf.semanticName')||readAssetName(node)?.identity;
  if(explicit)return true;
  const clusters=node.children.filter(n=>'children' in n&&n.children.length>0&&n.visible!==false&&n.width*n.height>=node.width*node.height*.15);
  // Two substantial separate child drawings indicate a wrapper or gallery.
  for(let i=0;i<clusters.length;i++)for(let j=i+1;j<clusters.length;j++){
    const a=clusters[i],b=clusters[j];
    const overlap=Math.max(0,Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x))*Math.max(0,Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y));
    if(overlap<Math.min(a.width*a.height,b.width*b.height)*.05)return false;
  }
  return true;
}
export function artworkRole(node:SceneNode):{artworkRole?:'whole'|'part';partOf?:string} {
  const data=readAssetName(node);
  if(data?.appearance.crop)return {artworkRole:'part',partOf:data.identity};
  return {artworkRole:'whole',partOf:undefined};
}
