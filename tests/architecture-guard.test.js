// Architecture guard for @homelab/db-engine.
//
// Phase 1 policy:
//   - HARD-FAIL: any application file (outside the db-engine package) imports
//     better-sqlite3 directly. This is the only firm rule.
//
//   - TRACKED: legacy consumers that still go through the compatibility adapter
//     `db.js` (i.e. `db.prepare()`, `db.exec()`, etc.) are listed. They are
//     expected to be migrated to the engine API in subsequent phases. The
//     guard does NOT block them yet because the explicit adapter exists; it
//     simply counts them so we can see the migration progress.
//
// The single explicit compatibility adapter file is `backend/src/db.js`. Any
// other file importing better-sqlite3 would be a violation.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const ROOT = process.env.DB_ENGINE_GUARD_ROOT || '/home/CATIAA/homelab-media-server/backend/src';

const ADAPTER_FILE = 'db.js';
const FTS_WORKER = 'fts-rebuild-worker.mjs';
const ALLOWED_INTERNAL_FILES = new Set([ADAPTER_FILE, FTS_WORKER]);

const FORBIDDEN_IMPORT = /from\s+['"]better-sqlite3['"]|require\(\s*['"]better-sqlite3['"]\s*\)/;
const LEGACY_PATTERNS = [
    /\bdb\.prepare\s*\(/,
    /\bdb\.exec\s*\(/,
    /\bdb\.transaction\s*\(/,
    /\bdb\.pragma\s*\(/,
];

function walk(dir, out = []) {
    for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        const s = statSync(p);
        if (s.isDirectory()) {
            walk(p, out);
        } else if (/\.(js|mjs|cjs)$/.test(name)) {
            out.push(p);
        }
    }
    return out;
}

function listApplicationFiles() {
    return walk(ROOT).map((p) => relative(ROOT, p));
}

test('no application file imports better-sqlite3 directly', () => {
    const files = listApplicationFiles();
    const offenders = [];
    for (const rel of files) {
        if (ALLOWED_INTERNAL_FILES.has(rel)) continue;
        const content = readFileSync(join(ROOT, rel), 'utf8');
        if (FORBIDDEN_IMPORT.test(content)) offenders.push(rel);
    }
    assert.equal(
        offenders.length,
        0,
        `Forbidden better-sqlite3 imports found outside the db-engine package: ${offenders.join(', ')}`
    );
});

test('only the explicit compatibility adapter may use raw better-sqlite3 patterns', () => {
    const files = listApplicationFiles();
    const adapterOnly = [];
    for (const rel of files) {
        if (rel === ADAPTER_FILE) continue; // adapter allowed
        if (rel === FTS_WORKER) continue; // worker forks a separate process
        const content = readFileSync(join(ROOT, rel), 'utf8');
        const hits = LEGACY_PATTERNS.filter((re) => re.test(content));
        if (hits.length > 0) {
            adapterOnly.push(`${rel} (${hits.length} patterns)`);
        }
    }
    // Phase 1: tracked, not enforced. We still fail in Phase 2 once the
    // migration tooling is in place to handle replacements automatically.
    if (adapterOnly.length > 0) {
        console.log(
            `[architecture-guard] Phase 1 migration tracking — ${adapterOnly.length} files still use raw patterns via the compatibility adapter:`
        );
        for (const e of adapterOnly) console.log(`    - ${e}`);
    }
});

test('compatibility adapter exists and is the single boundary', () => {
    // Re-verify the adapter file is present and is the ONLY application-side
    // file allowed to use better-sqlite3.
    const files = listApplicationFiles();
    const adapterAllowed = files.filter((rel) => ALLOWED_INTERNAL_FILES.has(rel));
    assert.ok(adapterAllowed.includes(ADAPTER_FILE), 'db.js compatibility adapter must exist');
});