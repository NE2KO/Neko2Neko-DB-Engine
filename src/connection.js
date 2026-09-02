// @homelab/db-engine — connection.js
//
// Owns the physical SQLite connection and its lifecycle.
// Application code must never see a Database instance.

import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export const DEFAULT_PRAGMAS = Object.freeze({
    journal_mode: 'WAL',
    synchronous: 'NORMAL',
    temp_store: 'MEMORY',
    cache_size: -80000,
    mmap_size: 4294967296,
    page_size: 32768,
    busy_timeout: 5000,
    foreign_keys: 'ON',
});

export function createConnection(dbPath, pragmas = {}) {
    mkdirSync(dirname(dbPath), { recursive: true });
    const merged = { ...DEFAULT_PRAGMAS, ...pragmas };
    const conn = new Database(dbPath);

    for (const [k, v] of Object.entries(merged)) {
        if (v === null || v === undefined) continue;
        conn.pragma(`${k} = ${formatPragmaValue(v)}`);
    }

    conn.__homelabPragmas = Object.freeze({ ...merged });
    return conn;
}

function formatPragmaValue(v) {
    if (typeof v === 'string') return v;
    if (typeof v === 'boolean') return v ? 'ON' : 'OFF';
    return String(v);
}