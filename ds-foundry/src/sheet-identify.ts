import {AssetName,normalizeAssetName,assetName,readAssetName} from './asset-names';
import {hasGeneratedAncestor} from './contact-sheet';
import {isDefaultName} from './naming';
import {shapeFeatures, variationName} from './similarity';
import {PD_ORIGINAL, PD_CATEGORY, slug} from './util';
const LINK='dsf.sheetSource', CAPTION='dsf.sheetCaption';
interface Link {ids:string[];category:string;prefix:string;}
export function linkSheetCell(cell:SceneNode,ids:string[],caption:TextNode,category:string,prefix:string) {
  cell.setPluginData(LINK,JSON.stringify({ids,category,prefix}));caption.setPluginData(CAPTION,'1');
}
export function selectedSheetCell():SceneNode|null {
  if(figma.currentPage.selection.length!==1)return null;
  let n:BaseNode|null=figma.currentPage.selection[0];
  while(n&&n.type!=='PAGE'&&n.type!=='DOCUMENT') {if(n.getPluginData(LINK))return n as SceneNode;n=n.parent;}
  return null;
}
function readLink(n:BaseNode):Link {const l=JSON.parse(n.getPluginData(LINK));if(!Array.isArray(l.ids)||!l.ids.length)throw Error('Invalid sheet source link. Rebuild this sheet.');return l;}
export async function inspectSheetSelection() {
  const cell=selectedSheetCell();
  if(!cell)return {cellId:null};
  const link=readLink(cell),source=await figma.getNodeByIdAsync(link.ids[0]);
  return {cellId:cell.id,name:source?.getPluginData('dsf.semanticName')||'',sourceName:source?.name||'Source unavailable',category:link.category,assetName:source?readAssetName(source):null};
}
/** Source IDs, never caption text or visual guesses, determine what a sheet edit changes. */
export async function identifySheetSelection(cellId:string,name:string,match:boolean,metadata?:AssetName) {
  const cell=selectedSheetCell();if(!cell||cell.id!==cellId)throw Error('Selection changed. Select the contact-sheet item again.');
  const structured=normalizeAssetName(metadata);const clean=structured?assetName(structured):slug(name,100);if(!clean)throw Error('Enter a name for this item.');
  const link=readLink(cell);
  const source=await figma.getNodeByIdAsync(link.ids[0]);
  if(!source||source.removed||source.type==='PAGE'||source.type==='DOCUMENT'||hasGeneratedAncestor(source))throw Error('Original artwork is missing. Rebuild the sheet from the source artwork.');
  await figma.loadAllPagesAsync();
  const cells=figma.root.children.flatMap(p=>p.findAll(n=>!!n.getPluginData(LINK)));
  const refs=new Map<string,Link>();
  for(const c of cells){const l=readLink(c);for(const id of l.ids)refs.set(id,l);}
  for(const id of link.ids)refs.set(id,link);
  const base=shapeFeatures(source as SceneNode);
  const updates=new Map<string,{node:SceneNode;name:string;link:Link;assetName?:AssetName|null}>();
  for(const [id,l] of refs){
    const node=await figma.getNodeByIdAsync(id);
    if(!node||node.removed||node.type==='PAGE'||node.type==='DOCUMENT'||hasGeneratedAncestor(node))continue;
    const selected=link.ids.includes(id);
    const short=node.name.split('/').pop()||'';
    const unnamed=isDefaultName(short.replace(/-/g,' '))||/needs.identification|\d+x\d+/i.test(short);
    if(!selected&&(!match||node.getPluginData('dsf.semanticName')||!unnamed))continue;
    const f=selected?base:shapeFeatures(node as SceneNode);
    if(!selected&&(!base.geometry||!base.complete||!f.complete||f.geometry!==base.geometry))continue;
    const traits=structured?{identity:structured.identity,appearance:{...structured.appearance}}:null;
    if(traits&&!selected&&JSON.stringify(base.palette)!==JSON.stringify(f.palette))traits.appearance.color='recolored';
    if(traits&&!selected&&base.stroke&&f.stroke){if(f.stroke/base.stroke>1.2)traits.appearance.treatment='thick-outline';else if(f.stroke/base.stroke<.8)traits.appearance.treatment='thin-outline';}
    updates.set(id,{node:node as SceneNode,name:traits?assetName(traits):selected?clean:variationName(clean,base,f),link:l,assetName:traits});
  }
  // Font loading happens before any source or caption changes.
  const captions:{node:TextNode;name:string}[]=[];
  const cellUpdates:{node:SceneNode;name:string}[]=[];
  for(const c of cells){const l=readLink(c),u=l.ids.map(id=>updates.get(id)).find(Boolean);if(!u)continue;
    cellUpdates.push({node:c,name:u.name});
    if('findAll' in c)for(const t of c.findAll(n=>n.type==='TEXT'&&n.getPluginData(CAPTION)==='1') as TextNode[]){
      const fonts=t.fontName===figma.mixed?t.getRangeAllFontNames(0,t.characters.length):[t.fontName];
      for(const f of fonts)await figma.loadFontAsync(f);captions.push({node:t,name:u.name});
    }
  }
  if(selectedSheetCell()?.id!==cellId)throw Error('Selection changed. Select the contact-sheet item again.');
  const undo:(()=>void)[]=[];
  const pd=(n:BaseNode,k:string,v:string)=>{const old=n.getPluginData(k);undo.push(()=>n.setPluginData(k,old));n.setPluginData(k,v);};
  const rename=(n:BaseNode,v:string)=>{const old=n.name;undo.push(()=>{n.name=old;});n.name=v;};
  try{
    for(const u of updates.values()){
      if(!u.node.getPluginData(PD_ORIGINAL))pd(u.node,PD_ORIGINAL,u.node.name);
      pd(u.node,'dsf.semanticName',u.name);pd(u.node,'dsf.assetName',u.assetName?JSON.stringify(u.assetName):'');pd(u.node,PD_CATEGORY,u.link.category);
      // Variant property names are Figma syntax, not descriptive labels.
      if(!(u.node.type==='COMPONENT'&&u.node.parent?.type==='COMPONENT_SET'))rename(u.node,`${u.link.prefix}${u.link.category}/${u.name}`);
    }
    for(const u of cellUpdates)rename(u.node,u.name);
    for(const u of captions){const old=u.node.characters;undo.push(()=>{u.node.characters=old;});u.node.characters=u.name;}
  }catch(e){for(const restore of undo.reverse())try{restore();}catch{}throw e;}
  return {sources:updates.size,sheets:cellUpdates.length,name:clean,assetName:structured};
}

export async function exportSheetReference(cellId:string,name:string,metadata?:AssetName) {
  const cell=selectedSheetCell();if(!cell||cell.id!==cellId)throw Error('Select the contact-sheet item again.');
  const link=readLink(cell),node=await figma.getNodeByIdAsync(link.ids[0]);
  if(!node||node.removed||node.type==='PAGE'||node.type==='DOCUMENT'||hasGeneratedAncestor(node))throw Error('Original artwork is unavailable.');
  const structured=metadata===undefined?readAssetName(node):normalizeAssetName(metadata);const clean=structured?assetName(structured):slug(name,100);if(!clean)throw Error('Enter the approved reference name first.');
  const n=node as SceneNode;
  const image=await n.exportAsync({format:'PNG',constraint:{type:n.width>=n.height?'WIDTH':'HEIGHT',value:320},useAbsoluteBounds:true});
  return {name:clean,assetName:structured,kind:link.category,what:'Approved from a contact-sheet selection',image:figma.base64Encode(image),features:shapeFeatures(n)};
}
