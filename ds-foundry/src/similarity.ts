import { extractIdentity, identityHash, normalizeNetwork } from './identity';

export interface ShapeFeatures {
  geometry?: string; parts: string[]; palette: string[]; stroke: number;
  width: number; height: number; complete: boolean;
}
/** Local vector parts survive regrouping and many pose changes; similarity is evidence, not identity. */
export function shapeFeatures(root: SceneNode): ShapeFeatures {
  const parts:string[]=[], palette=new Set<string>(), strokes:number[]=[];
  let visited=0, complete=true;
  function walk(n:SceneNode,depth:number) {
    if (++visited>512 || depth>24) {complete=false;return;}
    if (n.visible === false || ('opacity' in n && n.opacity===0)) return;
    for(const key of ['fills','strokes'] as const) {
      const paints=(n as any)[key];if(!Array.isArray(paints))continue;
      for(const p of paints)if(p.type==='SOLID'&&p.visible!==false&&p.opacity!==0)palette.add([p.color.r,p.color.g,p.color.b].map(v=>Math.round(v*255)).join(','));
    }
    if ('strokeWeight' in n && typeof n.strokeWeight==='number' && n.strokeWeight>0 && 'strokes' in n && Array.isArray(n.strokes) && n.strokes.some(p=>p.visible!==false)) strokes.push(n.strokeWeight/Math.max(root.width,root.height,1));
    if(n.type==='VECTOR')try {
      const v=n.vectorNetwork;
      if(v.vertices.length+v.segments.length>2000){complete=false;return;}
      if(v.segments.length>=3)parts.push(identityHash(JSON.stringify(normalizeNetwork(v,n.width,n.height))));
    }catch{complete=false;}
    if('children' in n){if(n.children.length>512)complete=false;for(const c of n.children.slice(0,512))walk(c,depth+1);}
  }
  walk(root,0);strokes.sort((a,b)=>a-b);
  return {geometry:extractIdentity(root).geometrySignature,parts:parts.sort(),palette:[...palette].sort(),stroke:strokes.length?strokes[Math.floor(strokes.length/2)]:0,width:root.width,height:root.height,complete};
}
export function similarity(a:ShapeFeatures,b:ShapeFeatures) {
  const counts=new Map<string,number>();b.parts.forEach(p=>counts.set(p,(counts.get(p)||0)+1));let shared=0;
  a.parts.forEach(p=>{const n=counts.get(p)||0;if(n){shared++;counts.set(p,n-1);}});
  const overlap=shared/Math.max(a.parts.length,b.parts.length,1);
  const color=a.palette.filter(p=>b.palette.includes(p)).length/Math.max(a.palette.length,b.palette.length,1);
  const stroke=a.stroke&&b.stroke?Math.min(a.stroke,b.stroke)/Math.max(a.stroke,b.stroke):0;
  const exact=!!a.geometry&&a.geometry===b.geometry&&a.complete&&b.complete;
  return {exact,shared,overlap,color,stroke,score:exact?1:overlap*.8+color*.1+stroke*.1,
    candidate:exact||(shared>=3&&overlap>=.3)};
}
export function variationName(base:string,reference:ShapeFeatures,item:ShapeFeatures):string {
  const suffix:string[]=[];
  if(JSON.stringify(reference.palette)!==JSON.stringify(item.palette))suffix.push('recolored');
  if(reference.stroke&&item.stroke){const ratio=item.stroke/reference.stroke;if(ratio>1.2)suffix.push('thick-outline');else if(ratio<.8)suffix.push('thin-outline');}
  if(!suffix.length && Math.abs(item.width/reference.width-1)>.05)suffix.push(Math.round(item.width)+'px');
  return [base,...suffix].join('-');
}
