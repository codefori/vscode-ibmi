# Suggestion: Lazy SQL Job Pool for Mapepire

I'd like to suggest a **lazy job pool** as a relatively low-risk incremental improvement. The idea is to replace the single `this.sqlJob` in `IBMi.ts` with a small pool of up to 3 jobs, dispatching each `runSQL()` call to whichever job is currently idle. The `sshSqlJob.getStatus()` method already exists to detect idle jobs, so the infrastructure is mostly in place — the changes are concentrated in two areas.

The critical benefit is **dispatching** — rather than every SQL call waiting in a single queue, each call is routed immediately to whichever job in the pool is currently idle. This means independent queries (e.g., fetching member lists, object lists, and library information) no longer block each other and can effectively proceed in parallel simply by virtue of landing on different idle jobs.

**Pool sizing:** I suggest a pool of **3 jobs total** — one primary job started at connection time (as today), plus up to two additional jobs spawned on-demand when all current jobs are busy. This covers virtually all realistic concurrent query scenarios without multiplying JVM memory overhead unnecessarily. Each `--single` job carries real resource cost on the IBM i side (a PASE job table entry plus JVM heap memory), so beyond 3 the returns diminish quickly relative to the cost.

**On-demand startup:** Additional jobs are spawned lazily in the background only when needed, so the user never waits on their startup. Once a job is warm it remains in the pool for reuse, and the pool could shrink back during idle periods.

The dispatch logic itself is straightforward to implement given the existing `getStatus()` infrastructure, but it is deliberate code that would need to live in the extension. All changes are self-contained within `IBMi.ts` — the existing `sshSqlJob` and `Mapepire` classes require no modification.

---

## Change 1 — `src/api/IBMi.ts`: Replace the single job field with a pool

**Current:**
```typescript
private sqlJob: sshSqlJob | undefined;
```

**Suggested:**
```typescript
private sqlJobs: sshSqlJob[] = [];
private readonly SQL_JOB_POOL_MAX = 3;
```

---

## Change 2 — `src/api/IBMi.ts`: Add a pool dispatcher method

Add this new private method:

```typescript
private async getAvailableSqlJob(mapepire: Mapepire): Promise<sshSqlJob | undefined> {
  // Return any currently idle job
  const idleJob = this.sqlJobs.find(j => j.getStatus() === JobStatus.READY);
  if (idleJob) return idleJob;

  // Spawn a new job on-demand if the pool isn't full
  if (this.sqlJobs.length < this.SQL_JOB_POOL_MAX) {
    try {
      const newJob = await mapepire.newJob(this);
      this.sqlJobs.push(newJob);
      return newJob;
    } catch (e: any) {
      this.appendOutput(`Failed to spawn additional SQL job: ${e.message || e}\n`);
    }
  }

  // Pool is full and all busy — fall back to least-recently-used
  return this.sqlJobs[0];
}
```

---

## Change 3 — `src/api/IBMi.ts`: Update connect-time startup to seed the pool

**Current:**
```typescript
this.sqlJob = await mapepire.newJob(this);
if (this.sqlJob.id) {
  this.splfUserData = `C4I${this.sqlJob.id.substring(0, this.sqlJob.id.indexOf('/'))}`;
  await this.sqlJob.execute(`CALL QSYS2.QCMDEXC('OVRPRTF FILE(*PRTF) SPOOL(*YES) HOLD(*YES) USRDTA(${this.splfUserData}) SPLFOWN(*CURUSRPRF) OVRSCOPE(*JOB)')`);
}
```

**Suggested:**
```typescript
const firstJob = await mapepire.newJob(this);
this.sqlJobs.push(firstJob);
if (firstJob.id) {
  this.splfUserData = `C4I${firstJob.id.substring(0, firstJob.id.indexOf('/'))}`;
  await firstJob.execute(`CALL QSYS2.QCMDEXC('OVRPRTF FILE(*PRTF) SPOOL(*YES) HOLD(*YES) USRDTA(${this.splfUserData}) SPLFOWN(*CURUSRPRF) OVRSCOPE(*JOB)')`);
}
```

---

## Change 4 — `src/api/IBMi.ts`: Update `runSQL()` to dispatch from the pool

**Current:**
```typescript
async runSQL(statements: string | string[], options: { bindings?: BindingValue[] } = {}): Promise<Tools.DB2Row[]> {
  if (this.sqlJob) {
    // ... uses this.sqlJob directly throughout
  }
  throw new Error(`There is no way to run SQL on this system.`);
}
```

**Suggested:** Replace the `this.sqlJob` guard and all internal references:

```typescript
async runSQL(statements: string | string[], options: { bindings?: BindingValue[] } = {}): Promise<Tools.DB2Row[]> {
  const mapepire = this.getComponent<Mapepire>(Mapepire.ID);
  const sqlJob = mapepire ? await this.getAvailableSqlJob(mapepire) : this.sqlJobs[0];

  if (sqlJob) {
    // Replace all `this.sqlJob` references in the existing method body with `sqlJob`
    // ... (rest of method unchanged, just using `sqlJob` instead of `this.sqlJob`)
  }
  throw new Error(`There is no way to run SQL on this system.`);
}
```

---

## Change 5 — `src/api/IBMi.ts`: Update `dispose()` and `sqlRunnerAvailable()`

**Current:**
```typescript
if (this.sqlJob) {
  delete this.sqlJob;
  delete this.splfUserData;
}

public sqlRunnerAvailable() {
  return this.sqlJob !== undefined;
}
```

**Suggested:**
```typescript
if (this.sqlJobs.length > 0) {
  this.sqlJobs = [];
  delete this.splfUserData;
}

public sqlRunnerAvailable() {
  return this.sqlJobs.length > 0;
}
```

---

I recognize this may already be on your roadmap, as I am only concerned about user-reactions if it "suddenly" starts running slow.
