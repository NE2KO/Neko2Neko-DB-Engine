// @homelab/db-engine — internal/lock-stats.js
//
// Centralized lock telemetry counters.
//
// All counters are plain JS numbers (atomic in the single-threaded Node.js
// event loop). Exposed via engine.getLockStats().

export function createLockStats() {
    return {
        busyWaits: 0,
        busyExhaustedCount: 0,
        lockedCount: 0,
        lockWaitMs: 0,
        lastBusyWait: null,
        lastLockedAt: null,
        snapshot() {
            return {
                busyWaits: this.busyWaits,
                busyExhaustedCount: this.busyExhaustedCount,
                lockedCount: this.lockedCount,
                lockWaitMs: this.lockWaitMs,
                lastBusyWait: this.lastBusyWait,
                lastLockedAt: this.lastLockedAt,
            };
        },
        reset() {
            this.busyWaits = 0;
            this.busyExhaustedCount = 0;
            this.lockedCount = 0;
            this.lockWaitMs = 0;
            this.lastBusyWait = null;
            this.lastLockedAt = null;
        },
    };
}
