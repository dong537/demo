# Deploy To Railway

## Goal

Deploy the current platform to the linked Railway production project and verify backend/frontend health without committing secrets or uploading unrelated local source snapshots.

## What I already know

- Railway CLI is installed: `railway 4.66.0`.
- Current Railway link:
  - Project: `ipipx-platform-live-20260526`
  - Project ID: `9cea558e-9db1-4b8e-9bef-21526a2bfad5`
  - Environment: `production`
- Existing services are online:
  - `backend`: `https://backend-production-43893.up.railway.app`
  - `frontend`: `https://frontend-production-9279.up.railway.app`
  - `worker`
- Existing deployment configs:
  - `apps/api/railway.json`
  - `apps/web/railway.json`
  - `apps/worker/railway.json`
- Existing runbook: `docs/railway-deployment-runbook.md`.
- Local unrelated dirty/untracked files exist and must not be committed:
  - `.claude/settings.json`
  - `CLAUDE.md`
  - `IPIPD-Permit/`

## Requirements

- Deploy `backend`, `frontend`, and `worker` to Railway production using the existing service-specific Railway config files.
- Do not print Railway secret variable values or local `.env` values.
- Do not run real upstream provider purchases as part of deployment.
- Prevent unrelated local `IPIPD-Permit/` source snapshot from being uploaded by Railway local deploy.
- Verify service health after deploy:
  - backend `/health`
  - backend `/ready`
  - backend `/openapi.json`
  - frontend `/healthz`

## Acceptance Criteria

- [x] Railway deploy command succeeds for backend.
- [x] Railway deploy command succeeds for frontend.
- [x] Railway deploy command succeeds for worker.
- [x] Backend health smoke succeeds.
- [x] Frontend health smoke succeeds.
- [x] Any repo config change needed for safe deploy is committed without secrets.

## Out of Scope

- Real provider orders.
- Rotating provider credentials.
- Printing or exporting Railway variables.
- Changing Railway project/service topology unless deployment fails because topology is missing.

## Technical Approach

- Add `IPIPD-Permit/` to `.railwayignore` so local deploy payload excludes the copied page-source reference.
- Copy each service config to root `railway.json` before `railway up`, then remove root `railway.json` after upload.
- Use the linked Railway production project and explicit `--service`/`--environment production` flags.

## Technical Notes

- `railway up` local upload reads root `/railway.json`; it does not automatically use `apps/*/railway.json`.
- Root `railway.json` must remain temporary and uncommitted.
- Existing `.railwayignore` excludes env/build artifacts but did not exclude `IPIPD-Permit/`.
