# Real artwork regression set (initial coverage)

12 original images: one blue Ollie reference and 11 held-out examples. Labels were visually reviewed by Codex using the user's Ollie identity. Historical AI names were not imported as truth. Gray owl identity remains provisional and is excluded from Ollie match scoring. Review `gallery.html` alongside `manifest.json` to correct labels.

Included: blue/pink Ollie, drinking and guitar poses, face/wing/beak parts, multi-character scenes, cloud. Cloud and pink Ollie are original user screenshots with UI context; the remaining images are original thumbnails from prior artwork runs. No images were cropped or synthesized.

**Coverage still needed:** real logos; confirmed accidental debris with source geometry; clean cloud/pink exports; vector features for geometry-based similarity. Tiny purposeful wings, legs and beaks must not be labeled debris merely because they are small. This suite measures the server naming pipeline, not Figma scanning/grouping, geometry retrieval, or the review UI. Existing plugin tests cover those workflows with synthetic fixtures.

## Run after changes

The first live Gemini baseline is saved in `baseline.json`: 6/11 correct identifications, 5 incorrect, zero abstentions; 3 correct Ollie matches, zero missed, 2 incorrect matches. Failures include three fragments classified as characters and two scenes matched as Ollie. Anthropic's configured key returned an authentication error; Gemini completed successfully.

For all plugin/server checks plus a fresh comparison against that baseline:

```sh
sh tools/check-artwork.sh
```

This is an explicit development check, not a background watcher. It makes paid model calls and saves a timestamped report. Inspect case-level regressions before accepting a new baseline.

From `ds-foundry-server`:

```sh
.venv/bin/pytest -q
.venv/bin/python tools/evaluate_artwork.py --live --provider gemini --output evaluations/artwork/NEW-baseline.json
# Subsequent changes: preserve the baseline and write a timestamped report:
.venv/bin/python tools/evaluate_artwork.py --live --provider gemini --baseline evaluations/artwork/baseline.json
```

Uses `.env` without asking you to paste a key; normal provider API charges apply. Select `--provider gemini` or `--model MODEL` when needed. Without `--live`, the runner only validates image integrity. Regular pytest runs validate dataset integrity and scoring; they do not make paid API calls. Live runs must be invoked explicitly after changes. To rescore an existing run without calls, use `--predictions PATH_TO_REPORT`.

Each live run uses disposable storage, disables learning/cache reads, supplies only the single labeled reference, and evaluates test images independently. Test labels, filenames, and descriptions are not sent as naming hints. Reports include raw predictions, cases, category counts, dataset/code hashes, model, timestamp, accuracy, match precision and recall. Exit 1 means a previously correct case regressed; exit 2 means the run could not finish. Provider errors do not create a score. Model outputs vary; repeat a surprising regression before changing labels or the baseline.

Correct identification requires the manifest's subject/action synonyms and allowed category, at confidence >=0.5. Empty/abstract/unresolved/low-confidence answers count as missed identifications; other failures count as incorrect. This is a transparent naming rubric, not a vision model judging itself or an exhaustive semantic judge. Additional valid synonyms require human review.

Match scoring measures **whole-character Ollie identity transfer from the supplied reference**, inferred from the returned name and category. Three blue/pink examples are positive; parts, scenes and cloud are negative. An `ollie-wing` part can be correctly named without being a whole-character match. Gray owls are unscored for identity. Incorrect matches are false positives; missed matches are false negatives. Undefined precision is reported as null. These numbers do not measure all possible pairwise similarities or geometry scores.

Add verified real exports and labels to the manifest, update their SHA256 hashes, review the gallery, then establish a new baseline. Keep reference and test images separate. Reports with different dataset hashes cannot be compared automatically.
