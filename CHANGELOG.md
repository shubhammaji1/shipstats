# Changelog

## 0.3.0

- Redesign the dashboard into Overview, Packages and Integrations with responsive navigation and Signal Beacon branding.
- Add combined daily npm activity, clear summary cards, source counts, product search and source filters.
- Guide discovery and explicit selection, retain page/period preferences, and reveal Overview after tracking or adding a product.
- Add direct per-source entry points, accessible charts/tables, theme-aware styles, high-contrast support and reduced motion.
- Preserve account-switch reset behavior; expand the offline suite to 27 tests.

## 0.2.2

- Reset npm tracking, readings, cached results and picker filters when switching username or scope, before the new request completes.
- Keep the dashboard clear if a new account search is empty or fails; preserve the same account's selections across re-search and restart.
- Add controller-to-dashboard regression tests for account switching, failures, scope changes and persistence.

## 0.2.1

- Selected Signal Beacon artwork replaces the package-crate logo in the extension, dashboard and README.
- Text-free transparent PNG and matching monochrome beacon glyph for the activity bar.

## 0.2.0

- ShipStats branding throughout commands, settings, identifiers, tests, documentation and packaging.
- New Minecraft-inspired voxel package logo and a matching monochrome analytics activity icon.
- New local extension identity; earlier prototype selections and tokens need to be configured again.

## 0.1.0

- Public npm username/scope discovery and explicit package selection.
- Daily download analytics with 7/30/90-day windows, preceding-period growth, and honest partial coverage.
- Manual npm, Marketplace, Open VSX and optional authenticated Reddit count tracking.
- Local persistence, theme-aware accessible dashboard, cache/stale handling, bounded requests and rate-limit cooldown.
