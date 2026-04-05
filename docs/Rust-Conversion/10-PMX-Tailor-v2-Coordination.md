# PMX Tailor v2 Coordination

## Positioning

- PMX Tailor v2 should be treated as a post-conversion stage.
- It should not block the initial Rust conversion path scaffold.

## Recommended Order

- Stabilize the Rust conversion contract first.
- Introduce PMX Tailor v2 as an optional second-stage processor.
- Keep failure isolation so tailor errors do not invalidate the base conversion output.

## Integration Rule

- Base conversion and tailor processing should be independently testable.
- Rust conversion mode should be observable even when tailor is disabled.
