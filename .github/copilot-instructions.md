# Wasabi Drive backend — GitHub Copilot repository instructions

**Active milestone:** Phase 8D — fixed-grid thumbnail centre-crop prototype (offline only).

These instructions replace the backend repository's stale `.github/copilot-instructions.md` for this focused task. They apply to the `api-wasabi-drive` repository. The human owner makes architecture, security, release and storage decisions; ChatGPT performs independent analysis/review; GitHub Copilot performs only the explicitly scoped implementation.

## Authoritative state and decisions

- Phase 8C is **complete, deployed, verified and closed**, including final-five verification and backups. Do not revive superseded Phase 8C tasks.
- The owner has **merged, deployed to TEST and PRD, and accepted** the fixed-size frontend file-grid layout. Reference supplied frontend snapshot: `app-wasabi-drive-master (25).zip`, archive comment `2b72202798668597b046c5bb07a6ec1d4a435bad`. The previous frontend snapshot `(24)` is superseded for layout questions.
- The current grid in `src/components/main/Files.module.css` uses 216px fixed grid tracks and left alignment. `src/components/main/File.module.css` uses a 7px card margin, 1px border, and 20:19 image-frame aspect ratio with `object-fit: cover; object-position: centre`. The image display area is approximately **200 x 190 CSS pixels**, excluding border/margins and the separate filename/description row. Verify against the owner's actual latest checkout before relying on these measurements.
- The most recently supplied backend snapshot is `api-wasabi-drive-master (49).zip`, archive comment `61b53fc150865eb1dda31ccdc3d77f9bd7433807`. These identifiers are from archives, not independent confirmation of live GitHub or deployed commits.
- The existing completed 13-image production pilot retains **immutable `v1`** WebP derivatives generated with max edge 512px, quality 80, without unnecessary metadata. Existing originals, derivatives, exact verified coverage, checkpoints, audit journals, writer lock, private backups and credentials are protected. Never rewrite or regenerate the old pilot.
- The approved next step is **an offline comparison of physically centre-cropped thumbnail candidates** for the new grid. The owner permits cropping thumbnail content, including people at image edges, and prioritises load performance. This does **not** approve a production recipe, a `v2` rollout, live Wasabi access, a new manifest, a frontend change, or a deployment.
- A future in-app Photo Viewer (including optimised display images, Previous/Next navigation and explicit original downloads), and mobile-first redesign, are **future Technical Assessment Review handoff candidates only**, not Phase 8D tasks.

## Ownership, Git and permissions

- Inspect the real local working branch, HEAD and status before changes. Work only on an owner-approved focused branch based on `master`, suggested `experiment/thumbnail-centre-crop-prototype`. If on `master` or the tree contains unrelated modifications, report and stop before editing. Do not reset/stash/override owner changes.
- Do not commit, push, open or merge a pull request or deploy without separate explicit approval. A merge to `master` can trigger a TEST deployment; a prototype-only task is not approval to trigger that pipeline.
- Do not use credentials or connect to Wasabi or AWS, including read-only list/metadata/download/signing requests. Do not inspect local `.env` secrets or private production state. Do not change permissions, cloud configuration, CI/CD or workflows.
- Do not read/process/copy private user photos autonomously. Synthetic images are permitted for local tests. The owner may later run an offline experiment on explicitly selected originals using private directories outside Git.
- No unrelated refactoring, packages, lockfile changes, new infrastructure, framework or storage service. Do not alter or weaken existing tests merely to make them pass.

## Stack and architectural invariants

- Preserve Node.js 24, CommonJS, Express 4, AWS Lambda/API Gateway REST API, Serverless Framework v4/CloudFormation, Wasabi S3-compatible storage and the existing `test`/`prd` stages.
- Preserve route -> application/service -> storage implementation -> AWS SDK separation, centralised configuration, independent local HTTP startup and Lambda application construction.
- Microsoft Entra access-token authentication and backend authorization remain the security authority. API keys and CORS are not authentication.
- Keep source originals/private buckets and the original `AccessUrl` unchanged. Optional `ThumbnailAccessUrl` continues to refer only to verified, exact-match derivative keys signed by the dedicated read-only signer. No speculative URLs or per-object storage existence calls at browse time; internal derived buckets remain invisible and inaccessible to ordinary browsing.
- Preserve the frontend's existing lazy loading, bounded failed-thumbnail fallback, pagination/continuation handling, and open-original link. No frontend code is in scope here.
- Keep Sharp, RAW preview extraction and write-capable backfill outside the Express import path.

## Scoped Copilot code task — offline crop experiment only

Existing reference code:

- `scripts/prototype-thumbnail.js`: local CLI `thumbnail:prototype` supports `--max-edge` and `--quality`.
- `src/thumbnail/prototype.js`: local Sharp `.rotate().resize(maxEdge,maxEdge,{fit:'inside',withoutEnlargement:true}).webp({quality})` and result statistics.
- `test/thumbnail.prototype.test.js`: existing local-only prototype tests.
- `src/thumbnail/transform.js`, `src/thumbnail/service.js` and the production backfill **must retain the `v1` generation policy unchanged** for this task.

Implement **only after the owner asks Copilot to implement the focused prompt**:

1. Add backward-compatible optional local CLI crop arguments `--crop-width <pixels>` and `--crop-height <pixels>` to the existing `thumbnail:prototype` script, with both required together and mutually exclusive with an explicitly provided `--max-edge`. The no-crop invocation must remain unchanged: max edge 512, quality 80, preserve aspect ratio, no upscaling.
2. In crop mode use Sharp's `fit: 'cover'`, `position: 'centre'`, auto-orientation, output WebP, no enlargement and unchanged quality validation. Preserve the input image and avoid writing outside the caller-chosen output path. Reject incomplete, invalid or ambiguous options. Keep reasonable, explicit numeric bounds; do not build a general image pipeline or introduce arbitrary production recipe overrides.
3. Maintain existing CLI result fields; report actual output width/height/bytes and optionally a clear `mode` field. Do not falsely claim that `withoutEnlargement` always produces exact requested dimensions for tiny input images; the output can be smaller. Explain this exception.
4. Add focused tests for the unchanged existing path, landscape/portrait cropping, actual dimensions and centre alignment (using synthetic colour sections if suitable), EXIF orientation where relevant, no enlargement, invalid pair/size/quality options, source/destination path protection, and backwards compatibility. Keep tests deterministic and synthetic.
5. Preferred edit scope: `.github/copilot-instructions.md`, `scripts/prototype-thumbnail.js`, `src/thumbnail/prototype.js`, `test/thumbnail.prototype.test.js`. Small README updates only if necessary and owner approved. Do not modify API, config, signer, key identity, production transformer, production backfill, Docker, infrastructure, frontend, or deployment workflows.

## Owner-operated local size/quality experiment

Compare representative local originals (suggested 10-15, containing landscape, portrait, details, noise and varied sizes) using the SAME input images and Sharp/dependency version for every result. Do not use existing thumbnails as input. Separate output directories, unique anonymised names, no overwrite of original files; keep photos, paths, mappings and results with private identifiers outside the repository. The owner decides which private files may be processed.

| Candidate | Method | Physical output (normal sufficiently large source) | WebP quality |
|---|---|---|---|
| Existing control | Fit inside | 512px maximum edge; preserve aspect | 80 |
| C1, smallest | Centre crop | 200 x 190px (1x display resolution) | 80 |
| C2, moderate | Centre crop | 300 x 285px (1.5x display resolution) | 80 |
| C3, sharpest | Centre crop | 400 x 380px (2x display resolution) | 80 |

Compare per-sample and aggregate output bytes, median reduction relative to the 512/80 control, actual dimensions, and owner visual inspection at the real 200 x 190 CSS-pixel grid size and normal browser zoom/display pixel ratio (DPR = device pixel ratio). C3 can have as many/more pixels than the current 512x288 landscape thumbnail and may yield little or no byte saving. Do not equate fewer bytes to proven page-speed improvements.

An exploratory local comparison on one user-supplied JPEG with available Sharp **0.34.1** produced 29.22 KiB (512x288 control), 9.32 KiB (200x190), 17.04 KiB (300x285), 25.84 KiB (400x380). The backend declares Sharp `^0.35.5`; this one-photo exploratory figure is not production parity or a collection-wide benchmark.

## Engineering constraints for any later production work (NOT authorised now)

- A different physical recipe needs a separate immutable key version (potentially `v2`); never reinterpret/overwrite `v1`. `createThumbnailKey()` accepts a version, but the API signing, production generator, scope/checkpoint and storage adapters still enforce `v1` and/or one source scope. A helper accepting `v2` is not end-to-end support.
- Multiple-bucket coverage cannot be implemented simply by appending to `THUMBNAIL_API_ALLOWED_KEYS`: current pilot cap and aggregate AWS Lambda environment limit make that unsuitable. The separate 8D-B architecture review proposes a validated, stage-specific private coverage manifest, retaining both pilot and new coverage.
- Production writes require separate owner approval, safe TEST/PRD preparation, effective single writer-lock boundary, distinct scope/recipe checkpoint and audit identity, private backups, conditional source reads/derived writes and verified coverage before API use.
- No automatic generation Lambda, new database, queue, media viewer or frontend rewrite has been approved. Previous completed pilot state and rollback guarantees must remain intact.

## Verification and report-back

Run tests on **Node.js 24** in the owner's approved local development environment:

```text
npm test
git diff --check
git diff --stat
git status --short
```

Do not run `npm run test:integration`, any deployment command, live bucket inventory or backfill. Report exact node/Sharp versions, tested commands, actual pass/fail results, changed files, branch/HEAD/status, and any untested cases. Keep prototype source edits uncommitted for owner and ChatGPT review. Separate prototype completion from owner-operated private-photo experiments and from any later production design/rollout gate.
