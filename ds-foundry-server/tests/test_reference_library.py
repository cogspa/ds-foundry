import base64
from fastapi.testclient import TestClient
from app.main import app
from app.reference_library import ReferenceLibrary

PNG=base64.b64encode(b'\x89PNG\r\n\x1a\nfixture').decode()

def test_library_persistence_and_project_isolation():
    client=TestClient(app)
    entry={'name':'ollie','kind':'character','image':PNG}
    r=client.post('/library/Project-A',json=entry)
    assert r.status_code==200
    id=r.json()['id']
    assert client.post('/library/Project-A',json=entry).json()['id']==id
    assert ReferenceLibrary('Project-A').all()[0]['image']==PNG
    assert client.get('/library/project-a').json()==[]
    assert client.get('/library/Project_A').json()==[]
    assert client.patch(f'/library/Project-A/{id}',json={'name':'ollie-blue'}).status_code==200
    assert client.get('/library/Project-A').json()[0]['name']=='ollie-blue'
    assert client.delete(f'/library/Other/{id}').status_code==404
    assert client.delete(f'/library/Project-A/{id}').status_code==200
    assert client.get('/library/Project-A').json()==[]

def test_library_validation_and_name_conflicts():
    client=TestClient(app)
    assert client.post('/library/test',json={'name':' ','kind':'icon','image':PNG}).status_code==422
    assert client.post('/library/test',json={'name':'cloud','kind':'icon','image':'not png'}).status_code==422
    a=client.post('/library/test',json={'name':'cloud','kind':'icon','image':PNG}).json()
    client.post('/library/test',json={'name':'sun','kind':'icon','image':PNG})
    assert client.patch('/library/test/'+a['id'],json={'name':'sun'}).status_code==409
    assert len(client.get('/library/test').json())==2

def test_structured_identity_survives_library_save_and_edit():
    c=TestClient(app)
    a=c.post('/library/brand',json={'name':'old-label','kind':'character','image':PNG,'assetName':{'identity':'Ollie','appearance':{'color':'pink','pose':'waving'}}})
    assert a.status_code==200
    assert a.json()['name']=='ollie-pink-waving'
    assert a.json()['assetName']['identity']=='ollie'
    id=a.json()['id']
    assert c.patch('/library/brand/'+id,json={'name':'old','assetName':{'identity':'ollie','appearance':{'color':'blue','pose':'waving'}}}).status_code==200
    row=c.get('/library/brand').json()[0]
    assert row['id']==id and row['name']=='ollie-blue-waving'
    assert row['assetName']['identity']=='ollie'

def test_rejected_pairs_persist_symmetrically_and_are_project_scoped():
    from app.reference_library import RejectionStore
    c=TestClient(app)
    a=c.post('/library/Brand/rejections',json={'a':'shape:a','b':'shape:b','aName':'pink','bName':'blue'}).json()
    b=c.post('/library/Brand/rejections',json={'a':'shape:b','b':'shape:a','aName':'blue','bName':'pink'}).json()
    assert a['id']==b['id']
    assert len(RejectionStore('Brand').all())==1
    assert c.get('/library/brand/rejections').json()==[]
    assert c.delete('/library/Other/rejections/'+a['id']).status_code==404
    assert c.delete('/library/Brand/rejections/'+a['id']).status_code==200
    assert RejectionStore('Brand').all()==[]

def test_proxy_excludes_rejected_reference_names_and_bypasses_cache(monkeypatch):
    import app.main as main
    from app.glossary import Refs
    from app.schemas import Usage
    refs=Refs('brand');refs.add('ollie','mascot','character',PNG);refs.save()
    monkeypatch.setenv('ANTHROPIC_API_KEY','test-only')
    monkeypatch.setattr(main,'get_chat_model',lambda *a:object())
    def fake_run(*args):
        assert args[7] is False
        assert args[8].all()==[]
        assert args[9]==[]
        return [],Usage()
    monkeypatch.setattr(main,'run_naming',fake_run)
    r=TestClient(app).post('/name',json={'project':'brand','critic':False,'items':[{'key':'x','category':'icon','image':PNG}],'excluded_reference_names':['ollie'],'references':[{'name':'ollie','image':PNG}]})
    assert r.status_code==200
    assert Refs('brand').all()[0]['name']=='ollie'

def test_logo_composition_survives_save_reload_rename_and_validates_roles():
    c=TestClient(app)
    composition={'version':1,'arrangement':'horizontal','regions':[{'id':'mark','name':'Owl mark','role':'symbol','text':'','x':0,'y':0,'width':.3,'height':1},{'id':'text','name':'Lettering','role':'signature','text':'Owting','x':.4,'y':.2,'width':.6,'height':.6}]}
    entry={'name':'owting-logo','kind':'logo','image':PNG,'composition':composition}
    r=c.post('/library/logos',json=entry)
    assert r.status_code==200
    id=r.json()['id']
    c.patch('/library/logos/'+id,json={'name':'owting-primary'})
    assert c.get('/library/logos').json()[0]['composition']==composition
    assert c.get('/library/other').json()==[]
    composition['regions'][0]['role']='unknown'
    assert c.post('/library/logos',json=entry).status_code==422
