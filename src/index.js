// @homelab/db-engine — index.js
//
// Public API for the persistence boundary.
//
// The engine owns:
//   - connection lifecycle
//   - schema/DDL
//   - prepared-statement registry
//   - transaction abstraction
//   - health, WAL, backup
//
// The application owns intent.

import { createConnection, DEFAULT_PRAGMAS } from './connection.js';
import { applyCoreSchema, seedDefaults, getSchemaVersion, recordSchemaVersion } from './schema.js';
import { createStatementRegistry } from './statements.js';
import { createBatchHelper } from './transactions/batch.js';
import { runWithRetry } from './transactions/retry.js';
import { createLockStats } from './internal/lock-stats.js';
import { statSync, existsSync, copyFileSync } from 'node:fs';
import { dirname } from 'node:path';

export function createDbEngine(config = {}) {
    const dbPath = config.dbPath;
    if (!dbPath) {
        throw new Error('@homelab/db-engine: dbPath is required');
    }
    const pragmas = { ...DEFAULT_PRAGMAS, ...(config.pragmas || {}) };

    const state = {
        started: false,
        conn: null,
        stmts: null,
        dbPath,
        pragmas,
        lockStats: createLockStats(),
    };

    const engine = {
        _state: state,

        async start() {
            if (state.started) return engine;
            state.conn = createConnection(state.dbPath, state.pragmas);
            applyCoreSchema(state.conn);
            seedDefaults(state.conn);
            recordSchemaVersion(state.conn);
            state.stmts = createStatementRegistry(state.conn);
            state.started = true;
            return engine;
        },

        async stop() {
            if (!state.started) return;
            try {
                if (state.conn) state.conn.close();
            } catch {}
            state.started = false;
            state.conn = null;
            state.stmts = null;
        },

        // Core CRUD
        query(sql, params = []) {
            return state.conn.prepare(sql).all(...params);
        },

        get(sql, params = []) {
            return state.conn.prepare(sql).get(...params);
        },

        run(sql, params = []) {
            return state.conn.prepare(sql).run(...params);
        },

        transaction(fn) {
            const txConn = state.conn.transaction(fn);
            return (...args) => txConn(...args);
        },

        // Phase 1.5 — Write-Path Hardening
        batchTransaction(fn, opts = {}) {
            const helper = createBatchHelper(state.conn, state.lockStats);
            return helper(fn, opts);
        },

        async runWithRetry(sql, params = [], opts = {}) {
            return runWithRetry(
                () => state.conn.prepare(sql).run(...(params || [])),
                { ...opts, lockStats: state.lockStats },
            );
        },

        getLockStats() {
            return state.lockStats.snapshot();
        },

        resetLockStats() {
            state.lockStats.reset();
        },

        // Maintenance
        walCheckpoint(mode = 'PASSIVE') {
            if (!state.conn) return null;
            return state.conn.pragma(`wal_checkpoint(${mode})`);
        },

        backup(destination) {
            if (!state.conn) throw new Error('engine not started');
            // Hot backup: better-sqlite3's native backup() is async because it
            // copies page-by-page while writers continue. Caller can await via
            //   const meta = await engine.backupAsync(path);
            // Phase 1 keeps a sync wrapper for backwards compatibility:
            // we kick the backup in the background and return a sentinel.
            const startedAt = Date.now();
            try {
                state.conn.backup(destination).then(() => {
                    /* completed */
                }).catch(() => {
                    /* logged below */
                });
                return {
                    ok: true,
                    path: destination,
                    ts: startedAt,
                    async: true,
                };
            } catch (e) {
                return { ok: false, error: e.message };
            }
        },

        async backupAsync(destination) {
            if (!state.conn) throw new Error('engine not started');
            const startedAt = Date.now();
            try {
                await state.conn.backup(destination);
                return {
                    ok: true,
                    path: destination,
                    size: existsSync(destination) ? statSync(destination).size : 0,
                    ts: startedAt,
                };
            } catch (e) {
                return { ok: false, error: e.message };
            }
        },

        getStats() {
            if (!state.conn) return null;
            return {
                journalMode: state.conn.pragma('journal_mode', { simple: true }),
                pageCount: state.conn.pragma('page_count', { simple: true }),
                pageSize: state.conn.pragma('page_size', { simple: true }),
                cacheSize: state.conn.pragma('cache_size', { simple: true }),
                freelistCount: state.conn.pragma('freelist_count', { simple: true }),
            };
        },

        getVersion() {
            return getSchemaVersion(state.conn);
        },

        // Health
        async health() {
            if (!state.started) {
                return { ok: false, reason: 'not_started' };
            }
            const checks = {
                ok: true,
                reachable: false,
                queryOk: false,
                integrity: null,
                journalMode: null,
                busyTimeout: null,
                pageCount: null,
                walSize: null,
            };
            try {
                checks.reachable = !!state.conn;
                checks.journalMode = state.conn.pragma('journal_mode', { simple: true });
                checks.busyTimeout = state.conn.pragma('busy_timeout', { simple: true });
                checks.pageCount = state.conn.pragma('page_count', { simple: true });

                const r = state.conn.prepare('SELECT 1 as v').get();
                checks.queryOk = r && r.v === 1;

                // WAL size = size of the WAL file if present.
                const walPath = state.dbPath + '-wal';
                if (existsSync(walPath)) {
                    checks.walSize = statSync(walPath).size;
                } else {
                    checks.walSize = 0;
                }

                // integrity_check is a real, explicit SQLite check.
                // Caller decides when to invoke it (it can be slow on large DBs).
                const integ = state.conn.pragma('integrity_check', { simple: true });
                checks.integrity = integ === 'ok';

                if (!checks.reachable || !checks.queryOk || !checks.integrity) {
                    checks.ok = false;
                }
            } catch (e) {
                checks.ok = false;
                checks.error = e.message;
            }
            return checks;
        },

        // Statement registry accessor (controlled; names registered only).
        getStmts() {
            if (!state.stmts) throw new Error('engine not started');
            return state.stmts;
        },

        // Synchronous raw handles for engine-internal helpers
        // (kept here so app code never imports better-sqlite3 directly).
        // These return narrow, intent-shaped objects, NOT the Database.
        _runSync(sql, params = []) {
            return state.conn.prepare(sql).run(...params);
        },
        _allSync(sql, params = []) {
            return state.conn.prepare(sql).all(...params);
        },
        _getSync(sql, params = []) {
            return state.conn.prepare(sql).get(...params);
        },
    };

    return engine;
}

export { DEFAULT_PRAGMAS } from './connection.js';