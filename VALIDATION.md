# ShipStats 1.0.0 verification

Verified locally on 3 November 2026.

- TypeScript compilation, JavaScript syntax, icon/README asset checks and all 76 offline tests pass. Existing tracking/history/group/monitoring/export tests remain included.
- New tests cover optional release-note persistence and legacy metadata, bounded/invalid notes, early reviews at UTC boundaries, equal before/after lengths, first-day waiting, preliminary versus completed status, zero and missing daily values, source failures and preliminary labels in Markdown/SVG.
- Controller and DOM tests cover readiness dates, mode changes, safe notes, gapped chart segments with exact-value tables, matched previews, metric/input changes rejecting stale previews, identical preview/export SVG and notes restored after restart.
- A real headless Chrome run loaded production dashboard assets with a simulated VS Code bridge and deterministic source data at 1280 px and 375 px widths. Readiness, early review, charts and the share-card preview rendered without page errors or document-level horizontal overflow. Desktop/mobile screenshots were visually inspected.
- The real browser converted the generated SVG through the dashboard's image/canvas path. The resulting PNG passed the production byte/checksum/dimension/pixel validator at 1200 x 630. This is browser verification with fixture data, not a live source API or actual VS Code webview run.
- The isolated desktop Extension Host check could not launch successfully: automatic executable detection failed; using the installed Code.exe explicitly exited 2147483651 without a smoke report. Actual desktop activation, save dialogs and installed-extension verification remain incomplete. No macOS, Linux or live API pass is claimed.

Before public registry publication, install the 1.0.0 VSIX in normal desktop VS Code, confirm existing data remains, save/edit release notes, test completed and early reviews, inspect the chart/preview, and export PNG/SVG/Markdown through native Save dialogs. This build changes the manifest version and creates the installer; it does not itself publish to Marketplace or Open VSX.

## Historical 0.6.5 verification

Verified locally on 2 November 2026. TypeScript compilation and all 72 offline tests pass. After the final rounded-background clip adjustment, all eight launch tests pass again. Card tests cover signed growth/decline, zero baselines, unavailable data, very large safe integers, long labels, XML validity and escaped accessible descriptions.

Rendered and visually inspected five 1200 x 630 SVG cards using the locally installed Sharp renderer: the user's 369/0 example, positive growth, decline, maximum safe integer/long labels and missing data. Numbers, labels, dates, coverage and footer fit the inspected samples. This verifies standalone SVG rasterization; the VS Code browser-canvas PNG path and desktop Extension Host still have the limitations documented below. Preview files and rendering dependencies are not included in the VSIX.

## Historical 0.6.4 verification

Verified locally on 2 November 2026. TypeScript compilation, dashboard syntax and all 71 offline tests pass. New coverage checks that incomplete-window errors travel from the controller to the report area, display beside the action, match the current inputs, clear after a successful retry or refresh, and show immediate progress while preventing duplicate submissions. The existing success-path DOM test now waits for the simulated host response before checking the report. Desktop visual verification remains incomplete.

## Historical 0.6.3 verification

Verified locally on 2 November 2026. TypeScript compilation, dashboard syntax and all 69 offline tests pass. New DOM coverage verifies direct saved-marker deletion by stable ID, safe labels, busy-state disabling, preservation of other markers, editor reset, Launch Review selection updates and the last-marker empty state. Marker rows wrap their actions for narrow layouts. Desktop visual verification remains incomplete.

## Historical 0.6.2 verification

Verified locally on 2 November 2026. TypeScript compilation, dashboard syntax and all 68 offline tests pass. The new DOM regression verifies direct deletion sends the selected rule's stable ID, busy updates disable deletion, a successful host update removes only that rule and resets its editor, and deleting the last rule shows the empty state. Desktop visual verification remains incomplete.

## Historical 0.6.1 verification

Verified locally on 2 November 2026. TypeScript compilation, dashboard syntax checks and all 67 offline tests pass. The new DOM regression covers no products, no markers, blocked empty submissions, the Insights shortcut with the selected product, save failure/busy states, return to the newly saved backdated marker and removal of all markers. Desktop visual verification remains incomplete as described below.

## Historical 0.6.0 verification

Verified locally on 2 November 2026.

- TypeScript compilation and JavaScript syntax checks pass. All 66 offline tests pass, including 0.4 and 0.5 regression coverage.
- Launch tests verify equal before/after UTC windows, release-day inclusion, completed-window requirements, target membership, invalid window rejection, data coverage and no causal attribution.
- Monitoring tests cover one-shot milestones across restarts, fresh-versus-cached/failed samples, positive percent baselines, directional changes, one-hour cooldowns, editing/rearming, source-specific metrics, disabled rules, unique rule names and bounded retention.
- Controller/webview integration tests verify alert persistence/restart/acknowledgement, untracking and Reddit cleanup, failed monitoring writes and cached retry without duplicates, Markdown/SVG exports, PNG request matching, exact exported PNG bytes, cancellation, write errors and rejection of malformed/replayed/stale PNG requests.
- DOM tests cover Launch Review inputs, coverage, changed-input export disabling, monitoring edits, unread badges, safe alert labels, PNG-conversion failure handling and the 1200 x 630 canvas messaging path using mocked browser image/canvas services. The PNG byte validator uses valid deterministic test PNGs; these fixtures are not visual share-card renderings.
- PNG validation checks byte bounds, dimensions, header fields, checksums, complete chunks, decompressed pixel length and row filter bytes. SVG/Markdown text escaping, missing values and metric separation are tested.
- Real Chromium headless rendering was attempted at desktop and mobile widths using the production dashboard assets and a simulated VS Code bridge. Both browser processes exited with code 2147483651 before rendering, so no visual, overflow or real PNG rasterization pass is claimed.
- Actual desktop Extension Host verification remains incomplete from the earlier attempt. No live API, Reddit-token, macOS or Linux run is claimed for this release.

Before publishing, install the 0.6.0 VSIX in normal desktop VS Code. Open Launch Review, choose an older saved release with a completed window, review data coverage and export Markdown, SVG and PNG. Check the PNG visually and confirm its 1200 x 630 dimensions. If browser canvas rendering is unavailable, verify SVG export. Create a small milestone, wait for a genuine fresh fetch (cache TTL applies), verify its inbox alert, restart and confirm it does not repeat. Test a percent rule, acknowledgements, cancellation and your preferred theme/narrow window.

Reports are timestamped point-in-time comparisons. Alerts are local inbox entries, not OS/email/push delivery. Nothing runs while VS Code is closed, and no public posting happens automatically.

## Historical 0.5.0 verification

Verified locally on 2 November 2026.

- TypeScript compilation passes; all 50 offline tests pass, including 0.4 regression coverage.
- Insights unit tests cover group create/edit/delete, overlapping membership, unique names, limits and validation; marker create/edit/delete, date validation, persistent IDs, bounds and removal of obsolete product references.
- Comparison tests cover inclusive UTC ranges, real zeroes, partial/failed/expired npm data, strict group totals, individual targets, observed count decreases, first/last timestamps, missing baselines, invalid/future dates and warnings for overlapping or unequal ranges.
- Controller-to-dashboard integration tests use the actual host controller and dashboard script with mocked VS Code services and providers. They cover editor submissions, saved metadata after restart, group-scoped totals, chart markers, native-history-export regressions, comparison invalidation, untracking cleanup and failed metadata writes.
- Dashboard tests verify manual release-marker scope, finite SVG positions, safe text insertion of labels, persistent group-filter preference, preservation of form drafts, disabled busy controls, stable IDs during edits, comparison requests, missing values and hiding results after form edits.
- No new provider API or runtime dependency was added. Metadata remains local to the existing extension identity.
- Desktop Extension Host and full visual browser verification have not been completed for 0.5. The previous 0.4 host attempt exited before producing a report; that unresolved environment limitation is retained below. No live provider or macOS/Linux run is claimed.

Before publishing: install the 0.5.0 VSIX, open Insights, create a group, select it on Overview, add a release marker dated inside an npm chart window, compare two ranges, restart and verify metadata persistence. Check a narrow window, keyboard navigation and your preferred theme. Test a missing-data range and verify that CSV export still contains all saved observations.

0.6 Launch Review, milestones, alerts and share cards remain planned.

## Historical 0.4.0 verification

Verified locally on 2 November 2026.

- TypeScript compilation and JavaScript syntax checks pass. All 38 offline tests pass.
- New history tests cover serialization/restart recovery, zeroes and decreasing counts, bounded retention, malformed saved data, duplicate/cache exclusion, provider failures and incomplete npm windows.
- Controller-to-webview integration tests cover persisted snapshots after restarting with an unavailable source, account-switch cleanup, untracking cleanup, native-save-dialog cancellation, selected export destinations, export write errors, failed persistence and recovery on a cached retry.
- Dashboard tests cover saved observation tables, negative changes, rolling-window labels and period changes, missing baselines, source health, filter-independent export and empty-history button state.
- CSV includes UTF-8 BOM, CRLF records, UTC observation timestamps and metric meanings. Text cells are quoted and formula-like text is escaped. Tests cover quotes, delimiters and scoped names. Missing numbers remain blank.
- VSIX packaging passes; the release keeps publisher shubhammaji1, the absolute HTTPS README logo and the 75,598-byte icon. The compact history module is included in dist/src. Tests, source and development dependencies are excluded.
- Actual desktop host verification was attempted but did not complete. Automatic executable discovery failed in this environment; launching the known installed Code.exe explicitly then exited with code 2147483651 before producing a smoke report. This is not a passing host test, and its cause has not been established.
- No new live-provider or full real VS Code UI check is claimed. Reddit still requires separately approved API access. Windows local checks do not establish macOS/Linux CI results.

Before publishing, install the 0.4.0 VSIX, refresh a public product, open Saved observations, restart VS Code, and confirm the saved row remains. After the cache expires, refresh again and inspect the change. Try Export CSV, cancellation, and opening the resulting CSV. Verify source failures keep saved history visible, and inspect a narrow window and your preferred theme. Run npm run test:host from a normal desktop terminal if available.

0.5 and 0.6 are documented future stages, not shipped features.

## Historical 0.3.0 verification

Publisher correction: the release manifest now uses `shubhammaji1.shipstats-analytics`. The desktop host result below was recorded for the earlier local identity; the host smoke test now resolves the current identity from package.json. Saved extension storage does not automatically migrate from `shipstats-local`.

Verified 30 October 2026 after the three-page dashboard redesign. Extension identity and Signal Beacon branding are retained, along with the username-switch reset fix.

- TypeScript compile and all 27 offline tests pass.
- Regression tests exercise the actual extension controller and dashboard script together through their message bridge, with mocked VS Code services and network providers. This is an integration test with a JSDOM-rendered interface, not an automated real VS Code UI test.
- Username A → B: old npm products, totals, readings, candidates, selections and filters disappear before B's pending request completes. Selecting B persists only B's npm tracking.
- Empty and failed new-account searches leave prior npm data cleared. Invalid identity input preserves valid tracking. Re-searching the same normalized identity and restarting preserve its selections. Switching username to scope resets npm tracking, while other tracked sources remain.
- New UI tests cover navigation, saved page/period preferences, product search, source filtering without changing totals, preserving package choices between pages, successful versus failed selection routing, and direct source-specific adding with source validation.
- Actual desktop VS Code 1.144.0 isolated host smoke passes on 0.3.0: activation, six commands, dashboard creation, empty refresh and token clearing.
- Chromium checks pass using the production dashboard assets and a simulated VS Code message bridge populated with real npm/Open VSX readings and real npm search results. Checked all three pages at 1280, 1024, 768, 375 and 320px: no horizontal overflow. Checked 7/30/90 controls, source/text filters, discovered-package filtering, keyboard navigation, logo decoding, direct source add and Reddit token action messages, and absence of JavaScript errors. Dark, light and forced-colors captures were generated for visual inspection.
- These browser checks and bridge integration tests are not a full automated real VS Code UI test; actual host activation and panel creation are verified separately by the smoke test above.
- Selected Signal Beacon logo is a 1254×1254 PNG with transparent corners and no embedded lettering. It is used by the extension manifest, dashboard and README; a matching monochrome beacon SVG serves the activity bar.
- Reddit remains optional and unverified against a live token. This update retains the same ShipStats extension identity and existing saved state for the active account.

Run `npm test`, `npm run test:host` and `npm run package` from this project to reproduce the code and packaging checks. Logo prompts and generation method are recorded in BRANDING.md. Logos are static images in a voxel/pixel-art style.
