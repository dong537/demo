# Simplify API Key Create

## Goal

Make customer API Key creation simple for normal users: they only enter an API Key name, while the system applies the standard static proxy permission and no IP whitelist by default.

## Source of Truth

- API Key records live in `api_keys`.
- API Key creation goes through `POST /api/api-keys`.
- Customer UI must not invent fake display state; the entered name must be saved by the backend and returned in list/create responses.

## Requirements

- Customer API Key create modal shows only one required input: API Key name.
- Frontend submits the name plus default `scopes: ['res_static:*']` and empty/default IP whitelist.
- Existing backend permission checks and tenant checks remain unchanged.
- API Key list displays the saved name so users can recognize keys.
- User-facing copy must use i18n keys in both Chinese and English.

## Acceptance Criteria

- [x] Customer creates an API Key by entering only a name.
- [x] API Key name is persisted and returned by backend list/create endpoints.
- [x] Customer API Key list displays the name.
- [x] Scope/IP whitelist controls are removed from the customer create dialog.
- [x] Existing API Key auth/revoke behavior remains unchanged.
- [x] Relevant frontend/backend tests pass.

## Current Status

Completed. The implementation adds a persisted `api_keys.name` field, threads it through backend DTO/repository/use-cases, simplifies the customer create form to a single name input with the standard static-proxy scope, and keeps admin API Key creation as the advanced scope/IP surface.

## Out of Scope

- Real upstream provider API keys.
- Admin API Key UX.
- API Key scope customization UI.
- IP whitelist management UI.
- Changing API Key authentication semantics.

## Technical Approach

- Add `name` to `api_keys` schema and a migration.
- Thread `name` through API Key DTO, repository create, create use case, and list DTO mapping.
- Update customer API Key feature to use `name` as the only form field and submit default scopes.
- Update customer API Key tests and API Key backend tests for the new contract.
