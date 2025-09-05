# SecuraMem Enterprise Auditability — Receipts and Journaling — Whitepaper

Audience: Security, Compliance, and Forensics teams assessing operational evidence and traceability.

## Executive summary

SecuraMem emits structured, local‑only execution receipts for commands and keeps a deterministic journal on disk. This enables precise forensic reconstruction without network dependency and supports compliance with common audit controls.

Key reference: `docs/receipts.md`.

## Design goals

- Deterministic evidence: every command emits a JSON receipt when `--json` is used and always writes a compact journal file on disk.
- Local‑only operation: no telemetry; evidence is stored under `.securamem/` in the project.
- Stable schema: envelope fields are stable across 1.x; new fields are additive.

## Receipt schema (summary)

Envelope fields:
- `id`: stable, unique identifier (ULID‑like)
- `cmd`: command name
- `args`: canonicalized arguments
- `success`: boolean
- `timestamp`: ISO 8601
- `durationMs`: optional
- `error`: optional error message
- `result`: command‑specific payload
- `meta`: optional; may include `resultSummary` and deterministic `digests`

See `docs/receipts.md` for command‑specific `result` shapes (status, vector‑status, index/search code, export/import, etc.).

## Evidence locations

- Live print: append `--json` to any command to emit a receipt to stdout.
- Saved files: `.securamem/journal/<YYYY-MM>/<receiptId>.json`.

## Example procedures

- Capture an indexing run with evidence:
```powershell
smem index-code --json > receipts-index.json
# On disk: .securamem/journal/<YYYY-MM>/<id>.json
```

- Export a portable context and sign it:
```powershell
smem export-context --out ./.securamem/exports/app.smemctx --sign --json > receipts-export.json
```

- Verify and import on a clean host:
```powershell
smem import-context --in app.smemctx --verify --json > receipts-import.json
```

## Forensic reconstruction workflow

1) Aggregate the relevant journal files by time window and command.
2) Validate `success=true`; if failures exist, correlate `error` messages and retry receipts.
3) Use `meta.digests` to validate content integrity against files/bundles.
4) For exports, verify ED25519 signature; record verification logs.

## Control mapping (indicative)

- SOC 2 CC7.2/CC7.3: Event logging and recording of security‑relevant events.
- ISO 27001 A.8.16/A.8.23: Activity logging and data leakage prevention.
- NIST 800‑53 AU‑2/AU‑12: Audit events and generation; AU‑10 integrity protections via digests/signatures.

## Recommended operational practices

- Treat `.securamem/` as evidence store; include it in your backup/retention strategy.
- Standardize a receipts harvesting job for CI or scheduled tasks.
- Store receipts and signed exports with your case files or evidence repository.
- Use `prove-offline` to capture runtime posture during sensitive operations.

## Appendix — References and tooling

- `docs/receipts.md` — schema and examples.
- `SECURITY.md` — offline posture and signing guidance.
- `REPRODUCIBLE_BUILDS.md` — building consistent, auditable artifacts.
