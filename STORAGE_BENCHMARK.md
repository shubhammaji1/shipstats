# Storage benchmark

Generated 2026-11-04T06:49:46.027Z on win32, Node v22.17.0.

- 50 npm products, each with a 214-character identifier.
- 5,000 retained snapshots (100 per product), with large rolling totals.
- 20 groups, 200 release markers with 500-character notes, 50 rules and 100 alerts.
- Serialized tracking data: **2,506,168 bytes**.
- Formatted backup: **3,263,590 bytes** (5 MB import limit).
- Median validation/restore preparation across five local runs: **59.55 ms**.

This measures JSON payload size and pure validation time. It excludes VS Code database overhead, filesystem persistence, source response caches, startup and UI rendering. Results vary by machine. History retains at most 100 observations per product within 90 days; frequent refreshes reduce effective time coverage.

Reproduce after compilation with `node scripts/benchmark-storage.cjs`. Add `--write-report` to update this file.
