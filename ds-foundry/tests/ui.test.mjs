import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
test('character shortcut prepares a bounded source selection before any names or sheets are changed',()=>{
 const h=boot();h.d.querySelector('input[name=scope][value=selection]').checked=true;
 h.d.querySelector('#findCharacters').click();
 const m=h.sent.find(m=>m.type==='ai_prepare');
 assert.ok(m);assert.equal(m.charactersOnly,true);assert.equal(m.rescanDocument,true);
 assert.equal(m.characterScope,'selection');assert.equal(m.maxItems,120);
 assert.equal(h.sent.some(m=>['ai_apply','build'].includes(m.type)),false);
 assert.equal(h.d.querySelector('#findCharacters').disabled,true);
 assert.deepEqual(h.errors,[]);h.w.close();
});
test('character review applies four whole figures, preserves established names and excludes fragments scenes and duplicates',()=>{
 const h=boot();h.w.eval(`
 aiCharacterMode=true;
 aiItems=['pink','grey','yellow','green'].map(color=>({ids:[color],name:'Group',suggested:color+'-owl',kind:'character',category:'illustration',confidence:.96,characterSearch:true,dataUrl:'',characterAncestorIds:['scene']}));
 aiItems.push({ids:['scene'],name:'camp',suggested:'owl-camping-scene',kind:'illustration',category:'illustration',confidence:.99,dataUrl:''},
 {ids:['body'],name:'body',suggested:'blue-ollie-body',kind:'character',category:'character',confidence:.99,dataUrl:''},
 {ids:['face'],name:'face',suggested:'pink-owl-eyes-only',kind:'character',category:'character',confidence:.99,dataUrl:''},
 {ids:['inner'],name:'Group',suggested:'grey-owl',kind:'character',category:'illustration',confidence:.98,characterAncestorIds:['grey','scene'],dataUrl:''},
 {ids:['uncertain'],name:'Group',suggested:'green-owl',kind:'character',category:'illustration',confidence:.5,dataUrl:''});
 aiItems[0].existingName='Pip';aiItems[0].assetName={identity:'ollie',appearance:{color:'pink'}};
 reviewCharacters();dedupeNames();renderAi();`);
 assert.equal(h.d.querySelectorAll('#aiRows .ai-row').length,4);
 assert.match(h.d.querySelector('#characterSummary').textContent,/4 whole-character results/);
 h.d.querySelector('#aiApply').click();
 const r=h.sent.at(-1).renames;
 assert.deepEqual(Array.from(r,r=>r.ids[0]),['pink','grey','yellow','green']);
 assert.ok(r.every(r=>r.kind==='character'));assert.equal(r[0].name,'Pip');assert.equal(r[0].assetName,null);
 assert.deepEqual(h.errors,[]);h.w.close();
});
test('character search visually reviews named illustrations and never uses body parts as identity references',async()=>{
 const h=boot();h.w.eval(`
 aiCharacterMode=true;
 aiItems=[{ids:['ollie'],name:'Ollie',existingName:'Ollie',category:'illustration',characterSearch:true,dataUrl:'data:image/png;base64,png'}];
 loadLibraryReferences=async()=>[{referenceName:'blue-ollie-wing',suggested:'blue-ollie-wing',category:'character',kind:'character',dataUrl:'wing'}];
 window.characterCalls=[];
 aiName=async(batch,key,model,refs)=>{window.characterCalls.push({ids:batch.flatMap(it=>it.ids),refs:refs.map(r=>r.referenceName)});for(const it of batch){it.suggested='blue-owl-running';it.kind='character';it.confidence=.98;}};
 `);
 await h.w.eval('aiRun()');
 assert.equal(h.w.characterCalls.length,1);assert.deepEqual(Array.from(h.w.characterCalls[0].ids),['ollie']);
 assert.equal(h.w.characterCalls[0].refs.length,0);
 assert.equal(h.d.querySelector('#aiRows input[type=text]').value,'Ollie');
 h.d.querySelector('#aiApply').click();assert.equal(h.sent.at(-1).renames[0].kind,'character');
 assert.deepEqual(h.errors,[]);h.w.close();
});
test('character processing shows actual request failures while excluded scenes cannot be applied',async()=>{
 const h=boot();h.w.eval(`
 aiCharacterMode=true;aiItems=[{ids:['scene'],name:'scene',category:'illustration',suggested:'camping',kind:'illustration',confidence:.95,dataUrl:''},
 {ids:['failed'],name:'Group',category:'illustration',error:'gemini · HTTP 429 · Prepayment credits depleted',dataUrl:''}];
 reviewCharacters();renderAi();`);
 assert.equal(h.d.querySelectorAll('#aiRows .ai-row').length,1);
 assert.match(h.d.querySelector('#aiRows').textContent,/Prepayment credits depleted/);
 assert.equal(h.d.querySelector('#aiApply').disabled,true);
 assert.deepEqual(h.errors,[]);h.w.close();
});

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

test('reviewed names reach build options only after native apply succeeds',()=>{
 const h=boot();h.emit({type:'scanned',summary:emptySummary});
 h.w.eval("aiItems=[{ids:['1'],category:'symbol',kind:'logo',suggested:'acme-wordmark',dataUrl:'',name:'Vector 1'}]; renderAi();");
 h.d.querySelector('#aiBuild').click();
 assert.equal(h.sent.at(-1).type,'ai_apply');assert.equal(h.sent.at(-1).renames[0].kind,'logo');
 assert.equal(h.sent.some(m=>m.type==='build'),false);
 h.emit({type:'ai_applied',count:1});
 assert.equal(h.d.querySelector('#step-6').hidden,false);assert.equal(h.sent.some(m=>m.type==='build'),false);
 h.d.querySelector('#nextBuild').click();assert.equal(h.d.querySelector('#step-7').hidden,false);
 h.d.querySelector('#build').click();
 const build=h.sent.at(-1);assert.equal(build.type,'build');
 assert.equal(build.options.assets,true);assert.equal(build.options.icons,true);assert.equal(build.options.components,true);assert.equal(build.options.labels,true);
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

test('direct Assets rebuild works without prior scan and bypasses AI identification',()=>{
 const h=boot();
 h.d.querySelector('#rebuildAssetsNow').click();
 assert.equal(h.sent.at(-1).type,'assets_rebuild');
 assert.equal(h.sent.some(m=>m.type==='ai_prepare'),false);
 assert.equal(h.d.querySelector('#rebuildAssetsNow').disabled,true);
 assert.match(h.d.querySelector('#status').textContent,/no AI/);
 assert.deepEqual(h.errors,[]);h.dom.window.close();
});

const emptySummary={nodeCount:10,pages:['Page 1'],colors:[],types:[],spacing:[],radii:[],effects:[],elements:{},icons:{count:0,samples:[]},shapes:{count:0,samples:[]},components:[],missingFonts:[]};
test('full rebuild rescans the document and keeps all four outputs through name review',()=>{
 const h=boot();h.d.querySelector('#rebuildFull').click();
 const prepare=h.sent.at(-1);assert.equal(prepare.type,'ai_prepare');assert.equal(prepare.rescanDocument,true);
 assert.equal(prepare.targets.art,true);assert.equal(prepare.targets.icons,true);
 h.emit({type:'scanned',summary:emptySummary,continuing:true});
 assert.equal(h.d.querySelector('#rebuildFull').disabled,true);assert.equal(h.d.querySelector('#build').disabled,true);
 h.w.eval("aiItems=[{ids:['scene'],category:'illustration',suggested:'owl-camping-scene',dataUrl:'',name:'Group 1'}];aiBusy=false;renderAi();setBusy(false);updateApplyCount();");
 h.d.querySelector('#aiBuild').click();assert.equal(h.sent.at(-1).type,'ai_apply');
 assert.equal(h.sent.some(m=>m.type==='build'),false);
 h.emit({type:'ai_applied',count:1});
 assert.equal(h.d.querySelector('#step-6').hidden,false);assert.equal(h.sent.some(m=>m.type==='build'),false);
 h.d.querySelector('#nextBuild').click();assert.equal(h.d.querySelector('#step-7').hidden,false);
 h.d.querySelector('#build').click();
 const build=h.sent.at(-1);assert.equal(build.type,'build');
 for(const flag of ['foundations','components','icons','assets','styles','variables'])assert.equal(build.options[flag],true,flag);
 assert.deepEqual(h.errors,[]);h.w.close();
});

test('all-known full rebuild is possible without changing names or calling a provider',async()=>{
 const h=boot();h.d.querySelector('#rebuildFull').click();
 h.emit({type:'scanned',summary:emptySummary,continuing:true,newScan:true});
 h.w.fetch=async()=>{throw Error('Unexpected network call');};
 h.w.eval("aiItems=[{ids:['scene'],referenceName:'owl-camping-scene',category:'illustration',dataUrl:'',name:'Group 1'}];");
 await h.w.eval('aiRun();');h.w.eval('setBusy(false);updateApplyCount();');
 assert.equal(h.d.querySelector('#aiBuild').disabled,false);
 assert.equal(h.d.querySelector('#aiBuild').textContent,'Continue with saved names →');
 h.d.querySelector('#aiBuild').click();
 assert.equal(h.d.querySelector('#step-6').hidden,false);assert.equal(h.sent.some(m=>m.type==='build'),false);
 h.d.querySelector('#nextBuild').click();assert.equal(h.d.querySelector('#step-7').hidden,false);
 h.d.querySelector('#build').click();
 assert.equal(h.sent.at(-1).type,'build');assert.equal(h.sent.at(-1).options.foundations,true);
 assert.equal(h.sent.some(m=>m.type==='ai_apply'),false);
 assert.deepEqual(h.errors,[]);h.w.close();
});

test('naming coverage exposes deferred items and failed thumbnail exports',async()=>{
 const h=boot();h.d.querySelector('#rebuildFull').click();
 h.emit({type:'ai_items',items:[],done:true,total:2,preserved:17,deferred:9,exportFailures:2});await turn();
 assert.match(h.d.querySelector('#aiCoverage').textContent,/17 established names preserved/);
 assert.match(h.d.querySelector('#aiCoverage').textContent,/9 more unnamed/);
 assert.match(h.d.querySelector('#aiCoverage').textContent,/2 thumbnails could not/);
 assert.equal(h.sent.some(m=>m.type==='build'),false);
 assert.deepEqual(h.errors,[]);h.w.close();
});

test('Assets-only completion does not block the subsequent full identification rebuild',()=>{
 const h=boot();h.d.querySelector('#rebuildAssetsNow').click();
 h.emit({type:'scanned',summary:emptySummary,continuing:true});
 h.emit({type:'built',result:{paintStyles:0,textStyles:0,effectStyles:0,variables:0,labeled:0,componentSets:0,components:0,icons:0,assets:1,pages:['DS · Assets'],notes:[],files:[]}});
 h.d.querySelector('#rebuildFull').click();
 assert.equal(h.sent.at(-1).type,'ai_prepare');assert.equal(h.sent.at(-1).rescanDocument,true);
 assert.deepEqual(h.errors,[]);h.w.close();
});


const visibleStep=d=>+d.querySelector('.step-panel:not([hidden])').id.slice(-1);
const state=(d,n)=>d.querySelector('#state-'+n).dataset.state;
const buildResult={paintStyles:1,textStyles:1,effectStyles:0,variables:2,labeled:3,componentSets:1,components:1,icons:1,assets:2,pages:['DS · Foundations','DS · Assets'],notes:[],files:{'tokens.json':'{}'}};
function scanAndContinue(h){
 h.d.querySelector('#scan').click();h.emit({type:'scanned',summary:emptySummary,newScan:true});h.d.querySelector('#scanNext').click();
}
test('eight tools start with contact sheet and logo, with optional steps before scanning',()=>{
 const h=boot(),{d}=h;
 assert.equal(visibleStep(d),1);assert.equal(state(d,1),'waiting');
 assert.match(d.querySelector('#step-title-1').textContent,/Identify a contact-sheet item/);assert.match(d.querySelector('#step-title-2').textContent,/Logo composition inspector/);
 for(const n of [1,2,3,4])assert.equal(d.querySelector(`[data-guide-step="${n}"]`).disabled,false);
 for(const n of [5,6,7,8])assert.equal(d.querySelector(`[data-guide-step="${n}"]`).disabled,true);
 d.querySelector('#step-1 [data-guide-go="2"]').click();assert.equal(visibleStep(d),2);
 d.querySelector('#nextReferences').click();assert.equal(visibleStep(d),3);d.querySelector('#nextIdentify').click();assert.equal(visibleStep(d),4);
 assert.equal(h.sent.some(m=>['build','ai_apply','logo_save'].includes(m.type)),false);assert.deepEqual(h.errors,[]);h.w.close();
});
test('guided workflow keeps inputs on Back and requires explicit Build after naming and families',()=>{
 const h=boot(),{d,emit,sent}=h;scanAndContinue(h);assert.equal(visibleStep(d),5);
 d.querySelector('#t_max').value='25';d.querySelector('[data-guide-step="3"]').click();d.querySelector('#libraryProject').value='Owting';
 d.querySelector('[data-guide-step="5"]').click();assert.equal(d.querySelector('#t_max').value,'25');assert.equal(d.querySelector('#libraryProject').value,'Owting');
 d.querySelector('#skipNaming').click();assert.equal(visibleStep(d),6);assert.equal(state(d,5),'skipped');
 assert.equal(sent.some(m=>m.type==='build'||m.type==='ai_prepare'||m.type==='ai_apply'),false);
 d.querySelector('#nextBuild').click();assert.equal(visibleStep(d),7);d.querySelector('#o_foundations').checked=false;d.querySelector('#build').click();
 assert.equal(sent.at(-1).type,'build');assert.equal(sent.at(-1).options.foundations,false);assert.equal(state(d,7),'processing');
 for(const b of d.querySelectorAll('[data-guide-step]'))assert.equal(b.disabled,true);
 emit({type:'built',result:buildResult});assert.equal(visibleStep(d),8);assert.equal(state(d,7),'completed');
 assert.equal(d.querySelector('#results').hidden,false);assert.match(d.querySelector('#files').textContent,/tokens.json/);
 assert.equal(d.querySelector('#progress').hidden,true);d.querySelector('#startAgain').click();assert.equal(visibleStep(d),4);
 assert.deepEqual(h.errors,[]);h.w.close();
});
test('review choices survive Back and prefix refresh; a new scan resets naming progress',()=>{
 const h=boot(),{d,w,emit}=h;scanAndContinue(h);
 w.eval("aiItems=[{ids:['1'],category:'illustration',suggested:'owl-camping',dataUrl:'',name:'Group 1'}];renderAi();");
 d.querySelector('#reuseCorrections').checked=false;
 const input=d.querySelector('#aiRows input[type=text]');input.value='owl-camping-scene';input.dispatchEvent(new w.Event('input',{bubbles:true}));
 d.querySelector('[data-guide-step="3"]').click();d.querySelector('[data-guide-step="5"]').click();
 assert.equal(d.querySelector('#aiRows input[type=text]').value,'owl-camping-scene');
 d.querySelector('#aiBuild').click();emit({type:'error',msg:'Write failed'});
 assert.equal(visibleStep(d),5);assert.equal(state(d,5),'error');assert.equal(d.querySelector('[data-guide-step="7"]').disabled,true);
 assert.equal(d.querySelector('#aiBuild').disabled,false);d.querySelector('#aiBuild').click();emit({type:'ai_applied',count:1});
 assert.equal(visibleStep(d),6);assert.equal(state(d,5),'saved');
 d.querySelector('#nextBuild').click();emit({type:'scanned',summary:emptySummary});assert.equal(visibleStep(d),7);assert.equal(d.querySelector('#build').disabled,false);
 d.querySelector('[data-guide-step="5"]').click();w.eval("aiItems=[{ids:['2'],category:'icon',suggested:'cloud',dataUrl:'',name:'Vector 2'}];renderAi();");
 emit({type:'scanned',summary:emptySummary});assert.equal(d.querySelector('#aiRows input[type=text]').value,'cloud');
 d.querySelector('[data-guide-step="4"]').click();d.querySelector('#scan').click();assert.equal(d.querySelectorAll('#aiRows .ai-row').length,0);
 emit({type:'scanned',summary:emptySummary,newScan:true});assert.equal(visibleStep(d),4);assert.equal(d.querySelector('[data-guide-step="7"]').disabled,true);
 assert.deepEqual(h.errors,[]);w.close();
});
test('stopped build clears processing and preserves the chosen output for retry',()=>{
 const h=boot(),{d,emit,sent}=h;scanAndContinue(h);d.querySelector('#skipNaming').click();d.querySelector('#nextBuild').click();
 d.querySelector('#o_icons').checked=false;d.querySelector('#build').click();d.querySelector('#cancel').click();
 assert.equal(sent.at(-1).type,'cancel');assert.equal(d.querySelector('#cancel').disabled,true);assert.match(d.querySelector('#activityState').textContent,/Stopping/);
 emit({type:'error',msg:'Stopped. Nothing else was changed.'});
 assert.equal(visibleStep(d),7);assert.equal(state(d,7),'stopped');assert.equal(d.querySelector('#build').disabled,false);assert.equal(d.querySelector('[data-guide-step="8"]').disabled,true);
 assert.equal(d.querySelector('#progress').hidden,true);assert.equal(d.querySelector('#activityElapsed').hidden,true);
 d.querySelector('#build').click();assert.equal(sent.at(-1).type,'build');assert.equal(sent.at(-1).options.icons,false);
 assert.deepEqual(h.errors,[]);h.w.close();
});
test('contact-sheet selection changes Waiting to Review to Saved without scanning',()=>{
 const h=boot(),{d,emit}=h;assert.equal(state(d,1),'waiting');
 emit({type:'sheet_selection',cellId:'cell',sourceName:'Vector 8',name:''});assert.equal(visibleStep(d),1);assert.equal(state(d,1),'review');
 d.querySelector('#sheetName').value='cloud';d.querySelector('#sheetApply').click();assert.equal(state(d,1),'processing');assert.equal(h.sent.at(-1).type,'sheet_identify');
 emit({type:'sheet_identified',sources:1,sheets:1,name:'cloud'});assert.equal(state(d,1),'saved');assert.equal(d.querySelector('#progress').hidden,true);
 emit({type:'sheet_selection',cellId:null});assert.equal(state(d,1),'waiting');assert.deepEqual(h.errors,[]);h.w.close();
});
test('pending full rebuild options are editable before generation',()=>{
 const h=boot(),{d,emit,w}=h;d.querySelector('#o_foundations').checked=false;d.querySelector('#rebuildFull').click();
 emit({type:'scanned',newScan:true,continuing:true,summary:emptySummary});w.eval('aiItems=[];renderAi();aiBusy=false;setBusy(false);');d.querySelector('#aiBuild').click();d.querySelector('#nextBuild').click();
 assert.equal(d.querySelector('#o_foundations').checked,true);d.querySelector('#o_icons').checked=false;d.querySelector('#build').click();
 assert.equal(h.sent.at(-1).type,'build');assert.equal(h.sent.at(-1).options.icons,false);assert.equal(h.sent.at(-1).options.foundations,true);assert.deepEqual(h.errors,[]);w.close();
});
test('changing the spacing grid requires a fresh scan with the new grid',()=>{
 const h=boot(),{d,w,emit}=h;scanAndContinue(h);d.querySelector('#skipNaming').click();d.querySelector('[data-guide-step="4"]').click();
 const grid=d.querySelector('input[name=grid][value="8"]');grid.checked=true;grid.dispatchEvent(new w.Event('change',{bubbles:true}));
 assert.equal(d.querySelector('#scanNext').disabled,true);assert.equal(d.querySelector('#build').disabled,true);
 d.querySelector('#scan').click();assert.equal(h.sent.at(-1).baseGrid,8);emit({type:'scanned',summary:emptySummary,newScan:true});assert.equal(d.querySelector('#scanNext').disabled,false);assert.deepEqual(h.errors,[]);w.close();
});
test('progress uses reported percentages, exposes silence, and ignores late progress after completion',()=>{
 const h=boot(),{d,w,emit}=h;d.querySelector('#scan').click();
 assert.equal(d.querySelector('#progress').hasAttribute('aria-valuenow'),false);assert.equal(d.querySelector('#progress').classList.contains('indeterminate'),true);
 emit({type:'progress',pct:38,msg:'Reading 380 of 1000 layers'});assert.equal(d.querySelector('#progress').getAttribute('aria-valuenow'),'38');assert.match(d.querySelector('#activityDetail').textContent,/380 of 1000/);
 w.eval('activeOperation.started-=35000;activeOperation.lastUpdate-=35000;tickOperation();');
 assert.match(d.querySelector('#activityElapsed').textContent,/35s/);assert.equal(d.querySelector('#activityDelay').hidden,false);assert.match(d.querySelector('#activityDelay').textContent,/does not measure completion/);
 emit({type:'scanned',summary:emptySummary,newScan:true});assert.equal(state(d,4),'completed');assert.equal(d.querySelector('#activityElapsed').hidden,true);
 emit({type:'progress',pct:80,msg:'Late progress'});assert.equal(d.querySelector('#progress').hidden,true);assert.doesNotMatch(d.querySelector('#activityDetail').textContent,/Late/);assert.deepEqual(h.errors,[]);w.close();
});
function inspectFixture(h){
 h.d.querySelector('[data-guide-step="2"]').click();h.d.querySelector('#logoInspect').click();
 h.emit({type:'logo_inspected',data:{nodeId:'logo1',snapshot:'s',name:'owting-logo',image:'AQID',regions:[{id:'text',name:'owting',role:'signature',text:'owting',x:.3,y:0,width:.7,height:1},{id:'owl',name:'OwtingLogo',role:'unknown',text:'',x:0,y:0,width:.3,height:1}]}});
}
test('logo inspector explicitly waits for a missing region role and only enables Save when valid',()=>{
 const h=boot(),{d,w}=h;inspectFixture(h);
 assert.equal(visibleStep(d),2);assert.equal(state(d,2),'review');assert.equal(d.querySelector('#logoSave').disabled,true);
 assert.match(d.querySelector('#activityDetail').textContent,/1 of 2.*OwtingLogo/);assert.equal(d.querySelector('#progress').hidden,true);assert.equal(d.querySelector('#activityElapsed').hidden,true);
 d.querySelector('#logoSave').click();assert.equal(h.sent.some(m=>m.type==='logo_save'),false);
 const role=d.querySelector('[data-logo-region="owl"] select');role.value='symbol';role.dispatchEvent(new w.Event('change',{bubbles:true}));
 assert.equal(d.querySelector('#logoSave').disabled,false);assert.match(d.querySelector('#logoChecklist').textContent,/2 of 2 assigned/);
 d.querySelector('#logoSave').click();assert.equal(state(d,2),'processing');assert.equal(h.sent.at(-1).type,'logo_save');assert.equal(d.querySelector('#cancel').hidden,true);
 assert.deepEqual(h.errors,[]);w.close();
});
test('logo source save and library save are separate phases; failure is partial and retry is explicit',async()=>{
 const h=boot(),{d,w,emit}=h;inspectFixture(h);
 const role=d.querySelector('[data-logo-region="owl"] select');role.value='symbol';role.dispatchEvent(new w.Event('change',{bubbles:true}));d.querySelector('#logoSave').click();
 let rejectSave;w.fetch=()=>new Promise((resolve,reject)=>{rejectSave=reject;});emit({type:'logo_saved',entry:{name:'owting-logo',kind:'logo',image:'AQID'}});
 assert.equal(state(d,2),'processing');assert.match(d.querySelector('#activityDetail').textContent,/Source logo approved.*Saving/);assert.match(d.querySelector('#logoChecklist').textContent,/Source approval: saved/);
 rejectSave(new Error('offline'));await turn();assert.equal(state(d,2),'partial');assert.match(d.querySelector('#activityDetail').textContent,/library save failed/);assert.equal(d.querySelector('#progress').hidden,true);assert.equal(d.querySelector('#logoSave').disabled,false);
 w.fetch=async()=>({ok:true,json:async()=>({id:'saved'})});d.querySelector('#logoSave').click();emit({type:'logo_saved',entry:{name:'owting-logo',kind:'logo',image:'AQID'}});await turn();
 assert.equal(state(d,2),'saved');assert.equal(visibleStep(d),2);assert.match(d.querySelector('#logoChecklist').textContent,/Library reference: saved/);assert.equal(d.querySelector('#activityElapsed').hidden,true);assert.deepEqual(h.errors,[]);w.close();
});
test('library load has processing and failure states and can be retried',async()=>{
 const h=boot(),{d,w}=h;let rejectLoad;w.fetch=()=>new Promise((resolve,reject)=>{rejectLoad=reject;});d.querySelector('#libraryLoad').click();
 assert.equal(state(d,3),'processing');assert.equal(d.querySelector('#nextIdentify').disabled,true);rejectLoad(new Error('Server unavailable'));await turn();
 assert.equal(state(d,3),'error');assert.equal(d.querySelector('#progress').hidden,true);assert.equal(d.querySelector('#nextIdentify').disabled,false);
 w.fetch=async()=>({ok:true,json:async()=>[]});d.querySelector('#libraryLoad').click();await turn();assert.equal(state(d,3),'completed');assert.match(d.querySelector('#activityDetail').textContent,/0 approved/);assert.deepEqual(h.errors,[]);w.close();
});
test('AI phase messages replace stale thumbnail status and stop spinning when review is ready',async()=>{
 const h=boot(),{d,w,emit}=h;scanAndContinue(h);d.querySelector('#aiSuggest').click();w.eval("aiStatus('Naming batch 2 of 4');");
 assert.match(d.querySelector('#activityDetail').textContent,/Naming batch 2 of 4/);assert.equal(state(d,5),'processing');
 emit({type:'ai_items',items:[],total:0,done:true,preserved:12});await turn();assert.equal(state(d,5),'review');assert.equal(d.querySelector('#progress').hidden,true);assert.equal(d.querySelector('#activityElapsed').hidden,true);assert.deepEqual(h.errors,[]);w.close();
});
test('a stalled model request reports unknown completion without automatically replaying',async()=>{
 const h=boot(),{w}=h;let expire;const timer=w.setTimeout.bind(w);w.setTimeout=(fn,delay)=>delay===90000?(expire=fn,123456):timer(fn,delay);
 w.fetch=(url,options)=>new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(new Error('aborted'))));
 const request=w.eval("postJson('http://localhost:8000/identify',{}, {},0)");expire();await assert.rejects(request,/No response within 90 seconds/);assert.deepEqual(h.errors,[]);w.close();
});

const errorReply=(status,body,headers={})=>({ok:false,status,headers:{get:key=>headers[key]},text:async()=>typeof body==='string'?body:JSON.stringify(body)});

test('HTTP errors keep FastAPI, Gemini, and plain-text diagnostics without retrying permanent failures',async()=>{
 const h=boot(),{w}=h;
 for(const fixture of [
  [400,{detail:'No Gemini key: set GOOGLE_API_KEY'},'No Gemini key'],
  [401,{error:{message:'Key was revoked'}},'Key was revoked'],
  [403,{error:{code:403,status:'PERMISSION_DENIED',message:'Model access denied'}},'PERMISSION_DENIED'],
  [404,{error:{source:'provider',provider:'gemini',model:'missing-model',phase:'critic',status:404,message:'This model does not exist',retryable:false}},'missing-model · critic'],
  [500,{detail:'Cannot write cache: disk full'},'disk full'],
  [502,{detail:'Naming failed: missing upstream model'},'missing upstream model'],
  [500,'Unexpected storage failure','Unexpected storage failure']
 ]){
  let calls=0;w.fetch=async()=>{calls++;return errorReply(fixture[0],fixture[1]);};
  await assert.rejects(w.eval("postJson('http://localhost:8000/name',{}, {},1)"),e=>e.message.includes(fixture[2])&&e.message.includes('HTTP '+fixture[0])&&!e.message.includes('busy'));
  assert.equal(calls,1);
 }
 assert.deepEqual(h.errors,[]);w.close();
});

test('retryable provider failures respect Retry-After, show the cause while waiting, and retain the final error',async()=>{
 const h=boot(),{w,d}=h;w.eval("setBusy(true,'Identifying artwork',5)");
 const delays=[],timer=w.setTimeout.bind(w);w.setTimeout=(fn,delay)=>delay<90000?(delays.push(delay),timer(fn,0)):timer(fn,delay);
 let calls=0;w.fetch=async()=>{calls++;return errorReply(429,{error:{source:'provider',provider:'gemini',model:'fixture-model',phase:'naming',status:429,retryable:true,message:'Requests per minute exceeded',retryAfterSeconds:12}},{'retry-after':'13'});};
 await assert.rejects(w.eval("postJson('http://localhost:8000/name',{}, {},1)"),/HTTP 429.*fixture-model[\s\S]*Requests per minute exceeded[\s\S]*Retry after 13 seconds/);
 assert.equal(calls,2);assert.deepEqual(delays,[13000]);
 assert.equal(d.querySelector('#aiErrors').hidden,false);assert.match(d.querySelector('#aiErrorText').textContent,/Requests per minute exceeded[\s\S]*Retrying in 13 seconds/);
 w.eval('finishOperation("error","Quota exceeded",5)');assert.equal(d.querySelector('#aiErrors').hidden,false);
 assert.deepEqual(h.errors,[]);w.close();
});

test('capacity failures receive only the bounded retry and never replace diagnostics with busy',async()=>{
 const h=boot(),{w}=h;const timer=w.setTimeout.bind(w),delays=[];
 w.setTimeout=(fn,delay)=>delay<90000?(delays.push(delay),timer(fn,0)):timer(fn,delay);
 let calls=0;w.fetch=async()=>{calls++;return errorReply(503,{error:{code:503,status:'UNAVAILABLE',message:'Capacity exhausted for this model'}});};
 await assert.rejects(w.eval("postJson('https://generativelanguage.googleapis.com/v1beta/models/fixture:generateContent',{}, {},1)"),/Gemini · HTTP 503 · UNAVAILABLE[\s\S]*Capacity exhausted/);
 assert.equal(calls,2);assert.equal(delays.length,1);assert.ok(delays[0]>=5000&&delays[0]<=7000);
 assert.deepEqual(h.errors,[]);w.close();
});

test('long quota delays and partially completed pipelines do not trigger automatic replay',async()=>{
 const h=boot(),{w}=h;
 for(const [status,error,expected] of [
  [429,{code:429,message:'Daily quota exhausted',details:[{retryDelay:'120s'}]},/Retry after 120 seconds/],
  [503,{source:'provider',provider:'gemini',message:'Critic unavailable',phase:'critic',status:503,retryable:true,completedCalls:1},/1 model calls already completed.*Automatic replay is disabled/]
 ]){
  let calls=0;w.fetch=async()=>{calls++;return errorReply(status,{error});};
  await assert.rejects(w.eval("postJson('http://localhost:8000/name',{}, {},1)"),expected);assert.equal(calls,1);
 }
 assert.deepEqual(h.errors,[]);w.close();
});

test('error display redacts credentials, omits validation input, and treats provider text as text',async()=>{
 const h=boot(),{w,d}=h;d.querySelector('#apiKey').value='private-test-key';
 w.fetch=async()=>errorReply(400,{detail:'Rejected api_key=private-test-key Authorization: Bearer bearer-secret data:image/png;base64,AQID <img onerror="alert(1)">'});
 let error;try{await w.eval("postJson('http://localhost:8000/name',{}, {},0)");}catch(e){error=e;}
 assert.ok(error);assert.doesNotMatch(error.message,/private-test-key|bearer-secret|AQID/);
 w.fixtureMessage=error.message;w.eval('recordRequestError(fixtureMessage)');assert.equal(d.querySelector('#aiErrorText img'),null);assert.match(d.querySelector('#aiErrorText').textContent,/<img/);
 w.fetch=async()=>errorReply(422,{detail:[{loc:['body','items'],msg:'Too many items',input:'secret input bytes'}]});
 await assert.rejects(w.eval("postJson('http://localhost:8000/name',{}, {},0)"),e=>/body.items: Too many items/.test(e.message)&&!e.message.includes('secret input bytes'));
 assert.deepEqual(h.errors,[]);w.close();
});

test('malformed errors, HTML gateways, and connection failures still produce useful diagnostics',async()=>{
 const h=boot(),{w}=h;
 w.fetch=async()=>errorReply(500,'<html><script>internal debug output</script></html>');
 await assert.rejects(w.eval("postJson('http://localhost:8000/name',{}, {},0)"),e=>/Local server · HTTP 500 · Internal error/.test(e.message)&&!e.message.includes('script'));
 w.fetch=async()=>errorReply(400,{error:{message:'Invalid request',details:{unexpected:'object'}}});
 await assert.rejects(w.eval("postJson('http://localhost:8000/name',{}, {},0)"),/Invalid request/);
 let calls=0;w.fetch=async()=>{calls++;throw Error('Connection refused');};
 await assert.rejects(w.eval("postJson('http://localhost:8000/name',{}, {},1)"),/Local server · Connection failed: Connection refused/);assert.equal(calls,1);
 assert.deepEqual(h.errors,[]);w.close();
});

test('a mixed naming run preserves successes and keeps failed requests visible without a second look replay',async()=>{
 const h=boot(),{w,d}=h;scanAndContinue(h);d.querySelector('#aiSuggest').click();
 w.eval(`aiItems=[{ids:['named'],referenceName:'ollie',name:'Ollie',category:'character',dataUrl:'data:image/png;base64,old'},
 {ids:['unknown'],name:'Group',category:'illustration',dataUrl:'data:image/png;base64,new'}];
 var namingAttempts=0;aiName=async()=>{namingAttempts++;throw Error('gemini · HTTP 404 · Missing naming model');};`);
 await w.eval('aiReceive({items:[],total:2,done:true})');
 assert.equal(w.eval('namingAttempts'),1);assert.equal(w.eval("aiItems.find(it=>it.ids[0]==='named').suggested"),'ollie');
 assert.equal(state(d,5),'partial');assert.match(d.querySelector('#state-5 strong').textContent,/Partly identified/);
 assert.match(d.querySelector('#aiStatus').textContent,/1 names available[\s\S]*1 items failed[\s\S]*HTTP 404/);
 assert.match(d.querySelector('#aiErrorText').textContent,/Missing naming model/);assert.equal(d.querySelector('#aiErrors').hidden,false);
 assert.equal(d.querySelector('#progress').hidden,true);assert.deepEqual(h.errors,[]);w.close();
});

test('library and asset-family requests display the same actual HTTP diagnostics',async()=>{
 const h=boot(),{w,d,emit}=h;
 w.fetch=async()=>errorReply(404,{detail:'The selected project reference is missing'});
 d.querySelector('#libraryLoad').click();await turn();
 assert.match(d.querySelector('#libraryStatus').textContent,/HTTP 404[\s\S]*selected project reference is missing/);
 assert.equal(state(d,3),'error');
 w.fetch=async()=>errorReply(403,{error:{source:'provider',provider:'gemini',model:'comparison-model',phase:'comparison',message:'Model access denied',retryable:false}});
 d.querySelector('#assetResolve').click();emit({type:'assets_prepared',documentId:'fixture',items:[],warnings:[]});await turn();
 assert.match(d.querySelector('#assetStatus').textContent,/HTTP 403[\s\S]*comparison-model[\s\S]*Model access denied/);
 assert.equal(state(d,6),'error');assert.equal(h.sent.some(m=>m.type==='assets_apply'),false);
 assert.deepEqual(h.errors,[]);w.close();
});

test('a saved pose with the same name as a local example remains available for exact recognition',async()=>{
 const h=boot(),{w,d}=h;
 const f={geometry:'waving',parts:['eye','beak','wing'],palette:['0,0,0'],stroke:.02,width:100,height:120,complete:true};
 w.fetch=async url=>({ok:true,json:async()=>url.endsWith('/rejections')?[]:[{id:'pose',name:'ollie',kind:'character',image:'pose',features:f}]});
 w.eval(`aiItems=[{ids:['local'],name:'Ollie',referenceName:'ollie',category:'character',dataUrl:'data:image/png;base64,local',features:{...${JSON.stringify(f)},geometry:'standing'}},
 {ids:['unknown'],name:'Group 2',category:'illustration',dataUrl:'data:image/png;base64,new',features:${JSON.stringify(f)}}];
 aiName=async()=>{throw Error('An exact approved pose must not need a model');};`);
 await w.eval('aiRun()');
 assert.equal(w.eval("aiItems.find(it=>it.ids[0]==='unknown').suggested"),'ollie');
 assert.equal(w.eval("aiItems.find(it=>it.ids[0]==='unknown').source"),'matching vector geometry');
 assert.match(d.querySelector('#aiReferenceStatus').textContent,/1 examples from this file · 1 saved examples.*ollie/);
 assert.equal(h.sent.some(m=>m.type==='ai_apply'),false);assert.deepEqual(h.errors,[]);w.close();
});

test('established labels without geometry survive a mixed automatic recognition run',async()=>{
 const h=boot(),{w}=h;
 w.eval(`aiItems=[{ids:['named'],referenceName:'ollie',name:'Ollie',category:'character',dataUrl:'data:image/png;base64,old'},
 {ids:['new'],name:'Vector 3',category:'icon',dataUrl:'data:image/png;base64,new'}];
 aiName=async batch=>{for(const it of batch){it.suggested='cloud';it.confidence=.95;}};`);
 await w.eval('aiRun()');assert.equal(w.eval("aiItems.find(it=>it.ids[0]==='named').suggested"),'ollie');
 assert.equal(w.eval("aiItems.find(it=>it.ids[0]==='new').suggested"),'cloud');assert.deepEqual(h.errors,[]);w.close();
});

test('second look uses saved Ollie examples when the file has no established name',async()=>{
 const h=boot(),{w}=h;
 const f={geometry:'reference',parts:['eye','beak','body','wing'],palette:[],stroke:.02,width:100,height:120,complete:true};
 w.fetch=async url=>({ok:true,json:async()=>url.endsWith('/rejections')?[]:[{id:'ollie',name:'ollie',kind:'character',image:'ref',features:f}]});
 w.eval(`aiItems=[{ids:['candidate'],name:'Group 2',category:'illustration',features:{...${JSON.stringify(f)},geometry:'pose'},dataUrl:'data:image/png;base64,new'}];
 var recognitionCalls=0;
 aiName=async(batch,key,model,refs)=>{recognitionCalls++;if(!refs.some(r=>r.referenceName==='ollie'))throw Error('Missing Ollie');
 if(recognitionCalls===1){batch[0].needsName=true;batch[0].confidence=.2;}
 else {batch[0].suggested='ollie-waving';batch[0].kind='character';batch[0].needsName=false;batch[0].confidence=.9;}};`);
 await w.eval('aiRun()');assert.equal(w.eval('recognitionCalls'),2);assert.equal(w.eval('aiItems[0].suggested'),'ollie-waving');
 assert.equal(w.eval('aiItems[0].source'),'reference');assert.deepEqual(h.errors,[]);w.close();
});

test('reference selection ranks matching poses ahead of unrelated earlier examples and excludes rejected pairs',()=>{
 const h=boot(),{w}=h;
 w.eval(`const f={geometry:'ollie',parts:['eye','beak','wing'],palette:['0,0,0'],stroke:.02,width:100,height:120,complete:true};
 var candidate={ids:['new'],name:'Group 2',category:'illustration',features:{...f,geometry:'pose'}};
 var examples=Array.from({length:8},(_,i)=>({libraryId:'scene'+i,referenceName:'scene-'+i,kind:'illustration',dataUrl:'data:image/png;base64,scene',features:{...f,geometry:'scene'+i,parts:['mountain','tree','cloud']}}));
 var ollie={libraryId:'ollie',referenceName:'ollie',kind:'character',dataUrl:'data:image/png;base64,owl',features:f};examples.push(ollie);
 var chosen=referencesFor([candidate],examples);`);
 assert.equal(w.eval('chosen[0].referenceName'),'ollie');assert.equal(w.eval('chosen.length'),6);
 w.eval("candidate.rejectedMatchKeys=[matchReferenceKey(ollie)];");
 assert.equal(w.eval("referencesFor([candidate],examples).some(r=>r.referenceName==='ollie')"),false);
 assert.deepEqual(h.errors,[]);w.close();
});

test('automatic recognition shortcut starts document identification without manual logo approval or a build',()=>{
 const h=boot(),{d}=h;
 d.querySelector('#t_art').checked=false;d.querySelector('#t_icons').checked=false;
 d.querySelector('#recognizeArtwork').click();
 assert.equal(h.sent.at(-1).type,'ai_prepare');assert.equal(h.sent.at(-1).rescanDocument,true);
 assert.equal(h.sent.at(-1).targets.art,true);assert.equal(h.sent.at(-1).targets.icons,true);
 assert.equal(visibleStep(d),5);assert.equal(state(d,5),'processing');
 assert.equal(h.sent.some(m=>['logo_save','build','ai_apply'].includes(m.type)),false);
 assert.deepEqual(h.errors,[]);h.w.close();
});
