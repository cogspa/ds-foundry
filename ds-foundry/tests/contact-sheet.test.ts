import {test} from 'node:test';
import assert from 'node:assert/strict';
import {refreshIdentifications, appearanceKey, sheetName} from '../src/contact-sheet';
import {buildAssets, applyLabels} from '../src/build';
import {prepareAiItems} from '../src/ai';

function fixture() {
 const nodes=new Map<string,any>();let next=0;
 const make=(type='FRAME',id=String(++next),name=type):any=>{
  const pd=new Map();
  const node:any={id,type,name,width:40,height:40,x:0,y:0,children:[],parent:null,removed:false,
   getPluginData:(k:string)=>pd.get(k)||'',setPluginData:(k:string,v:string)=>pd.set(k,v),
   resize(w:number,h:number){this.width=w;this.height=h;},
   appendChild(n:any){if(n.parent)n.parent.children=n.parent.children.filter((k:any)=>k!==n);n.parent=this;this.children.push(n);},
   findAll(fn:any){const out:any[]=[];const walk=(n:any)=>{for(const c of n.children){if(fn(c))out.push(c);walk(c);}};walk(this);return out;},
   remove(){this.removed=true;if(this.parent)this.parent.children=this.parent.children.filter((n:any)=>n!==this);},
   clone(){return make(this.type,undefined,this.name);},loadAsync:async()=>{}};
  nodes.set(id,node);return node;
 };
 const root=make('DOCUMENT','root'),page=make('PAGE','source');root.appendChild(page);
 const messages:any[]=[];page.selection=[];
 (globalThis as any).figma={root,currentPage:page,loadAllPagesAsync:async()=>{},getNodeByIdAsync:async(id:string)=>nodes.get(id),loadFontAsync:async()=>{},
  createPage:()=>{const p=make('PAGE');root.appendChild(p);return p;},createFrame:()=>make(),createText:()=>make('TEXT'),
  createComponentFromNode:(n:any)=>{n.type='COMPONENT';return n;},ui:{postMessage:(m:any)=>messages.push(m)}};
 const record=(id:string,category:string,name='Vector 14'):any=>{const n=make('VECTOR',id,name);page.appendChild(n);return {id,category,name,w:40,h:40,inInstance:false,text:'',desc:'black-empty-path-1x1',fingerprint:'same-legacy',page:'source'};};
 const inventory=(records:any[]):any=>({elements:records.filter(r=>r.category!=='icon'),icons:records.filter(r=>r.category==='icon'),shapes:[],components:[]});
 return {make,nodes,record,inventory,messages,page};
}
test('reviewed logo category and name survive label build and icon rebucketing',async()=>{
 const f=fixture(),r=f.record('logo','icon'),inv=f.inventory([r]);
 f.nodes.get('logo').setPluginData('dsf.category','logo');f.nodes.get('logo').setPluginData('dsf.semanticName','acme-wordmark');
 await refreshIdentifications(inv);await applyLabels(inv,{prefix:'ds/',rename:true,labelText:false} as any);
 assert.equal(inv.icons.length,0);assert.equal(inv.elements[0].category,'logo');assert.equal(sheetName(r,'ds/'),'acme-wordmark');
 assert.equal(f.nodes.get('logo').getPluginData('dsf.category'),'logo');
});
test('unknown same-size shapes stay separate and unnamed icons request identification',()=>{
 const a:any={id:'1',name:'ds/icon/vector-14',category:'icon',w:24,h:24},b={...a,id:'2'};
 assert.notEqual(appearanceKey(a),appearanceKey(b));assert.match(sheetName(a,'ds/'),/Needs identification/);
});
test('generated descendants are removed before rebuilding source sheets',async()=>{
 const f=fixture(),r=f.record('generated','icon'),inv=f.inventory([r]);
 f.nodes.get('generated').parent.setPluginData('dsf.generated','1');
 await refreshIdentifications(inv);assert.equal(inv.icons.length,0);
});
test('contact sheets contain named logos icons symbols components and visual debris',async()=>{
 const f=fixture();
 const records=['logo','icon','symbol','input','other','debris'].map((category,i)=>({...f.record('r'+i,category),semanticName:['acme-wordmark','search','recycle','email-address','profile-menu','empty-path'][i]}));
 const inv=f.inventory(records);const notes:string[]=[];
 const result=await buildAssets(inv,{prefix:'ds/'} as any,notes);
 assert.equal(result.count,6);assert.deepEqual(notes,[]);
 for(const title of ['Logos','Icons','Symbols & ornaments','Components','Possible vector debris'])assert.ok(result.page.children.some((n:any)=>n.name==='Assets · '+title),title);
 for(const r of records)assert.ok([...f.nodes.values()].some(n=>n.type==='TEXT'&&n.characters===r.semanticName),r.semanticName);
 assert.equal([...f.nodes.values()].filter(n=>n.type==='COMPONENT'&&n.name.includes('empty-path')).length,0);
});
test('thumbnail stream flushes earlier images even if last export fails',async()=>{
 const f=fixture(),a=f.record('a','icon'),b=f.record('b','icon');
 f.nodes.get('a').exportAsync=async()=>new Uint8Array([1]);f.nodes.get('b').exportAsync=async()=>{throw Error('unavailable');};
 await prepareAiItems(f.inventory([a,b]),{icons:true} as any,10);
 assert.equal(f.messages.filter(m=>m.type==='ai_items').flatMap(m=>m.items).length,1);
 assert.equal(f.messages.at(-1).done,true);
});

import {classify} from '../src/classify';
test('debris is limited to small generic open paths; intentional geometry is retained',()=>{
 const ctx={parentW:800,parentH:800,yInParent:100,topLevel:true};
 const path=(extra:any={})=>({id:'v',type:'VECTOR',name:'Vector 12',width:10,height:4,parent:null,fills:[],strokes:[],effects:[],
  vectorNetwork:{vertices:[{x:0,y:0},{x:4,y:4},{x:10,y:0}],segments:[{start:0,end:1},{start:1,end:2}],regions:[]},...extra} as any);
 assert.equal(classify(path(),ctx).category,'debris');
 assert.equal(classify(path({type:'LINE',name:'Line 2'}),ctx).category,'debris');
 for(const extra of [{width:80},{name:'chevron-down'},{type:'ELLIPSE',name:'Ellipse 1'},
  {parent:{type:'COMPONENT',parent:null}},
  {vectorNetwork:{vertices:[{x:0,y:0},{x:4,y:4},{x:10,y:0}],segments:[{start:0,end:1},{start:1,end:2},{start:2,end:0}],regions:[{windingRule:'NONZERO',loops:[[0,1,2]]}]}}]) {
  assert.notEqual(classify(path(extra),ctx).category,'debris');
 }
});

import {similarity,variationName} from '../src/similarity';
test('reference matching requires geometry; shared color and strokes are insufficient',()=>{
 const a:any={geometry:'same',parts:['eye','beak','body','wing'],palette:['0,0,0'],stroke:.02,width:100,height:120,complete:true};
 const same={...a,palette:['255,0,0'],stroke:.04};
 assert.equal(similarity(a,same).exact,true);
 assert.equal(variationName('blue-ollie',a,same),'blue-ollie-recolored-thick-outline');
 const pose={...a,geometry:'changed',parts:['eye','beak','body','new-wing']};
 assert.equal(similarity(a,pose).exact,false);assert.equal(similarity(a,pose).candidate,true);
 assert.equal(similarity(a,{...a,geometry:'different',parts:['triangle','star']}).candidate,false);
 assert.equal(similarity(a,{...a,complete:false}).exact,false);
});

test('named small artwork classified as icon is still an identity reference',async()=>{
 const f=fixture(),r=f.record('ollie','icon','blue-ollie');
 f.nodes.get('ollie').exportAsync=async()=>new Uint8Array([1]);
 await prepareAiItems(f.inventory([r]),{icons:true} as any,10);
 const items=f.messages.filter(m=>m.type==='ai_items').flatMap(m=>m.items);
 assert.equal(items[0].referenceName,'blue-ollie');
});

import {linkSheetCell,inspectSheetSelection,identifySheetSelection} from '../src/sheet-identify';
test('sheet caption selection updates linked source and captions without overwriting a named match',async()=>{
 const f=fixture();
 const source=(id:string,name='Vector 14')=>{f.record(id,'icon',name);const n=f.nodes.get(id);Object.assign(n,{visible:true,fills:[],strokes:[],relativeTransform:[[1,0,0],[0,1,0]],vectorNetwork:{vertices:[{x:0,y:0},{x:40,y:0},{x:20,y:40}],segments:[{start:0,end:1},{start:1,end:2},{start:2,end:0}],regions:[{windingRule:'NONZERO',loops:[[0,1,2]]}]}});return n;};
 const a=source('a'),b=source('b'),named=source('c','heart');
 const cells=[a,b,named].map(n=>{const c=f.make(),t=f.make('TEXT');t.characters='Needs identification';t.fontName={family:'Inter',style:'Regular'};f.page.appendChild(c);c.appendChild(t);linkSheetCell(c,[n.id],t,'icon','ds/');return {c,t};});
 f.page.selection=[cells[0].t];assert.equal((await inspectSheetSelection()).cellId,cells[0].c.id);
 const result=await identifySheetSelection(cells[0].c.id,'cloud',true);
 assert.equal(result.sources,2);assert.equal(a.name,'ds/icon/cloud');assert.equal(b.name,'ds/icon/cloud');assert.equal(named.name,'heart');
 assert.equal(cells[0].t.characters,'cloud');assert.equal(cells[1].t.characters,'cloud');
 f.page.selection=[cells[2].t];await assert.rejects(()=>identifySheetSelection(cells[0].c.id,'wrong',true),/Selection changed/);
});

import {normalizeAssetName,assetName,readAssetName} from '../src/asset-names';
import {applyAiNames} from '../src/ai';
test('identity and appearance generate stable names and persist independently',async()=>{
 const structured=normalizeAssetName({identity:'Ollie',appearance:{pose:'Waving',color:'Pink',crop:'Eyes only'}})!;
 assert.equal(assetName(structured),'ollie-pink-waving-eyes-only');
 const f=fixture();f.record('named','character');
 await applyAiNames([{ids:['named'],name:'legacy',category:'character',assetName:structured}], 'ds/',true);
 const n=f.nodes.get('named');assert.equal(n.name,'ds/character/ollie-pink-waving-eyes-only');
 assert.deepEqual(readAssetName(n),structured);
 await applyAiNames([{ids:['named'],name:'new-manual-name',category:'character'}], 'ds/',true);
 assert.equal(readAssetName(n),null);
});

import {scan} from '../src/scan';
import {artworkBoundary} from '../src/artwork';
test('scan keeps whole grouped character while harvesting internal colors and part links',async()=>{
 const f=fixture(),g=f.make('GROUP','ollie','Ollie');g.resize(100,120);f.page.appendChild(g);g.setPluginData('dsf.category','character');g.setPluginData('dsf.semanticName','ollie');
 const child=(id:string,color:number)=>{const n=f.make('VECTOR',id);delete n.children;Object.assign(n,{visible:true,opacity:1,rotation:0,relativeTransform:[[1,0,0],[0,1,0]],fills:[{type:'SOLID',color:{r:color,g:0,b:0}}],strokes:[],vectorNetwork:{vertices:[{x:0,y:0},{x:10,y:10}],segments:[{start:0,end:1}],regions:[]}});g.appendChild(n);return n;};
 child('eye',1);child('beak',0);Object.assign(g,{visible:true,relativeTransform:[[1,0,0],[0,1,0]]});
 const inv=await scan('page',4),items=[...inv.elements,...inv.icons,...inv.shapes];
 assert.deepEqual(items.map(r=>r.id),['ollie']);assert.equal(inv.colors.length,2);
 assert.equal(inv.artworkParts?.length,2);assert.ok(inv.artworkParts?.every(p=>p.ownerId==='ollie'));
});
test('separate drawings in an unnamed gallery are not collapsed into one illustration',()=>{
 const f=fixture(),gallery=f.make('GROUP');gallery.resize(220,100);
 for(const x of [0,120]){const drawing=f.make('GROUP');drawing.resize(100,100);drawing.x=x;drawing.appendChild(f.make('VECTOR'));gallery.appendChild(drawing);}
 assert.equal(artworkBoundary(gallery,'illustration'),false);
});
test('an explicitly identified detached part gets its own parts section',async()=>{
 const f=fixture(),r={...f.record('wing','icon'),artworkRole:'part',partOf:'ollie',semanticName:'ollie-wing'};
 const result=await buildAssets(f.inventory([r]),{prefix:'ds/'} as any,[]);
 assert.ok(result.page.children.some((n:any)=>n.name==='Assets · Artwork parts'));
 assert.equal(result.page.children.some((n:any)=>n.name==='Assets · Icons'),false);
});

test('logo scan rejects status bars, pagination and branded buttons while retaining named lockups',()=>{
 const f=fixture(); const ctx={parentW:430,parentH:900,yInParent:0,topLevel:false};
 const group=(name:string,w:number,h:number)=>{const n=f.make('GROUP',undefined,name);Object.assign(n,{width:w,height:h,fills:[],strokes:[],effects:[]});return n;};
 const shape=(parent:any,type='VECTOR',name='Vector 1')=>{const n=f.make(type,undefined,name);Object.assign(n,{width:8,height:8,x:parent.children.length*20,y:0,fills:[],strokes:[]});parent.appendChild(n);delete n.children;return n;};
 const txt=(parent:any,text:string)=>{const n=shape(parent,'TEXT','Text');Object.assign(n,{characters:text,fontSize:16});return n;};
 const bar=group('Status bar - iPhone',430,54);txt(bar,'10:02');for(let i=0;i<3;i++)shape(bar);
 assert.equal(classify(bar,ctx).category,'nav');bar.name='Group 45';assert.equal(classify(bar,ctx).category,'nav');
 const dots=group('Pagination',106,10);for(let i=0;i<5;i++)shape(dots,'ELLIPSE');
 assert.equal(classify(dots,ctx).category,'nav');dots.name='Group 2';assert.equal(classify(dots,ctx).category,'nav');
 const button=group('Continue wPhone#',366,50);shape(button);shape(button);txt(button,'Continue with Google');
 assert.equal(classify(button,ctx).category,'button');
 const unknown=group('Group 90',330,80);for(let i=0;i<8;i++)shape(unknown);
 assert.notEqual(classify(unknown,ctx).category,'logo');
 unknown.name='Owting logo';assert.equal(classify(unknown,ctx).category,'logo');
 unknown.name='Owting wordmark';assert.equal(classify(unknown,ctx).category,'logo');
 unknown.resize(90,90);assert.equal(classify(unknown,ctx).category,'logo');
 const wordmark=f.make('TEXT',undefined,'Owting wordmark');wordmark.characters='owting';wordmark.fontSize=48;
 assert.equal(classify(wordmark,ctx).category,'logo');
 assert.equal(artworkBoundary(unknown,'logo'),true);
 const brand=group('Brand colors',330,70);for(let i=0;i<5;i++)shape(brand,'RECTANGLE');
 assert.notEqual(classify(brand,ctx).category,'logo');
 const lockup=group('Group 19',330,80);shape(lockup);txt(lockup,'Owting');
 assert.equal(classify(lockup,ctx).category,'symbol'); // Semantic review, not automatic brand inference.
});

test('old saved logo classifications cannot put known UI back on the Logos sheet',async()=>{
 const f=fixture(),r=f.record('old-ui','logo','Status bar - iPhone'),n=f.nodes.get(r.id);
 n.type='GROUP';n.width=430;n.height=54;n.setPluginData('dsf.category','logo');n.setPluginData('dsf.semanticName','status-bar-iphone');
 const inv=f.inventory([r]);await refreshIdentifications(inv);assert.equal(inv.elements[0].category,'nav');
});

test('applying an AI logo guess to a branded button preserves its UI role',async()=>{
 const {applyAiNames}=await import('../src/ai'); const f=fixture(),r=f.record('cta','logo','Google control'),n=f.nodes.get(r.id);
 n.type='GROUP';n.width=366;n.height=50;const t=f.make('TEXT');t.characters='Continue with Google';n.appendChild(t);
 await applyAiNames([{ids:[r.id],name:'google-sign-in',category:'symbol',kind:'logo'}],'ds/',true);
 assert.equal(n.getPluginData('dsf.category'),'button');assert.equal(n.name,'ds/button/google-sign-in');
});

import {inspectLogo,saveLogo,logoArrangement,proposeLogoRegions} from '../src/logo-composition';
test('logo inspector detects text regions, saves reviewed roles and rejects stale artwork',async()=>{
 const f=fixture(),g=f.make('GROUP',undefined,'Owting logo');f.page.appendChild(g);
 Object.assign(g,{width:200,height:80,absoluteBoundingBox:{x:10,y:20,width:200,height:80},exportAsync:async()=>new Uint8Array([1,2,3])});
 const mark=f.make('VECTOR',undefined,'owl mark');delete mark.children;Object.assign(mark,{width:60,height:60,absoluteBoundingBox:{x:10,y:30,width:60,height:60},fills:[],strokes:[]});g.appendChild(mark);
 const text=f.make('TEXT',undefined,'brand letters');delete text.children;Object.assign(text,{characters:'Owting',fontSize:36,fontName:{family:'Inter',style:'Regular'},width:120,height:40,absoluteBoundingBox:{x:85,y:40,width:120,height:40},fills:[],strokes:[]});g.appendChild(text);
 for(const n of [g,mark,text])n.relativeTransform=[[1,0,n.x],[0,1,n.y]];
 f.page.selection=[g];(globalThis as any).figma.base64Encode=()=> 'AQID';
 const before=await inspectLogo();assert.deepEqual(before.regions.map(r=>r.role),['symbol','signature']);assert.equal(before.regions[1].text,'Owting');
 assert.equal(g.getPluginData('dsf.logoComposition'),'');
 const entry=await saveLogo({...before,name:'owting-logo'});assert.equal(entry.kind,'logo');assert.equal(entry.composition.arrangement,'horizontal');
 assert.equal(JSON.parse(g.getPluginData('dsf.logoComposition')).regions.length,2);assert.equal(g.name,'Owting logo');assert.equal(g.getPluginData('dsf.category'),'');
 text.characters='Another brand';await assert.rejects(()=>saveLogo({...before,name:'owting-logo'}),/changed/);
});
test('logo arrangement supports standalone, stacked and overlapping regions without shape assumptions',()=>{
 const r=(role:string,x:number,y:number,width:number,height:number)=>({role,x,y,width,height} as any);
 assert.equal(logoArrangement([r('signature',0,0,1,.3)]),'signature-only');
 assert.equal(logoArrangement([r('symbol',0,0,.3,.3)]),'symbol-only');
 assert.equal(logoArrangement([r('symbol',.3,0,.4,.4),r('signature',0,.6,1,.2)]),'stacked');
 assert.equal(logoArrangement([r('symbol',0,0,1,1),r('signature',.2,.3,.6,.3)]),'overlapping');
});
