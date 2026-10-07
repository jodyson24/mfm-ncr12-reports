# MFM-NCR12-REPORTS Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Build a responsive public report submission and browsing portal with verified R2 uploads and original-file downloads.

**Architecture:** One Express web service serves the React application and API. MongoDB stores report/file metadata, quotas, and leased jobs; a separate worker verifies originals, generates previews, creates archives, and cleans abandoned uploads. The private R2 bucket holds originals and derived assets.

**Tech Stack:** TypeScript, React, Bootstrap 5, Express, MongoDB Atlas, AWS S3-compatible SDK for R2, Vitest, Playwright, Docker, Render. Pin a supported Node LTS consistently when implementation begins; commit dependency lockfiles.

**Spec:** `docs/superpowers/specs/2026-10-07-mfm-ncr12-reports-design.md` (reviewed and accepted by user on 7 October 2026).

## Global Constraints

- Project name: MFM-NCR12-REPORTS; public access; no authentication or user accounts in v1.
- Width 100%, max-width 100vw; height 100vh followed by height 100dvh; no body scroll or horizontal overflow.
- React with TypeScript, Bootstrap 5, Node.js/Express with TypeScript, MongoDB Atlas, Cloudflare R2, and Render; no Google Drive integration.
- Initial maximum 500 MiB per file and 2 GiB per report, configurable server-side; no fixed attachment count.
- Three concurrent files; multipart above 25 MiB; signed upload URLs expire after 15 minutes; drafts expire after 24 hours.
- Allow JPEG, PNG, WebP, GIF, HEIC/HEIF, MP4, MOV, WebM, MP3, WAV, M4A, PDF, PPT, PPTX. Reject executables, HTML, SVG, macro-enabled PowerPoint and mismatched content.
- Organisation/uploader names: 120 characters; title: 180; description: 3,000; required acknowledgement and valid calendar-date range.
- Dashboard: 20 reports per page, newest first; dates displayed in Africa/Lagos.
- Initial rate limits: 10 drafts/IP/hour, 30 reservations/IP/minute; daily deployment reservation budget 20 GiB.
- R2 stays private; public routes expose only published assets. No client credentials, public deletion, or blocking thumbnail requirement.
- Archive expiry: 24 hours. Render disks are temporary. Real deployment and provider smoke tests require supplied credentials.

## Review Focus

1. Retries after lost responses must not duplicate reservations, jobs, reports, or archives (Tasks 2–5, 8).
2. Cancel/complete/publish races must never expose removed or unverified objects (Tasks 3–5).
3. Malformed dates, query operators, hostile filenames, and compressed document bombs must fail safely (Tasks 1, 4, 5, 8).
4. Expired worker leases and interrupted cleanup must be recoverable without a stale worker committing results (Tasks 4, 8, 9).
5. Small landscape screens, mobile keyboard, and unsupported media must retain reachable controls and original downloads (Tasks 6–7).

## File structure and shared interfaces

Use npm workspaces `shared/`, `server/`, `worker/`, `client/`. Keep feature-specific routes, services and tests together. Root owns package scripts, TypeScript configuration, lockfile, Dockerfile and render.yaml.

`shared/src/contracts.ts` owns ReportInput, FileCandidate, PublicReport, PublicFile, DraftStatus, ApiError and paginated responses. Dates are YYYY-MM-DD strings; IDs are opaque strings; byte sizes are integers. File categories are image/video/audio/pdf/powerpoint. Public DTOs never contain objectKey, uploadId, draftTokenHash or capability tokens.

Draft mutations use `Authorization: Bearer <capability>`; create and reserve require `Idempotency-Key`. Publish key is stored per draft. A reservation key cannot be reused with a different payload. R2 multipart parts use 8 MiB except the final part, with at most three parts concurrently. Capability lifetime matches the draft; retain only its cryptographic hash server-side and keep its plaintext in browser session memory.

### Task 1: Contracts, validation, and project foundation

**Files:** root package.json, tsconfig.json, .gitignore; shared/package.json; shared/src/contracts.ts, validation.ts; shared/test/validation.test.ts.

**Interfaces:** `parseReportInput(value: unknown): ReportInput`, `parseFileCandidate(value: unknown): FileCandidate`, `parseReportQuery(value: unknown): ReportQuery`; throw typed ApiError with field errors.

- [ ] Write failing tests: reject end-before-start, impossible dates such as 2026-02-30, blank names, 121-character names, 181-character title, 3001-character description, negative/fractional bytes and query objects containing Mongo operators; normalise repeated whitespace; accept exact boundaries.
- [ ] Run `npm test -w shared`; confirm assertions fail before implementation.
- [ ] Create workspace build/test/typecheck scripts and implement schema validation with explicit limits, overlap filter dates, page bounds, and literal search input.
- [ ] Run shared tests and `npm run typecheck`; expect success.
- [ ] Commit `feat: establish report contracts and validation`.

### Task 2: MongoDB persistence, draft creation, and quota counters

**Files:** server/src/config.ts, db.ts, reports/model.ts, reports/drafts.ts, middleware/errors.ts, middleware/rateLimits.ts; scripts/setup-indexes.ts; server/test/drafts.test.ts.

**Interfaces:** `createDraft(input: ReportInput, idempotencyKey: string, ip: string): Promise<{id:string,token:string,expiresAt:string,limits:UploadLimits}>`; `requireDraft(id:string,token:string): Promise<DraftRecord>`; `reserveFile(draftId:string, token:string, candidate:FileCandidate, key:string): Promise<FileRecord>`.

- [ ] Write failing integration tests on an ephemeral replica set: concurrent reservations cannot exceed 2 GiB/report or 20 GiB/day; duplicate keys return the same reservation; changed payload gives 409; invalid/expired tokens give 404; public DTO omits internal fields; draft creation limit returns 429 and Retry-After.
- [ ] Run `npm test -w server -- drafts`; confirm failure.
- [ ] Implement model/indexes from spec §7, atomic transaction-based reservation/idempotency, hash-only capability storage, UTC expiry, distributed counters, validated configuration and emergency upload-disable switch. Keep capability replay available only during its lifetime; reconstruct an idempotent create response using a server-secret keyed token derivation rather than storing plaintext.
- [ ] Run integration tests and typecheck; expect all assertions pass.
- [ ] Commit `feat: add protected drafts and transactional quotas`.

### Task 3: R2 upload transport and cancellation lifecycle

**Files:** server/src/storage/r2.ts, uploads/service.ts, uploads/routes.ts; server/test/uploads.test.ts.

**Interfaces:** `beginUpload(file:FileRecord): Promise<UploadDescriptor>`; `signParts(fileId:string,partNumbers:number[]): Promise<PartDescriptor[]>`; `completeUpload(fileId:string,parts?:CompletedPart[]): Promise<void>`; `cancelFile(fileId:string): Promise<void>`. Routes require the owning draft capability.

- [ ] Write failing mocked-provider tests: 25 MiB uses PUT and 25 MiB+1 uses multipart; signing expiry equals 900 seconds; invalid/duplicate part numbers rejected; wrong draft ownership denied; missing object or wrong HEAD size cannot verify; cancelled files cannot complete; retries enqueue one verification job.
- [ ] Run `npm test -w server -- uploads`; confirm failure.
- [ ] Implement all draft/file API routes from spec §8, server-generated keys, signed PUT/part URLs, multipart completion, refresh of active upload descriptors, HEAD verification and cleanup scheduling. Reserve before issuing URLs; handle provider failure without losing reservation identity. Cancellation is a persisted transition and schedules abort/delete; publication and completion must check it transactionally.
- [ ] Run tests/typecheck; expect success. Document separate real R2 PUT/multipart/CORS checks pending credentials.
- [ ] Commit `feat: support signed R2 uploads and cancellation`.

### Task 4: Verification worker and bounded previews

**Files:** worker/src/index.ts, jobs/lease.ts, jobs/verify.ts, jobs/thumbnail.ts, media/inspect.ts; worker/test/lease.test.ts, verification.test.ts; Dockerfile.

**Interfaces:** `claimJob(workerId:string): Promise<LeasedJob|null>`; `renewLease(job:LeasedJob): Promise<boolean>`; `finishJob(job:LeasedJob,result:JobResult): Promise<boolean>`; `inspectOriginal(path:string): Promise<Inspection>`; `generatePreview(file:FileRecord): Promise<PreviewResult>`.

- [ ] Write failing tests: one claim wins; expired lease can be reclaimed; stale claimant cannot finish; spoofed PDF/executable rejected; PPTX with macros rejected; ZIP entry limits stop document bombs; corrupt/unsupported preview preserves verified original; verification cancellation cannot restore deleted state.
- [ ] Run `npm test -w worker`; confirm failure.
- [ ] Implement lease-generation fencing, 60-second leases with 20-second renewal and five attempts with bounded backoff. Inspect file signatures and container metadata, including legacy PPT structure and OOXML relationships; reject macro/external-execution content. Use bounded temp files; 120-second task timeouts, image pixel limits, PDF page limits and sandboxed child-process arguments. Install FFmpeg, Poppler and Sharp dependencies in Docker. Produce at-most-512px thumbnails/posters; unavailable HEIC decoding uses fallback. Never execute document contents.
- [ ] Run tests/typecheck and Docker build; expect success. Confirm worker exits cleanly on SIGTERM and releases temp files.
- [ ] Commit `feat: verify uploads and generate bounded previews`.

### Task 5: Atomic publication and public reports API

**Files:** server/src/reports/publish.ts, queries.ts, publicDto.ts, routes.ts; server/src/files/routes.ts; server/test/publicReports.test.ts.

**Interfaces:** `publishDraft(id:string,token:string,key:string): Promise<PublicReport>`; `listReports(query:ReportQuery): Promise<Page<PublicReport>>`; `getReport(id:string,page:number): Promise<ReportDetails>`; `getPublishedFileUrl(id:string,kind:'preview'|'download'): Promise<string>`.

- [ ] Write failing tests: publish rejects empty/unverified/rejected/cancelled files; concurrent publication returns one reference; draft routes/assets inaccessible publicly; overlap search includes spanning periods; stable newest-first pages break timestamp ties by ID; filters compose; malicious filenames cannot inject download headers.
- [ ] Run `npm test -w server -- publicReports`; confirm failure.
- [ ] Implement transactional publication against retained files, 20-report pages and 40-file gallery pages, explicit DTOs, text search, organisation/period/category filters, signed 5-minute read URLs and safe UTF-8 Content-Disposition. Thumbnail absence produces a processing/fallback state.
- [ ] Run tests/typecheck; expect success.
- [ ] Commit `feat: publish verified reports and expose public browsing`.

### Task 6: Full-viewport submission UI and upload queue

**Files:** client/src/App.tsx, styles/shell.css, api/client.ts; features/submission/SubmissionPage.tsx, ReportForm.tsx, FileDropzone.tsx, FileCard.tsx, uploadQueue.ts; client/test/uploadQueue.test.ts; client/e2e/submission.spec.ts.

**Interfaces:** `createUploadQueue(api:DraftApi, onChange:(state:QueueState)=>void): UploadQueue`; queue exposes add(File[]), remove(id), cancel(id), retry(id), and dispose(). React routes are /, /reports, /reports/:id.

- [ ] Write failing queue tests: max three active files/parts; retry does not restart successful files; cancellation aborts XHR; local URLs revoked; duplicate candidate triggers user choice; refresh/reselection is explicit. Browser tests assert retained form data after recoverable errors and unavailable submit until all retained files are verified.
- [ ] Run `npm test -w client` and submission Playwright test; confirm failure.
- [ ] Implement Bootstrap plum/light shell and accessible form, token-in-memory API client, XHR upload progress, signed URL renewal and in-session part resume. Show limits, duplicate confirmation, per-file retry/remove/cancel, accessible live status and persistent action bar. Display public-visibility acknowledgement; success shows reference, count, period and actions.
- [ ] Run queue and browser tests at 360×800, 1280×800 and 667×375; assert no body/horizontal scroll and reachable controls. Manually check mobile keyboard/focus scrolling on a real mobile browser before release; record pending if unavailable.
- [ ] Commit `feat: add responsive submission workspace and smart uploads`.

### Task 7: Dashboard, details, and media viewers

**Files:** client/src/features/reports/ReportsPage.tsx, ReportDetails.tsx, ReportFilters.tsx, AttachmentGallery.tsx, MediaPreview.tsx; client/e2e/reports.spec.ts.

**Interfaces:** consumes Task 5 DTOs; filters encode shareable query parameters; details fetch gallery pages independently. PDF.js renders only visible pages and releases canvases; preview refresh resolves expired signed URLs.

- [ ] Write failing browser tests: correct uploader/files for selected report; back/forward preserves filters; empty/loading/error states; unsupported video/PPT/HEIC has download action; 360px cards and desktop table keep pinned toolbar visible; focus enters/exits detail panel predictably.
- [ ] Run reports Playwright test; confirm failure.
- [ ] Implement table/cards, filters, desktop side panel and mobile workspace details; image enlargement, video/audio playback, paginated PDF viewer, processing and fallback cards, downloads and footer navigation. Format timestamps in Africa/Lagos and calendar periods without timezone conversion.
- [ ] Run browser tests, keyboard/reduced-motion checks and production build; expect success.
- [ ] Commit `feat: add searchable dashboard and attachment previews`.

### Task 8: Download All archive jobs

**Files:** server/src/archives/service.ts, routes.ts; worker/src/jobs/archive.ts; client/src/features/reports/ArchiveButton.tsx; worker/test/archive.test.ts; server/test/archives.test.ts.

**Interfaces:** `requestArchive(reportId:string): Promise<ArchiveStatus>`; `getArchive(reportId:string): Promise<ArchiveStatus>`; status pending/processing/ready/failed with optional signed download URL.

- [ ] Write failing tests: simultaneous requests coalesce; unpublished report returns 404; repeated/path-traversal filenames become unique safe ZIP entries; streaming does not buffer whole originals; failure leaves individual downloads available; expiry permits regeneration; stale worker cannot overwrite replacement archive.
- [ ] Run archive tests; confirm failure.
- [ ] Implement bounded streaming ZIP to R2 multipart upload, per-report deduplication and request throttling, immutable file-set cache, 24-hour expiry, lease fencing and abort-on-error. Add client polling with clear pending/retry states.
- [ ] Run tests and a synthetic multi-file streaming test with memory observation; expect correct ZIP entries and bounded memory.
- [ ] Commit `feat: add asynchronous report archive downloads`.

### Task 9: Cleanup and operator maintenance

**Files:** worker/src/jobs/cleanup.ts; scripts/remove-report.ts; server/src/observability.ts; worker/test/cleanup.test.ts; docs/operations.md.

**Interfaces:** `cleanupExpired(now:Date): Promise<CleanupSummary>`; `removeReport(id:string,reason:string): Promise<void>`; CLI requires trusted server environment and records an audit event.

- [ ] Write failing tests: expired draft objects/multipart uploads deleted before metadata disposal; partial storage failure retries; cancelled objects cannot resurrect; report removal hides first; preview/archive assets also deleted; quota reservations release once without refunding an already-consumed daily abuse budget.
- [ ] Run cleanup tests; confirm failure.
- [ ] Implement hourly sweep via worker scheduler and deduplicated jobs, archive expiry deletion, orphan reconciliation and idempotent maintenance. Log request/job IDs, status, cleanup metrics and bounded errors without credentials/tokens. Document R2 one-day incomplete multipart lifecycle, budget alerts, backup/restore, emergency disable, failure inspection and lack of comprehensive antivirus guarantee.
- [ ] Run tests/typecheck; expect success.
- [ ] Commit `feat: add recoverable cleanup and operator controls`.

### Task 10: Render packaging, deployment script, and release checks

**Files:** server/src/app.ts, index.ts; render.yaml, .env.example, README.md; scripts/deploy.sh, smoke-test.ts; docs/deployment.md; server/test/health.test.ts.

**Interfaces:** Express serves built client and /api, binds PORT, returns process health at /api/health and DB readiness at /api/ready; unknown API routes stay JSON 404 and SPA deep links serve index.html. Docker web/worker share source/image with separate startup commands.

- [ ] Write failing HTTP tests for health/readiness, static assets, /reports/:id deep links and unknown API routes; script checks missing env/config without printing secret values.
- [ ] Run health/script checks; confirm failure.
- [ ] Implement Render web/worker Blueprint, consistent runtime pinning and dependency lock, graceful shutdown, configurable trust proxy with documented Render verification, safe deploy-hook POST and no automatic paid resource creation. Document Atlas transactions/network access, R2 token/bucket/CORS, all environment settings, index setup, smoke tests and rollback. Deployment script validates, tests and builds before triggering the supplied hook; it never logs the hook.
- [ ] Run `npm ci`, `npm run typecheck`, `npm test`, `npm run build`, `npm run test:e2e` and Docker builds; expect success. Validate Blueprint with available official tooling. Run real R2 multipart/CORS, Atlas and Render smoke checks only with supplied credentials; report them separately as pending otherwise.
- [ ] Review spec acceptance checks 1–8 against results; fix gaps, record limitations and commit `chore: package Render deployment and release checks`.

## Self-review outcome

All specification sections map to Tasks 1–10. Draft safeguards and UI remain one integrated plan because neither is a independently shippable subsystem. Review Focus cases have tests assigned above. Operator credentials, official logo and live-provider validation are release inputs; PowerPoint slide conversion stays deferred. No product implementation or live deployment is claimed by this plan.

## Execution handoff

Review this plan before implementation. Native execution is recommended because the ten tasks share strict lifecycle and DTO interfaces; one implementer can maintain continuity. Subagent-driven execution is available if separate task-by-task implementation and review is preferred. Keep the approved specification alongside this plan.
