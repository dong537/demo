# Phase 6: Order Completion and Multi-Node Projection

## Completed

- Customer order input no longer accepts `maxReplicaFanout`; fanout is owned by the selected `line_placement_policies` row.
- Before reservation, the API checks an active placement policy, active inbound profile/node group, and simulated capacity for the requested quantity.
- Provider completion atomically creates one `dedicated_lines` aggregate per purchased exit, an encrypted client identity, an encrypted residential exit assignment, placement nodes, projections, and `APPLY_DEDICATED_LINE_PROJECTION` jobs.
- Capacity increments use conditional SQL updates. A race or changed placement policy after provider success preserves the purchased exits and marks the provider job `NEEDS_OPERATOR`; it does not claim delivery succeeded.
- The projection worker uses a Bearer OpenUI adapter, version/hash/status read-back, lease-based retry, and sanitized operator errors. Projection credentials and SOCKS5 credentials never enter logs or API responses.
- A line with ready projections but no current imported NY route stays `MIGRATING_AWAITING_ROUTE_IMPORT`.
- Operator APIs configure/list control nodes and placement policies without returning Bearer credentials. `POST /api/admin/delivery-routes/import` imports a versioned NY snapshot with multiple domains per route; targets must belong to the line placement.
- Customer APIs `GET /api/dedicated-lines` and `GET /api/dedicated-lines/:id` return only the customer's front-door domains and client identity once the line is `ACTIVE`/`DEGRADED`; provider exit credentials are never returned.

## Verification

- `pnpm --filter @ipeasy/db generate`
- API typecheck/build and worker typecheck
- OpenUI adapter/use-case/worker unit tests
- Real PostgreSQL integration: customer order inventory gate, provider completion allocation, projection claim/read-back, and route-awaiting status
- Real PostgreSQL integration also covers multi-domain route import and customer delivery redaction.

## Remaining

- No real 3x-ui/Xray node smoke test has been run.
- NY route/domain import and assignment, payment settlement, customer/admin/reseller delivery views, Zeabur deploy, and end-to-end browser checks remain open.
