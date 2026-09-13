import {rejectionKey,rejectedPair} from '../src/rejected-matches';
window.DSFRejections={key:rejectionKey,pair:rejectedPair};
import {normalizeAssetName,assetName,APPEARANCE_FIELDS} from '../src/asset-names';
window.DSFAssetNames={normalizeAssetName,assetName,fields:APPEARANCE_FIELDS};
import {similarity,variationName} from '../src/similarity';
window.DSFSimilarity={similarity,variationName};
import { visualFeatures } from './visual-features';
import { renameFamily, mergeFamilies, splitFamily, editVariant, approveFamily, exportAssetMap } from '../src/asset-review';

let map=null, pendingSave=null, rejected=[], context=null, resolving=false, generation=0, page=0;
let externalBusy=false;
window.addEventListener('dsf-busy',e=>{
  externalBusy=e.detail;
  $('#assetResolve').disabled=externalBusy||resolving;
  $('#assetApply').disabled=externalBusy||!map||!map.assets.some(f=>f.status==='approved'&&f.variants.length);
  $('#assetReview').inert=externalBusy;$('#assetProposals').inert=externalBusy;
});
let controller=null;
const PAGE_SIZE=12;
async function canonicalPost(url,body) {
  controller=new AbortController();
  const signal=controller.signal, timeout=setTimeout(()=>controller?.abort(),120000);
  try {
    const r=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body),signal});
    if(!r.ok){let detail='';try{detail=JSON.stringify((await r.json()).detail);}catch{}throw new Error(`Server ${r.status}: ${detail}`);}
    return await r.json();
  } finally {clearTimeout(timeout);controller=null;}
}
$('#cancel').addEventListener('click',()=>{
  if(!resolving)return;
  generation++;controller?.abort();resolving=false;$('#assetResolve').disabled=false;setBusy(false);message('Canonical resolution stopped. No metadata applied.');
});
const message=(s)=>{$('#assetStatus').textContent=s;};
function render() {
  $('#assetApply').disabled=!map || !map.assets.some(f=>f.status==='approved' && f.variants.length);
  $('#assetExport').disabled=!map;
  if (!map) { $('#assetReview').replaceChildren(); $('#assetProposals').replaceChildren(); return; }
  const families=map.assets.filter(f=>f.variants.length).sort((a,b)=>a.confidence-b.confidence || a.assetId.localeCompare(b.assetId));
  page=Math.max(0,Math.min(page,Math.ceil(families.length/PAGE_SIZE)-1));
  $('#assetReview').innerHTML=`<p>${families.length} families · page ${page+1}/${Math.max(1,Math.ceil(families.length/PAGE_SIZE))} <button class="btn small" data-page="-1">Previous</button> <button class="btn small" data-page="1">Next</button></p>`+families.slice(page*PAGE_SIZE,(page+1)*PAGE_SIZE).map(f=>`<article data-family="${esc(f.assetId)}" style="border-top:1px solid var(--line);padding:10px 0">
    <div class="field"><input type="text" data-name value="${esc(f.canonicalName)}" aria-label="Canonical name" /><b>${Math.round(f.confidence*100)}%</b></div>
    <div class="hint">${esc(f.assetId)} · ${esc(f.status)} · ${f.variants.length} variants</div>
    <details><summary>Variants and evidence</summary>${f.variants.map(v=>`<div data-node="${esc(v.nodeId)}" style="padding:6px 0;border-bottom:1px solid var(--line)">
      <div class="row"><input type="checkbox" data-split aria-label="Select variant for split" />${v.image?`<img src="data:image/png;base64,${esc(v.image)}" alt="${esc(v.name)}" style="width:56px;height:48px;object-fit:contain;background:#888;border-radius:4px" />`:'<span>Preview unavailable</span>'}<span>${esc(v.name)} · ${esc(v.nodeId)}<br>${esc(v.page)} · ${Math.round(v.identityConfidence*100)}%</span></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;margin:6px 0">${['color','orientation','treatment','lockup','state','crop','pose'].map(k=>`<label>${k}<input data-variant="${k}" type="text" value="${esc(v.variant[k]||'')}" placeholder="unknown" maxlength="60" style="width:100%" /></label>`).join('')}</div>
      <label><input type="radio" name="ref-${esc(f.assetId)}" data-ref ${f.referenceNodeId===v.nodeId?'checked':''} /> Canonical reference</label>
      <div class="hint">${v.identityEvidence.map(esc).join(' · ')}</div>
    </div>`).join('')}</details>
    <div class="field" style="margin:6px 0"><label>Brand</label><input type="text" data-brand value="${esc(f.brandFamily||'')}" placeholder="Optional shared brand for related assets" maxlength="120" /></div>
    <div class="row" style="flex-wrap:wrap;margin-top:8px"><button class="btn small" data-confirm>Confirm family</button><button class="btn small" data-unconfirm>Unapprove</button><button class="btn small" data-split-action>Split selected</button></div>
    <div class="field" style="margin-top:6px"><select data-target aria-label="Merge destination" style="max-width:230px"><option value="">Merge into…</option>${map.assets.filter(t=>t!==f&&t.kind===f.kind).map(t=>`<option value="${esc(t.assetId)}">${esc(t.canonicalName)} · ${esc(t.assetId)}</option>`).join('')}</select><button class="btn small" data-merge>Merge</button></div>
  </article>`).join('');
  $('#assetProposals').innerHTML=map.proposals.length?`<h2 style="margin-top:14px">Possible matches <small>not merged</small></h2>`+map.proposals.slice(0,40).map((p,i)=>`<div style="margin:8px 0"><b>${esc(p.left)} ↔ ${esc(p.right)}</b><br>${esc(p.relation)} · ${Math.round(p.confidence*100)}%<p class="hint">${p.evidence.map(esc).join(' · ')}</p><button class="btn small" data-proposal="${i}" data-accept>${p.relation==='related'?'Link brand':'Accept merge'}</button> <button class="btn small" data-proposal="${i}" data-reject>Reject match</button></div>`).join('')+`<p class="hint">Showing ${Math.min(40,map.proposals.length)} of ${map.proposals.length} proposals. Review these to reveal the next candidates.</p>`:'';
}
$('#assetReview').addEventListener('change',e=>{
  const el=e.target, row=el.closest('[data-family]'); if (!row||!map) return;
  const f=map.assets.find(f=>f.assetId===row.dataset.family);
  try {
    if (el.hasAttribute('data-name')) renameFamily(f,el.value);
    if (el.hasAttribute('data-brand')) { f.brandFamily=el.value.trim()||undefined; f.status='pending'; }
    if (el.hasAttribute('data-variant')) editVariant(f,el.closest('[data-node]').dataset.node,{[el.dataset.variant]:el.value.trim()||undefined});
    if (el.hasAttribute('data-ref')) {f.referenceNodeId=el.closest('[data-node]').dataset.node;f.status='pending';}
    if (!el.hasAttribute('data-split') && !el.hasAttribute('data-target')) { $('#assetApply').disabled=!map.assets.some(f=>f.status==='approved'); message('Review updated. Confirm changed families before applying.'); }
  } catch(e) {message(e.message);}
});
$('#assetReview').addEventListener('click',e=>{
  const b=e.target.closest('button'); if(!b||!map)return;
  if(b.dataset.page){page+=+b.dataset.page;render();return;}
  const row=b.closest('[data-family]'); if(!row)return;
  const f=map.assets.find(f=>f.assetId===row.dataset.family);
  try {
    if(b.hasAttribute('data-confirm')) approveFamily(f);
    if(b.hasAttribute('data-unconfirm')) f.status='pending';
    if(b.hasAttribute('data-split-action')) {
      const ids=[...row.querySelectorAll('[data-split]:checked')].map(el=>el.closest('[data-node]').dataset.node);
      const next=splitFamily(map,f.assetId,ids,f.kind+'/split-'+crypto.randomUUID());
      rejected.push([f.assetId,next.assetId]);
    }
    if(b.hasAttribute('data-merge')) mergeFamilies(map,row.querySelector('[data-target]').value,f.assetId);
    render();
  } catch(e) {message(e.message);}
});
$('#assetProposals').addEventListener('click',e=>{
  const b=e.target.closest('[data-proposal]'); if(!b||!map)return;
  const p=map.proposals[+b.dataset.proposal];
  try {
    if(b.hasAttribute('data-reject')) rejected.push([p.left,p.right]);
    else if(p.relation==='related') {
      const a=map.assets.find(f=>f.assetId===p.left),c=map.assets.find(f=>f.assetId===p.right);
      a.brandFamily=c.brandFamily=p.canonicalName||a.canonicalName; a.status=c.status='pending';
    } else {
      // Prefer the approved reference identity when one side comes only from project memory.
      const a=map.assets.find(f=>f.assetId===p.left),c=map.assets.find(f=>f.assetId===p.right);
      const target=!c.variants.length?c:a, source=target===a?c:a;
      mergeFamilies(map,target.assetId,source.assetId,p.evidence,p.confidence);
      if(p.canonicalName && target.canonicalName.startsWith('unresolved-')) renameFamily(target,p.canonicalName);
    }
    map.proposals=map.proposals.filter(x=>x!==p);render();
  }catch(e){message(e.message);}
});
function captureContext() {
  const useModel=$('#assetModel').checked;
  const raw=modelId()==='__custom'?$('#customModel').value.trim():modelId();
  const [up,upModel]=provider()==='proxy'?raw.split(':'):[provider(),raw];
  return {project:$('#assetProject').value.trim()||'default',server:$('#assetServer').value.trim().replace(/\/+$/,''),useModel,provider:up||'anthropic',model:upModel||null,api_key:provider()==='proxy'?null:$('#apiKey').value.trim()||null,maxModelCalls:8};
}
$('#assetResolve').onclick=()=>{
  if(resolving||aiBusy||externalBusy)return;
  context=captureContext();
  if(!/^https?:\/\//.test(context.server)){message('Enter a valid server URL');return;}
  generation++;resolving=true;map=null;pendingSave=null;rejected=[];page=0;render();
  $('#assetSave').hidden=true;$('#assetResolve').disabled=true;
  setBusy(true,'Extracting canonical features…');
  const semantic=aiItems.filter(it=>it.suggested).map(it=>({ids:it.ids,name:it.suggested,kind:it.kind==='abstract'?it.category:(it.kind||it.category),description:it.what||''}));
  send({type:'assets_prepare',project:context.project,semantic});
};
$('#assetApply').onclick=()=>{
  if(!map||resolving||externalBusy)return;
  setBusy(true,'Applying approved canonical metadata…');
  send({type:'assets_apply',map,project:context.project});
};
$('#assetExport').onclick=()=>{if(map)download('asset-map.json',exportAssetMap(map),'application/json');};
async function saveReferences() {
  if(!pendingSave)return;
  const request=pendingSave;
  try{
    await postJson(`${request.server}/assets/approve/${encodeURIComponent(request.project)}`,{},request.body,0);
    if(pendingSave!==request)return;
    pendingSave=null;$('#assetSave').hidden=true;message(`Applied ${request.count} nodes and saved approved project references.`);
  }catch(e){$('#assetSave').hidden=false;message(`Node metadata applied; project references were not saved: ${e.message}. Use Retry saving references.`);}
}
$('#assetSave').onclick=saveReferences;
window.addEventListener('message',async e=>{
  const m=e.data.pluginMessage;if(!m)return;
  if(m.type==='scanned'&&m.newScan){generation++;map=null;pendingSave=null;resolving=false;$('#assetResolve').disabled=false;render();}
  if(m.type==='error'){resolving=false;$('#assetResolve').disabled=false;message(m.msg);}
  if(m.type==='assets_prepared'){
    if(!resolving)return;
    const epoch=generation, ctx={...context};
    try{
      message(`Resolving ${m.items.length} nodes…`);
      const visuals=new Map();
      for(const item of m.items){
        if(epoch!==generation)return;
        if(!item.image)continue;
        if(!visuals.has(item.image)) {try{visuals.set(item.image,await visualFeatures(item.image));}catch{visuals.set(item.image,undefined);}}
        item.features.visualSignature=visuals.get(item.image);
      }
      const {server,...settings}=ctx;
      const result=await canonicalPost(`${server}/assets/resolve`,{...settings,documentId:m.documentId,items:m.items});
      if(epoch!==generation)return;
      map=result;map.warnings.push(...m.warnings);render();message(`${map.assets.filter(f=>f.variants.length).length} families · ${map.calls} model calls. ${map.warnings.join(' ')} Review and confirm before applying.`);
    }catch(e){message(e.message);}
    finally{if(epoch===generation){resolving=false;$('#assetResolve').disabled=false;setBusy(false,map?'Canonical resolution ready for review.':'Canonical resolution finished; see status above.');}}
  }
  if(m.type==='assets_applied'){
    map=m.map;setBusy(false,`Applied canonical metadata to ${m.count} nodes.`);render();
    pendingSave={server:context.server,project:m.project,count:m.count,body:{documentId:map.documentId,families:map.assets.filter(f=>f.status==='approved'&&f.variants.length),rejected}};
    await saveReferences();
  }
});
