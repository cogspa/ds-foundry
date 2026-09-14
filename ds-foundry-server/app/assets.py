"""Indexed deterministic resolution followed by bounded, injected multimodal comparisons.
No pairwise all-file search; no writes; no model construction in this module.
"""
from __future__ import annotations
from collections import defaultdict
import hashlib
import json
import re
import unicodedata
from langchain_core.messages import HumanMessage, SystemMessage
from .asset_schemas import AssetItem, AssetVariant, AssetFamily, AssetMap, AssetProposal, IdentityVerdict, ResolveRequest
from .asset_prompts import IDENTITY_SYSTEM
from .request_errors import error_status, safe_message
from .providers import DEFAULT_MODELS

VISUAL = {'icon','symbol','logo','character','illustration','image','avatar','shape'}
STOP = set('logo wordmark mark black white red blue green horizontal vertical stacked reverse reversed standard monochrome final vector group frame layer outline lockup image icon symbol illustration'.split())
CTA = {'learn more','read more','buy now','shop now','click here','sign up','log in','get started','submit','next','back','download','continue'}
def text_key(s):
    s = unicodedata.normalize('NFKC', s).lower()
    s = re.sub(r'[™®©]', '', s)
    s = re.sub(r'[‐‑–—-]', ' ', s)
    s = ' '.join(s.split())
    return s if 2 <= len(s) <= 120 and s not in CTA else ''

def tokens(s):
    return {t for t in re.findall(r'[^\W_]+', s.lower()) if len(t)>2 and t not in STOP and not t.isdigit()}

def digest(s): return hashlib.sha256(s.encode()).hexdigest()[:16]
def slug(s): return re.sub(r'[^a-z0-9]+','-',s.lower()).strip('-')[:60]
def geometry(it): return it.features.geometrySignature if it.features.geometryReliable else None

def conflicts(a,b):
    ta,tb = text_key(a.features.visibleText),text_key(b.features.visibleText)
    if ta and tb and ta != tb: return True
    la,lb = a.features.variant.lockup,b.features.variant.lockup
    return bool(la and lb and la != lb and 'mark' in (la,lb))

def compatible(a,b):
    return a.kind == b.kind or (a.kind in VISUAL and b.kind in VISUAL)

def strong(a,b):
    if not compatible(a,b) or conflicts(a,b): return None
    g = geometry(a)
    if g and g == geometry(b): return (.97, ['matching normalized vector/text structure', 'matching topology and relative placement; paint and scale excluded'])
    if a.features.componentFamily and a.features.componentFamily == b.features.componentFamily and a.kind == b.kind:
        return (.94, ['explicit Figma component family', 'compatible visible text and lockup evidence'])
    return None

def candidate_pairs(items, limit=4000, bucket_limit=24):
    """Bounded inverted-index neighbors. Category/aspect alone never creates a merge."""
    index = defaultdict(list); pairs = set(); truncated = False
    for i,it in enumerate(items):
        group = 'visual' if it.kind in VISUAL else it.kind
        keys = []
        if geometry(it): keys.append(('geometry',geometry(it)))
        if it.features.componentFamily: keys.append(('component',it.features.componentFamily))
        if text_key(it.features.visibleText): keys.append(('text',it.kind,text_key(it.features.visibleText)))
        for t in sorted(tokens(it.semanticName + ' ' + it.description + ' ' + it.name))[:12]: keys.append(('term',group,t))
        if it.features.visualSignature:
            signature=it.features.visualSignature
            if re.fullmatch(r'v1:[a-f0-9]{64}',signature):
                # Locality-sensitive bands retrieve nearby silhouettes without an all-pairs distance scan.
                for band in range(8):
                    value=signature[3+band*8:3+(band+1)*8]
                    if value not in ('00000000','ffffffff'): keys.append(('visual',group,band,value))
            else: keys.append(('visual',group,signature))
        for key in keys:
            for j in index[key]:
                if len(pairs) >= limit: truncated = True; break
                if compatible(it,items[j]): pairs.add((j,i))
            if len(index[key]) < bucket_limit: index[key].append(i)
            else: truncated = True
    return sorted(pairs),truncated

def model_verdict(model,a,b):
    content = []
    for label,it in [('A',a),('B',b)]:
        content.append({'type':'text','text':label + ': ' + json.dumps({'kind':it.kind,'name':it.name,'semanticName':it.semanticName,'text':it.features.visibleText,'geometry':geometry(it),'variant':it.features.variant.model_dump(exclude_none=True)},ensure_ascii=False)})
        content.append({'type':'image_url','image_url':{'url':'data:image/png;base64,'+it.image.removeprefix('data:image/png;base64,')}})
    reply = model.invoke([SystemMessage(content=IDENTITY_SYSTEM),HumanMessage(content=content)])
    c = reply.content
    if isinstance(c,list): c = ''.join(x.get('text','') for x in c if isinstance(x,dict))
    c = re.sub(r'^```(?:json)?\s*|\s*```$', '', str(c).strip())
    return IdentityVerdict.model_validate_json(c)

def resolve(req: ResolveRequest, references=None, rejected=None, model=None):
    current = sorted(req.items,key=lambda i:i.nodeId)
    refs = references or []; denied = rejected or set()
    all_items = list(current); ref_owner = {}
    for f in refs:
        for s in f.get('samples',[]):
            it = AssetItem.model_validate(s['item'])
            it.semanticName = ' '.join([f['canonicalName'],*f.get('aliases',[])])[:200]
            ref_owner[len(all_items)] = f['assetId']; all_items.append(it)
    parents = list(range(len(all_items))); members = {i:[i] for i in range(len(all_items))}
    def root(i):
        while parents[i] != i:
            parents[i] = parents[parents[i]]; i = parents[i]
        return i
    texts = {i: {text_key(it.features.visibleText)} - {''} for i,it in enumerate(all_items)}
    locks = {i: {it.features.variant.lockup} - {None,''} for i,it in enumerate(all_items)}
    root_owners = {i: ({ref_owner[i]} if i in ref_owner else set()) for i in range(len(all_items))}
    def union(a,b, approved=False):
        a,b = root(a),root(b)
        if a == b: return True
        # Never transitively join distinct approved identities or contradict another family member.
        owners = root_owners[a] | root_owners[b]
        if len(owners)>1: return False
        combined_text = texts[a] | texts[b]; combined_locks = locks[a] | locks[b]
        if not approved and (len(combined_text)>1 or ('mark' in combined_locks and len(combined_locks)>1)): return False
        if len(members[a]) < len(members[b]): a,b=b,a
        parents[b]=a; members[a]+=members.pop(b); texts[a]=combined_text; locks[a]=combined_locks; root_owners[a]=owners; return True
    evidence = defaultdict(list); confidence = defaultdict(lambda:.35)
    # Multiple approved reference treatments share one stable identity, even when geometry differs.
    first_ref = {}
    for i,owner in ref_owner.items():
        if owner in first_ref: union(first_ref[owner],i,approved=True)
        else: first_ref[owner]=i
    # Explicit node metadata restores manual splits/merges when the reviewed appearance still matches.
    for i,it in enumerate(current):
        owner=it.approvedAssetId
        if owner not in first_ref: continue
        candidates=[j for j,o in ref_owner.items() if o==owner]
        if any(strong(it,all_items[j]) or (it.image and it.image==all_items[j].image) for j in candidates):
            union(i,first_ref[owner],approved=True); confidence[i]=.99; evidence[i]=['previous designer approval and matching reference features']
    # A shared exact key is linear-time even in huge duplicate buckets. Conflicts partition the key.
    exact = defaultdict(list)
    for i,it in enumerate(all_items):
        key = geometry(it)
        if key: exact[key].append(i)
    ambiguous_keys = {key for key,indexes in exact.items() if len({ref_owner[i] for i in indexes if i in ref_owner})>1}
    for indexes in exact.values():
        owners = {ref_owner[i] for i in indexes if i in ref_owner}
        for i in indexes[1:]:
            j = indexes[0]
            if len(owners)>1: continue  # human splits have priority over identical geometry
            match = strong(all_items[j],all_items[i])
            if match and union(j,i,approved=bool(owners)):
                for k in (j,i): confidence[k]=max(confidence[k],match[0]); evidence[k]+=match[1]
    # Representatives avoid duplicate model calls. Reference-only roots still participate for cross-file recognition.
    roots = sorted({root(i) for i in range(len(all_items))})
    reps = [all_items[r] for r in roots]
    pairs,truncated = candidate_pairs(reps)
    deferred = []
    for a,b in pairs:
        a,b=roots[a],roots[b]
        if root(a)==root(b): continue
        match=strong(all_items[a],all_items[b])
        if geometry(all_items[a]) in ambiguous_keys or geometry(all_items[b]) in ambiguous_keys: match=None
        if match and union(a,b):
            for k in members[root(a)]: confidence[k]=min(match[0],max(confidence[k],.94)); evidence[k] += match[1]
        else: deferred.append((a,b))
    by_ref = {f['assetId']:f for f in refs}
    families=[]; family_for={}; representative={}
    used=set(by_ref)
    for r in sorted(members):
        indexes=members[r]; live=[i for i in indexes if i<len(current)]
        owners={ref_owner[i] for i in indexes if i in ref_owner}
        if not live and not owners: continue
        ref=by_ref[next(iter(owners))] if owners else None
        # Stable IDs are opaque until approval. Visible words name the display, never serve as a merge key.
        base=all_items[live[0] if live else indexes[0]]
        cname=ref['canonicalName'] if ref else slug(text_key(base.features.visibleText)) or slug(base.semanticName) or 'unresolved-'+digest(geometry(base) or req.documentId+':'+base.nodeId)[:8]
        aid=ref['assetId'] if ref else base.kind+'/'+cname+'-'+digest(req.documentId+':'+base.nodeId)[:8]
        while not ref and aid in used: aid += '-2'
        used.add(aid)
        vs=[]
        kind=ref['kind'] if ref else ('logo' if any(all_items[i].kind=='logo' for i in live) else base.kind)
        for i in live:
            it=all_items[i]; ev=list(dict.fromkeys(evidence[i])) or ['unresolved individual asset; review required']
            if ref: ev+=['matched approved project family '+aid]
            data=it.model_dump(); data['kind']=kind
            vs.append(AssetVariant(**data,assetId=aid,canonicalName=cname,variantId='v1:'+digest(req.documentId+':'+it.nodeId),variant=it.approvedVariant if it.approvedAssetId==aid and it.approvedVariant else it.features.variant.model_copy(),identityConfidence=confidence[i],identityEvidence=ev,aspectRatio=it.width/it.height if it.height else 0))
        f=AssetFamily(assetId=aid,canonicalName=cname,kind=kind,variants=vs,confidence=min((v.identityConfidence for v in vs),default=1),aliases=ref.get('aliases',[]) if ref else [],referenceNodeId=vs[0].nodeId if vs else None,brandFamily=ref.get('brandFamily') if ref else None)
        if ref and ref.get('reference',{}).get('documentId')==req.documentId:
            selected=ref['reference']['nodeId']
            if any(v.nodeId==selected for v in vs): f.referenceNodeId=selected
        families.append(f); representative[aid]=base
        for i in indexes: family_for[i]=aid
    family_index={f.assetId:f for f in families}
    proposals=[]; seen=set(); calls=0; warnings=[]
    if truncated: warnings.append('Candidate budget reached; unmatched items remain separate. Narrow the scan or supply references.')
    for a,b in deferred:
        left,right=family_for[a],family_for[b]
        if left==right: continue
        pair=tuple(sorted((left,right)))
        if pair in seen or pair in denied: continue
        seen.add(pair)
        fa=family_index[left]; fb=family_index[right]
        if not fa.variants and not fb.variants: continue
        aa,bb=representative[left],representative[right]
        reason=['shared candidate evidence only; identity unconfirmed']
        relation='uncertain'; score=.4; cname=''
        if conflicts(aa,bb):
            # Known mark-vs-wordmark may be related, but never auto-identical.
            if aa.features.variant.lockup != bb.features.variant.lockup and 'mark' in (aa.features.variant.lockup,bb.features.variant.lockup): relation='related'; reason=['mark and wordmark require separate asset IDs']
            else: continue
        elif model is not None and aa.image and bb.image and calls<req.maxModelCalls:
            calls+=1
            try:
                v=model_verdict(model,aa,bb)
                if v.relation=='different': continue
                relation=v.relation; score=v.confidence; reason=v.evidence; cname=v.canonicalName
                # Critic: low-confidence claims never become same proposals, appearance never overrides Figma paints.
                if relation=='same' and score<.85: relation='uncertain'; reason+=['below semantic match review threshold (.85)']
                for f,patch in [(fa,v.leftVariant),(fb,v.rightVariant)]:
                    for item in f.variants:
                        representative_item = aa if f is fa else bb
                        if item.nodeId != representative_item.nodeId and geometry(item) != geometry(representative_item): continue
                        for key in ('lockup','orientation'):
                            value=getattr(patch,key)
                            if value and (not getattr(item.variant,key) or value=='stacked'): setattr(item.variant,key,value)
            except Exception as exc:
                status = error_status(exc)
                diagnostic = (f'Comparison failed · {req.provider} · {req.model or DEFAULT_MODELS[req.provider]}'
                              + (f' · HTTP {status}' if status else '') + ': '
                              + safe_message(exc, (req.api_key,)))
                reason=[diagnostic, 'Identity unconfirmed; left separate for review']; score=.2
                if diagnostic not in warnings: warnings.append(diagnostic)
        proposals.append(AssetProposal(left=left,right=right,confidence=score,evidence=reason,relation=relation,canonicalName=cname))
    if model is not None and calls>=req.maxModelCalls and deferred: warnings.append('Model call budget enforced; remaining candidates need review.')
    # Keep reference-only families only when there is an actionable proposal to them.
    needed={p.left for p in proposals}|{p.right for p in proposals}
    families=[f for f in families if f.variants or f.assetId in needed]
    return AssetMap(documentId=req.documentId,assets=families,proposals=proposals,warnings=warnings,calls=calls,candidateCount=len(pairs))
