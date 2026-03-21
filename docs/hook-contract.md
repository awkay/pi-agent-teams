# Hook Contract — Versioning and Compatibility Policy

Defines what hook scripts can rely on, how changes are classified, and how the contract evolves.

## Current version

**`1`** — set via `PI_TEAMS_HOOK_CONTEXT_VERSION` env var and the `version` field in `PI_TEAMS_HOOK_CONTEXT_JSON`.

## Contract surface

A hook script receives its contract through two channels:

### 1. Environment variables (flat)

| Variable | Stability | Since v1 |
|---|---|---|
| `PI_TEAMS_HOOK_EVENT` | **stable** | ✓ |
| `PI_TEAMS_HOOK_CONTEXT_VERSION` | **stable** | ✓ |
| `PI_TEAMS_HOOK_CONTEXT_JSON` | **stable** (envelope; see §payload) | ✓ |
| `PI_TEAMS_TEAM_ID` | **stable** | ✓ |
| `PI_TEAMS_TEAM_DIR` | **stable** | ✓ |
| `PI_TEAMS_TASK_LIST_ID` | **stable** | ✓ |
| `PI_TEAMS_STYLE` | **stable** | ✓ |
| `PI_TEAMS_MEMBER` | **stable** (absent when N/A) | ✓ |
| `PI_TEAMS_EVENT_TIMESTAMP` | **stable** (absent when N/A) | ✓ |
| `PI_TEAMS_TASK_ID` | **stable** (absent when no task) | ✓ |
| `PI_TEAMS_TASK_SUBJECT` | **stable** (absent when no task) | ✓ |
| `PI_TEAMS_TASK_OWNER` | **stable** (absent when no task) | ✓ |
| `PI_TEAMS_TASK_STATUS` | **stable** (absent when no task) | ✓ |

**Stable** means the variable name, presence semantics, and value type will not change within a major version. New variables may be added at any time (additive change).

### 2. JSON payload (`PI_TEAMS_HOOK_CONTEXT_JSON`)

```jsonc
{
  "version": 1,             // always present, always integer
  "event": "task_completed", // matches PI_TEAMS_HOOK_EVENT
  "team": {
    "id": "...",
    "dir": "...",
    "taskListId": "...",
    "style": "normal"
  },
  "member": "alice",         // string | null
  "timestamp": "...",        // ISO 8601 | null
  "task": {                  // object | null
    "id": "...",
    "subject": "...",
    "description": "...",
    "owner": "...",          // string | null
    "status": "completed",
    "blockedBy": [],
    "blocks": [],
    "metadata": {},
    "createdAt": "...",
    "updatedAt": "..."
  }
}
```

## Compatibility rules

### What hooks can rely on (guaranteed)

Within a major version:

1. **Existing fields are never removed or renamed.**
2. **Existing field types are never changed** (string stays string, array stays array).
3. **`version` is always present** and is always an integer.
4. **`event` is always present** and matches `PI_TEAMS_HOOK_EVENT`.
5. **Nullable fields stay nullable** — `null` is a valid value for `member`, `timestamp`, and `task`.
6. **Exit code semantics are stable**: `0` = success, non-zero = failure.

### What may change without a version bump (additive)

1. **New top-level fields** may appear in the JSON payload.
2. **New nested fields** may appear inside `team`, `task`, or other objects.
3. **New env variables** with the `PI_TEAMS_HOOK_` or `PI_TEAMS_` prefix may be set.
4. **New event types** may be added to `TeamsHookEvent`.
5. **New values for `style`** may appear.
6. **`metadata` contents** — the `task.metadata` object is intentionally untyped; contents may vary.

**Hook scripts MUST tolerate unknown fields.** Do not fail on unexpected keys.

### What requires a major version bump (breaking)

1. Removing or renaming an existing field.
2. Changing the type of an existing field (e.g. `blockedBy: string[]` → `blockedBy: object[]`).
3. Changing the semantics of exit codes.
4. Changing the meaning of an existing event type.
5. Removing an env variable that was previously set.
6. Restructuring the JSON payload shape (e.g. flattening `team.*` to top-level).

## Version negotiation

Hook scripts should check the version and fail fast on unsupported versions:

```bash
#!/bin/bash
version="$PI_TEAMS_HOOK_CONTEXT_VERSION"
if [[ "$version" != "1" ]]; then
  echo "Unsupported hook contract version: $version (expected 1)" >&2
  exit 1
fi
```

```javascript
// on_task_completed.mjs
const ctx = JSON.parse(process.env.PI_TEAMS_HOOK_CONTEXT_JSON);
if (ctx.version !== 1) {
  console.error(`Unsupported hook contract version: ${ctx.version} (expected 1)`);
  process.exit(1);
}
```

This ensures hooks surface version mismatches as clear failures rather than silently misbehaving.

## Deprecation process

When a breaking change is needed:

1. **Announce** in the changelog with a `BREAKING(hooks):` prefix.
2. **Bump** `PI_TEAMS_HOOK_CONTEXT_VERSION` to the next integer.
3. **Support both versions** for at least one minor release cycle when feasible — emit both `version: N` and `version: N+1` payloads, or run hooks twice with different versions.
4. **Drop the old version** in the next major release with a clear migration guide.

If dual-version support is impractical (rare), skip step 3 and ship the break in a major release.

## Migration guide template

When bumping versions, add a section here:

### v1 → v2 (not yet planned)

_Reserved. No breaking changes are currently planned._

## Truncation limits

To stay within process environment size constraints, fields are truncated:

| Field | Max length | Truncation |
|---|---|---|
| `task.subject` | 1,000 chars | Trailing `…` |
| `task.description` | 8,000 chars | Trailing `…` |
| `task.blockedBy` | 200 entries | Array slice |
| `task.blocks` | 200 entries | Array slice |
| `stdout` / `stderr` (in results) | 12,000 chars | Trailing `…` with byte count |

These limits are **stable within a major version**. They may increase (never decrease) in additive changes.

## Hook resolution

Hooks are discovered in `PI_TEAMS_HOOKS_DIR` (default: `~/.pi/agent/teams/_hooks/`):

| Event | File candidates (checked in order) |
|---|---|
| `idle` | `on_idle`, `on_idle.sh`, `on_idle.js`, `on_idle.mjs` |
| `task_completed` | `on_task_completed`, `on_task_completed.sh`, `on_task_completed.js`, `on_task_completed.mjs` |
| `task_failed` | `on_task_failed`, `on_task_failed.sh`, `on_task_failed.js`, `on_task_failed.mjs` |

Resolution rules:
- `.js` / `.mjs` → run with `node`
- `.sh` → run with `bash`
- No extension + executable bit → run directly
- No extension + not executable → skip
- First match wins; no chaining.

This resolution order is **stable**. New file extensions (e.g. `.ts`, `.py`) may be added at the end of the candidate list in future versions.

## Timeout and execution

| Parameter | Default | Env override |
|---|---|---|
| Timeout | 60s | `PI_TEAMS_HOOK_TIMEOUT_MS` |
| Enable/disable | disabled | `PI_TEAMS_HOOKS_ENABLED=1` |

On timeout: `SIGTERM`, then `SIGKILL` after 1s grace period.

stdin is closed (`/dev/null`). stdout and stderr are captured and returned to the leader.
