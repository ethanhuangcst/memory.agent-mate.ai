## [0.11.0] — 2026-08-20 — `flip-carrier`

### Changed

- **Secure-default flip**: `AI_MEMORY_REQUIRE_AGENT_ATTESTATION` now defaults to
  required on every surface (fail-open → fail-closed). Operators must set the
  explicit `=0` opt-out to keep the previous permissive behaviour.

### Deprecated

- `AI_MEMORY_RECALL_TOUCH_SYNC` is deprecated and will be Removed in the next
  major release.

### Errata

- Corrected an earlier erratum about surface-scoped defaults.
