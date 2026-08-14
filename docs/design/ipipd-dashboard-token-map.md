# IPIPD Dashboard Token Map

目标：把 `IPIPD-Permit/ipipd-clone` 的 dashboard 与公开页视觉尺寸映射到当前 Ant Design 实现，作为后续截图对比和复刻收敛的 source of truth。该映射只约束视觉 token，不替代真实业务接口、权限、分站、报价、下单和履约链路。

## Shell

| Surface | IPIPD reference | Current AntD target | Implementation |
| --- | --- | --- | --- |
| Page background | `#fafafc` | `--ipx-bg` | `apps/web/src/shared/theme/tokens.css` |
| Header height | `56px` dashboard, `64px` public | `--ipx-header-h: 56px`, public topbar `64px` | `.ipx-customer-header`, `.landing-topbar`, `.buy-topbar` |
| Sidebar width | `232px` | `--ipx-sidebar-w: 232px` | `.ipx-customer-sidebar` |
| Border | `#d8d8d8` primary, `#e8e8e8` soft | `--ipx-border`, `--ipx-border-soft` | global tokens |
| Primary | `#003afe` | `--ipx-primary` | global tokens and public CSS variables |
| Radius | `6px` controls, `8px` panels | `--ipx-radius-btn`, `--ipx-radius` | global AntD overrides |

## Ant Design Components

| Component | Reference intent | AntD override target | Current target value |
| --- | --- | --- | --- |
| Menu item | compact row, clear selected blue soft bg | `.ant-menu-item`, `.ant-menu-submenu-title` | `40px` customer sidebar, `36px` nested, `font-weight: 600/700` |
| Table header | dense header, grey surface, strong label | `.ant-table-thead > tr > th` | `44px`, `12px`, `700`, `#fafafc` |
| Table body | compact operational rows | `.ant-table-tbody > tr > td` | `52px`, `9px 12px`, no decorative shadow |
| Card | white panel, thin border | `.ant-card` | border `#d8d8d8`, radius `8px`, head `48px`, body `16px` |
| Button | utilitarian, no glow | `.ant-btn` | height `34px`, radius `7px`, weight `700`; primary no shadow |
| Input/Form | dense fields | `.ant-input`, `.ant-select-selector`, `.ant-form-item` | height `34px`, label weight `700`, margin `14px` |
| Modal/Drawer | framed operation surface | `.ant-modal-*`, `.ant-drawer-*` | title `800`, body padding `18px`, footer padding `12px 18px` |
| Pagination | table footer density | `.ant-pagination` | item `30px`, compact gap, bold active |

## Public Pages

| Surface | Reference direction | Current mapping |
| --- | --- | --- |
| Home hero | IPIPD blue-white, centered, minimal decoration | `.landing-hero`: white/soft-blue background, reduced radial glow, no heavy shadow |
| Buy hero | purchase-oriented workbench, not a generic marketing hero | `.buy-hero`: white/soft-blue grid, compact live panel, real customer buy link |
| Public cards | thin bordered panels | `.landing-*card`, `.buy-*card`: `8px` radius, `#d8d8d8` border, no hover lift shadow |
| Public CTA | blue band allowed but restrained | `.landing-cta`, `.buy-cta`: flat brand blue, no fake product data |

## Verification Targets

Use the same desktop viewport for visual checks:

- `/`
- `/buy`
- `/overview`
- `/customer/buy`
- `/proxies`
- `/wallet`
- `/api-keys`
- `/tickets`
- `/proxy-check`

Authenticated customer pages require a real seeded/login session. If auth blocks a screenshot, capture the visible redirect/error state and record the limitation instead of injecting mock data.
