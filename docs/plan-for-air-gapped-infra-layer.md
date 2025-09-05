Plan and priorities to make SecuraMem a trusted, air‑gapped infra layer — concise, prioritized, and actionable.

Immediate priorities (0–7 days)

Enable native vector backend (sqlite‑vec / FAISS)
Why: huge ANN performance and accuracy benefit vs local‑JS; required for scale.
Windows (validated): place vec0.dll here so SecuraMem can find it automatically:
- .securamem/sqlite-vec/win32-x64/vec0.dll (manual path checked by the loader)
- OR install npm package sqlite-vec-windows-x64 (loader checks node_modules/sqlite-vec-windows-x64/vec0.dll)
macOS/Linux: ship or document platform-appropriate sqlite-vec/FAISS builds and loader paths.
Verification: smem vector-status should show Backend: sqlite-vec and not local-js.
Harden Tree‑sitter coverage and default excludes
Why: avoid noisy fallbacks and index only source files.
Next action I can take: add packaged tree‑sitter parsers (or prebuilt WASM) and add stricter default excludes + tests.
Package offline embedding model(s)
Why: air‑gapped operation needs local models cached under .securamem/models.
Next action: pick a small, permissively licensed text embedding model compatible with @xenova/transformers; provide an offline bootstrap script that pre-downloads all required files into .securamem/models and disables network egress at runtime.
Notes: Ensure the loader never fetches remote assets; add a prove-offline check that asserts model files are present and network guards are active.
Short term (1–4 weeks) 4) Produce platform artifacts & CI

Why: reproducible, installable releases for Windows/Linux/macOS.
Next action: add CI to build native artifacts (vss0, tree‑sitter parsers) and create release bundles.
Integrity & provenance
Why: trust for air‑gapped operators — verify what they run.
Next action: generate SBOM, sign binaries (code signing or detached signatures), publish checksums and reproducible build steps.
Automated self‑tests & telemetry (opt‑in)
Why: quickly verify that installation works offline.
Next action: add smem self-test and smem vector-status checks; telemetry must be off by default and strictly opt‑in.
Medium term (1–3 months) 7) Security review & third‑party audit

Why: expert review increases trust and helps land higher‑risk customers.
Next action: prepare scope and artifacts for an external audit.
Documentation & onboarding
Why: non‑expert users must be able to deploy air‑gapped stacks reliably.
Next action: create step‑by‑step install guides for air‑gapped installs, release checklist, and quickstart with prebundled artifacts.
Packaging for offline model & binaries distribution
Why: make operator experience repeatable (tar/zip with checksums).
Next action: create release bundles with everything needed for air‑gapped installs.
Longer term (3–6 months) 10) Reproducible builds + supply chain hardening, bug bounty, pilot customers, performance benchmarks and dashboards.

Current state (Sep 2025) — verified in demo
- Vector backend detection works; on Windows without vec0.dll, loader falls back to local-js and logs the attempted paths.
- CLI commands available: remember, recall, status, vector-status, self-test, init, index-code, search-code, reindex-file, policy, prove-offline, report, export-context, import-context, pro.
- Journal/receipt viewing is exposed via report --json (no standalone journal/receipt-show commands).

Windows quick steps (developer laptop)
1) Place vec0.dll for sqlite-vec
	- Preferred: npm i sqlite-vec-windows-x64 (puts vec0.dll under node_modules/sqlite-vec-windows-x64)
	- Manual: copy vendor DLL to .securamem/sqlite-vec/win32-x64/vec0.dll
2) Pre-cache models (offline)
	- Run an offline bootstrap script to place model files under .securamem/models
3) Verify air-gap readiness
	- smem self-test
	- smem vector-status
	- smem prove-offline

Acceptance criteria (engineering)
- smem vector-status reports sqlite-vec backend (not local-js) on all target platforms.
- smem prove-offline passes with network guards enabled and no remote fetches.
- Offline bootstrap artifact contains vec0 binaries and model files with checksums and signatures.
- report --json returns recent operation summaries suitable for audit displays.

Recommended next step (my suggestion)

I recommend starting with item 1: add a platform‑matched sqlite-vec vec0.dll for your Windows x64 workspace and verify vector-status. That gives immediate, high‑impact improvements and lets us iterate on the rest.