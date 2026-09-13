import {selectedSheetCell} from './sheet-identify';
import {hasGeneratedAncestor} from './contact-sheet';
import {shapeFeatures} from './similarity';
import {identityHash} from './identity';
import {logoUiCategory} from './classify';

type Role='symbol'|'signature'|'ignore'|'unknown';
export interface LogoRegion {id:string;name:string;text:string;role:Role;x:number;y:number;width:number;height:number;features:ReturnType<typeof shapeFeatures>}
export function proposeLogoRegions(root:SceneNode):LogoRegion[]{
 const bounds=('absoluteRenderBounds' in root?root.absoluteRenderBounds:null)||root.absoluteBoundingBox;
 if(!bounds||bounds.width<=0||bounds.height<=0)throw Error('Artwork has no visible bounds.');
 const out:LogoRegion[]=[];
 const visit=(n:SceneNode,depth:number)=>{
  if(n.visible===false)return;
  const kids='children' in n?n.children.filter(k=>k.visible!==false):[];
  const hasText=(v:SceneNode):boolean=>v.type==='TEXT'||('children' in v&&v.children.some(hasText));
  if(kids.length&&depth<4&&(n===root||hasText(n))){for(const k of kids)visit(k,depth+1);return;}
  const b=('absoluteRenderBounds' in n?n.absoluteRenderBounds:null)||n.absoluteBoundingBox;if(!b)return;
  if(out.length>=48)throw Error('Too many regions. Select a smaller logo group (up to 48 regions).');
  out.push({id:n.id,name:n.name,text:n.type==='TEXT'?n.characters.slice(0,200):'',role:n.type==='TEXT'?'signature':/\b(mark|symbol|logotype)\b/i.test(n.name)?'symbol':'unknown',x:(b.x-bounds.x)/bounds.width,y:(b.y-bounds.y)/bounds.height,width:b.width/bounds.width,height:b.height/bounds.height,features:shapeFeatures(n)});
 };
 visit(root,0);return out;
}
export function logoArrangement(regions:LogoRegion[]):string{
 const union=(role:Role)=>{const r=regions.filter(n=>n.role===role);if(!r.length)return null;const x=Math.min(...r.map(n=>n.x)),y=Math.min(...r.map(n=>n.y));return {x,y,width:Math.max(...r.map(n=>n.x+n.width))-x,height:Math.max(...r.map(n=>n.y+n.height))-y};};
 const a=union('symbol'),b=union('signature');if(!a)return 'signature-only';if(!b)return 'symbol-only';
 const overlap=Math.max(0,Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x))*Math.max(0,Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y));
 if(overlap>Math.min(a.width*a.height,b.width*b.height)*.1)return 'overlapping';
 return Math.abs(a.x+a.width/2-b.x-b.width/2)>Math.abs(a.y+a.height/2-b.y-b.height/2)?'horizontal':'stacked';
}
async function source(){
 if(figma.currentPage.selection.length!==1)throw Error('Select one original logo group or linked sheet item.');
 const cell=selectedSheetCell();const selected=figma.currentPage.selection[0];
 const n=cell?await figma.getNodeByIdAsync(JSON.parse(cell.getPluginData('dsf.sheetSource')).ids[0]):selected;
 if(!n||n.removed||n.type==='PAGE'||n.type==='DOCUMENT'||hasGeneratedAncestor(n))throw Error('Select original artwork or a linked sheet item.');
 if(logoUiCategory(n as SceneNode))throw Error('This is a UI control. Select its embedded brand mark instead.');
 return n as SceneNode;
}
export async function inspectLogo(){
 const n=await source(),regions=proposeLogoRegions(n);
 const image=figma.base64Encode(await n.exportAsync({format:'PNG',constraint:{type:n.width>=n.height?'WIDTH':'HEIGHT',value:480},useAbsoluteBounds:true}));
 const snapshot=identityHash(JSON.stringify([n.id,regions,image]));
 let saved:any;try{saved=JSON.parse(n.getPluginData('dsf.logoComposition'));}catch{}
 if(saved?.snapshot===snapshot)for(const r of regions){const old=saved.regions.find((x:LogoRegion)=>x.id===r.id);if(old){r.role=old.role;r.text=old.text;}}
 return {nodeId:n.id,name:n.getPluginData('dsf.semanticName')||n.name,image,regions,snapshot};
}
export async function saveLogo(msg:any){
 const fresh=await inspectLogo();if(fresh.nodeId!==msg.nodeId||fresh.snapshot!==msg.snapshot)throw Error('Selection or artwork changed. Inspect it again before saving.');
 const name=String(msg.name||'').trim().slice(0,200);if(!name)throw Error('Enter the approved logo name.');
 if(!Array.isArray(msg.regions)||msg.regions.length!==fresh.regions.length||new Set(msg.regions.map((r:any)=>r.id)).size!==fresh.regions.length)throw Error('Inspect the regions again.');
 const regions=fresh.regions.map(r=>{const edit=msg.regions.find((e:any)=>e.id===r.id);if(!edit||!['symbol','signature','ignore'].includes(edit.role))throw Error('Assign every region a role or Ignore before saving.');return {...r,role:edit.role as Role,text:String(edit.text||'').slice(0,200)};});
 if(!regions.some(r=>r.role==='symbol'||r.role==='signature'))throw Error('Identify at least one symbol or signature region.');
 const composition={version:1 as const,arrangement:logoArrangement(regions),regions};
 const n=await source();if(n.id!==fresh.nodeId)throw Error('Selection changed. Inspect again.');
 const features=shapeFeatures(n);
 n.setPluginData('dsf.logoComposition',JSON.stringify({...composition,snapshot:fresh.snapshot}));
 return {name,kind:'logo',what:'Human-reviewed logo composition: '+composition.arrangement,image:fresh.image,features,composition};
}
