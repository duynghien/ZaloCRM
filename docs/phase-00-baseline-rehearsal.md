# Phase 00 Baseline Rehearsal

Validated on 2026-09-01 against an authorized local ZaloCRM clone running PostgreSQL 16. This document contains no credentials, data rows, or backup contents.

- A custom-format backup contained 86 archive entries; its repository-local copy is gitignored.
- Source and restored clone each contained 13 public tables.
- Catalog fingerprint (tables, columns, constraints, indexes): `4cec111dd8ce546e591421f4e157505d333235b1849e7311300c7e4eea7a366e` on both databases.
- Per-table row-count fingerprint: `97595b33a01a75d26e0dcc7ea118f5534dc24a8f4e660e08be78b5e4ab017d1e` on both databases.
- Foreign-key fingerprint: `f9e03355b6ab3d4ed99eecbc8a4ae9b8633345cc8296bef0d4502072d8bc81ba` on both databases.

The legacy snapshot did not include `group_report_configs` or `generated_reports`; `20260901000001_sync_current_schema` adds them after the baseline.

Validated paths:

1. An empty database applied both migrations with `prisma migrate deploy` and then had no schema diff.
2. A restored legacy clone marked `00000000000000_baseline` as applied, deployed the additive migration, and then had no schema diff.

Use PostgreSQL 16 client tools for PostgreSQL 16 rehearsal. Each production database requires its own backup, restore, and fingerprint comparison before marking the baseline as applied.
