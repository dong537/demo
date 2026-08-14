# Railway 閮ㄧ讲 Runbook

## 鐩爣鐜

- Railway project: `ipipx-platform-live-20260526`
- Environment: `production`
- Reference directory: `C:\Users\Lenovo\Desktop\瀹跺浠ｇ悊骞冲彴`
- Existing services:
  - `backend`: `https://backend-production-43893.up.railway.app`
  - `frontend`: `https://frontend-production-1870.up.railway.app`
  - `Postgres`

鏃ч」鐩殑 Railway 閰嶇疆鍙綔涓洪」鐩€佹湇鍔°€佸仴搴锋鏌ュ拰鍙橀噺褰㈢姸鍙傝€冦€傚綋鍓嶄粨搴撲娇鐢?pnpm/turbo 宸ヤ綔鍖猴紝閮ㄧ讲鍛戒护浠ユ湰浠撳簱 `apps/*/railway*.json` 涓哄噯銆?
## 鏈嶅姟閰嶇疆

### backend

- Config file: `apps/api/railway.json`
- Build: `corepack enable && pnpm install --frozen-lockfile && pnpm --filter @ipeasy/db generate && pnpm --filter @ipeasy/api... build`
- Pre-deploy: `pnpm --filter @ipeasy/db migrate:deploy`
- Start: `NODE_ENV=production pnpm --filter @ipeasy/api start:prod`
- Health: `/health`

### frontend

- Config file: `apps/web/railway.json`
- Build: `corepack enable && pnpm install --frozen-lockfile && pnpm --filter @ipeasy/db generate && pnpm --filter @ipeasy/web... build`
- Start: `pnpm --filter @ipeasy/web start`
- Health: `/healthz`

### worker

- Config file: `apps/worker/railway.json`
- Build: `corepack enable && pnpm install --frozen-lockfile && pnpm --filter @ipeasy/db generate && pnpm --filter @ipeasy/worker... build`
- Start: `NODE_ENV=production pnpm --filter @ipeasy/worker start`
- No HTTP healthcheck. It is a background fulfillment worker.

## 蹇呴渶鍙橀噺

backend 鍜?worker:

```txt
NODE_ENV=production
DATABASE_URL
REDIS_URL
APP_ENCRYPTION_KEY
JWT_SECRET
APP_PLATFORM_CURRENCY=CNY
CORS_ORIGINS=https://frontend-production-1870.up.railway.app
ALLOW_PLACEHOLDER_APIKEYS=false
ALLOW_LOCAL_DEV_APIKEY=false
PAYMENT_CONFIRMATION_ENABLED=false
PROVIDER_FULFILLMENT_EXECUTION_ENABLED=false
PROVIDER_FULFILLMENT_PROVIDER_ALLOWLIST=
PROVIDER_FULFILLMENT_UPSTREAM_ACCOUNT_ALLOWLIST=
WORKER_FULFILLMENT_POLL_INTERVAL_MS=5000
WORKER_FULFILLMENT_BATCH_SIZE=20
```

frontend:

```txt
NODE_ENV=production
VITE_API_BASE_URL=/api
WEB_API_PROXY_TARGET=https://backend-production-43893.up.railway.app
```

鐪熷疄涓婃父鍑嵁涓嶅啓鍏?Railway 鏅€氬彉閲忔槑鏂囨ā鏉裤€備笂绾块獙鏀舵椂閫氳繃 `PROVIDER_CREDENTIAL_JSON` 娉ㄥ叆鍒?`provider:set-credential` 鍛戒护锛屽啓鍏ユ暟鎹簱鍔犲瘑瀛楁鍚庡垹闄や复鏃跺彉閲忔垨鏈湴 shell 鐜銆?
## 閮ㄧ讲姝ラ

1. 閾炬帴褰撳墠浠撳簱鍒版棫 Railway project:

```powershell
railway link --project 9cea558e-9db1-4b8e-9bef-21526a2bfad5 --environment production
```

2. 纭鏈嶅姟:

```powershell
railway service list
```

3. 鍦?Railway Dashboard 涓‘璁ゆ湇鍔?Root Directory / Config Path:

```txt
backend  -> apps/api/railway.json
frontend -> apps/web/railway.json
worker   -> apps/worker/railway.json
```

濡傛灉褰撳墠椤圭洰杩樻病鏈?`worker` 鏈嶅姟锛屽厛鍦?Railway 鏂板缓鏈嶅姟骞舵寚鍚戝悓涓€浠撳簱锛屽啀浣跨敤 `apps/worker/railway.json`銆?
4. 璁剧疆鍙橀噺銆備笉瑕佹妸鍛戒护杈撳嚭璐村埌鑱婂ぉ鎴栨棩蹇楅噷锛屽洜涓?Railway 鍙橀噺鍛戒护浼氭樉绀哄師濮嬪€笺€?
5. 閮ㄧ讲:

```powershell
Copy-Item apps\api\railway.json railway.json -Force
railway up --service backend --environment production --no-gitignore --message "deploy backend"

Copy-Item apps\web\railway.json railway.json -Force
railway up --service frontend --environment production --no-gitignore --message "deploy frontend"

Copy-Item apps\worker\railway.json railway.json -Force
railway up --service worker --environment production --no-gitignore --message "deploy worker"

Remove-Item railway.json
```

Local Railway CLI upload reads the uploaded root `/railway.json`. Do not assume `railway up`
will automatically read `apps/*/railway.json`. The temporary root `railway.json` above must
not be committed. After upload, verify deployment metadata has `configFile=/railway.json`
and a non-empty `fileServiceManifest`; an empty manifest or default `RAILPACK` builder means
the service was deployed without the intended config.

Because `/railway.json` is intentionally ignored by Git, local CLI uploads must pass
`--no-gitignore` while the temporary root manifest exists. The repository root must not
contain a generic `Dockerfile`: Railway will prefer it for every service and can deploy
the frontend image to the backend service. Keep service-specific Dockerfiles under
`apps/*` and point the service config at the intended Dockerfile path.

## 閮ㄧ讲鍚?smoke

```powershell
curl.exe -fsS https://backend-production-43893.up.railway.app/health
curl.exe -fsS https://backend-production-43893.up.railway.app/ready
curl.exe -fsS https://backend-production-43893.up.railway.app/openapi.json
curl.exe -fsS https://frontend-production-1870.up.railway.app/healthz
```

浜哄伐 smoke 蹇呴』瑕嗙洊锛?
- 绠＄悊鍛樼櫥褰曘€?- 鍚庡彴浜哄伐鍏呭€笺€?- 浠ｅ涓嬪崟銆?- 閽卞寘鎵ｆ銆?- 璁㈠崟鍒楄〃鑳芥煡鍒版柊璁㈠崟銆?- 瀹¤鏃ュ織鑳芥煡鍒板厖鍊煎拰浠ｅ涓嬪崟銆?- worker 寮€鍚湡瀹炲饱绾﹀悗锛岃鍗曚骇鐢?`upstream_order_mirrors` 鍜?`proxy_instances`銆?
## 鐪熷疄涓婃父楠屾敹

1. `PROVIDER_FULFILLMENT_EXECUTION_ENABLED=false` 鏃跺啓鍏?provider 鍑嵁銆佽窇 health check銆佸悓姝ュ簱瀛樸€?2. 纭鍙敭璧勬簮鏈夊簱瀛樸€佷环鏍煎拰 `resource_mappings`銆?3. 鐢ㄦ祴璇曞鎴峰皬棰濅汉宸ュ厖鍊笺€?4. 瀵?PR / IPIPD / 985Proxy 鍒嗗埆 dry-run 璐拱棰勮銆?5. 灏?`PROVIDER_FULFILLMENT_EXECUTION_ENABLED=true`锛屽苟鐢?allowlist 闄愬畾鏈瑕侀獙鏀剁殑 provider 鎴?upstream account銆?6. 鍚?provider 鍋氬皬鏁伴噺鐪熷疄璐拱銆?7. 楠岃瘉澶辫触璺緞鏃讹紝鍏堢缉灏?allowlist 鎴栧仠鐢ㄥ搴?provider account锛岀‘璁ゅけ璐ャ€侀€€娆俱€佸璁″彲鏌ャ€?
## 鍥炴粴

- 绔嬪嵆鍋滅湡瀹炲饱绾︼細`PROVIDER_FULFILLMENT_EXECUTION_ENABLED=false`銆?- 鍋滃崟涓笂娓革細灏嗗搴?`provider_accounts.status` 鏀逛负 `DISABLED`锛屾垨绉诲嚭 allowlist銆?- 鍥炴粴搴旂敤锛氬湪 Railway 瀵?`backend`銆乣frontend`銆乣worker` 鍥炴粴鍒颁笂涓€鎴愬姛 deployment銆?- 鏁版嵁搴?migration 鍙仛 forward fix锛屼笉鍋氱牬鍧忔€у洖婊氥€?
