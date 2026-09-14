"""Character/fragment regressions; fake model only, no billable requests."""
import json
import pytest
from langchain_core.messages import AIMessage
from app.character_parts import character_part
from app.graph import _parse_proposals, run_naming
from app.glossary import Cache, Glossary, Refs
from app.schemas import Item, Reference

@pytest.mark.parametrize('name,expected', [
 ('blue-ollie-body', True), ('owl-wing-2', True), ('pink-owl-eyes-only', True),
 ('ollie-full-body', False), ('owl-whole-body', False), ('grey-owl-playing-guitar', False),
 ('pink-owl-waving', False), ('yellow-owl-back', False)
])
def test_character_parts(name, expected):
    assert character_part(name) is expected

def test_model_cannot_promote_named_wing_to_whole_character():
    result = _parse_proposals([{'i':0,'name':'blue-ollie-wing','kind':'character','confidence':.99}], [4])
    assert result[4].kind == 'symbol'

def test_legacy_fragment_references_are_excluded_but_whole_reference_is_kept():
    project = 'whole-character-regression'
    refs = Refs(project)
    refs.add('blue-ollie-body', 'torso', 'character', 'body-image')
    refs.add('ollie-full-body', 'whole owl', 'character', 'whole-image')
    refs.save()
    class Model:
        def invoke(self, messages):
            content = str(messages[-1].content)
            assert 'body-image' not in content and 'wing-image' not in content
            assert 'whole-image' in content
            return AIMessage(content=json.dumps([{'i':0,'name':'pink-owl-waving','kind':'character','confidence':.96}]))
    results, usage = run_naming(
        [Item(key='character-v1:pink',category='illustration',name='Group 8',image='pink-image')],
        Model(), None, Glossary(project), Cache(project), False, False, False, refs,
        [Reference(name='blue-ollie-wing',kind='character',image='wing-image')])
    assert results[0].kind == 'character'
    assert usage.calls == 1
