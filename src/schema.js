// @homelab/db-engine — schema.js
//
// Owns DDL: tables, indexes, triggers, FTS5.
// Application must never call db.exec() / db.prepare("CREATE...").
//
// Phase 1 schema mirrors the existing homelab-media-server schema exactly.
// Future phases add versioned migrations.

export const CORE_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS folders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    path TEXT UNIQUE NOT NULL,
    parent_id INTEGER,
    depth INTEGER DEFAULT 0,
    file_count INTEGER DEFAULT 0,
    total_size INTEGER DEFAULT 0,
    last_scanned INTEGER,
    last_updated INTEGER
  );

  CREATE TABLE IF NOT EXISTS files (
    id TEXT PRIMARY KEY,
    dir_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    ext TEXT,
    size INTEGER NOT NULL DEFAULT 0,
    mtime INTEGER NOT NULL DEFAULT 0,
    duration REAL DEFAULT 0,
    has_thumb INTEGER DEFAULT 0,
    thumb_cache_path TEXT,
    last_accessed INTEGER DEFAULT 0,
    access_count INTEGER DEFAULT 0,
    last_verified INTEGER DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT 0,
    codec_info TEXT,
    is_stream_compatible INTEGER DEFAULT 0,
    youtube_id TEXT,
    video_offset REAL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS folder_generation (
    folder_id INTEGER PRIMARY KEY,
    generation INTEGER NOT NULL DEFAULT 0
  );
`;

export const TRIGGERS_SQL = `
  DROP TRIGGER IF EXISTS folder_gen_ai;
  DROP TRIGGER IF EXISTS folder_gen_ad;
  DROP TRIGGER IF EXISTS folder_gen_au;
  CREATE TRIGGER folder_gen_ai AFTER INSERT ON files BEGIN
    INSERT INTO folder_generation(folder_id) VALUES (NEW.dir_id)
      ON CONFLICT(folder_id) DO UPDATE SET generation = generation + 1;
  END;
  CREATE TRIGGER folder_gen_ad AFTER DELETE ON files BEGIN
    INSERT INTO folder_generation(folder_id) VALUES (OLD.dir_id)
      ON CONFLICT(folder_id) DO UPDATE SET generation = generation + 1;
  END;
  CREATE TRIGGER folder_gen_au AFTER UPDATE ON files BEGIN
    INSERT INTO folder_generation(folder_id) VALUES (NEW.dir_id)
      ON CONFLICT(folder_id) DO UPDATE SET generation = generation + 1;
    INSERT INTO folder_generation(folder_id)
      SELECT NEW.dir_id WHERE OLD.dir_id != NEW.dir_id
      ON CONFLICT(folder_id) DO UPDATE SET generation = generation + 1;
  END;
`;

// Auxiliary tables owned by the engine for Phase 1.
// Each subsystem's domain DDL stays colocated inside the engine until
// it deserves its own engine. media_visibility remains owned by Media Engine.
export const AUX_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS playlists (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    path TEXT UNIQUE NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    creator TEXT DEFAULT '',
    annotation TEXT,
    info TEXT,
    image TEXT,
    track_count INTEGER DEFAULT 0,
    total_duration INTEGER DEFAULT 0,
    total_size INTEGER DEFAULT 0,
    available_tracks INTEGER DEFAULT 0,
    missing_tracks INTEGER DEFAULT 0,
    last_scanned INTEGER,
    last_updated INTEGER,
    created_at INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS playlist_tracks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    playlist_id INTEGER NOT NULL,
    track_index INTEGER NOT NULL,
    location TEXT NOT NULL,
    resolved_path TEXT,
    title TEXT DEFAULT '',
    artist TEXT DEFAULT '',
    album TEXT DEFAULT '',
    duration INTEGER,
    artwork TEXT,
    track_num INTEGER,
    file_exists INTEGER DEFAULT 0,
    file_size INTEGER DEFAULT 0,
    file_mtime INTEGER,
    FOREIGN KEY (playlist_id) REFERENCES playlists(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_playlist_tracks_playlist ON playlist_tracks(playlist_id);
  CREATE INDEX IF NOT EXISTS idx_playlist_tracks_index ON playlist_tracks(playlist_id, track_index);

  CREATE TABLE IF NOT EXISTS uploads (
    id TEXT PRIMARY KEY,
    filename TEXT NOT NULL,
    target_path TEXT NOT NULL,
    size INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'pending',
    uploaded INTEGER NOT NULL DEFAULT 0,
    error TEXT,
    checksum TEXT,
    type TEXT,
    ext TEXT,
    started_at INTEGER,
    completed_at INTEGER,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS adb_transactions (
    id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL,
    device TEXT NOT NULL,
    src TEXT NOT NULL,
    dst TEXT NOT NULL,
    size INTEGER NOT NULL DEFAULT 0,
    mtime INTEGER NOT NULL DEFAULT 0,
    mode TEXT NOT NULL DEFAULT '644',
    name TEXT NOT NULL,
    relative_path TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    attempts INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 3,
    overwrite INTEGER NOT NULL DEFAULT 0,
    error TEXT,
    error_type TEXT,
    transferred_bytes INTEGER NOT NULL DEFAULT 0,
    speed INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    started_at INTEGER,
    completed_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_adb_tx_job ON adb_transactions(job_id);
  CREATE INDEX IF NOT EXISTS idx_adb_tx_status ON adb_transactions(status);

  CREATE TABLE IF NOT EXISTS adb_jobs (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    device_id TEXT NOT NULL,
    device_serial TEXT DEFAULT '',
    device_ip TEXT DEFAULT '',
    sources_json TEXT NOT NULL,
    dest TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued',
    conflict_strategy TEXT,
    apply_all INTEGER DEFAULT 0,
    apply_all_decision TEXT,
    max_workers INTEGER DEFAULT 3,
    engine TEXT DEFAULT 'transactional',
    progress REAL DEFAULT 0,
    speed INTEGER DEFAULT 0,
    current_file TEXT,
    error TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    completed_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_adb_jobs_status ON adb_jobs(status);

  CREATE TABLE IF NOT EXISTS conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    local_id TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT 'New Chat',
    pinned INTEGER NOT NULL DEFAULT 0,
    archived INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    metadata TEXT NOT NULL DEFAULT '{}'
  );
  CREATE INDEX IF NOT EXISTS idx_conversations_local_id ON conversations(local_id);
  CREATE INDEX IF NOT EXISTS idx_conversations_pinned ON conversations(pinned);
  CREATE INDEX IF NOT EXISTS idx_conversations_updated ON conversations(updated_at DESC);

  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    tool_calls TEXT,
    tool_results TEXT,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, id ASC);

  CREATE TABLE IF NOT EXISTS ai_provider_status (
    provider_id TEXT PRIMARY KEY,
    status TEXT NOT NULL DEFAULT 'disconnected',
    last_verified_at INTEGER,
    latency_ms INTEGER,
    models_json TEXT DEFAULT '[]',
    models_cached_at INTEGER,
    error_message TEXT
  );

  CREATE TABLE IF NOT EXISTS ai_conversation_settings (
    conversation_id INTEGER PRIMARY KEY,
    model TEXT,
    temperature REAL,
    max_tokens INTEGER,
    system_prompt TEXT,
    web_search INTEGER DEFAULT 0,
    vision INTEGER DEFAULT 0,
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS ai_memories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER,
    content TEXT NOT NULL,
    confidence REAL DEFAULT 0.5,
    pinned INTEGER DEFAULT 0,
    enabled INTEGER DEFAULT 1,
    tags TEXT DEFAULT '[]',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE SET NULL
  );
  CREATE INDEX IF NOT EXISTS idx_memories_conversation ON ai_memories(conversation_id);
  CREATE INDEX IF NOT EXISTS idx_memories_enabled ON ai_memories(enabled, pinned DESC);

  CREATE TABLE IF NOT EXISTS ai_context_summaries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER NOT NULL,
    summary TEXT NOT NULL,
    message_range_start INTEGER,
    message_range_end INTEGER,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_summaries_conversation ON ai_context_summaries(conversation_id);

  CREATE TABLE IF NOT EXISTS ai_pinned_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER NOT NULL,
    message_id INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
    FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
    UNIQUE(conversation_id, message_id)
  );
  CREATE INDEX IF NOT EXISTS idx_pinned_conversation ON ai_pinned_messages(conversation_id);

  CREATE TABLE IF NOT EXISTS ai_model_preferences (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    provider_id TEXT NOT NULL,
    model_id TEXT NOT NULL,
    favorited INTEGER DEFAULT 0,
    hidden INTEGER DEFAULT 0,
    last_used_at INTEGER,
    UNIQUE(provider_id, model_id)
  );

  CREATE TABLE IF NOT EXISTS listening_stats (
    trackId TEXT PRIMARY KEY,
    playCount INTEGER NOT NULL DEFAULT 0,
    listenedSeconds INTEGER NOT NULL DEFAULT 0,
    lastPlayedAt INTEGER,
    displayName TEXT,
    updatedAt INTEGER
  );

  CREATE TABLE IF NOT EXISTS listening_sessions (
    sessionId TEXT PRIMARY KEY,
    trackId TEXT NOT NULL,
    playDelta INTEGER NOT NULL DEFAULT 0,
    listenedDelta INTEGER NOT NULL DEFAULT 0,
    createdAt INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_listening_stats_updated ON listening_stats(updatedAt DESC);
  CREATE INDEX IF NOT EXISTS idx_listening_stats_plays ON listening_stats(playCount DESC);
  CREATE INDEX IF NOT EXISTS idx_listening_stats_listened ON listening_stats(listenedSeconds DESC);
`;

// Files/Folders extra indexes + safe ALTER for existing DBs.
export const INDEXES_SQL = `
  CREATE INDEX IF NOT EXISTS idx_files_cursor ON files(dir_id, created_at DESC, id DESC);
  CREATE INDEX IF NOT EXISTS idx_files_name ON files(dir_id, name COLLATE NOCASE, id);
  CREATE INDEX IF NOT EXISTS idx_files_mtime ON files(dir_id, mtime DESC, id);
  CREATE INDEX IF NOT EXISTS idx_files_size ON files(dir_id, size DESC, id);
  CREATE INDEX IF NOT EXISTS idx_folders_parent ON folders(parent_id);
  CREATE INDEX IF NOT EXISTS idx_folders_path ON folders(path);
  CREATE INDEX IF NOT EXISTS idx_playlists_deleted ON playlists(deleted_at);
`;

export const LEGACY_ALTERS = [
    'ALTER TABLE files ADD COLUMN thumb_cache_path TEXT',
    'ALTER TABLE files ADD COLUMN codec_info TEXT',
    'ALTER TABLE files ADD COLUMN is_stream_compatible INTEGER DEFAULT 0',
    'ALTER TABLE files ADD COLUMN uploader_metadata TEXT',
    'ALTER TABLE files ADD COLUMN checksum TEXT',
    'ALTER TABLE files ADD COLUMN created_at_embedded INTEGER',
    'ALTER TABLE files ADD COLUMN modified_at_fs INTEGER',
    'ALTER TABLE files ADD COLUMN uploaded_at INTEGER',
    'ALTER TABLE files ADD COLUMN metadata_source TEXT',
    'ALTER TABLE files ADD COLUMN title TEXT',
    'ALTER TABLE files ADD COLUMN artist TEXT',
    'ALTER TABLE files ADD COLUMN album TEXT',
    'ALTER TABLE files ADD COLUMN genre TEXT',
    'ALTER TABLE files ADD COLUMN lyrics TEXT',
    'ALTER TABLE files ADD COLUMN lyrics_synced TEXT',
    'ALTER TABLE files ADD COLUMN lyrics_romaji TEXT',
    'ALTER TABLE files ADD COLUMN cover_source TEXT',
    'ALTER TABLE files ADD COLUMN is_favorite INTEGER DEFAULT 0',
    'ALTER TABLE files ADD COLUMN is_locked INTEGER DEFAULT 0',
    'ALTER TABLE files ADD COLUMN youtube_id TEXT',
    'ALTER TABLE files ADD COLUMN video_offset REAL DEFAULT 0',
    'ALTER TABLE files ADD COLUMN faststart_state INTEGER DEFAULT NULL',
    'ALTER TABLE folders ADD COLUMN recursive_file_count INTEGER',
    'ALTER TABLE folders ADD COLUMN recursive_total_size INTEGER',
    'ALTER TABLE playlists ADD COLUMN deleted_at INTEGER',
    'ALTER TABLE send_queue ADD COLUMN hold_until INTEGER NOT NULL DEFAULT 0',
];

export const LEGACY_INDEX_ALTERS = [
    'CREATE INDEX IF NOT EXISTS idx_files_favorite ON files(is_favorite DESC, id)',
    'CREATE INDEX IF NOT EXISTS idx_files_locked ON files(is_locked DESC, id)',
];

// Settings table is a special case (single row for some, key/value for others).
// Phase 1: keep one canonical settings table owned by the engine.
export const SETTINGS_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT,
    type TEXT,
    category TEXT,
    label TEXT,
    description TEXT,
    options TEXT,
    updated_at INTEGER NOT NULL
  );
`;

// FTS5 setup. Mirrors the original db.js behavior: create virtual table + sync triggers.
export const FTS_SCHEMA_SQL = `
  CREATE VIRTUAL TABLE IF NOT EXISTS files_fts USING fts5(name, content='files', tokenize='unicode61 remove_diacritics 1');
  CREATE TRIGGER IF NOT EXISTS files_ai AFTER INSERT ON files BEGIN
    INSERT INTO files_fts(rowid, name) VALUES (NEW.rowid, NEW.name);
  END;
  CREATE TRIGGER IF NOT EXISTS files_ad AFTER DELETE ON files BEGIN
    INSERT INTO files_fts(files_fts, rowid, name) VALUES('delete', OLD.rowid, OLD.name);
  END;
  CREATE TRIGGER IF NOT EXISTS files_au AFTER UPDATE ON files BEGIN
    INSERT INTO files_fts(files_fts, rowid, name) VALUES('delete', OLD.rowid, OLD.name);
    INSERT INTO files_fts(rowid, name) VALUES (NEW.rowid, NEW.name);
  END;
`;

// Outbound scheduler + Telegram bot domain tables.
// These belong to the engine in Phase 1 because they live in the same DB and
// several routes import them together. Future refactors can promote them to
// their own engine.
export const OUTBOUND_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS send_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    file_id TEXT NOT NULL,
    target TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    error TEXT,
    hold_until INTEGER NOT NULL DEFAULT 0,
    completed_at INTEGER,
    caption TEXT NOT NULL DEFAULT '',
    sort_order INTEGER,
    scheduled_at INTEGER,
    processing_started_at INTEGER,
    retry_count INTEGER NOT NULL DEFAULT 0,
    attempt_log TEXT,
    pinned INTEGER NOT NULL DEFAULT 0,
    debug INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_send_queue_status ON send_queue(status);

  CREATE TABLE IF NOT EXISTS send_rate_limit (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    date TEXT NOT NULL,
    count INTEGER NOT NULL DEFAULT 0,
    last_send_at INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS send_counters (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    telegram_count INTEGER NOT NULL DEFAULT 0,
    whatsapp_count INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS send_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    tick_enabled INTEGER NOT NULL DEFAULT 1,
    debug_mode INTEGER NOT NULL DEFAULT 0,
    per_day INTEGER NOT NULL DEFAULT 3,
    share_only_target TEXT
  );

  CREATE TABLE IF NOT EXISTS telegram_allowed_chats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id TEXT UNIQUE NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS telegram_bot_tasks (
    user_msg_id INTEGER PRIMARY KEY,
    chat_id TEXT NOT NULL,
    queued_msg_id INTEGER,
    task_ids TEXT NOT NULL,
    total INTEGER NOT NULL DEFAULT 0,
    finished INTEGER NOT NULL DEFAULT 0,
    cleaned INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS telegram_task_link (
    task_id INTEGER PRIMARY KEY,
    user_msg_id INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS telegram_ephemeral (
    msg_id INTEGER PRIMARY KEY,
    chat_id TEXT NOT NULL,
    delete_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS telegram_processed (
    msg_id INTEGER PRIMARY KEY,
    ts INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS telegram_audio_bot_tasks (
    user_msg_id TEXT PRIMARY KEY,
    chat_id TEXT NOT NULL,
    queued_msg_id TEXT,
    task_ids TEXT,
    total INTEGER NOT NULL DEFAULT 0,
    finished INTEGER NOT NULL DEFAULT 0,
    cleaned INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS telegram_audio_task_link (
    task_id TEXT NOT NULL,
    user_msg_id TEXT NOT NULL,
    PRIMARY KEY (task_id)
  );

  CREATE TABLE IF NOT EXISTS telegram_audio_processed (
    msg_id TEXT PRIMARY KEY,
    ts INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS telegram_audio_ephemeral (
    msg_id TEXT PRIMARY KEY,
    chat_id TEXT NOT NULL,
    delete_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS settings_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    setting_key TEXT NOT NULL,
    old_value TEXT,
    new_value TEXT,
    type TEXT NOT NULL DEFAULT 'string',
    action TEXT NOT NULL DEFAULT 'update',
    timestamp INTEGER NOT NULL
  );
`;

// Default settings seeded into the engine-owned settings table.
export const DEFAULT_SETTINGS = [
    ['app.compact', 'false', 'boolean', 'general', 'Compact Mode', 'Reduce spacing for dense content', null],
    ['app.animations', 'true', 'boolean', 'general', 'Animations', 'Enable UI animations and transitions', null],
    ['perf.initialLimit', '500', 'number', 'performance', 'Initial Load Limit', 'Number of files to load per page', null],
    ['perf.virtualization', 'true', 'boolean', 'performance', 'Virtualization', 'Use virtualized rendering for large lists', null],
    ['perf.thumbQuality', '10', 'number', 'performance', 'Thumbnail Quality', 'JPEG quality (1-31, lower=better)', null],
    ['perf.adaptiveMobile', 'true', 'boolean', 'performance', 'Adaptive Mobile Mode', 'Auto-detect mobile and optimize', null],
    ['monitor.refreshInterval', '1000', 'number', 'monitoring', 'Refresh Interval (ms)', 'How often monitoring stats refresh', null],
    ['monitor.uiSmooth', 'true', 'boolean', 'monitoring', 'Smooth Animations', 'Smooth gauge animation between updates', null],
    ['monitor.uiSmoothMs', '900', 'number', 'monitoring', 'Smooth Duration (ms)', 'Gauge smoothing duration in milliseconds', null],
    ['monitor.netTargets', '[]', 'json', 'monitoring', 'Network Targets', 'Saved iperf3 targets', null],
    ['monitor.cpu', 'true', 'boolean', 'monitoring', 'CPU Metrics', 'Show CPU usage in monitoring', null],
    ['monitor.ram', 'true', 'boolean', 'monitoring', 'RAM Metrics', 'Show RAM usage in monitoring', null],
    ['monitor.gpu', 'true', 'boolean', 'monitoring', 'GPU Metrics', 'Show GPU usage in monitoring', null],
    ['monitor.dpu', 'true', 'boolean', 'monitoring', 'Disk Metrics', 'Show Disk usage in monitoring', null],
    ['monitor.network', 'true', 'boolean', 'monitoring', 'Network Metrics', 'Show Network usage in monitoring', null],
    ['scan.mode', 'balanced', 'enum', 'scanner', 'Scan Mode', 'Scan speed vs thoroughness', JSON.stringify({ enum: ['fast', 'balanced', 'full'] })],
    ['scan.recursive', 'true', 'boolean', 'scanner', 'Recursive Scan', 'Scan subdirectories recursively', null],
    ['scan.incremental', 'true', 'boolean', 'scanner', 'Incremental Scan', 'Only scan changed files', null],
    ['scan.autoInterval', '0', 'number', 'scanner', 'Auto Rescan Interval (minutes)', '0 = disabled', null],
    ['scan.workers', '4', 'number', 'scanner', 'Parallel Workers', 'Number of parallel scan workers', null],
    ['thumb.generate', 'true', 'boolean', 'scanner', 'Thumbnail Generation', 'Generate thumbnails during scan', null],
    ['thumb.concurrent', '4', 'number', 'scanner', 'Concurrent Thumbnails', 'Max parallel thumbnail generations', null],
    ['db.cacheSize', '-200000', 'number', 'database', 'Cache Size (KB)', 'SQLite page cache size (negative = KB)', null],
    ['api.compression', 'disabled', 'enum', 'api', 'Compression', 'Response compression mode', JSON.stringify({ enum: ['gzip', 'brotli', 'disabled'] })],
    ['api.rateLimit', '0', 'number', 'api', 'Rate Limit (req/min)', '0 = disabled', null],
    ['api.cacheTTL', '86400', 'number', 'api', 'Cache TTL (seconds)', 'Browser cache duration for static assets', null],
    ['serve.delivery', 'direct', 'enum', 'serve', 'Delivery Mode', 'File serving strategy', JSON.stringify({ enum: ['direct', 'stream', 'hybrid'] })],
    ['serve.rangeRequests', 'true', 'boolean', 'serve', 'Range Requests', 'Allow byte-range requests for seeking', null],
    ['serve.cacheStrategy', 'standard', 'enum', 'serve', 'Cache Strategy', 'How to cache served files', JSON.stringify({ enum: ['standard', 'aggressive', 'minimal', 'none'] })],
    ['serve.transcode', 'false', 'boolean', 'serve', 'Transcoding', 'Transcode non-compatible formats on the fly', null],
    ['render.virtualization', 'true', 'boolean', 'render', 'Virtualization', 'Use virtualized rendering for large lists', null],
    ['render.chunkSize', '50', 'number', 'render', 'Chunk Size', 'Items per render chunk', null],
    ['render.overscan', '5', 'number', 'render', 'Overscan', 'Extra rows rendered outside viewport', null],
    ['render.lazyImages', 'true', 'boolean', 'render', 'Lazy Images', 'Lazy load images outside viewport', null],
    ['render.reduceAnimations', 'false', 'boolean', 'render', 'Reduce Animations', 'Disable animations on low-end devices', null],
    ['render.skeletonUI', 'true', 'boolean', 'render', 'Skeleton UI', 'Show loading skeletons during data fetch', null],
    ['render.maxGridColumns', '8', 'number', 'render', 'Max Grid Columns', 'Maximum grid columns in file browser', null],
    ['network.keepAlive', '65000', 'number', 'network', 'Keep-Alive (ms)', 'HTTP keep-alive timeout', null],
    ['network.maxBodySize', '10', 'number', 'network', 'Max Body Size (MB)', 'Maximum request body size', null],
    ['network.maxConnections', '100', 'number', 'network', 'Max Connections', 'Maximum concurrent connections', null],
    ['network.streaming', 'buffered', 'enum', 'network', 'Streaming Mode', 'Media streaming strategy', JSON.stringify({ enum: ['chunked', 'buffered', 'direct'] })],
    ['network.trackSessions', 'true', 'boolean', 'network', 'Track Sessions', 'Enable active session tracking', null],
    ['network.sessionTimeout', '30', 'number', 'network', 'Session Timeout (min)', 'Inactive session timeout', null],
    ['ai.providers', '[]', 'json', 'ai', 'Providers', 'LLM providers configuration', null],
    ['ai.defaultProvider', 'openai', 'string', 'ai', 'Default Provider', 'Default AI provider ID', null],
    ['ai.defaultModel', 'gpt-4o-mini', 'string', 'ai', 'Default Model', 'Default model for the default provider', null],
    ['ai.defaultSearchProvider', 'duckduckgo', 'string', 'ai', 'Default Search Provider', 'Default web search provider', null],
    ['ai.tools.enabled', '[]', 'json', 'ai', 'Enabled Tools', 'Enabled tool module IDs', null],
    ['ai.tools.vault', 'search-only', 'enum', 'ai', 'Vault Access', 'What the AI can do with media vault', JSON.stringify({ enum: ['disabled', 'search-only', 'full'] })],
    ['ai.tools.system', 'disabled', 'enum', 'ai', 'System Stats', 'Allow AI to access system statistics', JSON.stringify({ enum: ['disabled', 'metadata'] })],
    ['ai.streaming', 'true', 'boolean', 'ai', 'Streaming', 'Stream AI responses via SSE', null],
    ['ai.maxContextMessages', '50', 'number', 'ai', 'Max Context Messages', 'Max messages to send to LLM per turn', null],
    ['ai.maxOutputTokens', '4096', 'number', 'ai', 'Max Output Tokens', 'Max tokens in LLM response', null],
    ['ai.temperature', '0.7', 'number', 'ai', 'Temperature', 'LLM temperature (0-2)', null],
    ['ai.context.maxTokens', '8000', 'number', 'ai', 'Max Context Tokens', 'Maximum tokens for context window', null],
    ['ai.context.autoCompact', 'true', 'boolean', 'ai', 'Auto Compact', 'Automatically compact context when nearing limit', null],
    ['ai.context.compactThreshold', '0.8', 'number', 'ai', 'Compact Threshold', 'Trigger compaction at this fraction of max', null],
    ['ai.memory.enabled', 'true', 'boolean', 'ai', 'Memory Enabled', 'Enable conversation memory system', null],
    ['ai.memory.autoExtract', 'true', 'boolean', 'ai', 'Auto Extract Memories', 'Automatically extract memories from conversations', null],
    ['ai.memory.extractionFrequency', '10', 'number', 'ai', 'Extraction Frequency', 'Extract memories every N messages', null],
    ['ai.memory.confidenceThreshold', '0.3', 'number', 'ai', 'Confidence Threshold', 'Minimum confidence to save memory', null],
    ['ai.defaultSystemPrompt', '', 'string', 'ai', 'Default System Prompt', 'Global default system prompt', null],
    ['upload.enabled', 'true', 'boolean', 'upload', 'Upload Enabled', 'Allow file uploads via web UI', null],
    ['upload.maxSizeGB', '100', 'number', 'upload', 'Max File Size (GB)', 'Maximum single file upload size', null],
    ['upload.concurrent', '4', 'number', 'upload', 'Concurrent Uploads', 'Max parallel uploads', null],
    ['upload.autoScan', 'true', 'boolean', 'upload', 'Auto Scan', 'Auto-run incremental scan after upload', null],
    ['upload.autoThumbnail', 'true', 'boolean', 'upload', 'Auto Thumbnail', 'Generate thumbnail immediately after upload', null],
    ['upload.metadataMode', 'balanced', 'enum', 'upload', 'Metadata Mode', 'Extraction depth', JSON.stringify({ enum: ['fast', 'balanced', 'full'] })],
    ['upload.duplicateStrategy', 'rename', 'enum', 'upload', 'Duplicate Strategy', 'How to handle duplicate files', JSON.stringify({ enum: ['skip', 'overwrite', 'rename'] })],
    ['upload.allowedTypes', '*', 'string', 'upload', 'Allowed Types', 'Comma-separated extensions or * for all', null],
    ['dashboard.compact', 'false', 'boolean', 'dashboard', 'Compact Mode', 'Reduce spacing for dense layout', null],
    ['dashboard.showCpu', 'true', 'boolean', 'dashboard', 'Show CPU Widget', 'Show CPU usage on overview', null],
    ['dashboard.showGpu', 'true', 'boolean', 'dashboard', 'Show GPU Widget', 'Show GPU usage on overview', null],
    ['dashboard.showDisk', 'true', 'boolean', 'dashboard', 'Show Disk Widget', 'Show disk usage on overview', null],
    ['dashboard.showNetwork', 'true', 'boolean', 'dashboard', 'Show Network Widget', 'Show network usage on overview', null],
    ['dashboard.showSystem', 'true', 'boolean', 'dashboard', 'Show System Widget', 'Show system info on overview', null],
    ['dashboard.overviewRefresh', '20', 'number', 'dashboard', 'Overview Refresh (s)', 'Overview summary data refresh interval in seconds', null],
    ['dashboard.topBarStats', 'true', 'boolean', 'dashboard', 'Top Bar Stats', 'Show CPU/RAM/Disk in top bar', null],
    ['alerts.enabled', 'true', 'boolean', 'alerts', 'Alerts Enabled', 'Enable threshold-based alerts', null],
    ['alerts.cpuWarn', '80', 'number', 'alerts', 'CPU Warning %', 'CPU usage warning threshold', null],
    ['alerts.cpuCrit', '95', 'number', 'alerts', 'CPU Critical %', 'CPU usage critical threshold', null],
    ['alerts.ramWarn', '80', 'number', 'alerts', 'RAM Warning %', 'RAM usage warning threshold', null],
    ['alerts.ramCrit', '95', 'number', 'alerts', 'RAM Critical %', 'RAM usage critical threshold', null],
    ['alerts.diskWarn', '85', 'number', 'alerts', 'Disk Warning %', 'Disk usage warning threshold', null],
    ['alerts.diskCrit', '95', 'number', 'alerts', 'Disk Critical %', 'Disk usage critical threshold', null],
    ['alerts.tempWarn', '75', 'number', 'alerts', 'CPU Temp Warning °C', 'CPU temperature warning threshold', null],
    ['alerts.tempCrit', '90', 'number', 'alerts', 'CPU Temp Critical °C', 'CPU temperature critical threshold', null],
    ['alerts.gpuTempWarn', '80', 'number', 'alerts', 'GPU Temp Warning °C', 'GPU temperature warning threshold', null],
    ['alerts.gpuTempCrit', '95', 'number', 'alerts', 'GPU Temp Critical °C', 'GPU temperature critical threshold', null],
    ['retention.historyDays', '7', 'number', 'retention', 'History Retention (days)', 'How many days to keep monitoring history', null],
    ['retention.logLines', '5000', 'number', 'retention', 'Max Log Lines', 'Maximum log lines to keep in memory', null],
    ['retention.alertHistory', '100', 'number', 'retention', 'Alert History Count', 'Maximum alert history entries', null],
    ['retention.sessionTimeout', '30', 'number', 'retention', 'Session Timeout (min)', 'Inactive session timeout before cleanup', null],
    ['system.autoRestart', 'false', 'boolean', 'system', 'Auto Restart', 'Auto-restart backend on crash', null],
    ['system.watchdog', 'true', 'boolean', 'system', 'Watchdog', 'Monitor backend health and alert on issues', null],
    ['system.healthCheck', '30', 'number', 'system', 'Health Check (s)', 'Backend health check interval in seconds', null],
    ['system.maxMemoryMB', '0', 'number', 'system', 'Max Memory (MB)', 'Restart if memory exceeds this (0=unlimited)', null],
    ['whatsapp.autoRestart', 'true', 'boolean', 'whatsapp', 'Auto Restart Bot', 'Auto-restart WhatsApp bot on disconnect', null],
    ['whatsapp.maxRetries', '5', 'number', 'whatsapp', 'Max Retries', 'Maximum reconnect attempts before giving up', null],
    ['whatsapp.retryDelay', '10', 'number', 'whatsapp', 'Retry Delay (s)', 'Seconds between reconnect attempts', null],
    ['scanner.watchEnabled', 'true', 'boolean', 'scanner', 'File Watcher', 'Watch for file changes and auto-scan', null],
    ['scanner.debounceMs', '5000', 'number', 'scanner', 'Watch Debounce (ms)', 'Debounce delay for file watcher events', null],
    ['downloader.youtubeCookiesPath', '', 'string', 'downloader', 'YouTube Cookies Path', 'Netscape cookies.txt path', null],
];

export function applyCoreSchema(conn) {
    conn.exec(CORE_SCHEMA_SQL);
    conn.exec(TRIGGERS_SQL);
    conn.exec(SETTINGS_TABLE_SQL);

    // Tables first, THEN column additions (to handle existing DBs), THEN indexes.
    conn.exec(AUX_SCHEMA_SQL);
    conn.exec(OUTBOUND_SCHEMA_SQL);

    for (const sql of LEGACY_ALTERS) {
        try { conn.exec(sql); } catch { /* column may already exist */ }
    }

    conn.exec(INDEXES_SQL);

    for (const sql of LEGACY_INDEX_ALTERS) {
        try { conn.exec(sql); } catch { /* index may already exist */ }
    }

    // FTS must exist before the statement registry compiles FTS-touching statements.
    conn.exec(FTS_SCHEMA_SQL);

    // One-time migration: if files_fts exists as a standalone FTS5 table
    // (no content='files'), migrate to external-content so the 'delete' command
    // in triggers works. Idempotent: no-op if already external-content.
    migrateFtsToExternalContent(conn);
}

function migrateFtsToExternalContent(conn) {
    try {
        const ddlRow = conn.prepare(
            "SELECT sql FROM sqlite_master WHERE type='table' AND name='files_fts'"
        ).get();
        if (!ddlRow || !ddlRow.sql) return;
        if (ddlRow.sql.includes("content='files'")) return; // already external-content

        // Standalone FTS5 detected. Rebuild as external-content backed by files.
        // The data is derived from files.name, so we can safely drop and rebuild.
        conn.exec(`
            DROP TABLE files_fts;
            CREATE VIRTUAL TABLE files_fts USING fts5(name, content='files', tokenize='unicode61 remove_diacritics 1');
            INSERT INTO files_fts(files_fts) VALUES('rebuild');
        `);
    } catch {
        // Best-effort: if migration fails, trigger errors on UPDATE will surface.
    }
}

export function seedDefaults(conn) {
    const countRow = conn.prepare('SELECT COUNT(*) as cnt FROM settings').get();
    if (countRow.cnt === 0) {
        const insert = conn.prepare('INSERT OR IGNORE INTO settings (key, value, type, category, label, description, options, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
        const now = Date.now();
        const tx = conn.transaction(() => {
            for (const row of DEFAULT_SETTINGS) {
                insert.run(row[0], row[1], row[2], row[3], row[4], row[5], row[6], now);
            }
        });
        tx();
    } else {
        const insert = conn.prepare('INSERT OR IGNORE INTO settings (key, value, type, category, label, description, options, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
        const now = Date.now();
        for (const row of DEFAULT_SETTINGS) {
            insert.run(row[0], row[1], row[2], row[3], row[4], row[5], row[6], now);
        }
    }

    // Cleanup deprecated keys
    try { conn.prepare("DELETE FROM settings WHERE key = 'app.title'").run(); } catch {}

    // Apply dynamic cache_size from settings
    try {
        const cacheSize = conn.prepare("SELECT value FROM settings WHERE key = 'db.cacheSize'").pluck().get();
        if (cacheSize) conn.pragma(`cache_size = ${cacheSize}`);
    } catch {}

    // Data fixups preserved from original db.js
    try { conn.exec("UPDATE files SET type = 'audio' WHERE ext = '.webm' AND type = 'video'"); } catch {}
    try { conn.exec("UPDATE folders SET recursive_file_count = NULL WHERE recursive_file_count = 0"); } catch {}
    try { conn.exec("UPDATE folders SET recursive_total_size = NULL WHERE recursive_total_size = 0"); } catch {}

    // Seed single-row tables
    conn.prepare('INSERT OR IGNORE INTO send_settings (id, tick_enabled, debug_mode, per_day) VALUES (1, 1, 0, 3)').run();
    conn.prepare('INSERT OR IGNORE INTO send_counters (id, telegram_count, whatsapp_count) VALUES (1, 0, 0)').run();
    conn.prepare("INSERT OR IGNORE INTO send_rate_limit (id, date, count, last_send_at) VALUES (1, '', 0, 0)").run();

    // One-time migration for legacy sort_order column
    try { conn.prepare("UPDATE send_queue SET sort_order = id WHERE sort_order IS NULL").run(); } catch {}
}

// Schema version tracking. Phase 1 establishes the concept.
const SCHEMA_VERSION = 1;

export function getSchemaVersion(conn) {
    try {
        const row = conn.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_meta'").get();
        if (!row) return 0;
        const v = conn.prepare('SELECT version FROM schema_meta WHERE id = 1').get();
        return v ? v.version : 0;
    } catch {
        return 0;
    }
}

export function recordSchemaVersion(conn) {
    conn.exec(`CREATE TABLE IF NOT EXISTS schema_meta (id INTEGER PRIMARY KEY CHECK (id = 1), version INTEGER NOT NULL, recorded_at INTEGER NOT NULL)`);
    conn.prepare('INSERT OR REPLACE INTO schema_meta (id, version, recorded_at) VALUES (1, ?, ?)').run(SCHEMA_VERSION, Date.now());
}