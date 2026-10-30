# ShipStats

<img src="media/shipstats-icon.png" alt="ShipStats Signal Beacon logo: voxel beacon with connected data nodes" width="160">

A VS Code extension for the things you ship. Discover public npm packages, select which to track, and see actual daily download counts with 7-, 30-, and 90-day comparisons. Add Marketplace, Open VSX, and optional Reddit counts alongside them.

**npm is the MVP's focus.** Other sources show their own cumulative or current metrics, never made-up historical downloads. There is no hosted service, account signup, telemetry, or runtime dependency.

## Install and use

Requires desktop VS Code **1.99+**, or a compatible current desktop build. This is a Node extension; vscode.dev/web is not supported.

1. Install the included `shipstats-analytics-0.3.0.vsix` from **Extensions → … → Install from VSIX**. Reload if prompted.
2. Click the ShipStats activity icon or run **ShipStats: Open Dashboard** from the Command Palette.
3. Open **Packages**, enter an **npm username** or **npm scope**, and click **Find packages**. Filter results, check packages, and click **Track selected packages** to open Overview. Within the same account, clearing the discovered selection and saving stops tracking those candidates; other manually tracked packages remain. **Changing the username or scope clears all previous npm tracking, download readings and picker filters before the new search starts.** Marketplace, Open VSX and Reddit tracking remains.
4. In **Overview**, use **7 / 30 / 90 days** to change the npm window. Explore the combined daily chart, search products, or filter cards by source. Expand **Daily values** for exact source counts; **View source** opens the original product page. Product filters affect the cards; overview totals continue to cover all tracked npm packages with complete data.
5. Use **Add product** for any source, or go to **Integrations** for direct Marketplace, Open VSX and Reddit add actions and Reddit access setup. **Add a package manually** on Packages opens the npm input directly. Use × on a product card to stop tracking it.

This renamed build has a new extension identity: `shipstats-local.shipstats-analytics`. If you installed the earlier local prototype, disable it before installing this build, then re-enter your discovery settings, tracked products and Reddit token. VS Code isolates settings and stored data by extension identity; automatic migration from the prototype is not included.

ShipStats 0.3.0 keeps the identity used by ShipStats 0.2.x, so upgrading from that version retains your tracked products and settings.

## Dashboard layout

- **Overview**: npm download total, tracking and coverage counts, source errors needing attention, combined daily activity, and searchable product cards with source filters.
- **Packages**: a guided find → choose → track workflow, scrollable package list, explicit selection counts, and manual npm entry. Discovery details are available under **About package discovery**.
- **Integrations**: clear source-specific metric descriptions, direct add actions and optional Reddit setup. Tokens stay out of the dashboard.

New users start on Packages. Returning users with tracked products start on Overview unless a previous page is remembered. The active page and analytics period survive webview recreation. Successful tracking and manual additions reveal Overview. Keyboard focus, light/dark themes, high contrast, reduced motion, and editor widths down to 320px are supported.

On a new dashboard opening, a saved scope or username is searched automatically. Scope takes precedence when both are configured. Existing tracked analytics load first; discovery never silently tracks packages. Selections persist across sessions in VS Code's local global state, separate from your workspace, with a 50-product limit. They are not configured for Settings Sync.

## What the numbers mean

| Source | Metric | History |
| --- | --- | --- |
| npm | Package downloads across versions, as reported by npm | Daily counts; 7/30/90-day totals and preceding-window comparison |
| VS Code Marketplace | Public `install` statistic, labeled installs | Cumulative source count only |
| Open VSX | Public `downloadCount` | Cumulative source count only |
| Reddit | Post `num_comments` | Current count only; includes no comment bodies |

The npm overview sums only successful, complete, non-stale npm windows. It reports coverage and marks partial totals. Other sources are deliberately excluded from the npm aggregate. Counts do not represent unique people, revenue, active users, or necessarily human downloads. npm lifetime totals are not claimed.

### npm discovery and ownership caveats

- **Username discovery uses `maintainer:username` public registry search**, then filters against returned maintainer metadata. It finds current public maintainer matches, not necessarily everything you originally published. An author, last publisher, collaborator, organization member, and owner are different concepts.
- **Scope discovery first uses `scope:namespace`** and verifies the exact `@namespace/` prefix. Some registry deployments return no results for that documented qualifier; ShipStats then falls back to general `@namespace/` search with the same exact prefix filter and an explicit warning that results may be incomplete. General search includes unrelated packages before filtering and can hit the cap. Namespace matches do not establish that you own or administer those packages. No npm authentication or ownership verification is performed.
- Public registry search can be delayed, incomplete, or change while paginating. ShipStats requests 250 records per page, up to 1,000 results, and displays a cap notice when applicable. Private packages, unpublished packages, and unindexed packages may be absent. Add any known package name manually; public download data may still be unavailable.
- Choosing packages is explicit. Within the same username/scope, saving a discovery selection replaces tracking only for the currently discovered candidates. Switching to a different username or scope starts a fresh npm dashboard: previous npm selections and cached readings are removed, including manually added npm packages. This reset also applies when the new account has no matches or its search fails. Invalid input does not clear tracking. Re-searching the same normalized identity (ignoring case, surrounding spaces, and the optional scope `@`) preserves tracking. Scope and username searches are different identities. The active identity and tracking persist across restarts.

### Windows, gaps, and freshness

One npm range request retrieves the previous **180 calendar days**, ending **yesterday in UTC**. This supports the current 90-day window and the preceding 90-day comparison. The current UTC day is excluded. Growth is `(current - previous) / previous × 100`; a zero preceding total produces no percentage. Missing days produce **Unavailable**, not zero. Real source-provided zeroes remain zero. Charts show gaps, and the daily table contains only returned rows.

npm may not have finished publishing yesterday's data. ShipStats preserves the requested dates and exposes missing coverage instead of silently shifting the window. An API that returns a zero for a provisional day cannot be distinguished from a final zero. Source counts can be delayed or revised.

Successful readings are held in memory for **10 minutes** and display their fetch timestamp. Refresh reuses fresh cached readings, so it does not force a network request on every click. Errors are not cached; a last successful reading remains explicitly marked stale and is excluded from aggregate totals. There is no persistent metric history or offline cache across VS Code restarts. HTTP requests have a 15-second timeout and a 5 MB response limit. At most four product reads run concurrently. HTTP 429 responses establish a host cooldown honoring Retry-After (minimum 60 seconds, capped at 24 hours), with no automatic retries. Refresh is manual by default.

## Settings

Open Settings and search **ShipStats**. These are application settings, not repository-controlled settings.

| Setting | Default | Meaning |
| --- | --- | --- |
| `shipstats.npmUsername` | empty | Public maintainer search username |
| `shipstats.npmScope` | empty | Namespace with or without `@`; overrides username on opening |
| `shipstats.refreshMinutes` | `0` | Manual refresh; positive values use at least 5 minutes and at most 1,440. Timer runs only while a dashboard exists and refreshes only when visible. Cache TTL still applies. |
| `shipstats.redditUserAgent` | empty | Descriptive Reddit app/version and contact username, e.g. `desktop:your-app:0.1 (by /u/your_username)` |

Commands: **Open Dashboard**, **Discover npm Packages**, **Add Product**, **Refresh Analytics**, **Set Reddit Access Token**, **Clear Reddit Access Token**, all under the ShipStats prefix.

## Optional Reddit monitoring

Reddit access is **not guaranteed**. This integration is for users who already have approved Reddit Data API access and a valid OAuth access token with appropriate read permissions. Approval, terms, access restrictions, and app eligibility remain Reddit's decision.

1. Review Reddit's current access policy and obtain approved API access through Reddit's official process.
2. Set `shipstats.redditUserAgent` to your descriptive registered app/version and Reddit contact.
3. Run **ShipStats: Set Reddit Access Token**. Paste the access token only, without `Bearer`. It is stored in VS Code **SecretStorage**, never in settings, the webview, or logs.
4. Add a Reddit post. Refresh manually or enable the dashboard refresh interval.

ShipStats calls only `https://oauth.reddit.com/api/info?id=t3_POSTID` with the token. It reads the current comment count and title. It does **not** implement an OAuth login/refresh flow, create API credentials, fetch comment bodies, identify new comments, send notifications, scrape HTML, or fall back to unauthenticated `.json` endpoints. Tokens can expire or be revoked: a 401/403 requires checking approval or replacing the token. Private/deleted/restricted posts may remain unavailable. **Clear Reddit Access Token** removes the saved secret and cached Reddit readings. Count monitoring is available only while the dashboard is open; this is not an always-running notification service.

## Privacy and security

- No analytics collection by ShipStats. No backend. Tracked identifiers and discovery settings stay in your VS Code profile; requested usernames, package names, extension IDs, and post IDs are sent to the corresponding source services.
- Requests go to fixed npm, Marketplace, Open VSX, and Reddit API hosts. Only Reddit requests carry the Reddit token. Redirects are rejected. Public statistics need no login.
- The dashboard has a restrictive Content Security Policy, local scripts/styles, no remote assets, and text-only insertion of API content. Source links are constructed from validated saved identifiers. The webview never receives secrets. Messages are validated again in the extension host.
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

```sh
npm ci
npm test
npm run package
```

The generated **`shipstats-analytics-0.3.0.vsix`** is installable locally. Production files are compiled JavaScript and local dashboard assets; development dependencies and tests are excluded. A lockfile pins the dependency tree. To distribute source, run `npm ci` before building. The local packaging command preserves relative README image links. Before public publishing, configure your repository and image URLs and remove `--no-rewrite-relative-links` so the Marketplace can resolve the README logo.

`shipstats-local` is a local packaging placeholder, not a registered publishing claim. Before publishing, replace `publisher` in `package.json` with your own Marketplace publisher, set your repository/bugs/homepage URLs, review branding and provider terms, and follow Microsoft's official publishing guide. For Open VSX, use your own namespace and follow its publishing process. ShipStats does not publish anything automatically.

## Source contracts and limitations

- [npm registry search API and qualifiers](https://github.com/npm/registry/blob/main/docs/REGISTRY-API.md)
- [npm official download counts API](https://github.com/npm/registry/blob/main/docs/download-counts.md)
- [VS Code gallery implementation](https://github.com/microsoft/vscode/blob/main/src/vs/platform/extensionManagement/common/extensionGalleryService.ts) — the public gallery query endpoint is a best-effort integration, not a guaranteed analytics API; access and response formats may change.
- [Open VSX extension schema](https://github.com/eclipse/openvsx/blob/master/server/src/main/java/org/eclipse/openvsx/json/ExtensionJson.java)
- [Reddit API access](https://support.reddithelp.com/hc/en-us/articles/14945211791892-Developer-Platform-Accessing-Reddit-Data), [Data API wiki](https://support.reddithelp.com/hc/en-us/articles/16160319875092-Reddit-Data-API-Wiki)
- [VS Code publishing guide](https://code.visualstudio.com/api/working-with-extensions/publishing-extension)

MIT licensed. v0.1 intentionally omits account authentication except manual Reddit access tokens, private npm registries, lifetime npm totals, extension download history, server-side polling, alerts, exports, and cross-device sync.
