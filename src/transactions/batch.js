// @homelab/db-engine — transactions/batch.js
//
// Generic batched-write primitive.
//
// `batchTransaction(fn, { batchSize })` collects `tx.run()` calls inside `fn`
// and flushes them to SQLite as a single transaction every `batchSize` writes
// (or when the caller signals commit).
//
// Design notes:
//   - This is a generic batch helper, NOT scanner-specific logic.
//   - The engine does NOT interpret SQL. It just groups `tx.run()` calls
//     into a single better-sqlite3 transaction.
//   - Errors mid-batch roll back the entire batch.

export function createBatchHelper(conn, lockStats) {
    /**
     * @param {Function} fn  - receives (tx, commitSignal)
     * @param {Object}   opts - { batchSize: number, onBatchCommitted?: fn }
     * @returns {Object} stats - { batches, totalRuns, errors }
     */
    return function batchTransaction(fn, opts = {}) {
        const batchSize = Math.max(1, opts.batchSize || 500);
        const onBatchCommitted = opts.onBatchCommitted || null;

        if (!conn) throw new Error('engine not started');

        const stats = {
            batches: 0,
            totalRuns: 0,
            errors: 0,
        };

        const pending = [];
        let inBatch = false;

        const flush = () => {
            if (pending.length === 0) return;
            inBatch = true;
            try {
                const txFn = conn.transaction(() => {
                    for (const { sql, params } of pending) {
                        conn.prepare(sql).run(...(params || []));
                    }
                });
                txFn();
                stats.batches += 1;
                if (onBatchCommitted) onBatchCommitted(pending.length);
            } catch (e) {
                stats.errors += 1;
                throw e;
            } finally {
                pending.length = 0;
                inBatch = false;
            }
        };

        const tx = {
            run(sql, params = []) {
                pending.push({ sql, params });
                stats.totalRuns += 1;
                if (pending.length >= batchSize) {
                    flush();
                }
            },
            get(sql, params = []) {
                // Reads inside a batch are pass-through (no batching).
                // They participate in the current transaction via the conn directly.
                if (inBatch) {
                    return conn.prepare(sql).get(...params);
                }
                return conn.prepare(sql).get(...params);
            },
            query(sql, params = []) {
                if (inBatch) {
                    return conn.prepare(sql).all(...params);
                }
                return conn.prepare(sql).all(...params);
            },
            size() {
                return pending.length;
            },
        };

        fn(tx, flush);
        flush();
        return stats;
    };
}
