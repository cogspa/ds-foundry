import json
import pytest
from fastapi.testclient import TestClient
from langchain_core.language_models.fake_chat_models import FakeListChatModel
from pydantic import ValidationError
from app.asset_schemas import AssetItem, Features, VariantProperties, ResolveRequest, ApprovalRequest
from app.assets import resolve, candidate_pairs, strong
from app.asset_store import AssetStore
from app import main, glossary

PNG='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
def item(n, geo=None, text='', **kw):
    color=kw.pop('color','black'); lock=kw.pop('lockup',None); comp=kw.pop('component',None)
    return AssetItem(nodeId=str(n),kind=kw.pop('kind','logo'),name=kw.pop('name','Vector '+str(n)),image=PNG,
        features=Features(geometrySignature=geo,geometryReliable=bool(geo),visibleText=text,componentFamily=comp,variant=VariantProperties(color=color,lockup=lock)),**kw)
def run(items, **kw): return resolve(ResolveRequest(documentId='file-1',items=items),**kw)

@pytest.fixture(autouse=True)
def isolated_store(tmp_path,monkeypatch): monkeypatch.setattr(glossary,'DATA_DIR',tmp_path)

@pytest.mark.parametrize('change',[{'color':'white'},{'width':500,'height':150},{'name':'Logo Final FINAL'}])
def test_a_b_c_same_geometry(change):
    m=run([item(1,'g1:logo',width=100,height=30),item(2,'g1:logo',**change)])
    assert len(m.assets)==1 and len(m.assets[0].variants)==2
    assert all(v.identityEvidence for v in m.assets[0].variants)
    assert m.assets[0].status=='pending'
    if 'color' in change: assert {v.variant.color for v in m.assets[0].variants}=={'black','white'}

@pytest.mark.parametrize('a,b',[(item(1,'a','Adobe'),item(2,'b','Acme')),(item(1,'a',color='white'),item(2,'b',color='white')),(item(1,None,width=100,height=30),item(2,None,width=100,height=30))])
def test_d_g_no_color_size_name_merge(a,b): assert len(run([a,b]).assets)==2

def test_text_conflict_even_equal_hash(): assert len(run([item(1,'same','Adobe'),item(2,'same','Acme')]).assets)==2

def test_e_horizontal_stacked_is_reviewable():
    model=FakeListChatModel(responses=[json.dumps({'relation':'same','confidence':.96,'canonicalName':'coca-cola','evidence':['same legible wordmark and distinctive lettering'],'rightVariant':{'orientation':'stacked'}})])
    m=run([item(1,'horizontal','Coca Cola'),item(2,'stacked','Coca Cola')],model=model)
    assert len(m.assets)==2 and m.proposals[0].relation=='same' and m.calls==1
    assert m.assets[1].variants[0].variant.orientation=='stacked'

def test_f_mark_wordmark_not_interchangeable():
    m=run([item(1,'g',lockup='mark',semanticName='acme'),item(2,'h',lockup='wordmark',semanticName='acme')])
    assert len(m.assets)==2 and m.proposals[0].relation=='related'

def test_component_and_transitive_text_conflicts():
    m=run([item(1,'g','Adobe',component='set'),item(2,'g',component='set'),item(3,'h','Acme',component='set')])
    assert len(m.assets)==2

@pytest.mark.parametrize('reply',['not json','[]','{}','{"relation":"same","confidence":"NaN","evidence":["x"]}',json.dumps({'relation':'same','confidence':.3,'evidence':['looks vaguely similar']}),json.dumps({'relation':'same','confidence':1.1,'evidence':['x']}),json.dumps({'relation':'same','confidence':.9,'evidence':['x'],'unknown':1})])
def test_bad_and_low_confidence_are_unmerged(reply):
    m=run([item(1,'a',semanticName='coca cola'),item(2,'b',semanticName='coca cola')],model=FakeListChatModel(responses=[reply]))
    assert len(m.assets)==2 and m.proposals[0].relation=='uncertain'

def test_comparison_failures_show_provider_diagnostics_and_keep_assets_separate():
    from google.genai.errors import ClientError
    class UnavailableModel:
        def invoke(self, messages):
            raise ClientError(404, {'error': {'message':'Model missing; api_key=private-fixture-key', 'status':'NOT_FOUND'}})
    req = ResolveRequest(documentId='fixture', provider='gemini', model='missing-model', api_key='private-fixture-key',
                         items=[item(1,'a',semanticName='coca cola'),item(2,'b',semanticName='coca cola')])
    result = resolve(req, model=UnavailableModel())
    assert len(result.assets)==2 and result.proposals[0].relation=='uncertain'
    assert 'gemini · missing-model · HTTP 404' in result.warnings[0]
    assert 'Model missing' in result.proposals[0].evidence[0]
    assert 'private-fixture-key' not in result.model_dump_json()

def approve(m):
    for f in m.assets:f.status='approved'
    return ApprovalRequest(documentId=m.documentId,families=m.assets)

def test_h_approved_reference_survives_new_file():
    store=AssetStore('A'); m=run([item(1,'g',color='black')]); original=m.assets[0].assetId
    store.approve(approve(m))
    assert AssetStore('B').all()==[]
    next=resolve(ResolveRequest(documentId='file-2',items=[item(9,'g',color='white')]),store.all())
    assert len(next.assets)==1 and next.assets[0].assetId==original
    assert next.assets[0].variants[0].variant.color=='white'
    assert next.assets[0].status=='pending'
    assert store.all()[0]['samples'][0]['item']['features']['variant']['color']=='black'

def test_multiple_reference_treatments_not_duplicate_families():
    m=run([item(1,'a'),item(2,'b')]); a,b=m.assets
    for v in b.variants:v.assetId=a.assetId;v.canonicalName=a.canonicalName
    a.variants+=b.variants;m.assets=[a]
    store=AssetStore('a');store.approve(approve(m))
    out=run([item(9,'a'),item(10,'b')],references=store.all())
    assert len(out.assets)==1 and len(out.assets[0].variants)==2

def test_split_override_and_reference_ambiguity():
    m=run([item(1,'same'),item(2,'same')]); f=m.assets[0]
    split=f.model_copy(deep=True);split.assetId='logo/different';split.variants=split.variants[1:];split.referenceNodeId='2'
    split.variants[0].assetId=split.assetId
    f.variants=f.variants[:1];m.assets.append(split)
    store=AssetStore('a');store.approve(approve(m))
    out=run([item(5,'same')],references=store.all())
    assert len([f for f in out.assets if f.variants])==1
    assert out.assets[0].assetId not in {f.assetId for f in m.assets}
    same=run([item(1,'same',approvedAssetId=f.assetId),item(2,'same',approvedAssetId=split.assetId)],references=store.all())
    assert {x.assetId for x in same.assets if x.variants}=={f.assetId,split.assetId}

def test_rename_keeps_id_and_save_idempotent():
    store=AssetStore('x');m=run([item(1,'g')]);req=approve(m);store.approve(req)
    f=m.assets[0];f.canonicalName='coca-cola';f.variants[0].canonicalName=f.canonicalName
    req=approve(m);store.approve(req);store.approve(req)
    assert store.all()[0]['assetId']==f.assetId and len(store.all()[0]['samples'])==1

def test_reject_persisted_and_no_model_on_deterministic():
    store=AssetStore('x');m=run([item(1,'a',semanticName='acme'),item(2,'b',semanticName='acme')])
    req=approve(m);req.rejected=[(m.assets[0].assetId,m.assets[1].assetId)];store.approve(req)
    out=run([item(1,'a'),item(2,'b')],references=store.all(),rejected=store.rejected())
    assert out.proposals==[] and out.calls==0

def test_budget_and_duplicate_representatives():
    items=[item(i,'g'+str(i%3),semanticName='acme logo') for i in range(300)]
    req=ResolveRequest(documentId='x',items=items,maxModelCalls=1)
    m=resolve(req,model=FakeListChatModel(responses=[json.dumps({'relation':'uncertain','confidence':.2,'evidence':['not clear']})]))
    assert len(m.assets)==3 and m.calls==1 and len(m.proposals)<=3
    pairs,capped=candidate_pairs([item(i,semanticName='acme') for i in range(1000)],limit=100)
    assert len(pairs)<=100 and capped

def test_generic_cta_is_not_identity():
    m=run([item(1,'a','Learn More',kind='button'),item(2,'b','Learn More',kind='button')])
    assert len(m.assets)==2

def test_no_scan_writes_and_http_validation():
    client=TestClient(main.app)
    req=ResolveRequest(documentId='file',items=[item(1,'a')]).model_dump()
    r=client.post('/assets/resolve',json=req);assert r.status_code==200,r.text
    assert not (glossary.DATA_DIR/'canonical-assets.sqlite3').exists()
    data=r.json();assert data['schemaVersion']==1
    bad=client.post('/assets/approve/default',json={'documentId':'file','families':data['assets']})
    assert bad.status_code==422
    data['assets'][0]['status']='approved'
    r=client.post('/assets/approve/default',json={'documentId':'file','families':data['assets']});assert r.status_code==200,r.text
    assert client.get('/assets/references/default').json()[0]['referenceCount']==1
    assert 'image' not in client.get('/assets/references/default').text

def test_duplicate_nodes_and_invalid_reference_rejected():
    with pytest.raises(ValidationError): ResolveRequest(documentId='x',items=[item(1),item(1)])
    m=run([item(1,'g')]);raw=approve(m).model_dump();raw['families'][0]['referenceNodeId']='no'
    with pytest.raises(ValidationError):ApprovalRequest.model_validate(raw)

def test_visual_candidates_never_auto_merge():
    a,b=item(1,'a'),item(2,'b')
    a.features.visualSignature='v1:'+'12345678'*8
    b.features.visualSignature='v1:'+'12345678'+'abcdefab'*7
    out=run([a,b])
    assert len(out.assets)==2 and out.candidateCount==1 and out.proposals[0].relation=='uncertain'

def test_large_duplicate_inventory_is_linear_and_lossless():
    import time
    start=time.monotonic()
    m=run([item(i,'one-logo',color='white' if i%2 else 'black') for i in range(10000)])
    assert len(m.assets)==1 and len(m.assets[0].variants)==10000 and m.calls==0
    assert time.monotonic()-start<8

def test_merging_keeps_old_reference_treatments_and_removes_superseded_id():
    store=AssetStore('merge')
    one=run([item(1,'a')]);two=resolve(ResolveRequest(documentId='other',items=[item(2,'b')]))
    store.approve(approve(one));store.approve(approve(two))
    one.assets[0].supersedes=[two.assets[0].assetId]
    store.approve(approve(one))
    assert len(store.all())==1 and len(store.all()[0]['samples'])==2

def test_lazy_http_deterministic_path_does_not_construct_model(monkeypatch):
    def fail(*args,**kwargs): raise AssertionError('unnecessary model construction')
    monkeypatch.setattr(main,'get_chat_model',fail)
    r=TestClient(main.app).post('/assets/resolve',json=ResolveRequest(documentId='x',items=[item(1,'g'),item(2,'g')],useModel=True).model_dump())
    assert r.status_code==200 and r.json()['calls']==0

def test_manual_variant_and_chosen_reference_survive_resolution():
    m=run([item(1,'g'),item(2,'g')]);f=m.assets[0]
    f.referenceNodeId='2';f.variants[1].variant.treatment='standard'
    store=AssetStore('edits');store.approve(approve(m))
    next_item=item(2,'g',approvedAssetId=f.assetId,approvedVariant=VariantProperties(color='black',treatment='standard'))
    out=run([item(1,'g'),next_item],references=store.all())
    assert out.assets[0].referenceNodeId=='2'
    v=next(v for v in out.assets[0].variants if v.nodeId=='2')
    assert v.variant.treatment=='standard' and v.identityConfidence==.99

def test_model_variant_does_not_overwrite_deterministic_color():
    out=run([item(1,'a',semanticName='acme'),item(2,'b',semanticName='acme')],model=FakeListChatModel(responses=[json.dumps({'relation':'same','confidence':.95,'evidence':['same wordmark'],'leftVariant':{'color':'red','treatment':'reverse'}})]))
    assert out.assets[0].variants[0].variant.color=='black'
    assert out.assets[0].variants[0].variant.treatment is None
