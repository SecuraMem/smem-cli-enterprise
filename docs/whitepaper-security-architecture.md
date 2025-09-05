# SecuraMem Enterprise Security Architecture — Whitepaper

Audience: Security Engineering, Compliance, and Risk teams evaluating SecuraMem Enterprise for air‑gapped and zero‑egress deployments.

## Executive summary

SecuraMem is a local‑only AI memory engine designed to operate with zero network egress by default and to produce verifiable evidence for auditors. Security posture is centered on: default‑deny networking, signed/portable context exports, deterministic journaling (receipts), and offline verifiability.

Key properties (see `SECURITY.md`):
- Offline by default: `policy.networkEgress=false` and runtime guards block http/https.
- Verifiability: every command produces a structured JSON receipt and a compact journal entry (`docs/receipts.md`).
- Air‑gapped context mobility: `.smemctx` export/import with optional ED25519 signing.
- Deterministic local operation: all inference/indexing is local; vector backends are embedded (sqlite‑vec/sqlite‑vss) with JS fallback.

## Threat model (abridged)

- Network exfiltration: Prevent unapproved egress during indexing/search/inference.
- Supply chain drift: Ensure the shipped CLI and runtime extensions match what was reviewed.
- Data integrity/tampering: Detect unauthorized changes to the local DB, indexes, and exported bundles.
- Forensic auditability: Reconstruct actions post‑hoc with high fidelity.

## Controls and design choices

1) Zero‑egress by default
- Policy gate keeps `networkEgress=false` unless explicitly allowed.
- Runtime guard short‑circuits http/https modules.
- “Prove offline” command surfaces runtime state for audit.

2) Verifiable execution via receipts
- Each command writes a structured receipt (stdout with `--json` and `.securamem/journal/…` on disk).
- Envelope fields are stable for 1.x (IDs, args, timestamps, result payloads). See `docs/receipts.md`.
- Receipts include optional deterministic digests (inputs/outputs) to anchor evidence.

3) Integrity and signing
- Exported `.smemctx` bundles can be ED25519‑signed; import verifies signatures.
- Database integrity checks guard against corruption/tampering and surface clear errors.

4) Local inference and indexing
- Uses local ONNX or JS embeddings; no remote model calls required.
- Vector backends prefer sqlite‑vec/sqlite‑vss; fall back to local‑JS to guarantee availability.

## Verification procedures (quick start)

- Prove offline posture at runtime:
  - `smem prove-offline --json`

- Inspect current policy and receipts directory:
  - Policy location: project root `.securamem/policy.json` (if configured)
  - Receipts: `.securamem/journal/<YYYY-MM>/<id>.json`

- Validate an export is signed and complete:
  - Create signed export: `smem export-context --sign --out ./.securamem/exports/app.smemctx`
  - Import with verification on a clean host: `smem import-context --verify --in app.smemctx`

## Operational guidance for air‑gapped deployments

- Disable egress at the environment layer (network ACLs, firewall) even though the CLI is default‑deny.
- Use the “Air‑Gap Pack” (models, vector DLLs, checksums) to pre‑seed runtime dependencies.
- Pin Node.js and lockfile for deterministic builds; avoid dynamic post‑install rebuilding when possible.
- Treat `.securamem/` as the security boundary; back it up with OS‑level protections.

## Evidence package for auditors

Provide the following to your audit team:
- `SECURITY.md` and this whitepaper.
- A sample of journal receipts covering representative commands.
- A signed `.smemctx` bundle and verification transcript.
- SBOM (e.g., `npm ls --json > sbom.json`) and SHA256 checksums of `dist/`.

## Mapping to common controls (indicative)

- SOC 2 CC6.1, CC6.6: Default‑deny outbound networking and logging of actions (receipts).
- ISO 27001 A.8.23: Data leakage prevention controls and monitoring.
- NIST 800‑53 AU‑3/AU‑12: Content of audit records and audit generation.

## Appendix — References

- `SECURITY.md` — baseline security posture and offline proof command.
- `docs/receipts.md` — receipt schema and stability notes.
- `docs/vector-backend.md` — vector backend options and behavior.
