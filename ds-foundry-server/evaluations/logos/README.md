# Logo screenshot smoke checks

The user supplied a positive Owting logo lockup and a negative contact sheet containing status bars, pagination, and a branded sign-in button. Original screenshot bytes are stored in `images/`; labels and hashes are in `manifest.json`.

Run `.venv/bin/python tools/evaluate_logos.py` from the server folder. This uses the `.env` Gemini configuration, disposable storage, no references, no learning, and no cache reads. Normal API charges apply. Each run saves its predictions under `runs/`; unresolved predictions or wrong logo/non-logo decisions fail the check. The standard `sh tools/check-artwork.sh` also runs these checks after the broader regression comparison passes.

Initial result: Owting classified as `logo`, negative screenshot classified as `nav`. The negative description focused on a status bar within the sheet, not the entire sheet: this verifies only the non-logo decision. It does not establish correct interpretation of every element. Individual status-bar, pagination, and sign-in-button structures have deterministic plugin regression fixtures, not extracted real vector geometry.

These two known examples are smoke checks, not a held-out/general logo benchmark: Owting and these UI categories are explicitly described in the naming prompt. More unseen brands, standalone marks, vertical lockups, unbranded icon/text combinations, and original Figma exports are needed to measure generalization.
