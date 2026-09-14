import {identityHash} from './identity';
/** Approval is tied to source content, not the category left by an old model. */
export function logoApprovalStamp(node:SceneNode):string|null {
 let count=0;
 const walk=(n:any,depth:number):any=>{
  if(++count>1500||depth>24)throw Error('Artwork too complex');
  return [n.type,n.width,n.height,n.relativeTransform,n.visible,n.opacity,n.fills,n.strokes,n.strokeWeight,
   n.type==='TEXT'?[n.characters,n.fontName,n.fontSize,n.letterSpacing,n.lineHeight]:null,
   n.type==='VECTOR'?n.vectorNetwork:null,n.type==='BOOLEAN_OPERATION'?n.booleanOperation:null,
   'children' in n?n.children.map((c:any)=>walk(c,depth+1)):null];
 };
 try{return identityHash(JSON.stringify(walk(node,0)));}catch{return null;}
}
export function hasCurrentLogoApproval(node:SceneNode):boolean{
 const saved=node.getPluginData('dsf.logoApproval');if(!saved)return false;
 try{const a=JSON.parse(saved);return a.approved===true&&!!a.stamp&&a.stamp===logoApprovalStamp(node);}catch{return false;}
}
export function approveLogo(node:SceneNode,name:string):void{
 const stamp=logoApprovalStamp(node);if(!stamp)throw Error('Could not fingerprint this logo for approval.');
 node.setPluginData('dsf.logoApproval',JSON.stringify({approved:true,stamp,name}));
}
