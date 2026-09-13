import './contact-sheet.test';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractIdentity, normalizeNetwork, normalizeVisibleText, componentRelationship } from '../src/identity';
import { renameFamily, mergeFamilies, splitFamily, approveFamily, editVariant, exportAssetMap } from '../src/asset-review';
import { layoutMetadata } from '../src/layout-meta';
import { prepareAssets, applyAssets } from '../src/assets';

const paint=(c=0)=>[{type:'SOLID',color:{r:c,g:c,b:c}}];
function vector(id='1',scale=1,color=0):any {
  return {id,name:'Vector 14',type:'VECTOR',width:100*scale,height:30*scale,visible:true,opacity:1,rotation:0,x:0,y:0,
    fills:paint(color),strokes:[],isMask:false,parent:null,absoluteBoundingBox:{x:0,y:0,width:100*scale,height:30*scale},
    relativeTransform:[[1,0,0],[0,1,0]],
    vectorNetwork:{vertices:[{x:0,y:0},{x:100*scale,y:0},{x:80*scale,y:30*scale}],segments:[{start:0,end:1,tangentStart:{x:10*scale,y:2*scale}},{start:1,end:2},{start:2,end:0}],regions:[{windingRule:'NONZERO',loops:[[0,1,2]]}]}};
}
function group(kids:any[],scale=1):any {
  const g={...vector('group',scale),type:'GROUP',fills:[],children:kids};delete g.vectorNetwork;
  for(const k of kids)k.parent=g;
  return g;
}
test('A B C normalized geometry excludes color scale position and layer names',()=>{
  const a=vector(),b=vector('2',5,1);b.name='Logo Final';b.x=340;b.y=290;
  const fa=extractIdentity(a),fb=extractIdentity(b);
  assert.equal(fa.geometrySignature,fb.geometrySignature);assert.equal(fa.variant.color,'black');assert.equal(fb.variant.color,'white');
  assert.equal(fb.variant.treatment,undefined);
});
test('network translation normalized; tangents topology winding remain significant',()=>{
  const a=vector(),b=vector();for(const p of b.vectorNetwork.vertices){p.x+=10;p.y+=20;}
  assert.deepEqual(normalizeNetwork(a.vectorNetwork,100,30),normalizeNetwork(b.vectorNetwork,100,30));
  b.vectorNetwork.segments[0].tangentStart.x=20;
  assert.notEqual(extractIdentity(a).geometrySignature,extractIdentity(b).geometrySignature);
  b.vectorNetwork=structuredClone(a.vectorNetwork);b.vectorNetwork.regions[0].windingRule='EVENODD';
  assert.notEqual(extractIdentity(a).geometrySignature,extractIdentity(b).geometrySignature);
});
test('scaled nested geometry matches, relative placement does not',()=>{
  const a=group([vector('1'),vector('2')]),b=group([vector('3',5),vector('4',5)],5);
  a.children[1].relativeTransform[0][2]=10;b.children[1].relativeTransform[0][2]=50;
  assert.equal(extractIdentity(a).geometrySignature,extractIdentity(b).geometrySignature);
  b.children[1].relativeTransform[0][2]=80;
  assert.notEqual(extractIdentity(a).geometrySignature,extractIdentity(b).geometrySignature);
});
test('different wordmarks and unknown geometry never collide reliably',()=>{
  const text=(s:string)=>({...vector(),type:'TEXT',characters:s,fontName:{family:'Inter',style:'Regular'},fontSize:20});
  assert.notEqual(extractIdentity(text('Adobe')).geometrySignature,extractIdentity(text('Acme')).geometrySignature);
  const im={...vector(),type:'RECTANGLE',fills:[{type:'IMAGE',imageHash:'one'}]};
  assert.equal(extractIdentity(im).geometryReliable,false);
  assert.equal(extractIdentity({...vector(),vectorNetwork:{vertices:[],segments:[]}}).geometrySignature,undefined);
});
test('visible wordmark normalization and generic CTA exclusion',()=>{
  assert.equal(normalizeVisibleText(' Coca–Cola®  '),'coca cola');
  const t={...vector(),type:'TEXT',characters:'Learn More',fontName:{family:'Inter'},fontSize:20};
  assert.equal(extractIdentity(t).visibleText,'');
});
test('paint variants: outline, multi, hidden and transparent paint, unknown images',()=>{
  const n=vector();n.fills=[];n.strokes=paint();assert.equal(extractIdentity(n).variant.treatment,'outline');
  n.fills=[...paint(),...paint(1)];assert.equal(extractIdentity(n).variant.color,'multi');
  n.fills=[{...paint()[0],visible:false},...paint(1)];n.strokes=[];assert.equal(extractIdentity(n).variant.color,'white');
  n.fills=[{type:'IMAGE'}];assert.equal(extractIdentity(n).variant.color,undefined);
});
test('layout retains local normalization and relationships',async()=>{
  const n=vector(),p=group([n],2);n.relativeTransform[0][2]=20;n.relativeTransform[1][2]=6;n.rotation=30;
  const m=layoutMetadata(n);assert.equal(m.normalizedBounds?.x,.1);assert.equal(m.rotation,30);assert.equal(m.parentId,'group');
  const set={type:'COMPONENT_SET',key:'library-key'},main={type:'COMPONENT',id:'master',parent:set};
  assert.deepEqual(await componentRelationship({type:'INSTANCE',getMainComponentAsync:async()=>main} as any),{family:'component:library-key',mainComponentId:'master'});
});
function family(id:string,ids:string[]):any {
  return {assetId:id,canonicalName:id,kind:'logo',confidence:.9,aliases:[],supersedes:[],status:'pending',referenceNodeId:ids[0],variants:ids.map(nodeId=>({nodeId,assetId:id,canonicalName:id,kind:'logo',variantId:'v:'+nodeId,variant:{color:'black'},identityConfidence:.9,identityEvidence:['geometry'],image:'png'}))};
}
function assetMap():any{return {schemaVersion:1,documentId:'file',assets:[family('logo/a',['1','2']),family('logo/b',['3'])],proposals:[],warnings:[],calls:0,candidateCount:0};}
test('manual merge split rename variant reference and serialization preserve partition and IDs',()=>{
  const m=assetMap(),id=m.assets[0].assetId;
  mergeFamilies(m,id,'logo/b');assert.equal(m.assets.length,1);assert.equal(m.assets[0].variants.length,3);
  const split=splitFamily(m,id,['1'],'logo/c');assert.equal(split.referenceNodeId,'1');assert.equal(m.assets[0].referenceNodeId,'2');
  renameFamily(split,'coca-cola');assert.equal(split.assetId,'logo/c');
  editVariant(split,'1',{color:'white'});approveFamily(split);assert.equal(split.status,'approved');
  const out=JSON.parse(exportAssetMap(m));assert.equal(out.assets[1].variants[0].image,undefined);
  assert.equal(out.assets[1].variants[0].variant.color,'white');
  assert.equal(new Set(out.assets.flatMap((f:any)=>f.variants.map((v:any)=>v.nodeId))).size,3);
});
test('mark and wordmark cannot merge; invalid splits fail',()=>{
  const m=assetMap();m.assets[0].variants[0].variant.lockup='mark';m.assets[1].variants[0].variant.lockup='wordmark';
  assert.throws(()=>mergeFamilies(m,'logo/a','logo/b'),/separate/);
  assert.throws(()=>splitFamily(m,'logo/a',['1','2'],'logo/c'),/some/);
});
test('scan/prepare are read-only, apply writes only approved and rejects stale/invalid maps',async()=>{
  const n=vector(),data=new Map(),messages:any[]=[];
  n.getPluginData=(k:string)=>data.get(k)||'';n.setPluginData=(k:string,v:string)=>data.set(k,v);n.exportAsync=async()=>new Uint8Array([1,2,3]);
  (globalThis as any).figma={fileKey:'file',mixed:Symbol(),root:{getPluginData:()=>''},getNodeByIdAsync:async()=>n,base64Encode:()=> 'AQID',ui:{postMessage:(m:any)=>messages.push(m)}};
  const inv:any={elements:[{id:'1',category:'logo',name:n.name,fingerprint:'old',page:'messy'}],icons:[],shapes:[]};
  await prepareAssets(inv,'project');assert.equal(data.size,0);
  const prepared=messages.find(m=>m.type==='assets_prepared'),it=prepared.items[0];
  const f=family('logo/coca-cola',['1']);f.variants[0]={...it,...f.variants[0]};
  const map:any={...assetMap(),assets:[f],documentId:prepared.documentId};
  await applyAssets(inv,map,'project');assert.equal(data.size,0);
  approveFamily(f);n.width=500;await assert.rejects(applyAssets(inv,map,'project'),/changed/);assert.equal(data.size,0);n.width=100;
  await applyAssets(inv,map,'project');assert.equal(data.get('dsf.assetId'),'logo/coca-cola');assert.equal(n.name,'Vector 14');
  assert.equal(inv.assetMap,map);
});

test('explicit vertical mark and text layout is stacked, not inferred reverse',()=>{
  const t={...vector('text'),type:'TEXT',characters:'ACME',fontName:{family:'Inter',style:'Bold'},fontSize:24};
  const g=group([vector(),t]);g.type='FRAME';g.layoutMode='VERTICAL';
  assert.equal(extractIdentity(g).variant.orientation,'stacked');
  assert.equal(extractIdentity(g).variant.lockup,'mark-wordmark');
});
