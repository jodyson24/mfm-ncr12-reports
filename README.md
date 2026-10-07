# MFM NCR12 Reports

Public report submission and browsing portal.

Copy `.env.example` to `.env`, enter real MongoDB Atlas and Cloudflare R2 values, then set `UPLOADS_ENABLED=true` only after provider smoke tests pass.

Local checks:

```text
npm ci
npm run typecheck
npm test -- --run --no-file-parallelism
```
