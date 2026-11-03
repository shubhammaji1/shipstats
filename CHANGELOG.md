# Changelog

## 1.0.0

- Add optional persistent release notes (up to 500 characters), with safe display and inclusion in reports and cards; preserve existing metadata and tracking.
- Add Early review: compare only completed UTC days since release with the same number of days before it. Keep incomplete data unavailable and label unfinished planned windows PRELIMINARY in reports and exports.
- Show completed-day progress and full-review availability dates before submission. Explain first-day waiting and disable reviews that cannot yet run.
- Add per-package npm daily Before/After charts with a shared scale, missing-data gaps and accessible exact-value tables.
- Preview the selected share card in the dashboard using the same SVG as export; reject stale preview responses after inputs, metric or source data change.
- Retain history/CSV, product groups, custom comparisons, milestones/local alerts, direct deletion, and PNG/SVG/Markdown export.


## 0.6.5

- Redesign SVG/PNG share cards with a navy/mint gradient, larger product and metric typography, highlighted After panel, period dates, a dedicated change strip and a readable coverage footer.
- Show signed growth/decline values, explain zero or missing percentage baselines, fit large values and long labels, and retain complete values in an accessible SVG description. Remove the outdated hardcoded version from the card footer.
- Keep previews out of the extension package; preserve local PNG/SVG exports without new extension dependencies.

## 0.6.4

- Show launch-review validation failures in the report area beside the action, including the end date of incomplete after-launch windows. Match errors to their inputs and clear them on retries, refreshes and metadata changes.
- Show immediate review progress, prevent duplicate submissions while pending and keep exports disabled until a report is available.

## 0.6.3

- Add Delete release marker beside every entry in Saved release markers. Use stable IDs, disable removal while busy, and update the editor and Launch Review selection after deletion.

## 0.6.2

- Add a Delete rule button beside every saved monitoring rule, using its stable ID. Disable deletion during busy updates and clear the editor when its selected rule is removed. Existing alerts remain available.

## 0.6.1

- Explain an empty Launch Review release-marker list and provide an Add release marker shortcut to Insights, prefilled for the selected product. Return to Launch Review with the newly saved marker selected, including backdated releases.
- Disable the marker selector and review action when no markers exist; guard empty submissions and explain the product prerequisite.

## 0.6.0

- Add Launch Review with equal 7-, 14-, 30- or 60-day before/after windows around a saved release marker, explicit coverage and no causal claims.
- Export full Markdown reports and single-metric 1200 x 630 SVG/PNG share cards through native Save dialogs. Validate PNG dimensions, checksums and bounded pixel data before writing.
- Add persistent per-product milestones and percentage increase/decrease rules, with fresh-fetch evaluation, positive baselines, one-hour change-alert cooldowns and one-shot milestone state.
- Add a local alert inbox, unread badge, acknowledgement and rule editing/deletion. Retain up to 100 alerts for 90 days and 50 rules.
- Preserve pending alert evaluations on storage failures and retry them on a cached refresh without duplicate alerts. Prune monitoring on untracking/account changes; clear Reddit monitoring when credentials are cleared.
- Preserve 0.4 history/CSV and 0.5 group/marker/custom-comparison behavior. Reject count-comparison differences outside the safe integer range.

## 0.5.0

- Add an Insights page with persistent product groups and editable membership across npm, Marketplace, Open VSX and Reddit.
- Scope Overview cards, npm totals and combined activity to a selected group; keep different source metrics separate.
- Add manually entered release markers with UTC dates, editable labels, chart lines and accessible text legends on npm charts.
- Compare two custom ranges of completed UTC days for all products, a group or an individual product.
- Require complete npm daily coverage for totals; use actual first/last saved observations for other source count changes and show their timestamps.
- Warn about overlapping/unequal ranges, preserve missing values and invalidate comparison results after data or metadata changes.
- Bound and validate saved metadata; prune removed products from groups and release markers while preserving 0.4 history and CSV behavior.

## 0.4.0

- Save compact observations locally across restarts: up to 100 per tracked product for 90 days, with no gap filling or backdating.
- Show count changes and npm rolling-window changes since the previous successful fetch, including decreases and unavailable baselines.
- Distinguish fresh, cached, incomplete, outdated, failed and stale source readings, with source-attempt timestamps.
- Export saved observations for all tracked products as UTF-8 CSV through a native Save dialog, with metric semantics and spreadsheet-safe text.
- Exclude cache hits and failed requests from history; retry failed persistence without losing the fetched observation.
- Remove affected observations when untracking products, switching npm identity or clearing Reddit credentials. Preserve existing tracking when upgrading from 0.3.x under the same publisher.

## 0.3.1

- Fix the README logo on Marketplace and Open VSX by using an absolute HTTPS image URL.
- Enable standard relative-link rewriting during VSIX packaging.
- Keep the release icon under the 100 KB project budget.

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
