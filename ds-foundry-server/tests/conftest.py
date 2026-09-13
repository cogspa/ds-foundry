"""Isolate all project memory before test collection imports application modules."""
import os
import tempfile
import pytest

os.environ['DSF_DATA_DIR'] = tempfile.mkdtemp(prefix='dsf-test-data-')

@pytest.fixture(autouse=True)
def isolated_project_memory(tmp_path, monkeypatch):
    from app import glossary
    monkeypatch.setattr(glossary, 'DATA_DIR', tmp_path)
