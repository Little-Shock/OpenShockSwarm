# Test Report 2026-04-09 Credential Profile / Encrypted Secret Scope

- Command: `pnpm test:headed-credential-profile-scope -- --report docs/testing/Test-Report-2026-04-09-credential-profile-scope-refresh.md`
- Artifacts Dir: `/tmp/openshock-tkt45-credential-scope-cFsFRH`
- Scope: `TKT-45 / credential profile / encrypted secret scope`
- Result: `PASS`

## Results

### End-to-End Surface Replay

- Settings create flow writes credential metadata into live truth, persists ciphertext + key under the vault files, and keeps plaintext out of `/v1/state`, `state.json`, and `/settings` SSR HTML.
- Agent profile editor consumes the same credential metadata truth and persists `credentialProfileIds` back to the server; the bound-count tile moves to `1` without exposing secret payload.
- Run detail dedupes workspace default + agent bind + run override into one effective credential scope, and it materializes a `secret_scope` guard on the execution surface before any consume happens.
- Settings, agent profile, and run detail stay on the same credential metadata truth after binding: profile shows `1` recent bound run and settings rolls up `1 agent · 1 run` without leaking plaintext.

### Adversarial Checks

- Plaintext secret does not appear in `/v1/state`, persisted `state.json`, `credentials.vault.json`, or `/settings` SSR HTML -> PASS
- `credentials.vault.json` stores ciphertext and `credentials.vault.key` is non-empty -> PASS
- Headed replay intentionally stops at UI create/bind/guard truth; exec->audit stays covered by the Go contract tests for this ticket -> PASS

### Screenshots

- settings-credential-created: /tmp/openshock-tkt45-credential-scope-cFsFRH/run/screenshots/01-settings-credential-created.png
- profile-agent-credential-bound: /tmp/openshock-tkt45-credential-scope-cFsFRH/run/screenshots/02-profile-agent-credential-bound.png
- run-credential-scope-bound: /tmp/openshock-tkt45-credential-scope-cFsFRH/run/screenshots/03-run-credential-scope-bound.png
- profile-credential-run-count: /tmp/openshock-tkt45-credential-scope-cFsFRH/run/screenshots/04-profile-credential-run-count.png
- settings-credential-usage-audit: /tmp/openshock-tkt45-credential-scope-cFsFRH/run/screenshots/05-settings-credential-usage-audit.png
