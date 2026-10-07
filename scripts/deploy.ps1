$ErrorActionPreference='Stop'
npm ci
npm run typecheck
npm test -- --run --no-file-parallelism
if ($env:DEPLOY_HOOK_URL) { Invoke-WebRequest -Method Post -Uri $env:DEPLOY_HOOK_URL -UseBasicParsing | Out-Null }
