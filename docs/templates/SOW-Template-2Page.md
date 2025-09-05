# Statement of Work (SOW) — SecuraMem AI Labs: Secure PoC Factory (2 pages)

## 1. Project Overview
- Objective: Deliver a secure, offline PoC for <Workflow/Use Case> using SecuraMem.
- Duration: Discovery (2 weeks), PoC (4–6 weeks), optional Pilot Hardening (2–4 weeks).
- Location: Remote; Client environment for validation.

## 2. Scope (In-Scope / Out-of-Scope)
- In-Scope:
  - Synthetic/anonymized dataset plan and setup
  - PoC build, signing, and delivery as `.smemctx`
  - Runbook + verification transcript + Zero‑Egress proof
  - Journal receipt pack and SBOM
- Out-of-Scope:
  - Production integrations (IDP, SIEM, DLP), advanced UI, change management
  - Access to client PII/regulated data (synthetic only in our environment)

## 3. Deliverables
- Signed `.smemctx` bundle + `SHA256SUMS`
- Verification transcript (`prove-offline`, signature verify)
- PoC runbook and acceptance test plan
- Receipts pack and SBOM/BUILD‑ENV

## 4. Acceptance Criteria
- Functional criteria aligned to success metrics (e.g., recall@k, latency bounds)
- Offline execution verified in client environment
- Bundle integrity verified (signature + checksums)

## 5. Timeline & Checkpoints
- Week 1: Discovery + success criteria
- Week 2: Data simulation + design review
- Weeks 3–5: Build + weekly demos
- Week 6: Sign, deliver, client validation + debrief

## 6. Client Responsibilities
- Provide process owners and sample artifacts for simulation
- Approve success metrics and test plan
- Run import/verify steps in client environment

## 7. Commercials
- Fixed fees per package; PoC fee credited against Enterprise annual if signed within 90 days
- Non‑production PoC license during engagement

## 8. Legal & Security
- NDA and MSA; SOW governs scope
- No transfer of client confidential data to SecuraMem
- Attachments: SECURITY.md, Evidence Pack whitepapers, Air‑Gap Pack manifest

## 9. Change Control
- Any scope change requires written change order with fee/timeline adjustments

## 10. Contacts
- SecuraMem PM: <Name, email>
- Client PM: <Name, email>
