import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';

const turn=()=>new Promise(r=>setTimeout(r,10));
const family=(id,ids)=>({assetId:id,canonicalName:id,kind:'logo',confidence:.95,status:'pending',aliases:[],supersedes:[],referenceNodeId:ids[0],variants:ids.map(nodeId=>({nodeId,assetId:id,canonicalName:id,kind:'logo',name:'Vector '+nodeId,page:'Messy',variant:{color:'white'},identityConfidence:.95,identityEvidence:['matching geometry'],features:{version:1,geometryReliable:true,visibleText:'',variant:{color:'white'},warnings:[]},width:100,height:30,fingerprint:'old',aspectRatio:100/30,variantId:'v:'+nodeId}))});
function boot(){
 const errors=[];
 const dom=new JSDOM(readFileSync('dist/ui.html','utf8'),{runScripts:'dangerously',pretendToBeVisual:true,url:'http://localhost:8765',beforeParse(w){
   w.fetch=async()=>({ok:true,json:async()=>[]});w.TextEncoder=TextEncoder;w.HTMLElement.prototype.scrollIntoView=()=>{};w.addEventListener('error',e=>errors.push(e.error));
 }});
 const w=dom.window,d=w.document,sent=[];w.parent.postMessage=m=>sent.push(m.pluginMessage);
 const emit=m=>w.dispatchEvent(new w.MessageEvent('message',{data:{pluginMessage:m}}));
 return {dom,w,d,sent,emit,errors};
}
test('actual UI resolves, edits, confirms, splits, applies and retries failed persistence',async()=>{
 const h=boot(); const {w,d,sent,emit}=h; const requests=[];
 w.fetch=async(url,opts)=>{requests.push({url,body:JSON.parse(opts.body)});return {ok:true,json:async()=>({schemaVersion:1,documentId:'file',assets:[family('logo/a',['1','2']),family('logo/b',['3'])],proposals:[],warnings:[],calls:0,candidateCount:0})};};
 d.querySelector('#assetResolve').click();assert.equal(sent.at(-1).type,'assets_prepare');
 emit({type:'assets_prepared',documentId:'file',items:[],warnings:[]});await turn();
 assert.equal(d.querySelectorAll('[data-family]').length,2);assert.equal(d.querySelector('#assetApply').disabled,true);
 const first=d.querySelector('[data-family]');
 const name=first.querySelector('[data-name]');name.value='Coca-Cola';name.dispatchEvent(new w.Event('change',{bubbles:true}));
 first.querySelector('[data-confirm]').click();assert.equal(d.querySelector('#assetApply').disabled,false);
 d.querySelector('#assetApply').click();const applied=sent.at(-1);assert.equal(applied.type,'assets_apply');assert.equal(applied.map.assets[0].canonicalName,'Coca-Cola');assert.equal(applied.map.assets[0].assetId,'logo/a');
 w.fetch=async()=>{throw new Error('offline');};emit({type:'assets_applied',count:2,map:applied.map,project:'default'});await turn();
 assert.equal(d.querySelector('#assetSave').hidden,false);assert.match(d.querySelector('#assetStatus').textContent,/not saved/);
 w.fetch=async()=>({ok:true,json:async()=>({ok:true})});d.querySelector('#assetSave').click();await turn();assert.equal(d.querySelector('#assetSave').hidden,true);
 const row=d.querySelector('[data-family]');row.querySelector('[data-split]').checked=true;row.querySelector('[data-split-action]').click();
 assert.equal(d.querySelectorAll('[data-family]').length,3);
 assert.deepEqual(h.errors,[]);h.dom.window.close();
});
test('UI rejects proposed merges without applying nodes',async()=>{
 const h=boot();h.w.fetch=async()=>({ok:true,json:async()=>({schemaVersion:1,documentId:'file',assets:[family('logo/a',['1']),family('logo/b',['2'])],proposals:[{left:'logo/a',right:'logo/b',relation:'same',confidence:.96,evidence:['same wordmark']}],warnings:[],calls:1,candidateCount:1})});
 h.d.querySelector('#assetResolve').click();h.emit({type:'assets_prepared',documentId:'file',items:[],warnings:[]});await turn();
 h.d.querySelector('[data-reject]').click();assert.equal(h.d.querySelectorAll('[data-proposal]').length,0);
 assert.equal(h.sent.some(m=>m.type==='assets_apply'),false);assert.equal(h.d.querySelectorAll('[data-family]').length,2);assert.deepEqual(h.errors,[]);h.dom.window.close();
});

test('reviewed naming builds sheets only after native apply succeeds',()=>{
 const h=boot();
 h.w.eval("aiItems=[{ids:['1'],category:'symbol',kind:'logo',suggested:'acme-wordmark',dataUrl:'',name:'Vector 1'}]; renderAi();");
 h.d.querySelector('#aiBuild').click();
 assert.equal(h.sent.at(-1).type,'ai_apply');assert.equal(h.sent.at(-1).renames[0].kind,'logo');
 assert.equal(h.sent.some(m=>m.type==='build'),false);
 h.emit({type:'ai_applied',count:1});
 const build=h.sent.at(-1);assert.equal(build.type,'build');
 assert.equal(build.options.assets,true);assert.equal(build.options.icons,true);assert.equal(build.options.components,true);assert.equal(build.options.labels,false);
 assert.deepEqual(h.errors,[]);h.w.close();
});

test('failed name application does not trigger contact-sheet creation',()=>{
 const h=boot();h.w.eval("aiItems=[{ids:['1'],category:'icon',suggested:'search',dataUrl:'',name:'Vector 1'}]; renderAi();");
 h.d.querySelector('#aiBuild').click();h.emit({type:'error',msg:'Cannot write node'});
 assert.equal(h.sent.some(m=>m.type==='build'),false);assert.deepEqual(h.errors,[]);h.w.close();
});

test('established reference supplies exact-match names without vision calls',async()=>{
 const h=boot();
 h.w.eval(`const f={geometry:'same',parts:['eyes','beak','body'],palette:['0,0,0'],stroke:.02,width:100,height:120,complete:true};
 aiItems=[{ids:['1'],name:'blue-ollie',referenceName:'blue-ollie',category:'illustration',features:f,dataUrl:''},{ids:['2'],name:'Vector 2',category:'illustration',features:{...f,palette:['255,0,0']},dataUrl:''}];
 aiName=async()=>{throw Error('Unexpected vision call');};`);
 await h.w.eval('aiRun()');
 const names=[...h.d.querySelectorAll('#aiRows input[type=text]:not([data-trait]):not([data-match-value])')].map(n=>n.value);
 assert.ok(names.includes('blue-ollie'));assert.ok(names.includes('blue-ollie-recolored'));
 assert.equal(h.d.querySelectorAll('#aiRows input[type=checkbox]:checked').length,1);
 assert.deepEqual(h.errors,[]);h.w.close();
});

test('Build identifies artwork before creating sheets by default',()=>{
 const h=boot(),d=h.d;
 d.querySelector('#provider').value='proxy';d.querySelector('#provider').dispatchEvent(new h.w.Event('change'));
 d.querySelector('#build').disabled=false;d.querySelector('#build').click();
 assert.equal(h.sent.at(-1).type,'ai_prepare');
 assert.equal(h.sent.at(-1).targets.icons,true);assert.equal(h.sent.at(-1).targets.art,true);
 assert.equal(h.sent.some(m=>m.type==='build'),false);assert.deepEqual(h.errors,[]);h.w.close();
});

test('manual identification immediately names exact unknown variants and preserves other choices',async()=>{
 const h=boot();h.w.eval(`const f={geometry:'same',parts:['a','b','c'],palette:['0,0,0'],stroke:.02,width:100,height:100,complete:true};
 aiItems=[{ids:['1'],name:'Vector 1',category:'icon',needsName:true,features:f,dataUrl:''},
 {ids:['2'],name:'Vector 2',category:'icon',needsName:true,features:{...f,palette:['255,0,0']},dataUrl:''},
 {ids:['3'],name:'heart',category:'icon',suggested:'heart',features:f,dataUrl:'',selected:false}];renderAi();`);
 const input=h.d.querySelector('#aiRows input[type=text]');input.value='cloud';input.dispatchEvent(new h.w.Event('input',{bubbles:true}));input.dispatchEvent(new h.w.Event('change',{bubbles:true}));await turn();
 const values=[...h.d.querySelectorAll('#aiRows input[type=text]:not([data-trait]):not([data-match-value])')].map(el=>el.value);
 assert.deepEqual(values,['cloud','cloud-recolored','heart']);
 assert.equal(h.d.querySelectorAll('#aiRows input[type=checkbox]:checked').length,2);
 assert.equal(h.sent.some(m=>m.type==='ai_apply'),false);assert.deepEqual(h.errors,[]);h.w.close();
});

test('manual identification compares changed geometry but leaves semantic guesses unchecked',async()=>{
 const h=boot();h.w.eval(`const f={geometry:'one',parts:['a','b','c','d'],palette:[],stroke:.02,width:100,height:100,complete:true};
 aiItems=[{ids:['1'],name:'Vector 1',category:'character',suggested:'ollie',manualName:true,features:f,dataUrl:''},
 {ids:['2'],name:'Vector 2',category:'icon',needsName:true,features:{...f,geometry:'two',parts:['a','b','c','e']},dataUrl:''}];renderAi();
 aiName=async(batch,key,model,refs)=>{if(refs[0].suggested!=='ollie')throw Error('Missing correction');batch[0].suggested='ollie-waving';batch[0].kind='character';};`);
 await h.w.eval('reuseIdentification(aiItems[0])');
 assert.equal(h.d.querySelectorAll('#aiRows input[type=text]:not([data-trait]):not([data-match-value])')[1].value,'ollie-waving');
 assert.equal(h.d.querySelectorAll('#aiRows input[type=checkbox]')[1].checked,false);assert.deepEqual(h.errors,[]);h.w.close();
});

test('fresh plugin defaults to server env credentials and hides the key input',()=>{
 const h=boot();assert.equal(h.d.querySelector('#provider').value,'proxy');assert.equal(h.d.querySelector('#apiKeyField').hidden,true);
 h.emit({type:'ai_keys',keys:{proxy:'stale-override'}});
 assert.equal(h.d.querySelector('#apiKey').value,'');
 h.d.querySelector('#aiSuggest').click();assert.equal(h.sent.at(-1).type,'ai_prepare');
 assert.deepEqual(h.errors,[]);h.w.close();
});

test('contact-sheet identification works without a scan or API key',()=>{
 const h=boot();h.emit({type:'sheet_selection',cellId:'cell',name:'',sourceName:'Vector 8',category:'icon'});
 assert.equal(h.d.querySelector('#sheetFields').hidden,false);h.d.querySelector('#sheetName').value='cloud';h.d.querySelector('#sheetApply').click();
 assert.equal(h.sent.at(-1).type,'sheet_identify');assert.equal(h.sent.at(-1).cellId,'cell');
 h.emit({type:'sheet_identified',sources:2,sheets:3,name:'cloud'});assert.match(h.d.querySelector('#status').textContent,/2 source layers/);
 assert.deepEqual(h.errors,[]);h.w.close();
});

test('saved project references supply names in a new file with no local named reference',async()=>{
 const h=boot(),requests=[];
 const f={geometry:'ollie',parts:['a','b','c'],palette:['0,0,0'],stroke:.02,width:100,height:100,complete:true};
 h.w.fetch=async(url)=>{requests.push(url);return {ok:true,json:async()=>[{id:'saved',name:'ollie',kind:'character',image:'png',features:f}]};};
 h.w.eval(`aiItems=[{ids:['new-file-node'],name:'Vector 8',category:'icon',features:${JSON.stringify(f)},dataUrl:''}];aiName=async()=>{throw Error('No model needed for exact geometry');};`);
 await h.w.eval('aiRun()');
 assert.equal(h.d.querySelector('#aiRows input[type=text]').value,'ollie');assert.ok(requests.some(url=>/\/library\/default$/.test(url)));
 assert.match(h.d.querySelector('#libraryStatus').textContent,/1 approved/);assert.deepEqual(h.errors,[]);h.w.close();
});

test('save selected review references uses edited name and explicit project',async()=>{
 const h=boot(),requests=[];h.w.fetch=async(url,opts)=>{requests.push({url,method:opts.method,body:opts.body&&JSON.parse(opts.body)});return {ok:true,json:async()=>opts.method==='GET'?[]:{id:'saved'}};};
 h.w.eval("aiItems=[{ids:['1'],name:'Vector 1',category:'icon',suggested:'cloud',dataUrl:'data:image/png;base64,png'}];renderAi();");
 h.d.querySelector('#libraryProject').value='Brand A';h.d.querySelector('#aiRows input[type=text]').value='cloud-outline';h.d.querySelector('#librarySave').click();await turn();
 assert.equal(requests[0].method,'POST');assert.equal(requests[0].body.name,'cloud-outline');assert.match(requests[0].url,/Brand%20A$/);assert.deepEqual(h.errors,[]);h.w.close();
});

test('review generates a name from identity color and pose and applies structured metadata',()=>{
 const h=boot();h.w.eval("aiItems=[{ids:['1'],category:'character',name:'Vector 1',needsName:true,dataUrl:''}];renderAi();");
 const d=h.d;d.querySelector('#reuseCorrections').checked=false;
 for(const [key,value] of [['identity','Ollie'],['color','pink'],['pose','waving']]){const input=d.querySelector(`[data-trait="${key}"]`);input.value=value;input.dispatchEvent(new h.w.Event('input',{bubbles:true}));}
 assert.equal(d.querySelector('#aiRows input[type=text]').value,'ollie-pink-waving');d.querySelector('#aiApply').click();
 assert.equal(h.sent.at(-1).renames[0].assetName.identity,'ollie');assert.equal(h.sent.at(-1).renames[0].assetName.appearance.color,'pink');assert.deepEqual(h.errors,[]);h.w.close();
});

function matchFixture(h){
 h.w.eval(`const features={geometry:'g',parts:['a','b','c','d'],palette:['0,0,0'],stroke:.02,width:100,height:100,complete:true};
 const reference={ids:['ref'],name:'Ollie',referenceName:'ollie',suggested:'ollie',category:'character',kind:'character',assetName:{identity:'ollie',appearance:{color:'blue'}},features,dataUrl:'data:image/png;base64,ref'};
 aiItems=[{ids:['candidate'],name:'Vector 8',category:'icon',needsName:true,features:{...features,geometry:'g2'},dataUrl:'data:image/png;base64,candidate',referenceMatches:[{ref:reference,shared:3,overlap:.75,color:1,stroke:1,exact:false}]}];renderAi();`);
}
test('match evidence displays both images and measured facts; Same asset selects a reviewed name',()=>{
 const h=boot();matchFixture(h);
 const panel=h.d.querySelector('[data-match]');assert.equal(panel.querySelectorAll('img').length,2);
 assert.match(panel.textContent,/3 shared vector parts/);assert.match(panel.textContent,/Relative stroke thickness similarity: 100%/);
 h.d.querySelector('[data-match-action=same]').click();
 assert.equal(h.d.querySelector('#aiRows input[type=text]').value,'ollie-blue');
 assert.equal(h.d.querySelector('#aiRows input[type=checkbox]').checked,true);
 assert.equal(h.sent.some(m=>m.type==='ai_apply'),false);assert.deepEqual(h.errors,[]);h.w.close();
});
test('Variation requires a property value and preserves separate identity',()=>{
 const h=boot();matchFixture(h);
 h.d.querySelector('[data-match-action=variation]').click();assert.match(h.d.querySelector('[data-match-status]').textContent,/Enter the variation/);
 h.d.querySelector('[data-match-field]').value='color';h.d.querySelector('[data-match-value]').value='pink';h.d.querySelector('[data-match-action=variation]').click();
 assert.equal(h.d.querySelector('#aiRows input[type=text]').value,'ollie-pink');
 assert.equal(h.w.eval('aiItems[0].assetName.identity'),'ollie');assert.deepEqual(h.errors,[]);h.w.close();
});
test('Different asset removes the proposed pair and clears a prior accepted match',async()=>{
 const h=boot();matchFixture(h);h.d.querySelector('[data-match-action=same]').click();h.d.querySelector('[data-match-action=different]').click();
 assert.equal(h.d.querySelectorAll('[data-match]').length,0);assert.equal(h.d.querySelector('#aiRows input[type=text]').value,'');
 assert.equal(h.d.querySelector('#aiRows input[type=checkbox]').checked,false);
 await h.w.eval('reuseIdentification(aiItems[0].referenceMatches[0].ref)');
 assert.equal(h.d.querySelectorAll('[data-match]').length,0);assert.equal(h.sent.some(m=>m.type==='ai_apply'),false);
 await turn();assert.deepEqual(h.errors,[]);h.w.close();
});

test('saved Different asset decision prevents exact inheritance after a new review starts',async()=>{
 const h=boot();matchFixture(h);h.w.eval("aiItems[0].features.geometry='g';aiItems[0].features.palette=['255,0,0'];");
 const rule=h.w.eval(`({id:'rule',a:window.DSFRejections.key(aiItems[0]),b:window.DSFRejections.key(aiItems[0].referenceMatches[0].ref),aName:'Vector 8',bName:'ollie'})`);
 const ref=h.w.eval(`({...aiItems[0].referenceMatches[0].ref})`);
 h.w.fetch=async url=>({ok:true,json:async()=>url.endsWith('/rejections')?[rule]:[{id:'stored',name:'ollie',kind:'character',features:ref.features,image:'ref'}]});
 h.w.eval("aiItems[0].referenceMatches=[];aiName=async(batch)=>{batch[0].suggested='cloud';};");
 await h.w.eval('aiRun()');assert.equal(h.d.querySelectorAll('[data-match]').length,0);
 assert.equal(h.d.querySelector('#aiRows input[type=text]').value,'cloud');assert.deepEqual(h.errors,[]);h.w.close();
});

test('failed rejection save exposes retry without dropping local exclusion',async()=>{
 const h=boot();matchFixture(h);h.w.fetch=async()=>{throw Error('offline');};
 h.d.querySelector('[data-match-action=different]').click();await turn();
 assert.equal(h.d.querySelectorAll('[data-match]').length,0);assert.equal(h.d.querySelector('#rejectionsRetry').hidden,false);
 assert.match(h.d.querySelector('#aiRows').textContent,/NOT saved/);
 h.w.fetch=async(url,opts)=>({ok:true,json:async()=>opts.method==='POST'?{id:'r',...JSON.parse(opts.body)}:[]});
 h.d.querySelector('#rejectionsRetry').click();await turn();assert.equal(h.d.querySelector('#rejectionsRetry').hidden,true);
 assert.deepEqual(h.errors,[]);h.w.close();
});

test('logo inspector overlays roles and persists reviewed composition with recoverable library failure',async()=>{
 const h=boot(),{d,w,emit,sent}=h;
 d.querySelector('#logoInspect').click();assert.equal(sent.at(-1).type,'logo_inspect');
 const region={id:'r1',name:'Vector group',role:'unknown',text:'',x:0,y:0,width:1,height:1};
 emit({type:'logo_inspected',data:{nodeId:'logo1',snapshot:'snapshot',name:'owting-logo',image:'AQID',regions:[region]}});
 assert.equal(d.querySelectorAll('[data-logo-box]').length,1);
 d.querySelector('#logoSave').click();assert.match(d.querySelector('#logoStatus').textContent,/Assign every/);
 const select=d.querySelector('[data-logo-role]');select.value='symbol';select.dispatchEvent(new w.Event('change',{bubbles:true}));
 d.querySelector('#logoSave').click();assert.equal(sent.at(-1).type,'logo_save');assert.equal(sent.at(-1).regions[0].role,'symbol');
 w.fetch=async()=>{throw Error('offline');};emit({type:'logo_saved',entry:{name:'owting-logo',kind:'logo',image:'AQID',composition:{version:1,arrangement:'symbol-only',regions:[{...region,role:'symbol'}]}}});await turn();
 assert.match(d.querySelector('#logoStatus').textContent,/library save failed/);assert.equal(d.querySelector('#logoSave').disabled,false);
 let saved;w.fetch=async(url,opts)=>{if(opts.method==='POST')saved=JSON.parse(opts.body);return {ok:true,json:async()=>[]};};
 d.querySelector('#logoSave').click();emit({type:'logo_saved',entry:{name:'owting-logo',kind:'logo',image:'AQID',composition:{version:1,arrangement:'symbol-only',regions:[{...region,role:'symbol'}]}}});await turn();
 assert.equal(saved.composition.regions[0].role,'symbol');assert.deepEqual(h.errors,[]);h.dom.window.close();
});
