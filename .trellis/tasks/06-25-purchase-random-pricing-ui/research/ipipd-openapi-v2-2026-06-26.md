# IPIPD OpenAPI v2 Check - 2026-06-26

Source: https://api-docs.ipipd.cn/

## Auth Contract

- Required headers: `X-API-AppId`, `X-API-Timestamp`, `X-API-Nonce`, `X-API-Signature`.
- Timestamp is Unix seconds.
- Signature algorithm: HMAC-SHA256, lowercase hex.
- String to sign: `METHOD + URI + timestamp + nonce + body`.
- `URI` is the request path only and excludes query string.
- Empty request body signs as an empty string.

## Environment Contract

- Production base URL: `https://api.ipipd.cn`.
- Sandbox base URL in the current docs tester: `https://api.sandbox.ipipd.cn`.
- Existing operator-entered legacy sandbox URL `https://sandbox.ipipd.cn` still needs the request path mounted under `/api/openapi/v2/...`, while the canonical signed URI remains `/openapi/v2/...`.

## Static Proxy Endpoints

- `GET /openapi/v2/account` is the health-check account endpoint.
- `POST /openapi/v2/static/lines` uses `LineSearchRequest`.
- `POST /openapi/v2/static/orders/create` uses `OrderCreateRequest`.
- `POST /openapi/v2/static/orders` uses `OrderSearchRequest`.

## Static Lines

- `LineSearchRequest.current` is zero-based.
- `StaticLineV2DTO.status` is documented as `0=ACTIVE, 1=INACTIVE, 2=MAINTENANCE`, but it is not marked as a required field in the schema.
- `StaticLineV2DTO.active` is also optional.
- Inventory sync should therefore treat a missing `status` as not blocking saleability when `active !== false`; otherwise real upstream rows can be written with stock `0`.

## Orders

- `OrderCreateRequest` requires `quantity` and `days`.
- Supported order fields include `lineId`, `countryCode`, `cityCode`, `businessType`, `ispType`, `tag`, `cidr`, `quantity`, `days`, `currency`, `discountPackageId`, `orderNo`, `isTest`, and `sync`.
- The docs say `currency` currently does not take effect for order creation, so omitting it is not the primary cause of buy failure.
- `OrderSearchRequest.current` is zero-based and `size` has `maximum: 100`.

## Live Probe Note

Using the latest sandbox credential shared in chat against both `https://api.sandbox.ipipd.cn/openapi/v2/account` and `https://sandbox.ipipd.cn/api/openapi/v2/account` returned HTTP `401`. The probe printed only HTTP status and envelope metadata, not secrets or account data. This points to credential/environment authorization rather than signature construction, because the code matches the documented auth algorithm.
