# SecuraMem Enterprise Reproducible Builds — Whitepaper

Audience: Security Engineering, Release Engineering, and Audit/Compliance reviewers.

## Executive summary

Reproducible builds reduce supply‑chain risk by enabling verifiable, byte‑identical artifacts from the same inputs. SecuraMem Enterprise documents inputs, steps, and controls to produce consistent outputs and to generate evidence (checksums, SBOMs).

Key references: `REPRODUCIBLE_BUILDS.md` and CI scripts.

## Reproducibility contract

Inputs to pin:
- Node.js: exact major.minor.patch (see engines in `package.json`).
- OS/Arch: build on the same platform for byte‑identical `dist/`.
- Lockfile: use `npm ci` with the committed `package-lock.json`.
- Build flags: `npm ci --ignore-scripts=false` then `npm run build` (no extra flags).

Native modules:
- `better-sqlite3` is native; CI avoids flaky rebuilds. For strict reproducibility, prebuild for your target OS/Arch or vendor the binaries.

## Reference procedure

1) Freeze dependencies and build
```powershell
npm ci --ignore-scripts=false
npm run build
```

2) Record environment
```powershell
node -v > BUILD-ENV.txt
npm -v >> BUILD-ENV.txt
```

3) Generate checksums of build outputs
```powershell
powershell -NoProfile -Command "Get-ChildItem dist -Recurse | Get-FileHash -Algorithm SHA256 | ForEach-Object { \"$($_.Hash)  $($_.Path)\" } | Set-Content SHA256SUMS.txt"
```

4) Optional: Generate SBOM
```powershell
npm ls --json > sbom.json
```

## Verification guidance

- Rebuild on a clean host with the same inputs; compare `SHA256SUMS.txt`.
- Confirm `dist/` is byte‑identical; flag any drift for review.
- Store BUILD‑ENV, checksums, and SBOM as part of the release evidence package.

## Risk notes and mitigations

- Native rebuild drift: pin Node/toolchain versions; vendor prebuilt artifacts when feasible.
- Non‑deterministic timestamps: only receipts/journals have dynamic timestamps at runtime; build outputs should be stable.
- Environment variance: standardize the build image (container/VM) used by CI and releases.

## Audit evidence bundle

Include:
- `REPRODUCIBLE_BUILDS.md` and this whitepaper.
- `BUILD-ENV.txt`, `SHA256SUMS.txt`, and `sbom.json` from your build.
- CI logs proving the steps above were executed without overrides.
