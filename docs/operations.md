# Operations

Set real values in `.env` locally or in the deployment provider’s secret store. Never commit credentials. Keep `UPLOADS_ENABLED=false` until MongoDB, R2 CORS, signed URLs, and multipart smoke tests pass.

The worker runs cleanup hourly. Cleanup is idempotent: it deletes expired drafts, incomplete multipart uploads, previews, archives, and orphan objects, then marks metadata only after successful storage deletion. Failed provider operations remain eligible for the next sweep.
