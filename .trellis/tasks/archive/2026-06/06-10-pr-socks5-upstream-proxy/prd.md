# Configure Proxy-Seller SOCKS5 Upstream Proxy

## Goal

Route Proxy-Seller (`PR`) upstream API requests through the operator-provided SOCKS5 proxy so the configured Proxy-Seller IP whitelist can allow requests from this environment.

## Requirements

- Store the SOCKS5 endpoint only in local runtime configuration (`.env`), not in source-controlled files.
- Use `UPSTREAM_PROXY_SELLER_SOCKS5_URL` as the source of truth for the PR outbound proxy.
- Apply the SOCKS5 proxy only to the `PR` adapter; do not route IPIPD or 985Proxy through it.
- Preserve current provider account credential format and encrypted DB storage.
- Keep upstream failures visible; do not turn PR failures into empty inventory or fake success.

## Acceptance Criteria

- [x] `.env` contains a SOCKS5 URL for `UPSTREAM_PROXY_SELLER_SOCKS5_URL`.
- [x] `PrAdapter` uses the SOCKS5 proxy for health-check, inventory sync, buy, and order query requests when configured.
- [x] Unit tests cover PR adapter SOCKS5 URL parsing/use without leaking credentials.
- [x] `pnpm --filter @ipeasy/api test -- src/modules/providers/tests/pr-adapter.spec.ts` passes.
- [x] `pnpm --filter @ipeasy/api typecheck` passes.
- [x] PR health-check is retried against the live configured account.
- [x] PR inventory sync parses Proxy-Seller ZIP `resident/geo` response and syncs live resources.
- [x] PR inventory sync reads `reference/list/resident` and stores a real resident `tarifId` in resource mappings.
- [x] PR dry-run/build request parses encoded PR resource mappings without calling upstream `order/make`.

## Definition of Done

- Code changes committed without committing `.env` or proxy credentials.
- Existing unrelated dirty files are left untouched.
- Verification results are reported with secrets redacted.

## Technical Approach

Add a Proxy-Seller-only HTTP seam inside `PrAdapter`. If `UPSTREAM_PROXY_SELLER_SOCKS5_URL` is empty, keep the existing `fetchWithTimeout` path. If present, send JSON requests through `https.request` with `SocksProxyAgent`, preserving timeout behavior and existing upstream request logging.

## Out of Scope

- Do not add SOCKS proxy support to IPIPD, 985Proxy, or generic provider HTTP helpers.
- Do not change provider credential JSON shape.
- Do not modify Proxy-Seller whitelist through browser automation or external API.

## Technical Notes

- `.env.example` already defines `UPSTREAM_PROXY_SELLER_SOCKS5_URL`.
- `apps/api/src/modules/providers/adapters/pr.adapter.ts` currently does not read that env key.
- `socks-proxy-agent` is already installed and used by the proxy-check module.

## Resident Tariff Mapping

- Proxy-Seller `resident/geo` is the location/source-of-truth for available country rows.
- Proxy-Seller `reference/list/resident` returns resident tariffs at `data.items.tarifs[]`; the first usable tariff id is the default resident traffic package used by local resource mappings.
- Local PR `resource_mappings.providerResourceId` encodes `<countryCode>:<tarifId>` (for example `SG:6928`) so platform resources keep their country identity while `order/make` receives the real `tarifId`.
- Verification must stay dry-run unless the operator explicitly approves real execution; current user instruction forbids real PR orders.
