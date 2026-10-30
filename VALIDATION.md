# ShipStats 0.3.0 verification

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
