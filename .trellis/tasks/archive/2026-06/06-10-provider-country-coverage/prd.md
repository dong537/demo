# Configure Provider Country Coverage

## Goal

Enforce the operator-provided country and region coverage per upstream provider so seed resources, inventory sync, quote, and fulfillment all route each market to the intended platform.

## What I already know

- Proxy-Seller (`PR`) coverage: Singapore, Thailand, Poland, Brazil, Turkey, Israel, Netherlands, India, Canada, Austria, Romania, Latvia, Ukraine.
- IPIPD coverage: United Kingdom, France, Germany, Italy, Spain, Japan, Hong Kong, Vietnam, South Korea, United Arab Emirates, South Africa.
- 985Proxy (`NINE_EIGHT_FIVE`) coverage: Taiwan, Philippines, Malaysia, Australia, Indonesia.
- `apps/api/scripts/seed-resources.ts` already contains almost the same three lists.
- Provider adapters currently each keep their own country allowlist:
  - `PrAdapter` has `COUNTRY_NAMES` for PR.
  - `IpipdAdapter` has `ALPHA3_TO_ALPHA2` and `COUNTRY_NAMES`.
  - `NineEightFiveAdapter` has `COUNTRY_NAMES`, but it currently includes `HK` and does not include `ID`.
- Inventory sync writes `platform_resources`, latest inventory snapshots, and `resource_mappings` through `SyncInventoryUseCase`; quote/order use those resources, so adapter filtering is the correct enforcement point.

## Assumptions

- The provider coverage list should be the backend source of truth, not only a frontend display rule.
- Countries outside a provider's assigned list should not be created or refreshed by that provider inventory sync.
- Existing unrelated local changes (`.claude/settings.json`, `CLAUDE.md`, `IPIPD-Permit/`) are out of scope and must not be included in commits.

## Requirements

- Create one backend-owned provider country coverage source used by both seed scripts and provider adapters.
- Update PR, IPIPD, and 985 inventory sync filtering to use that shared source.
- Correct 985 coverage to Taiwan, Philippines, Malaysia, Australia, Indonesia; remove Hong Kong from 985 and add Indonesia.
- Keep IPIPD direct line ordering behavior: use upstream line id from inventory mappings when available.
- Do not run real provider orders as part of verification.

## Acceptance Criteria

- [x] `seed-resources` creates exactly the requested provider-country coverage.
- [x] PR sync accepts only `SG TH PL BR TR IL NL IN CA AT RO LV UA`.
- [x] IPIPD sync accepts only `GB FR DE IT ES JP HK VN KR AE ZA`, converting upstream alpha-3 to local alpha-2.
- [x] 985 sync accepts only `TW PH MY AU ID`.
- [x] Unit tests cover the provider coverage lists and at least one rejected country for each affected adapter.
- [x] Existing provider buy request tests remain green.
- [x] Lint, typecheck, and build pass.

## Out of Scope

- Real upstream ordering.
- Changing pricing amounts, unless a missing country price prevents seeded resources from being priced.
- Frontend redesign.
- Database schema migration unless the existing resource tables cannot express the requirement.

## Technical Approach

- Add a shared provider coverage module close to provider domain code.
- Use the shared module in `seed-resources.ts`, `PrAdapter`, `IpipdAdapter`, and `NineEightFiveAdapter`.
- Keep provider-specific request shape and mapping logic inside each adapter.
- Use tests to prevent country list drift between seed data and adapter filtering.

## Decisions

- IPIPD "recommended IP only" means the fixed operator-provided country/region list only. Do not add an extra filter on upstream `tag`, `businessTypeCode`, or similar metadata in this task.

## Technical Notes

- Inspected `apps/api/scripts/seed-resources.ts`.
- Inspected `apps/api/src/modules/providers/adapters/pr.adapter.ts`.
- Inspected `apps/api/src/modules/providers/adapters/ipipd.adapter.ts`.
- Inspected `apps/api/src/modules/providers/adapters/nine-eight-five.adapter.ts`.
- Inspected `apps/api/src/modules/resources/use-cases/sync-inventory.use-case.ts`.
- Inspected `apps/api/src/modules/pricing/use-cases/quote.use-case.ts`.
