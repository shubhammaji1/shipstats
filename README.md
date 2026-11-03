# ShipStats

[![CI](https://github.com/shubhammaji1/shipstats/actions/workflows/ci.yml/badge.svg)](https://github.com/shubhammaji1/shipstats/actions/workflows/ci.yml)

<img src="https://raw.githubusercontent.com/shubhammaji1/shipstats/main/media/shipstats-icon.png" alt="ShipStats Signal Beacon logo: voxel beacon with connected data nodes" width="160">

A VS Code extension for the things you ship. Discover public npm packages, select which to track, and see actual daily download counts with 7-, 30-, and 90-day comparisons. Add Marketplace, Open VSX, and optional Reddit counts alongside them. Group related products, annotate releases, and compare custom date ranges from the Insights page.

**npm is the MVP's focus.** Other sources show their own cumulative or current metrics, never made-up historical downloads. There is no hosted service, account signup, telemetry, or runtime dependency.

## Install and use

Requires desktop VS Code **1.99+**, or a compatible current desktop build. This is a Node extension; vscode.dev/web is not supported.

1. Install the included `shipstats-analytics-1.0.0.vsix` from **Extensions → … → Install from VSIX**. Reload if prompted.
2. Click the ShipStats activity icon or run **ShipStats: Open Dashboard** from the Command Palette.
3. Open **Packages**, enter an **npm username** or **npm scope**, and click **Find packages**. Filter results, check packages, and click **Track selected packages** to open Overview. Within the same account, clearing the discovered selection and saving stops tracking those candidates; other manually tracked packages remain. **Changing the username or scope clears all previous npm tracking, download readings and picker filters before the new search starts.** Marketplace, Open VSX and Reddit tracking remains.
4. In **Overview**, use **7 / 30 / 90 days** to change the npm window. Explore the combined daily chart, search products, or filter cards by source. Expand **Daily values** for exact source counts; **View source** opens the original product page. Text/source filters affect the cards; overview totals cover complete npm data within the selected product group (or all products).
5. Use **Add product** for any source, or go to **Integrations** for direct Marketplace, Open VSX and Reddit add actions and Reddit access setup. **Add a package manually** on Packages opens the npm input directly. Use × on a product card to stop tracking it.

The Marketplace extension identity is `shubhammaji1.shipstats-analytics`. If you installed a local build published as `shipstats-local.shipstats-analytics` or the earlier prototype, disable it before installing this build, then re-enter your tracked products and Reddit token. VS Code isolates extension storage by identity; automatic migration from the local build is not included. Existing ShipStats settings may remain available.

Future upgrades under `shubhammaji1.shipstats-analytics` retain that extension's saved state.

## Dashboard layout

- **Overview**: group-scoped npm totals, coverage counts, source health, combined daily activity with release markers, and searchable product cards.
- **Packages**: a guided find → choose → track workflow, scrollable package list, explicit selection counts, and manual npm entry. Discovery details are available under **About package discovery**.
- **Integrations**: clear source-specific metric descriptions, direct add actions and optional Reddit setup. Tokens stay out of the dashboard.
- **Insights**: manage product groups and release markers, and compare two custom UTC date ranges with coverage details.
- **Launch Review**: review a release, export a report or share card, and manage milestones and the local alert inbox.

New users start on Packages. Returning users with tracked products start on Overview unless a previous page is remembered. The active page and analytics period survive webview recreation. Successful tracking and manual additions reveal Overview. Keyboard focus, light/dark themes, high contrast, reduced motion, and editor widths down to 320px are supported.

On a new dashboard opening, a saved scope or username is searched automatically. Scope takes precedence when both are configured. Existing tracked analytics load first; discovery never silently tracks packages. Selections persist across sessions in VS Code's local global state, separate from your workspace, with a 50-product limit. They are not configured for Settings Sync.

## What the numbers mean

| Source | Metric | History |
| --- | --- | --- |
| npm | Package downloads across versions, as reported by npm | Daily counts; 7/30/90-day totals and preceding-window comparison |
| VS Code Marketplace | Public `install` statistic, labeled installs | Local observations of cumulative source counts |
| Open VSX | Public `downloadCount` | Local observations of cumulative source counts |
| Reddit | Post `num_comments` | Local observations of current counts; no comment bodies |

The npm overview sums only successful, complete, non-stale npm windows. It reports coverage and marks partial totals. Other sources are deliberately excluded from the npm aggregate. Counts do not represent unique people, revenue, active users, or necessarily human downloads. npm lifetime totals are not claimed.

### npm discovery and ownership caveats

- **Username discovery uses `maintainer:username` public registry search**, then filters against returned maintainer metadata. It finds current public maintainer matches, not necessarily everything you originally published. An author, last publisher, collaborator, organization member, and owner are different concepts.
- **Scope discovery first uses `scope:namespace`** and verifies the exact `@namespace/` prefix. Some registry deployments return no results for that documented qualifier; ShipStats then falls back to general `@namespace/` search with the same exact prefix filter and an explicit warning that results may be incomplete. General search includes unrelated packages before filtering and can hit the cap. Namespace matches do not establish that you own or administer those packages. No npm authentication or ownership verification is performed.
- Public registry search can be delayed, incomplete, or change while paginating. ShipStats requests 250 records per page, up to 1,000 results, and displays a cap notice when applicable. Private packages, unpublished packages, and unindexed packages may be absent. Add any known package name manually; public download data may still be unavailable.
- Choosing packages is explicit. Within the same username/scope, saving a discovery selection replaces tracking only for the currently discovered candidates. Switching to a different username or scope starts a fresh npm dashboard: previous npm selections and cached readings are removed, including manually added npm packages. This reset also applies when the new account has no matches or its search fails. Invalid input does not clear tracking. Re-searching the same normalized identity (ignoring case, surrounding spaces, and the optional scope `@`) preserves tracking. Scope and username searches are different identities. The active identity and tracking persist across restarts.

### Windows, gaps, and freshness

One npm range request retrieves the previous **180 calendar days**, ending **yesterday in UTC**. This supports the current 90-day window and the preceding 90-day comparison. The current UTC day is excluded. Growth is `(current - previous) / previous × 100`; a zero preceding total produces no percentage. Missing days produce **Unavailable**, not zero. Real source-provided zeroes remain zero. Charts show gaps, and the daily table contains only returned rows.

npm may not have finished publishing yesterday's data. ShipStats preserves the requested dates and exposes missing coverage instead of silently shifting the window. An API that returns a zero for a provisional day cannot be distinguished from a final zero. Source counts can be delayed or revised.

Successful readings are held in memory for **10 minutes** and display their fetch timestamp. Refresh reuses fresh cached readings, so it does not force a network request on every click. Errors are not cached; a last successful reading remains explicitly marked stale and is excluded from aggregate totals. Compact successful observations now persist locally across restarts. Full npm daily series and the live request cache remain in memory; after restarting, saved observations remain accessible even if a source is unavailable. HTTP requests have a 15-second timeout and a 5 MB response limit. At most four product reads run concurrently. HTTP 429 responses establish a host cooldown honoring Retry-After (minimum 60 seconds, capped at 24 hours), with no automatic retries. Refresh is manual by default.

## Reliable history (0.4)

Each product card has **Saved observations** and a change since its previous successful source fetch. Observations survive VS Code restarts. ShipStats keeps the latest **100 observations per tracked product within 90 days**, with no interpolation or backfilling. Nothing is collected while VS Code is closed. Manual commands can refresh while VS Code is running; scheduled refreshes require an open, visible dashboard. Cached refreshes add no observations.

Marketplace, Open VSX and Reddit changes are differences between observed counts, which may decrease. npm snapshots contain the 7-, 30- and 90-day rolling totals and their data-end date; a rolling-total change is **not new downloads**. Missing windows remain unavailable. Compact snapshots contain no Reddit token, post title, comment bodies or repeated daily series.

Source health reflects the latest dashboard state: **Fresh**, **Cached**, **Incomplete coverage**, **Refresh needed**, **Source unavailable**, or **Source failed - previous reading**. Each reading shows its fetch time and latest source-attempt time. Failed readings are excluded from totals. Failed requests do not become observations. If saving fails, ShipStats reports it and retries the pending observation on the next refresh.

Use **Export CSV** or **ShipStats: Export History as CSV** to choose a destination in the native Save dialog. Export includes observations for **all tracked products**, regardless of visible filters, with UTC timestamps, metric names, values and changes; npm exports one row per period. Missing data stays blank. Formula-like text is escaped for spreadsheet safety. Cancelling does not write a file.

Removing a product deletes its observations. Changing npm identity deletes previous npm history; other sources remain. Clearing the Reddit token also clears Reddit history. Export first if you want to retain a copy.

## Product insights (0.5)

Open **Insights** to create or edit a product group. Give it a unique name and choose from your currently tracked products. A product can belong to several groups; empty groups are allowed. Up to **20 groups** are saved locally across restarts. Select a group in **Overview** to scope the npm total, activity chart and cards. Text/source filters affect cards within that scope. Deleting a group leaves tracked products and release markers intact. Removing a tracked item or switching npm identity prunes affected group memberships and product-specific markers.

In **Release markers**, choose a product, enter its release label and UTC date, and save. Use the editor selectors to rename groups, change members, edit a marker or delete it. Up to **200 markers** are retained locally. Markers are manual annotations, not automatic registry release discovery. Relevant markers appear as vertical lines on combined and individual npm charts, with text legends for accessibility. Dates outside a chart range remain in the saved marker list; today's marker is not plotted until the chart includes that completed UTC day. Other source metrics have no daily chart. Timing does not establish that a release caused a download change.

For **Custom comparisons**, choose all tracked products, one group, or one product, then specify inclusive ranges A and B using completed UTC dates within the last **180 days**. Refresh source data first. The result shows A, B, **A minus B**, percent change and coverage. Different-length ranges are not normalized; overlapping and unequal ranges have explicit warnings. Zero or negative baselines have no percentage.

- **npm:** sum actual daily downloads over each range. Missing days, failed sources or expired readings produce **Unavailable**, never zero. A group npm total requires every selected npm package to have complete data. Marketplace/Open VSX/Reddit counts never enter that total.
- **Other sources:** compare the count change between the first and last saved observations inside each range, with both observed timestamps shown. At least two observations per range are required. These are not exact boundary-to-boundary daily totals; gaps are not estimated, and 0.4 history retention (up to 90 days/100 observations per product) applies.

Groups and markers persist. Comparison results are temporary and show their computation timestamp; refreshing data, changing tracked products, or successfully saving/deleting metadata clears them. Editing the form hides an old result until you compare again. CSV export continues to export **all saved observations**, independently of group/text/source filters; it does not export group metadata or comparison reports.

## Launch Review (1.0)

Release markers are saved manually, not imported automatically. If the list is empty, click **Add release marker**, enter the product, UTC release date and label in Insights, and save. Launch Review reopens with the new marker selected. You can also manage markers directly in **Insights → Release markers**. Under **Saved release markers**, click **Delete release marker** beside an entry to remove it.

In **Launch Review**, choose a release marker, its product (or a group containing it), and a planned **7-, 14-, 30- or 60-day** window. Readiness shows **completed days** and the date the full review becomes available before you click. The release day belongs to After. Dates and windows use UTC.

- **Completed window** compares the full selected number of days before and after release. Both windows must have finished by yesterday UTC.
- **Early review** uses the smaller of the planned window and the completed UTC days since release. Before uses exactly the same number of days. For example, three completed days after a release compare with three days before it. No review is available on the release day itself; the first completed day becomes available at the next UTC midnight.
- While fewer than the planned days have completed, the report, Markdown export, preview and share card are labelled **PRELIMINARY**. Once the full window finishes, early mode uses the full planned window and the preliminary label clears when you review again.
- **Release notes** are optional (up to 500 characters) in Insights. Record what shipped or what you intended to improve. Notes persist with existing markers and appear in the report and exports. Existing saved markers continue to work.
- **Daily comparison charts** show each npm package's Before and After side by side on the same vertical scale. Gaps stay empty, zero remains zero, and an expandable daily table provides exact dates and counts. Other sources keep observed count changes separate; daily activity is not invented.

Comparisons use completed days within the last 180 days. Missing daily coverage makes the corresponding total unavailable; early review does not fill gaps. A release's date or note does not establish that it caused a change.


Use **Export report (Markdown)** for the full comparison, coverage and observed endpoint timestamps. **Export card (SVG)** or **Export card (PNG)** creates a **1200 x 630** card for one selected metric: combined npm downloads only, or one product's source metric. Cards include ranges, computation time and caveats; long labels may be shortened on the card while the full report retains them. Reports are temporary and are cleared when source data or group/release metadata changes. Files are saved only where you choose. Nothing is posted publicly or sent to anyone.

The **share-card preview** appears inside Launch Review after a report is generated. Changing the share metric updates it; changing review inputs or refreshing clears stale previews. The preview uses the same SVG generator as the exports.

Share cards use a navy/mint layout with prominent After and Before values, signed changes, a percentage-baseline explanation, and a compact coverage footer. Full values and labels remain in the SVG's accessible description and the Markdown report.

PNG conversion uses the webview's browser canvas. If it is unavailable, use the standalone SVG export. PNG exports are checked for dimensions, bounded size, chunk checksums and valid pixel data before saving. A failed or cancelled export does not report success. The user-facing SVG is generated locally from escaped text and exact data; no AI-generated data or remote imagery is used.

### Milestones and monitoring

Create a uniquely named rule for a tracked product. npm rules use a **7-, 30- or 90-day rolling total**; other sources use their own count. Milestones require a positive integer target. Percentage increase/decrease thresholds must be above zero and at most 10,000 percent. At most **50 rules** are stored locally.

- **Milestones** trigger once when a fresh reading reaches the target, including a target already exceeded at creation on the next fresh reading. They remain reached across restarts until edited/rearmed.
- **Change alerts** compare against the previous valid source reading and require a positive baseline. Each rule has a **one-hour cooldown**. Baselines still advance during cooldown. A change in a rolling npm total is not the number of newly acquired downloads; observed count changes are not unique users.
- **Evaluation** happens on successful fresh source fetches while VS Code is running. Cached, failed and missing-window readings do not trigger alerts. The **10-minute source cache** applies, so repeatedly clicking Refresh does not force evaluation. There is no collection or alert delivery while VS Code is closed. After a long gap, changes span the displayed observation timestamps, not an assumed polling interval.
- **Editing/saving a rule** resets its baseline and rearms a milestone. Disabled rules do not evaluate. Deleting a rule stops monitoring; its historical alerts remain until retention removes them or the product is untracked.
- **Deleting a rule**: click **Delete rule** beside the saved rule, or select it in **Edit monitoring rule** and click **Delete monitoring rule**. Existing alert history remains after deletion.

- **Alerts** appear only in the Launch Review inbox and unread badge. Mark individual alerts or all visible alerts read. Up to **100 alerts within 90 days** persist across restarts. There are no OS toasts, push notifications or emails. If persistence fails, the error is shown and pending evaluations are retried on the next refresh.

Removing a product or switching npm identity prunes the affected rules and alerts. Clearing Reddit credentials also clears Reddit monitoring and history. Existing 0.4/0.5 tracking, groups and markers remain under the same extension identity; no new account or runtime dependency is required.

## Settings

Open Settings and search **ShipStats**. These are application settings, not repository-controlled settings.

| Setting | Default | Meaning |
| --- | --- | --- |
| `shipstats.npmUsername` | empty | Public maintainer search username |
| `shipstats.npmScope` | empty | Namespace with or without `@`; overrides username on opening |
| `shipstats.refreshMinutes` | `0` | Manual refresh; positive values use at least 5 minutes and at most 1,440. Timer runs only while a dashboard exists and refreshes only when visible. Cache TTL still applies. |
| `shipstats.redditUserAgent` | empty | Descriptive Reddit app/version and contact username, e.g. `desktop:your-app:0.1 (by /u/your_username)` |

Commands: **Open Dashboard**, **Discover npm Packages**, **Add Product**, **Refresh Analytics**, **Export History as CSV**, **Set Reddit Access Token**, **Clear Reddit Access Token**, all under the ShipStats prefix.

## Optional Reddit monitoring

Reddit access is **not guaranteed**. This integration is for users who already have approved Reddit Data API access and a valid OAuth access token with appropriate read permissions. Approval, terms, access restrictions, and app eligibility remain Reddit's decision.

1. Review Reddit's current access policy and obtain approved API access through Reddit's official process.
2. Set `shipstats.redditUserAgent` to your descriptive registered app/version and Reddit contact.
3. Run **ShipStats: Set Reddit Access Token**. Paste the access token only, without `Bearer`. It is stored in VS Code **SecretStorage**, never in settings, the webview, or logs.
4. Add a Reddit post. Refresh manually or enable the dashboard refresh interval.

ShipStats calls only `https://oauth.reddit.com/api/info?id=t3_POSTID` with the token. It reads the current comment count and title. It does **not** implement an OAuth login/refresh flow, create API credentials, fetch comment bodies, identify new comments, send new-comment notifications, scrape HTML, or fall back to unauthenticated `.json` endpoints. Tokens can expire or be revoked: a 401/403 requires checking approval or replacing the token. Private/deleted/restricted posts may remain unavailable. **Clear Reddit Access Token** removes the saved secret and cached Reddit readings, saved Reddit observations and Reddit monitoring rules/alerts. Scheduled monitoring requires a visible dashboard. Manual refresh commands can run while VS Code is running; this is not an always-running notification service.

## Privacy and security

- No analytics collection by ShipStats. No backend. Tracked identifiers and discovery settings stay in your VS Code profile; requested usernames, package names, extension IDs, and post IDs are sent to the corresponding source services.
- Requests go to fixed npm, Marketplace, Open VSX, and Reddit API hosts. Only Reddit requests carry the Reddit token. Redirects are rejected. Public statistics need no login.
- The dashboard has a restrictive Content Security Policy, local scripts/styles, no remote assets, and text-only insertion of API content. Source links are constructed from validated saved identifiers. The webview never receives secrets. Generated local SVG data URLs are used only for share-card PNG conversion; no external images or fonts are loaded. Messages are validated again in the extension host.
- Workspace files are not read. The extension runs locally in remote-development windows (`extensionKind: ui`), so network access comes from the local machine. Native Node fetch is used and does not automatically honor VS Code's `http.proxy`; corporate environments may require system/network configuration.

## Develop and test

Install Node.js **22+** and open this folder in VS Code:

```sh
npm ci
npm test
```

Press **F5** to launch an Extension Development Host, then run **ShipStats: Open Dashboard**. `npm run watch` recompiles during development. Tests are deterministic and offline: they cover UTC boundaries and growth, partial data, identifier validation, provider contracts, public search pagination/filtering, HTTP failures and rate limits, cache/stale behavior, bounded concurrency, and DOM interactions with a mock VS Code bridge. Fixture counts are used only by tests; the shipped dashboard contains no demo metrics.

Optional real-network smoke check:

```sh
npm run test:live
```

This queries the public `@vscode` namespace, real `@vscode/vsce` download data, and `redhat.vscode-yaml` on both registries. It does not require or test a Reddit token. Network restrictions and provider changes can cause failures; offline tests do not guarantee live availability.

To check actual extension activation and dashboard creation in a separate desktop VS Code profile, run `npm run test:host`. This briefly launches a test window and checks activation, command registration, opening the dashboard, an empty refresh, and secret clearing. It does not alter your regular profile. Set `VSCODE_EXECUTABLE` to the desktop VS Code executable if it cannot be found. Temporary test profiles are retained in your OS temp directory for diagnosis. This smoke check does not replace the populated-dashboard manual checks below.

Manual host checks before publishing:

- Fresh profile: open dashboard, discover your username/scope, filter/check/select, restart and verify selections.
- Add an unscoped and scoped npm package; inspect every period and daily table; remove a product.
- Confirm an invalid/nonexistent ID produces an error card while valid products remain usable.
- Verify both extension registries, light/dark/high-contrast themes, a narrow editor, keyboard focus, and screen-reader labels.
- If you have approved Reddit access, test token set/clear/expiry and a permitted post; otherwise expect the access-required card.

## Package and publish

GitHub Actions runs on every push and pull request, and can also be started manually from the **Actions → CI** page. Each Windows, Linux and macOS job uses Node.js 22, installs locked dependencies with `npm ci`, checks JavaScript syntax, compiles TypeScript, runs the offline tests and builds a VSIX. Successful jobs upload an installable VSIX artifact retained for 14 days. A failed check fails its job; other operating systems continue so their results remain visible.

Live API and desktop VS Code smoke checks remain separate commands because they require network/provider access or a desktop VS Code installation. CI does not publish the extension. Push the workflow to GitHub to see its first run; local test results are not GitHub check results.

```sh
npm ci
npm test
npm run package
```

The generated **`shipstats-analytics-1.0.0.vsix`** is installable locally. Production files are compiled JavaScript and local dashboard assets; development dependencies and tests are excluded. A lockfile pins the dependency tree. To distribute source, run `npm ci` before building. The README logo uses an absolute HTTPS URL so GitHub, Marketplace and Open VSX can load the same image. Packaging also enables standard relative-link rewriting. Push image changes to the public repository before uploading a new release.

The manifest publisher is `shubhammaji1`; upload the VSIX under that exact Marketplace publisher ID. Before publishing, verify the configured repository/bugs/homepage URLs, review branding and provider terms, and follow Microsoft's official publishing guide. For Open VSX, use the matching namespace and follow its publishing process. ShipStats does not publish anything automatically.

## Source contracts and limitations

- [npm registry search API and qualifiers](https://github.com/npm/registry/blob/main/docs/REGISTRY-API.md)
- [npm official download counts API](https://github.com/npm/registry/blob/main/docs/download-counts.md)
- [VS Code gallery implementation](https://github.com/microsoft/vscode/blob/main/src/vs/platform/extensionManagement/common/extensionGalleryService.ts) — the public gallery query endpoint is a best-effort integration, not a guaranteed analytics API; access and response formats may change.
- [Open VSX extension schema](https://github.com/eclipse/openvsx/blob/master/server/src/main/java/org/eclipse/openvsx/json/ExtensionJson.java)
- [Reddit API access](https://support.reddithelp.com/hc/en-us/articles/14945211791892-Developer-Platform-Accessing-Reddit-Data), [Data API wiki](https://support.reddithelp.com/hc/en-us/articles/16160319875092-Reddit-Data-API-Wiki)
- [VS Code publishing guide](https://code.visualstudio.com/api/working-with-extensions/publishing-extension)

MIT licensed. ShipStats does not include account authentication except manual Reddit access tokens, private npm registries, lifetime npm totals, provider-supplied historical extension downloads, collection while VS Code is closed, server-side polling, push/email/OS alert delivery, or cross-device sync.
