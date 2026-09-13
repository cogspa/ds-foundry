# Canonical Asset Resolution

DS Foundry 1.5.0 adds a semantic family layer after scan/classification/naming. It does not implement responsive recomposition or a layout solver.

## Workflow

1. Start the companion server with `ds-foundry-server/run.sh` (or restart your existing service after updating).
2. Reopen the development plugin using its existing manifest; `dist/` is rebuilt.
3. Scan the selection, page or document. Optionally suggest/apply AI names first. Suggested names and AI categories also feed the canonical resolver without having to rename originals.
4. In **Canonical Assets**, choose the server and project. Leave **Compare ambiguous images** off for deterministic resolution with no API key. Turn it on to use the provider/model selected in AI naming; Proxy supports the existing server-side keys and Ollama configuration.
5. **Resolve assets** reads nodes and exports review thumbnails. Nothing is written to original nodes or approved project memory.
6. Expand **Variants and evidence**. Edit appearance properties, choose a reference, rename the family, merge into another family, or select some variants and split them. Related marks and wordmarks should keep separate IDs and share the optional Brand field.
7. Review possible matches. Accepting a merge changes only the review draft. Confirm each correct family, then **Apply approved**. Pending families are not written to nodes. An edited family must be confirmed again.
8. Successful node application saves the approved references to that project's server memory. If the server save fails, the panel reports the distinction and offers **Retry saving references**. The Figma document and SQLite store are separate systems, so this is intentionally not presented as an atomic cross-system transaction.
9. Download **asset-map.json** directly, or use Build to include it alongside existing token exports. Direct exports include explicit pending/approved status: downstream consumers must filter approved families when they need confirmed identity. `layout-metadata.json` includes all retained inventory records and their canonical ID/variant ID links, where available.

Use the same project name across files to recognize earlier approved asset treatments. Naming cache/glossary/reference data is unchanged and is never treated as a human canonical approval.

## Contract and modules

- `src/asset-types.ts`: AssetItem, IdentityFeatures, AssetVariant, AssetFamily, AssetProposal, AssetMap, LayoutMetadata. Optional fields on the existing Inventory/ElementRec keep old callers compatible.
- `src/identity.ts`: bounded read-only extraction. `g1:` is a versioned normalized geometry hash; it is not the existing fingerprint. Coordinates, curve tangents, indexed topology/winding, relative child transforms, masks, Boolean operations, text and typography contribute. Paint and absolute position do not. Aspect ratio prevents nonuniform scaling from accidentally colliding.
- `ui/visual-features.js`: `v1:` alpha/luminance descriptor. Banded matches generate candidates only. No model call identifies deterministic paint/color/size.
- `src/layout-meta.ts`: absolute bounds, parent-local normalized bounds, parent/node IDs, semantic role where available, order, rotation, constraints, layout mode/sizing/alignment/padding/gap, styles, bound variables and component context.
- `src/assets.ts`: fresh feature/thumbnail preparation, application validation, stale-node checks, original plugin-data writes and rollback on write failure. The original fingerprint is retained unchanged.
- `src/asset-review.ts`: pure rename/merge/split/edit/approve/export operations; `ui/assets.js` supplies the controls. The esbuild UI copy step embeds this script, so the distributed plugin requires no network scripts.
- `app/asset_schemas.py`: additive strict Pydantic contracts; existing naming schemas remain intact.
- `app/assets.py`: indexed deterministic resolution and bounded multimodal proposals, with injected models and a deterministic critic for conflicts/thresholds.
- `app/asset_prompts.py`: conceptual identity comparison prompt, strict structured JSON, related mark/wordmark handling, untrusted image/text instructions.
- `app/asset_store.py`: transactional SQLite approval memory in `DSF_DATA_DIR/canonical-assets.sqlite3`, namespaced by exact project string. Multiple reference treatments, aliases, selected reference and rejected pairs persist. Merges preserve stored source treatments; splits remove reassigned same-document samples. Repeated saves are idempotent.

Canonical IDs are collision-resistant provisional paths such as `logo/coca-cola-<suffix>`. Display-name edits preserve the ID, which becomes a stable machine reference after approval. IDs do not encode color/orientation. `variantId` identifies the document/node occurrence. `brandFamily` relates separate assets without declaring them interchangeable.

## Algorithm and confidence

1. Extract reliable geometry, visible text excluding generic CTA phrases, deterministic paints, layout and explicit component relationships.
2. Match exact reliable geometry with compatible identity text/lockup. Match explicit component families when there is no contradictory text/lockup. Category can differ among visual categories because the existing classifier uses size tiers.
3. Keep distinct approved identities separate. When multiple approved identities have identical geometry, new unapproved occurrences remain ambiguous. Existing explicit node approvals plus matching reference features restore designer choices.
4. Generate bounded candidates using inverted geometry/component/text/semantic/visual indexes. Collapse deterministic duplicate families before expensive comparisons. Layer names are candidate hints, never identity keys. Color or dimensions alone do not create identity matches.
5. Optionally compare representative images with the existing provider architecture. Return `same`, `different`, `related` or `uncertain` with confidence and evidence. A same claim below .85 becomes uncertain. All model matches remain human-review proposals, including high-confidence ones.
6. Preserve per-node appearance and evidence, reconcile known approved IDs, and export the draft partition. Approvals are explicit later writes.

Rank scores are not calibrated probabilities: .97 for reliable exact geometry plus compatible structure/text, .94 for explicit component family, .99 for restored manual approval, .35 for unresolved singletons; malformed/unavailable model responses become .2 uncertain proposals. Family confidence is the minimum member confidence. Confirmation is tracked independently and does not rewrite model/deterministic scores.

## Limits and conservative fallbacks

- At most 10,000 records per canonical request, 400 distinct exported appearances, 4,000 indexed candidate pairs, 24 neighbors per bucket, and 8 model calls by default (server configurable up to 30). Budget limits are reported, and unresolved records remain in the map. Up to 64 diverse reference samples per approved family are retained.
- Geometry extraction is bounded at 1,500 descendant visits, 20,000 vector vertices/segments and depth 24 per element. Unsupported, incomplete, raster, mixed-font, empty or non-distinctive geometry does not supply a reliable geometry key. Reordered vector-network indices can cause false negatives; no approximate topology solver is claimed.
- The visual descriptor is a coarse candidate feature, not an embedding or identity classifier. Candidate budgets can miss matches in very large or visually diverse files; narrow the scope or use semantic evidence and references.
- Paint extraction reports actual solid paints, not full composited color. Gradients/images/mixed paints remain unknown. White does not imply reverse. Outlined wordmarks cannot be distinguished from symbols deterministically; lockup and stacked layout may require a model proposal or human correction.
- Changing a reviewed node's size, position, geometry, paint or raster thumbnail blocks application and asks for resolution again. Non-vector nodes without an exported review thumbnail cannot be approved/applied until the scope is narrowed.
- Figma `fileKey` is preferred for document-qualified variant IDs. When unavailable, a generated document token is persisted only on Apply. A duplicated Figma file may copy that plugin-data token; the host's actual file key is the authoritative identifier when available.
- Existing generated design-system subtrees are excluded from canonical preparation. The current scanner's own retained-record limits and classification coverage still apply; this layer does not silently rewrite that behavior.
- Browser tests exercise the actual bundled panel and a mocked Figma bridge. Geometry/application tests use Figma-shaped fixtures. The repository feature extractor was also run against native Figma fixtures (color/scale variants and horizontal/stacked lockups), and their outputs were resolved by the server. The installed plugin's native panel/Apply flow and live vision-provider quality evaluation were not exercised; application is covered by the mocked host tests.

## API

| Method | Route | Behavior |
|---|---|---|
| POST | `/assets/resolve` | `{project, documentId, items, useModel, provider, model?, api_key?, maxModelCalls}` → versioned AssetMap. Read-only; model instantiated lazily only if comparison is necessary. |
| POST | `/assets/approve/{project}` | `{documentId, families, rejected}` saves only nonempty approved families. Validates partition/identity consistency and reference membership. |
| GET | `/assets/references/{project}` | Reference family metadata and counts; omits image payloads. |

Original-node plugin data: `dsf.assetId`, `dsf.assetVariant` (version/variant ID/name/properties/reference/feature snapshot), `dsf.assetConfidence` (score + evidence), `dsf.assetProject`. Existing category and original-name metadata is preserved. Revert labels still reverts names; it does not erase canonical identity.

## Verification

```bash
cd ds-foundry
npm ci
npm run check  # typecheck, deterministic tests, build, actual bundled UI tests
cd ../ds-foundry-server
.venv/bin/python -m pytest -q
```

Tests cover color/scale/layer-name invariance, topology/tangents/winding/child placement, wordmark conflicts, generic copy, image/unknown fallbacks, component relationships, layout fields, manual review operations, apply-only writes, stale review rejection, serialization, strict malformed responses, semantic variants, related mark/wordmark handling, stored references, approval splits/merges, persistence retry and a 10,000-node no-model duplicate case. Existing naming tests are preserved and all test memory is isolated before application imports.

For native acceptance, use a disposable messy page with black/white/scaled copies of one logo, a stacked lockup, a separate symbol, and a different brand. Verify originals are unchanged after Scan/Resolve, exact copies form one family, model candidates remain unmerged, mark/wordmark IDs stay separate, corrections persist after Apply, and a second file resolves against the same project references. The native fixture checks below cover extraction/grouping/cross-file references. The complete installed-plugin interaction and live-model evaluation remain acceptance checks.

## Native fixture results

The actual bundled repository extractor was executed in these isolated Figma files on joe micallef's Team (Pro):

- [Messy native fixture](https://www.figma.com/design/LCsvSma5Up7ZqHI1ccB08T): six black/white/red and 1×/2×/5× vectors named Vector 12, Vector 98, Logo Final, Logo White, Logo Final FINAL and Group 27 shared `g1:5af7dac9c9d14765`. An unrelated white vector produced a different hash. Server resolution retained all seven occurrences in two families, with zero model calls.
- Native ACME mark/wordmark lockups exposed matching visible text and independent `horizontal` / `stacked` orientation. Distinct geometry remained a candidate proposal requiring review. Feature extraction returned no mutated node IDs.
- [Second native file](https://www.figma.com/design/XJs6i8w2c9ruV30XJH8A8q): a newly created white 300×90 vector named Vector 900 resolved to the same asset ID as the first fixture's approved family. Approval memory for this check lived only in a temporary test directory, separate from production project references.

These are synthetic geometric fixtures in native Figma, not a live-model evaluation of real brand logos. The fixture files are left available for inspection.
