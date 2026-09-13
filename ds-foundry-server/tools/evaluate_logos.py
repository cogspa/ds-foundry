"""Explicit live smoke check of user-supplied logo screenshots; uses .env/Gemini."""
import base64
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


def main():
    from dotenv import load_dotenv
    load_dotenv(ROOT / '.env', override=False)
    dataset = ROOT/'evaluations/logos'
    manifest = json.loads((dataset/'manifest.json').read_text())
    with tempfile.TemporaryDirectory(prefix='dsf-logo-eval-') as tmp:
        os.environ['DSF_DATA_DIR'] = tmp
        from app import glossary as storage
        storage.DATA_DIR = Path(tmp)
        from app.graph import run_naming
        from app.providers import get_chat_model, get_critic_model, DEFAULT_MODELS
        from app.schemas import Item
        namer, critic = get_chat_model('gemini'), get_critic_model('gemini', None, None)
        cases = []
        for row in manifest['items']:
            data = (dataset/row['image']).read_bytes()
            if hashlib.sha256(data).hexdigest() != row['sha256']:
                raise ValueError('Artwork changed: review the manual label')
            results, usage = run_naming([Item(key=row['id'],category='image',image=base64.b64encode(data).decode())],
                namer,critic,storage.Glossary(row['id']),storage.Cache(row['id']),True,False,False,storage.Refs(row['id']))
            p = results[0]
            resolved = bool(p.name) and p.kind != 'abstract' and p.confidence >= .5 and not p.note.startswith('unresolved')
            correct = resolved and ((p.kind == 'logo') == row['is_logo'])
            cases.append(dict(id=row['id'],expected_logo=row['is_logo'],correct=correct,prediction=p.model_dump(),usage=usage.model_dump()))
        report = dict(timestamp=datetime.now(timezone.utc).isoformat(),provider='gemini',model=DEFAULT_MODELS['gemini'],
            scope=manifest['scope'],cases=cases,correct=sum(c['correct'] for c in cases),total=len(cases),
            dataset_sha256=hashlib.sha256((dataset/'manifest.json').read_bytes()).hexdigest(),
            code_sha256=hashlib.sha256(b''.join(p.read_bytes() for p in sorted((ROOT/'app').glob('*.py')))).hexdigest())
        target=dataset/'runs'/(datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')+'.json')
        target.parent.mkdir(exist_ok=True)
        target.write_text(json.dumps(report,indent=2)+'\n')
        print(json.dumps(report,indent=2))
        if not all(c['correct'] for c in cases): raise SystemExit(1)


if __name__ == '__main__':
    main()
