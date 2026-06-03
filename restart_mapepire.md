# Plan: Fix Silent Mapepire Job Death with Transparent Restart

## Problem Summary

When the IBM i ends the Mapepire Java process (inactivity timer, OOM, or crash), the SSH exec channel fires a `close` event. `sshSqlJob.end()` cleans up its own internals but **never notifies `IBMi`**. `IBMi.sqlJob` remains a non-null dangling reference to a dead job. Every subsequent `runSQL` call passes the `if (this.sqlJob)` guard, reaches `send()`, and throws `"SQL client is not yet setup."` because `this.channel` is `undefined`. The user experiences a hard error or hung UI with no automatic recovery.

## Root Cause Detail

There are two independent layers:

1. **The SSH connection** (`IBMi.client`) — the tunnel between VS Code and IBM i.
2. **The Mapepire job** (`IBMi.sqlJob`, a `sshSqlJob`) — a Java process running inside an SSH exec channel on top of that connection.

These can die independently. When only the Mapepire process dies (the SSH connection stays alive), `IBMi.dispose()` is never called — it is only triggered by SSH-level events (`end`, `error`, `timeout` on the SSH connection itself). So `IBMi.sqlJob` is never cleared, leaving a dangling reference.

`sqlRunnerAvailable()` returns `true` on a dead job because it only checks `this.sqlJob !== undefined`. Callers get a false positive, then a hard throw on the actual query.

The most common trigger is the IBM i **inactivity timer** (`QINACTITV` system value / job description `TIMMSGQ`) ending the Java PASE job after a period of no SQL activity.

## Files to Modify

- `src/api/components/mapepire/sqlJob.ts` — add `onDied` callback slot; fix `end()` to reject in-flight queries before clearing listeners; guard `close()` against already-ended jobs
- `src/api/IBMi.ts` — add restart cap fields; extract `startSqlJob()` helper with connection guard and cap enforcement; register `onDied` callback

---

## Implementation Steps

### Phase 1 — Wire up the death notification (`sqlJob.ts`)

**Step 1.** Add `onDied` field to `sshSqlJob`, after the existing `private onClose?: () => void` field:

```typescript
private onDied?: () => void;
```

**Step 2.** Expose a public setter so `IBMi` can register the callback without accessing privates:

```typescript
public setOnDied(callback: () => void) {
  this.onDied = callback;
}
```

**Step 3.** Fire `onDied` from the existing `private end()` method. Also add in-flight query rejection before `removeAllListeners()` — without this, any Promise awaiting a response at the moment of unexpected death will hang forever since its listener is silently discarded (the clean-shutdown path `close()` already handles this correctly; `end()` must match it):

```typescript
private end() {
  this.channel?.close();
  this.channel = undefined;
  this.status = JobStatus.ENDED;
  // Reject all in-flight queries — mirrors what close() already does for clean shutdown
  this.responseEmitter.eventNames().forEach(event => {
    this.responseEmitter.emit(event, JSON.stringify({
      id: event, success: false,
      error: `Job ended unexpectedly.`
    }));
  });
  this.responseEmitter.removeAllListeners();
  this.onClose?.();
  this.onDied?.();   // ← new: notify IBMi the job has died
}
```

Order matters: `onClose` removes the job from `mapepire.jobs` first, then `onDied` signals `IBMi`.

**Step 4.** Guard `close()` against being called on an already-ended job. `close()` calls `this.send()` at the top, which throws `"SQL client is not yet setup."` when `this.channel` is `undefined`. Add an early return at the very top of `close()`:

```typescript
async close() {
  if (this.status === JobStatus.ENDED) return;
  // ... rest unchanged
```

---

### Phase 2 — Transparent restart (`IBMi.ts`)

**Step 5.** Add two restart-cap fields to the `IBMi` class, near the `private sqlJob` field (line 109):

```typescript
private sqlJobRestartAttempts = 0;
private readonly SQL_JOB_MAX_RESTARTS = 3;
```

**Step 6.** Extract the inline job startup in `connect()` (currently lines ~536–544) into a new private async helper method. This ensures initial startup and restart use identical logic:

```typescript
private async startSqlJob(mapepire: Mapepire): Promise<void> {
  this.sqlJob = await mapepire.newJob(this);
  this.sqlJobRestartAttempts = 0; // reset counter on every successful job start

  this.sqlJob.setOnDied(() => {
    this.sqlJob = undefined;
    // Guard: SSH connection is gone — do not restart into a torn-down connection
    if (!this.client) return;

    // Guard: stop restarting after consecutive failures to avoid masking resource exhaustion
    if (this.sqlJobRestartAttempts >= this.SQL_JOB_MAX_RESTARTS) {
      this.appendOutput(`Mapepire SQL job died ${this.SQL_JOB_MAX_RESTARTS} times in a row. Giving up on auto-restart.\n`);
      return;
    }

    this.sqlJobRestartAttempts++;
    this.appendOutput(`Mapepire SQL job died unexpectedly (attempt ${this.sqlJobRestartAttempts}). Attempting restart...\n`);
    this.startSqlJob(mapepire).catch(e => {
      this.appendOutput(`Failed to restart Mapepire SQL job: ${e.message || e}\n`);
    });
  });

  if (this.sqlJob.id) {
    this.splfUserData = `C4I${this.sqlJob.id.substring(0, this.sqlJob.id.indexOf('/'))}`;
    await this.sqlJob.execute(`CALL QSYS2.QCMDEXC('OVRPRTF FILE(*PRTF) SPOOL(*YES) HOLD(*YES) USRDTA(${this.splfUserData}) SPLFOWN(*CURUSRPRF) OVRSCOPE(*JOB)')`);
  }
}
```

The `onDied` callback:
- Immediately clears `this.sqlJob = undefined` so `sqlRunnerAvailable()` returns `false` during the restart window — callers get a clear error rather than hanging.
- Checks `this.client` before restarting: if `dispose()` was called while `newJob()` was in-flight, `this.client` is already `undefined`, and the newly-created job would leak into a torn-down connection. The guard prevents this.
- Enforces the restart cap: after `SQL_JOB_MAX_RESTARTS` consecutive deaths, auto-restart stops. The counter resets to `0` on every successful `newJob()` call, so a single successful query resets the window.
- Logs the attempt number and any restart failure to the output channel.

> **Note — `mapepire` closure capture:** `startSqlJob` takes `mapepire` as a parameter and the closure captures it from `connect()`. An alternative is to store it as an instance field (`private mapepireComponent: Mapepire | undefined`, set at connect time), making `startSqlJob` a no-arg method. This would be the natural choice if a user-facing "Reconnect SQL" command is added in future.

> **Note — `hasJavaInstalled` bypass:** The existing `connect()` wraps job startup in `if (hasJavaInstalled)`. `startSqlJob` bypasses this check since Java cannot be uninstalled at runtime — a restart scenario by definition means Java was present and working at initial connect. This is intentional.

**Step 7.** Replace the existing inline try/catch block in `connect()` with a call to the new helper:

```typescript
// Before:
try {
  this.sqlJob = await mapepire.newJob(this);
  if (this.sqlJob.id) {
    this.splfUserData = `C4I${this.sqlJob.id.substring(0, this.sqlJob.id.indexOf('/'))}`;
    await this.sqlJob.execute(`CALL QSYS2.QCMDEXC('OVRPRTF FILE(*PRTF) SPOOL(*YES) HOLD(*YES) USRDTA(${this.splfUserData}) SPLFOWN(*CURUSRPRF) OVRSCOPE(*JOB)')`);
  }
} catch (e: any) {
  callbacks.message(`error`, `Failed to start Mapepire SQL job: ${e.message || e}`);
  this.appendOutput(`Mapepire error: ${e.message || e}\n`);
}

// After:
try {
  await this.startSqlJob(mapepire);
} catch (e: any) {
  callbacks.message(`error`, `Failed to start Mapepire SQL job: ${e.message || e}`);
  this.appendOutput(`Mapepire error: ${e.message || e}\n`);
}
```

---

### Phase 3 — Behaviour during the restart window

**No code changes required.** Once `onDied` clears `this.sqlJob = undefined`:

- `sqlRunnerAvailable()` returns `false` — already correct.
- `runSQL` falls through to `throw new Error("There is no way to run SQL on this system.")` — already correct.
- `dispose()` on full disconnect is unaffected — it still checks `if (this.sqlJob)` and clears it.

---

## Relevant Code Locations

| Location | Description |
|---|---|
| `src/api/components/mapepire/sqlJob.ts` line 10 | `private onClose` field — add `onDied` after this |
| `src/api/components/mapepire/sqlJob.ts` lines 157–165 | `private end()` — add in-flight rejection loop and fire `onDied` |
| `src/api/components/mapepire/sqlJob.ts` `close()` | Add `if (this.status === JobStatus.ENDED) return` guard |
| `src/api/IBMi.ts` line 109 | `private sqlJob` field — add `sqlJobRestartAttempts` and `SQL_JOB_MAX_RESTARTS` nearby |
| `src/api/IBMi.ts` lines 536–544 | Inline job startup in `connect()` — replaced by `startSqlJob()` call |
| `src/api/IBMi.ts` lines 1174–1183 | `dispose()` — unchanged |
| `src/api/IBMi.ts` line 1195 | `sqlRunnerAvailable()` — unchanged |

---

## Scope Boundaries

**Included:**
- Death notification from `sshSqlJob` → `IBMi`
- Clearing the dangling `sqlJob` reference immediately on death
- Rejection of in-flight queries at the moment of unexpected death
- Transparent single-job restart with disconnect guard
- Restart cap (max 3 consecutive failures; counter resets on success)
- Guard against `close()` being called on an already-ended job

**Excluded:**
- Job pool / multi-job dispatching (tracked separately in `multijob.md`)
- Exponential back-off between restart attempts
- VS Code status bar "SQL reconnecting…" indicator
- `splfUserData` stability guarantees across restarts

---

## Verification Steps

1. Connect to IBM i; confirm SQL queries work normally.
2. From a 5250 session, `ENDJOB` the Mapepire Java PASE job while VS Code is connected.
3. Confirm the output channel logs `"Mapepire SQL job died unexpectedly. Attempting restart..."`.
4. Confirm subsequent `runSQL` calls succeed within a few seconds without a full user reconnect.
5. Confirm `sqlRunnerAvailable()` returns `false` during the restart window and `true` after.
6. Confirm a full user-initiated `disconnect()` still works cleanly — `dispose()` path unchanged.
7. Confirm `splfUserData` reflects the new job ID after restart.
8. Issue a `runSQL` call and, while it is mid-execution, `ENDJOB` the Mapepire process. Confirm the call receives an error rather than hanging indefinitely.
9. Kill the Mapepire job more than `SQL_JOB_MAX_RESTARTS` (3) times consecutively without allowing any successful query between kills. Confirm auto-restart stops and the output channel shows the "Giving up on auto-restart" message.

---

## Open Questions for Team

1. ~~**Restart cap:**~~ **Resolved — implemented in Step 6.** A hard cap of `SQL_JOB_MAX_RESTARTS = 3` consecutive failures is enforced, with the counter resetting on every successful `newJob()` call. No exponential back-off — a failed `newJob()` returns quickly if IBM i is resource-constrained, so back-off adds complexity with unclear benefit. Revisit if users report a restart storm in practice.

2. **`splfUserData` stability:** After restart, the new job gets a new ID, so `splfUserData` changes. Spooled files created before the restart under the old `USRDTA` value are unaffected, but any code that reads `splfUserData` after a restart will see a new value. Is this currently a concern?

3. **User notification:** Is output-channel logging sufficient, or should a brief `"SQL reconnecting…"` indicator appear in the VS Code status bar?
