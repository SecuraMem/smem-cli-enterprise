# SecuraMem (smem) — Air‑Gapped Code Memory CLI

[![CI](https://github.com/SecuraMem/smem-cli-enterprise/actions/workflows/ci.yml/badge.svg)](https://github.com/SecuraMem/smem-cli-enterprise/actions/workflows/ci.yml)
[![Changelog](https://img.shields.io/badge/Changelog-CHANGELOG.md-blue)](CHANGELOG.md)
[![Release Notes Template](https://img.shields.io/badge/Release%20Notes-TEMPLATE-blueviolet)](.github/RELEASE_TEMPLATE.md)

Verifiable, secure, and human‑in‑control code memory for regulated environments. Everything runs locally: zero network egress, reproducible builds, signed artifacts, SBOMs, and a glass‑box audit trail.

## Overview

SecuraMem is an air‑gapped, AI‑agnostic persistent memory tool for developers and teams in finance, healthcare, defense, and enterprise. It provides:

- Audit‑first operations: all commands produce receipts and journal entries
- Human‑centric control: nothing runs without explicit operator intent
- Code‑aware indexing and safe purging to keep context fresh
- Import/export with cryptographic signatures and checksums

## SecuraMem AI Labs — Secure PoC Factory
- Overview: docs/Secure-PoC-Factory.md
- One‑Pager (MD): docs/one-pagers/SecuraMem-AI-Labs-OnePager.md
- One‑Pager (HTML): docs/one-pagers/SecuraMem-AI-Labs-OnePager.html
- One‑Pager (PDF): docs/one-pagers/SecuraMem-AI-Labs-OnePager.pdf

## Quick start

Install and view help:

Note: This repository represents the Enterprise Edition. For public npm distribution (Community Edition), use the `securamem` package. For Enterprise access, contact securamem@gmail.com.

Common flows:

```powershell
# Initialize in a project
smem init

# Index code (symbol-aware with Tree-sitter when available)
smem index-code --symbols --path .

# Search
smem search-code "functionName" --hybrid --preview 3 --trace

# Inspect receipts and journal
smem receipt-show --last
smem journal --show
```

See docs/ for full guides:
- docs/README.md (index)
- docs/getting-started.md
- docs/cli-reference.md
- docs/policy.md
- docs/vscode.md
- docs/airgapped.md
- docs/troubleshooting.md

## Compatibility

- Primary working dir: .securamem (automatic migration is idempotent)
- Legacy compatibility: reads from .antigoldfishmode when present
- Bundles: default .smemctx; legacy .smemctx remains import‑compatible
- Signing keys: prefers smem_ed25519; falls back to smem_ed25519 when needed

## Security model

- Zero‑egress by default; local‑only operations
- Cryptographic signing (ed25519) and per‑file checksums
- Reproducible builds and SBOM generation
- Glass‑box receipts and journal for audits

See SECURITY.md for threat boundaries and hardening details.

## Support

For Enterprise licensing, evaluations, and support, contact: securamem@gmail.com

## Legacy note

Historical content for Securamem (smem) has been archived. See docs/archive/ for reference (e.g., archive/main-website-section.html, faq-section.html).