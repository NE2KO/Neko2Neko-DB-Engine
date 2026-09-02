# @homelab/db-engine

Standalone persistence engine for the homelab-media-server ecosystem.

## Philosophy

> **Application owns intent. DB Engine owns persistence.**

The application should express:

- read this
- get this
- insert/update/delete this
- execute a transaction
- ask for health
- request maintenance

The application must NOT decide:

- which physical database is active
- where the database physically lives internally
- how persistence is configured
- how SQLite connections are managed
- how WAL is maintained
- how recovery will eventually work
- how replication will eventually work
- how backup will eventually work

This is **not** a thin SQLite wrapper. The engine owns the connection lifecycle,
the schema, the prepared-statement registry, transactions, health, WAL, and
backup. Phase 1 establishes the boundary; later phases add journal, pointer,
passive replication, and failover without changing application code.

## API

```js
import { createDbEngine } from '@homelab/db-engine';

const engine = createDbEngine({
    dbPath: './data/media.db', // or env MEDIA_DB_PATH resolved by host
    pragmas: { /* overrides */ },
});

// Lifecycle
await engine.start();
const health = await engine.health();
await engine.stop();

// CRUD
const rows = await engine.query('SELECT * FROM files WHERE dir_id = ?', [folderId]);
const row  = await engine.get('SELECT * FROM files WHERE id = ?', [id]);
await engine.run('UPDATE files SET ...');

// Transaction
const tx = engine.transaction(() => {
    engine.run('INSERT INTO ...');
    engine.run('UPDATE ...');
});
tx();

// Statement registry (controlled, names preserved from legacy db.js)
const stmts = engine.getStmts();
stmts.upsertFile.run({ ... });

// Maintenance
engine.walCheckpoint('PASSIVE');
const meta = await engine.backupAsync('./backups/media.db');
```

## Lifecycle

```
create → start → use → stop
```

`start()` opens the connection, applies the schema, seeds default settings,
records the schema version, and prepares the statement registry.

`stop()` closes the connection. The engine may be restarted by calling
`start()` again.

## What the engine owns

- **Connection**: better-sqlite3 connection with WAL, busy_timeout=5000,
  synchronous=NORMAL, temp_store=MEMORY, cache_size=-80000, mmap_size=4GB,
  page_size=32768.
- **Schema**: all tables, indexes, triggers, FTS5 virtual table, and
  legacy ALTER TABLE guards. Future phases will introduce `migrations/`.
- **Statements**: the controlled registry (150+ named prepared statements,
  matching the legacy `stmts.*` API surface so existing consumers keep
  working through the compatibility adapter).
- **Transactions**: `engine.transaction(fn)` returns a synchronous function
  matching better-sqlite3 transaction semantics, including automatic
  rollback on throw.
- **Health**: `engine.health()` reports reachability, integrity, WAL mode,
  busy_timeout, page count, WAL file size.
- **WAL checkpoint**: `engine.walCheckpoint(mode)`.
- **Backup**: `engine.backupAsync(dest)` uses better-sqlite3's native
  page-by-page backup API. Safe under concurrent writes.
- **Schema versioning**: `engine.getVersion()` returns the current schema
  version, written to a `schema_meta` table by the engine on start.
- **Batch writes (Phase 1.5)**: `engine.batchTransaction(fn, { batchSize })`
  collects `tx.run()` calls and flushes them to a single SQLite transaction
  every N writes (or on explicit `commit()` signal). Returns
  `{ batches, totalRuns, errors }`.
- **Busy retry (Phase 1.5)**: `engine.runWithRetry(sql, params, opts)` retries
  on `SQLITE_BUSY` (exponential backoff 50ms→500ms cap, max 3 attempts).
  Does NOT retry on `SQLITE_LOCKED`. Tracks busy wait metrics in
  `engine.getLockStats()`.
- **Lock telemetry (Phase 1.5)**: `engine.getLockStats()` returns
  `{ busyWaits, busyExhaustedCount, lockedCount, lockWaitMs, lastBusyWait,
  lastLockedAt }`. Reset via `engine.resetLockStats()`.

## What the engine does NOT expose

- `getSqliteConnection()` — the underlying Database is hidden.
- `getActiveDatabase()` — ACTIVE/PASSIVE roles are Phase 3 concerns.
- `getJournalFile()` / `getPointerFile()` — Phase 2 concerns.
- `getRawConnection()` — there is no application-side backdoor.

The application's only way to interact with persistence is through the
methods above.

## Compatibility

The homelab-media-server backend ships a single explicit compatibility
adapter (`backend/src/db.js`) that delegates ALL persistence to this
engine. Existing application code that imports `db`, `stmts`, `setupFTS`,
`deferredDbInit`, or `updateAllRecursiveCounts` continues to work without
modification. The adapter is the ONLY application-side file allowed to
require `better-sqlite3`.

Application consumers should migrate incrementally to:

```js
import { createDbEngine, engine } from '@homelab/db-engine';
// or, in the legacy backend, from the adapter:
import { engine } from '../db.js';
await engine.health();
await engine.query(...);
```

## Architecture guard

The engine ships with an architecture guard test that fails the build if any
application file (outside the db-engine package) imports `better-sqlite3`
directly. The guard also tracks — but does not yet fail on — legacy
consumers still using `db.prepare()` / `db.exec()` patterns through the
adapter, so migration progress is visible.

Run it with:

```
node --test tests/architecture-guard.test.js
```

## Future roadmap

| Phase | Goal | Boundary impact |
|---|---|---|
| Phase 1 | Core boundary + adapter | Now |
| Phase 1.5 | Scanner batching + retry | Engine-internal |
| Phase 2 | Journal + Pointer | Engine-internal |
| Phase 3 | Passive replication | Engine-internal |
| Phase 4 | Backup rotation | Engine API |
| Phase 5 | Failover + state machine | Engine API |

None of the future phases require application-side changes. The engine API
is designed to grow without touching consumers.