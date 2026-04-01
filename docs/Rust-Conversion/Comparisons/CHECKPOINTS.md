# User Checkpoints

This file defines when to notify the user for external-application verification.

## Timing

1. Checkpoint 1 (Stage 03)
- Trigger: after Browser Contract and mode visibility are stable.
- Request to user: verify output can be loaded in external tools.

2. Checkpoint 2 (Stage 06)
- Trigger: after local run flow and artifact output are stable.
- Request to user: verify output can be loaded in external tools.

3. Checkpoint 3 (Stage 09)
- Trigger: after phase-0 parity comparison against baseline is stable.
- Request to user: verify output can be loaded in external tools.

## Record policy

- Write each checkpoint result into records/*.md and records/*.json.
- Mark status as pass, warn, or fail.
- Include short notes from external-app validation.
