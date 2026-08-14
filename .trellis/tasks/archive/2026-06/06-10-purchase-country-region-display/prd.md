# Purchase Country Region Display

## Goal

Make the customer static proxy purchase flow more intuitive by showing the selected resource as a clear country/region choice instead of only a generic resource name/code.

## What I already know

- Customer purchase route is `apps/web/src/routes/customer/buy/index.tsx`.
- The purchase feature is `apps/web/src/features/customer-proxies/buy-static-proxy.feature.tsx`.
- The resource API response already includes `id`, `code`, `name`, `countryCode`, and `stock`.
- Current resource option label is only `${name} (${code})`, which is not enough for users to visually understand the country/region at purchase time.
- Frontend uses React + TypeScript + Ant Design. Feature code should use antd + inline styles and i18n keys.

## Requirements

- On the customer purchase page, resource selection must clearly display country/region.
- Each option should show the country/region name, country/region code, provider/resource code, and stock when available.
- The quote summary should show the selected country/region clearly.
- The UI must keep using the existing `/api/resources` source of truth; do not introduce static fake country data.
- User-facing copy must use i18n keys in both `zh.ts` and `en.ts`.

## Acceptance Criteria

- [x] Customer buy resource dropdown shows country/region name and code.
- [x] Customer buy resource dropdown remains searchable by country/region name, code, and resource code.
- [x] Quote summary shows selected country/region instead of an ambiguous resource label.
- [x] Existing quote/order request body behavior is unchanged.
- [x] Web lint/typecheck/build pass.

## Out of Scope

- Backend resource schema changes.
- Real provider orders.
- Admin-assisted order UX.
- Repricing or provider selection behavior.

## Technical Approach

- Extend the local `ResourceDto` with optional fields already returned by API resources, such as `displayName`, `providerCode`, and `protocol`.
- Add local formatting helpers for country/region label, option search text, flag emoji, and stock display.
- Use Ant Design `Select` custom labels and `optionFilterProp="searchText"`.
- Keep derived display-only state in the feature component; server state remains TanStack Query.

## Technical Notes

- Inspected `apps/web/src/features/customer-proxies/buy-static-proxy.feature.tsx`.
- Inspected frontend component/state/quality specs.
