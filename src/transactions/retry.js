// @homelab/db-engine — transactions/retry.js
//
// Retry policy for SQLITE_BUSY errors.
//
// Policy:
//   - SQLITE_BUSY   → retry, max attempts (default 3), exponential backoff
//                     50ms → 100ms → 200ms → ... cap at 500ms.
//   - SQLITE_LOCKED → no retry. Surface immediately to caller.
//   - Other errors  → no retry.
//
// `lockStats` (if provided) is an object that tracks busy wait metrics.

const SQLITE_BUSY_CODE = 'SQLITE_BUSY';
const SQLITE_LOCKED_CODE = 'SQLITE_LOCKED';

function isBusyError(e) {
    if (!e) return false;
    return e.code === SQLITE_BUSY_CODE || e.errno === 5;
}

function isLockedError(e) {
    if (!e) return false;
    return e.code === SQLITE_LOCKED_CODE || e.errno === 6;
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * @param {Function} runFn  - () => any that performs the SQL operation
 * @param {Object}   opts   - { retries, backoff, lockStats }
 * @returns any - the result of runFn
 */
export async function runWithRetry(runFn, opts = {}) {
    const maxRetries = Math.max(0, opts.retries ?? 3);
    const lockStats = opts.lockStats || null;
    const sleepFn = opts.sleep || sleep;

    let attempt = 0;
    let lastErr = null;

    while (attempt <= maxRetries) {
        try {
            const result = runFn();
            return result;
        } catch (e) {
            lastErr = e;

            if (isLockedError(e)) {
                if (lockStats) {
                    lockStats.lockedCount = (lockStats.lockedCount || 0) + 1;
                }
                throw e;
            }

            if (!isBusyError(e)) {
                throw e;
            }

            if (attempt >= maxRetries) {
                if (lockStats) {
                    lockStats.busyExhaustedCount = (lockStats.busyExhaustedCount || 0) + 1;
                }
                break;
            }

            // Track busy wait
            const startWait = Date.now();
            if (lockStats) {
                lockStats.busyWaits = (lockStats.busyWaits || 0) + 1;
                lockStats.lastBusyWait = startWait;
            }

            // Exponential backoff: 50ms, 100ms, 200ms, 400ms, cap 500ms
            const backoff = Math.min(500, 50 * Math.pow(2, attempt));
            await sleepFn(backoff);

            if (lockStats) {
                const waited = Date.now() - startWait;
                lockStats.lockWaitMs = (lockStats.lockWaitMs || 0) + waited;
            }

            attempt += 1;
        }
    }

    throw lastErr;
}
