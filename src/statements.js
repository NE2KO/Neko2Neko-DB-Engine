// @homelab/db-engine — statements.js
//
// Controlled prepared-statement registry.
// All known semantic statement names live here.
// Application accesses them through engine.getStmts().

export function createStatementRegistry(conn) {
    const stmts = {
        // Playlists
        getPlaylistByPath: conn.prepare('SELECT * FROM playlists WHERE path = ?'),
        getPlaylistById: conn.prepare('SELECT * FROM playlists WHERE id = ?'),
        getAllPlaylists: conn.prepare('SELECT * FROM playlists WHERE deleted_at IS NULL ORDER BY title ASC'),
        getAllPlaylistsIncludingDeleted: conn.prepare('SELECT * FROM playlists ORDER BY title ASC'),
        softDeletePlaylist: conn.prepare('UPDATE playlists SET deleted_at = ? WHERE id = ?'),
        restorePlaylist: conn.prepare('UPDATE playlists SET deleted_at = NULL WHERE id = ?'),
        upsertPlaylist: conn.prepare(`
            INSERT INTO playlists (path, title, creator, annotation, info, image, track_count, total_duration, total_size, available_tracks, missing_tracks, last_scanned, last_updated, created_at)
            VALUES (@path, @title, @creator, @annotation, @info, @image, @track_count, @total_duration, @total_size, @available_tracks, @missing_tracks, @last_scanned, @last_updated, @created_at)
            ON CONFLICT(path) DO UPDATE SET
              title = excluded.title,
              creator = excluded.creator,
              annotation = excluded.annotation,
              info = excluded.info,
              image = excluded.image,
              track_count = excluded.track_count,
              total_duration = excluded.total_duration,
              total_size = excluded.total_size,
              available_tracks = excluded.available_tracks,
              missing_tracks = excluded.missing_tracks,
              last_scanned = excluded.last_scanned,
              last_updated = excluded.last_updated
        `),
        deletePlaylist: conn.prepare('DELETE FROM playlists WHERE id = ?'),
        deletePlaylistTracks: conn.prepare('DELETE FROM playlist_tracks WHERE playlist_id = ?'),
        insertPlaylistTrack: conn.prepare(`
            INSERT INTO playlist_tracks (playlist_id, track_index, location, resolved_path, title, artist, album, duration, artwork, track_num, file_exists, file_size, file_mtime)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `),
        getPlaylistTracks: conn.prepare('SELECT * FROM playlist_tracks WHERE playlist_id = ? ORDER BY track_index ASC'),

        getPlaylistIdByPath: conn.prepare('SELECT id FROM playlists WHERE path = ?'),
        getMaxTrackIndex: conn.prepare('SELECT MAX(track_index) as maxIdx FROM playlist_tracks WHERE playlist_id = ?'),
        getPlaylistTrackPaths: conn.prepare('SELECT resolved_path FROM playlist_tracks WHERE playlist_id = ?'),
        getPlaylistTrackStats: conn.prepare('SELECT COUNT(*) as cnt, COALESCE(SUM(duration),0) as dur, COALESCE(SUM(file_size),0) as sz FROM playlist_tracks WHERE playlist_id = ?'),
        updatePlaylistStats: conn.prepare('UPDATE playlists SET track_count = ?, total_duration = ?, total_size = ?, available_tracks = ?, last_updated = ? WHERE id = ?'),
        getPlaylistTrack: conn.prepare('SELECT * FROM playlist_tracks WHERE id = ? AND playlist_id = ?'),
        deletePlaylistTrack: conn.prepare('DELETE FROM playlist_tracks WHERE id = ?'),
        getPlaylistTrackIds: conn.prepare('SELECT id FROM playlist_tracks WHERE playlist_id = ? ORDER BY track_index ASC'),
        renumberPlaylistTrack: conn.prepare('UPDATE playlist_tracks SET track_index = ? WHERE id = ?'),
        getPlaylistTrackCount: conn.prepare('SELECT COUNT(*) as cnt FROM playlist_tracks WHERE playlist_id = ?'),
        getPlaylistTrackStatsSum: conn.prepare('SELECT SUM(duration) as total_duration, SUM(file_size) as total_size FROM playlist_tracks WHERE playlist_id = ?'),
        updatePlaylistTrackDurationByPath: conn.prepare('UPDATE playlist_tracks SET duration = ? WHERE resolved_path = ?'),
        refreshPlaylistTrackDurations: conn.prepare(`
            UPDATE playlist_tracks SET duration = COALESCE((
              SELECT f.duration FROM files f
              JOIN folders fo ON f.dir_id = fo.id
              WHERE fo.path || '/' || f.name = playlist_tracks.resolved_path
              LIMIT 1
            ), duration)
            WHERE duration = 0 OR duration IS NULL
        `),
        recomputeAllPlaylistTotals: conn.prepare(`
            UPDATE playlists SET
              total_duration = COALESCE((SELECT SUM(pt.duration) FROM playlist_tracks pt WHERE pt.playlist_id = playlists.id), 0),
              total_size = COALESCE((SELECT SUM(pt.file_size) FROM playlist_tracks pt WHERE pt.playlist_id = playlists.id), 0)
        `),
        lookupFileByDirPathAndName: conn.prepare(`
            SELECT f.id, f.name, f.type, f.ext, f.size, f.mtime, f.duration, f.has_thumb
            FROM files f
            JOIN folders fo ON f.dir_id = fo.id
            WHERE fo.path = ? AND f.name = ?
        `),

        // Files
        upsertFile: conn.prepare(`
            INSERT INTO files (id, dir_id, name, type, ext, size, mtime, duration, has_thumb, thumb_cache_path, last_accessed, access_count, last_verified, created_at, created_at_embedded, modified_at_fs, uploaded_at, metadata_source, checksum)
            VALUES (@id, @dir_id, @name, @type, @ext, @size, @mtime, @duration, @has_thumb, @thumb_cache_path, @last_accessed, @access_count, @last_verified, @created_at, @created_at_embedded, @modified_at_fs, @uploaded_at, @metadata_source, @checksum)
            ON CONFLICT(id) DO UPDATE SET
              dir_id = excluded.dir_id,
              name = excluded.name,
              type = excluded.type,
              ext = excluded.ext,
              size = excluded.size,
              mtime = excluded.mtime,
              duration = excluded.duration,
              last_verified = excluded.last_verified,
              created_at_embedded = COALESCE(excluded.created_at_embedded, files.created_at_embedded),
              modified_at_fs = COALESCE(excluded.modified_at_fs, files.modified_at_fs),
              uploaded_at = COALESCE(excluded.uploaded_at, files.uploaded_at),
              metadata_source = COALESCE(excluded.metadata_source, files.metadata_source),
              checksum = COALESCE(excluded.checksum, files.checksum)
        `),
        getFile: conn.prepare('SELECT * FROM files WHERE id = ?'),
        deleteFile: conn.prepare('DELETE FROM files WHERE id = ?'),
        updateThumbStatus: conn.prepare('UPDATE files SET has_thumb = 1 WHERE id = ?'),
        skipThumbStatus: conn.prepare('UPDATE files SET has_thumb = 2 WHERE id = ?'),
        updateThumbCachePath: conn.prepare('UPDATE files SET thumb_cache_path = ? WHERE id = ?'),
        updateLastAccessed: conn.prepare('UPDATE files SET last_accessed = ? WHERE id = ?'),
        updateCodecInfo: conn.prepare('UPDATE files SET codec_info = ?, is_stream_compatible = ? WHERE id = ?'),
        updateFaststartState: conn.prepare('UPDATE files SET faststart_state = ? WHERE id = ?'),
        getCodecInfo: conn.prepare('SELECT codec_info, is_stream_compatible FROM files WHERE id = ?'),

        getFilesCursor: conn.prepare(`
            SELECT id, name, type, ext, size, mtime, has_thumb, thumb_cache_path, dir_id, created_at, uploaded_at, is_favorite
            FROM files
            WHERE dir_id = ? AND (created_at, id) < (?, ?)
            ORDER BY created_at DESC, id DESC
            LIMIT ?
        `),
        getFilesFirstPage: conn.prepare(`
            SELECT id, name, type, ext, size, mtime, has_thumb, thumb_cache_path, dir_id, created_at, uploaded_at, is_favorite
            FROM files
            WHERE dir_id = ?
            ORDER BY created_at DESC, id DESC
            LIMIT ?
        `),
        getAllFilesFirstPage: conn.prepare(`
            SELECT id, name, type, ext, size, mtime, has_thumb, thumb_cache_path, dir_id, created_at, uploaded_at, is_favorite
            FROM files
            ORDER BY created_at DESC, id DESC
            LIMIT ?
        `),
        getFilesCursorAsc: conn.prepare(`
            SELECT id, name, type, ext, size, mtime, has_thumb, thumb_cache_path, dir_id, created_at, uploaded_at, is_favorite
            FROM files
            WHERE dir_id = ? AND (created_at > ? OR (created_at = ? AND id > ?))
            ORDER BY created_at ASC, id ASC
            LIMIT ?
        `),
        getFilesFirstPageAsc: conn.prepare(`
            SELECT id, name, type, ext, size, mtime, has_thumb, thumb_cache_path, dir_id, created_at, uploaded_at, is_favorite
            FROM files
            WHERE dir_id = ?
            ORDER BY created_at ASC, id ASC
            LIMIT ?
        `),
        getFilesSortedByNameAsc: conn.prepare(`
            SELECT id, name, type, ext, size, mtime, has_thumb, thumb_cache_path, dir_id, created_at, uploaded_at, is_favorite
            FROM files
            WHERE dir_id = ?
            ORDER BY name COLLATE NOCASE ASC, id ASC
            LIMIT ?
        `),
        getFilesSortedByNameDesc: conn.prepare(`
            SELECT id, name, type, ext, size, mtime, has_thumb, thumb_cache_path, dir_id, created_at, uploaded_at, is_favorite
            FROM files
            WHERE dir_id = ?
            ORDER BY name COLLATE NOCASE DESC, id ASC
            LIMIT ?
        `),
        getFilesSortedByMtimeAsc: conn.prepare(`
            SELECT id, name, type, ext, size, mtime, has_thumb, thumb_cache_path, dir_id, created_at, uploaded_at, is_favorite
            FROM files
            WHERE dir_id = ?
            ORDER BY mtime ASC, id ASC
            LIMIT ?
        `),
        getFilesSortedByMtimeDesc: conn.prepare(`
            SELECT id, name, type, ext, size, mtime, has_thumb, thumb_cache_path, dir_id, created_at, uploaded_at, is_favorite
            FROM files
            WHERE dir_id = ?
            ORDER BY mtime DESC, id ASC
            LIMIT ?
        `),
        getFilesSortedBySizeAsc: conn.prepare(`
            SELECT id, name, type, ext, size, mtime, has_thumb, thumb_cache_path, dir_id, created_at, uploaded_at, is_favorite
            FROM files
            WHERE dir_id = ?
            ORDER BY size ASC, id ASC
            LIMIT ?
        `),
        getFilesSortedBySizeDesc: conn.prepare(`
            SELECT id, name, type, ext, size, mtime, has_thumb, thumb_cache_path, dir_id, created_at, uploaded_at, is_favorite
            FROM files
            WHERE dir_id = ?
            ORDER BY size DESC, id ASC
            LIMIT ?
        `),

        // Folders
        upsertFolder: conn.prepare(`
            INSERT INTO folders (path, parent_id, depth, file_count, total_size, last_scanned, last_updated)
            VALUES (@path, @parent_id, @depth, @file_count, @total_size, @last_scanned, @last_updated)
            ON CONFLICT(path) DO UPDATE SET
              parent_id = excluded.parent_id,
              depth = excluded.depth,
              last_scanned = excluded.last_scanned,
              last_updated = excluded.last_updated
        `),
        getFolder: conn.prepare('SELECT * FROM folders WHERE id = ?'),
        getFolderByPath: conn.prepare('SELECT * FROM folders WHERE path = ?'),
        getFolderGeneration: conn.prepare('SELECT generation FROM folder_generation WHERE folder_id = ?'),

        getFilesIndexByTypeFav: conn.prepare('SELECT id FROM files WHERE dir_id = ? AND type = ? AND is_favorite = 1'),
        getFilesIndexByFav: conn.prepare('SELECT id FROM files WHERE dir_id = ? AND is_favorite = 1'),
        getFilesIndexByType: conn.prepare('SELECT id FROM files WHERE dir_id = ? AND type = ?'),
        getFilesIndexAll: conn.prepare('SELECT id FROM files WHERE dir_id = ?'),
        getFilesBatch: conn.prepare(`
            SELECT f.id, f.name, f.type, f.ext, f.size, f.mtime, f.has_thumb, f.duration,
                   f.created_at, f.uploaded_at, f.is_favorite, d.path as dir_path
            FROM files f
            JOIN folders d ON f.dir_id = d.id
            WHERE f.id IN (SELECT json_each.value FROM json_each(?))
        `),
        getFilesSubfolders: conn.prepare(`
            SELECT f.id FROM files f
            JOIN folders fo ON fo.id = f.dir_id
            WHERE (fo.parent_id = ? OR fo.id = ?) AND f.id IN (SELECT json_each.value FROM json_each(?))
        `),
        getFolderById: conn.prepare('SELECT id, path, parent_id, depth FROM folders WHERE id = ?'),
        getFoldersByParent: conn.prepare(`SELECT id, path, COALESCE(recursive_file_count, file_count) as file_count, COALESCE(recursive_total_size, total_size) as total_size, last_updated, (SELECT COUNT(*) FROM folders sub WHERE sub.parent_id = folders.id) as subfolder_count FROM folders WHERE parent_id = ? ORDER BY path ASC`),
        getFoldersByParentDistinct: conn.prepare(`
            SELECT
              MIN(id) as id, path,
              COALESCE(MAX(recursive_file_count), MAX(file_count)) as file_count,
              COALESCE(MAX(recursive_total_size), MAX(total_size)) as total_size,
              MAX(last_updated) as last_updated,
              (SELECT COUNT(*) FROM folders sub WHERE sub.parent_id = folders.id) as subfolder_count
            FROM folders
            WHERE parent_id = ?
            GROUP BY path
            ORDER BY path ASC
        `),

        getFileWithPath: conn.prepare(`
            SELECT f.id, f.name, f.type, f.ext, f.size, f.mtime, f.duration, f.has_thumb, f.thumb_cache_path, f.uploaded_at, f.is_favorite,
                   f.title, f.artist, f.album, f.genre, f.lyrics, f.lyrics_synced, f.cover_source, f.youtube_id, f.video_offset, f.codec_info, f.is_stream_compatible, f.faststart_state,
                   d.path as dir_path
            FROM files f
            JOIN folders d ON f.dir_id = d.id
            WHERE f.id = ?
        `),
        getFilesCursorWithPath: conn.prepare(`
            SELECT f.id, f.name, f.type, f.ext, f.size, f.mtime, f.has_thumb, f.thumb_cache_path, f.dir_id, f.created_at, f.uploaded_at, f.is_favorite,
                   d.path as dir_path
            FROM files f
            JOIN folders d ON f.dir_id = d.id
            WHERE f.dir_id = ? AND (f.created_at, f.id) < (?, ?)
            ORDER BY f.created_at DESC, f.id DESC
            LIMIT ?
        `),
        getFilesCursorWithPathPrev: conn.prepare(`
            SELECT f.id, f.name, f.type, f.ext, f.size, f.mtime, f.has_thumb, f.thumb_cache_path, f.dir_id, f.created_at, f.uploaded_at, f.is_favorite,
                   d.path as dir_path
            FROM files f
            JOIN folders d ON f.dir_id = d.id
            WHERE f.dir_id = ? AND (f.created_at, f.id) > (?, ?)
            ORDER BY f.created_at DESC, f.id DESC
            LIMIT ?
        `),
        getFilesFirstPageWithPath: conn.prepare(`
            SELECT f.id, f.name, f.type, f.ext, f.size, f.mtime, f.has_thumb, f.thumb_cache_path, f.dir_id, f.created_at, f.uploaded_at, f.is_favorite,
                   d.path as dir_path
            FROM files f
            JOIN folders d ON f.dir_id = d.id
            WHERE f.dir_id = ?
            ORDER BY f.created_at DESC, f.id DESC
            LIMIT ?
        `),
        getFilesCursorAscWithPath: conn.prepare(`
            SELECT f.id, f.name, f.type, f.ext, f.size, f.mtime, f.has_thumb, f.thumb_cache_path, f.dir_id, f.created_at, f.uploaded_at, f.is_favorite,
                   d.path as dir_path
            FROM files f
            JOIN folders d ON f.dir_id = d.id
            WHERE f.dir_id = ? AND (f.created_at > ? OR (f.created_at = ? AND f.id > ?))
            ORDER BY f.created_at ASC, f.id ASC
            LIMIT ?
        `),
        getFilesFirstPageAscWithPath: conn.prepare(`
            SELECT f.id, f.name, f.type, f.ext, f.size, f.mtime, f.has_thumb, f.thumb_cache_path, f.dir_id, f.created_at, f.uploaded_at, f.is_favorite,
                   d.path as dir_path
            FROM files f
            JOIN folders d ON f.dir_id = d.id
            WHERE f.dir_id = ?
            ORDER BY f.created_at ASC, f.id ASC
            LIMIT ?
        `),
        getFilesSortedByNameAscWithPath: conn.prepare(`
            SELECT f.id, f.name, f.type, f.ext, f.size, f.mtime, f.has_thumb, f.thumb_cache_path, f.dir_id, f.created_at, f.uploaded_at, f.is_favorite,
                   d.path as dir_path
            FROM files f
            JOIN folders d ON f.dir_id = d.id
            WHERE f.dir_id = ?
            ORDER BY f.name COLLATE NOCASE ASC, f.id ASC
            LIMIT ?
        `),
        getFilesSortedByNameDescWithPath: conn.prepare(`
            SELECT f.id, f.name, f.type, f.ext, f.size, f.mtime, f.has_thumb, f.thumb_cache_path, f.dir_id, f.created_at, f.uploaded_at, f.is_favorite,
                   d.path as dir_path
            FROM files f
            JOIN folders d ON f.dir_id = d.id
            WHERE f.dir_id = ?
            ORDER BY f.name COLLATE NOCASE DESC, f.id ASC
            LIMIT ?
        `),
        getFilesSortedByMtimeAscWithPath: conn.prepare(`
            SELECT f.id, f.name, f.type, f.ext, f.size, f.mtime, f.has_thumb, f.thumb_cache_path, f.dir_id, f.created_at, f.uploaded_at, f.is_favorite,
                   d.path as dir_path
            FROM files f
            JOIN folders d ON f.dir_id = d.id
            WHERE f.dir_id = ?
            ORDER BY f.mtime ASC, f.id ASC
            LIMIT ?
        `),
        getFilesSortedByMtimeDescWithPath: conn.prepare(`
            SELECT f.id, f.name, f.type, f.ext, f.size, f.mtime, f.has_thumb, f.thumb_cache_path, f.dir_id, f.created_at, f.uploaded_at, f.is_favorite,
                   d.path as dir_path
            FROM files f
            JOIN folders d ON f.dir_id = d.id
            WHERE f.dir_id = ?
            ORDER BY f.mtime DESC, f.id ASC
            LIMIT ?
        `),
        getFilesSortedBySizeAscWithPath: conn.prepare(`
            SELECT f.id, f.name, f.type, f.ext, f.size, f.mtime, f.has_thumb, f.thumb_cache_path, f.dir_id, f.created_at, f.uploaded_at, f.is_favorite,
                   d.path as dir_path
            FROM files f
            JOIN folders d ON f.dir_id = d.id
            WHERE f.dir_id = ?
            ORDER BY f.size ASC, f.id ASC
            LIMIT ?
        `),
        getFilesSortedBySizeDescWithPath: conn.prepare(`
            SELECT f.id, f.name, f.type, f.ext, f.size, f.mtime, f.has_thumb, f.thumb_cache_path, f.dir_id, f.created_at, f.uploaded_at, f.is_favorite,
                   d.path as dir_path
            FROM files f
            JOIN folders d ON f.dir_id = d.id
            WHERE f.dir_id = ?
            ORDER BY f.size DESC, f.id ASC
            LIMIT ?
        `),
        getFilesSortedByMtimeDescCursor: conn.prepare(`
            SELECT f.id, f.name, f.type, f.ext, f.size, f.mtime, f.has_thumb, f.thumb_cache_path, f.dir_id, f.created_at, f.uploaded_at, f.is_favorite,
                   d.path as dir_path
            FROM files f
            JOIN folders d ON f.dir_id = d.id
            WHERE f.dir_id = ? AND (f.mtime < ? OR (f.mtime = ? AND f.id > ?))
            ORDER BY f.mtime DESC, f.id ASC
            LIMIT ?
        `),
        getFilesSortedByMtimeAscCursor: conn.prepare(`
            SELECT f.id, f.name, f.type, f.ext, f.size, f.mtime, f.has_thumb, f.thumb_cache_path, f.dir_id, f.created_at, f.uploaded_at, f.is_favorite,
                   d.path as dir_path
            FROM files f
            JOIN folders d ON f.dir_id = d.id
            WHERE f.dir_id = ? AND (f.mtime > ? OR (f.mtime = ? AND f.id > ?))
            ORDER BY f.mtime ASC, f.id ASC
            LIMIT ?
        `),
        getFilesSortedByNameDescCursor: conn.prepare(`
            SELECT f.id, f.name, f.type, f.ext, f.size, f.mtime, f.has_thumb, f.thumb_cache_path, f.dir_id, f.created_at, f.uploaded_at, f.is_favorite,
                   d.path as dir_path
            FROM files f
            JOIN folders d ON f.dir_id = d.id
            WHERE f.dir_id = ? AND (f.name COLLATE NOCASE < ? OR (f.name COLLATE NOCASE = ? AND f.id > ?))
            ORDER BY f.name COLLATE NOCASE DESC, f.id ASC
            LIMIT ?
        `),
        getFilesSortedByNameAscCursor: conn.prepare(`
            SELECT f.id, f.name, f.type, f.ext, f.size, f.mtime, f.has_thumb, f.thumb_cache_path, f.dir_id, f.created_at, f.uploaded_at, f.is_favorite,
                   d.path as dir_path
            FROM files f
            JOIN folders d ON f.dir_id = d.id
            WHERE f.dir_id = ? AND (f.name COLLATE NOCASE > ? OR (f.name COLLATE NOCASE = ? AND f.id > ?))
            ORDER BY f.name COLLATE NOCASE ASC, f.id ASC
            LIMIT ?
        `),
        getFilesSortedBySizeDescCursor: conn.prepare(`
            SELECT f.id, f.name, f.type, f.ext, f.size, f.mtime, f.has_thumb, f.thumb_cache_path, f.dir_id, f.created_at, f.uploaded_at, f.is_favorite,
                   d.path as dir_path
            FROM files f
            JOIN folders d ON f.dir_id = d.id
            WHERE f.dir_id = ? AND (f.size < ? OR (f.size = ? AND f.id > ?))
            ORDER BY f.size DESC, f.id ASC
            LIMIT ?
        `),
        getFilesSortedBySizeAscCursor: conn.prepare(`
            SELECT f.id, f.name, f.type, f.ext, f.size, f.mtime, f.has_thumb, f.thumb_cache_path, f.dir_id, f.created_at, f.uploaded_at, f.is_favorite,
                   d.path as dir_path
            FROM files f
            JOIN folders d ON f.dir_id = d.id
            WHERE f.dir_id = ? AND (f.size > ? OR (f.size = ? AND f.id > ?))
            ORDER BY f.size ASC, f.id ASC
            LIMIT ?
        `),

        deltaIncrementFolder: conn.prepare('UPDATE folders SET file_count = file_count + 1, total_size = total_size + ?, last_updated = ? WHERE id = ?'),
        deltaDecrementFolder: conn.prepare('UPDATE folders SET file_count = MAX(0, file_count - 1), total_size = MAX(0, total_size - ?), last_updated = ? WHERE id = ?'),

        reconcileFolder: conn.prepare(`
            UPDATE folders
            SET file_count = (SELECT COUNT(*) FROM files WHERE dir_id = folders.id),
                total_size = (SELECT COALESCE(SUM(size), 0) FROM files WHERE dir_id = folders.id)
            WHERE id = ?
        `),

        countFilesByType: conn.prepare('SELECT type, COUNT(*) as count FROM files GROUP BY type'),
        countTotalFiles: conn.prepare('SELECT COUNT(*) as total FROM files'),

        searchFilesFTS: conn.prepare(`
            SELECT f.id, f.name, f.type, f.ext, f.size, f.mtime, f.has_thumb, f.dir_id, f.created_at, f.uploaded_at, COALESCE(fo.path, '') as dir_path
            FROM files f
            LEFT JOIN folders fo ON f.dir_id = fo.id
            WHERE f.rowid IN (SELECT rowid FROM files_fts WHERE files_fts MATCH ?)
            LIMIT ?
        `),
        searchFilesFTSScoped: conn.prepare(`
            SELECT f.id, f.name, f.type, f.ext, f.size, f.mtime, f.has_thumb, f.dir_id, f.created_at, f.uploaded_at, COALESCE(fo.path, '') as dir_path
            FROM files f
            LEFT JOIN folders fo ON f.dir_id = fo.id
            WHERE f.rowid IN (SELECT rowid FROM files_fts WHERE files_fts MATCH ?)
              AND f.dir_id = ?
            LIMIT ?
        `),
        getPreviewFilesForFolder: conn.prepare(`
            SELECT id, name, type, ext, has_thumb FROM files
            WHERE dir_id = ?
            ORDER BY
                CASE type
                    WHEN 'image' THEN 1
                    WHEN 'video' THEN 2
                    WHEN 'audio' THEN 3
                    ELSE 4
                END,
                id ASC
            LIMIT ?
        `),
        searchFolders: conn.prepare(`
            SELECT id, path, path as name, 'folder' as type,
                   COALESCE(recursive_file_count, file_count) as file_count,
                   COALESCE(recursive_total_size, total_size) as total_size,
                   (SELECT COUNT(*) FROM folders sub WHERE sub.parent_id = folders.id) as subfolder_count
            FROM folders
            WHERE path LIKE ?
            ORDER BY path
            LIMIT ?
        `),
        searchFoldersScoped: conn.prepare(`
            SELECT id, path, path as name, 'folder' as type,
                   COALESCE(recursive_file_count, file_count) as file_count,
                   COALESCE(recursive_total_size, total_size) as total_size,
                   (SELECT COUNT(*) FROM folders sub WHERE sub.parent_id = folders.id) as subfolder_count
            FROM folders
            WHERE path LIKE ? AND (id = ? OR parent_id = ?)
            ORDER BY path
            LIMIT ?
        `),
        getSubfolderIds: conn.prepare(`
            WITH RECURSIVE subs(id) AS (
              SELECT id FROM folders WHERE id = ?
              UNION ALL
              SELECT f.id FROM folders f JOIN subs s ON f.parent_id = s.id
            )
            SELECT id FROM subs
        `),

        // AI conversations
        createConversation: conn.prepare('INSERT INTO conversations (local_id, title, pinned, archived, created_at, updated_at) VALUES (?, ?, 0, 0, ?, ?)'),
        getConversationsForLocal: conn.prepare('SELECT * FROM conversations WHERE local_id = ? ORDER BY pinned DESC, updated_at DESC'),
        getConversation: conn.prepare('SELECT * FROM conversations WHERE id = ? AND local_id = ?'),
        updateConversation: conn.prepare('UPDATE conversations SET title = ?, pinned = ?, archived = ?, updated_at = ? WHERE id = ? AND local_id = ?'),
        deleteConversation: conn.prepare('DELETE FROM conversations WHERE id = ? AND local_id = ?'),
        getMessages: conn.prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY id ASC'),
        insertMessage: conn.prepare('INSERT INTO messages (conversation_id, role, content, tool_calls, tool_results, created_at) VALUES (?, ?, ?, ?, ?, ?)'),
        getMessageCount: conn.prepare('SELECT COUNT(*) as cnt FROM messages WHERE conversation_id = ?'),
        deleteMessage: conn.prepare('DELETE FROM messages WHERE id = ?'),
        deleteMessagesBefore: conn.prepare('DELETE FROM messages WHERE conversation_id = ? AND id < ?'),

        // AI Provider Status
        getProviderStatus: conn.prepare('SELECT * FROM ai_provider_status WHERE provider_id = ?'),
        getAllProviderStatus: conn.prepare('SELECT * FROM ai_provider_status'),
        upsertProviderStatus: conn.prepare(`
            INSERT OR REPLACE INTO ai_provider_status (provider_id, status, last_verified_at, latency_ms, models_json, models_cached_at, error_message)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `),

        getConversationSettings: conn.prepare('SELECT * FROM ai_conversation_settings WHERE conversation_id = ?'),
        upsertConversationSettings: conn.prepare(`
            INSERT OR REPLACE INTO ai_conversation_settings (conversation_id, model, temperature, max_tokens, system_prompt, web_search, vision)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `),
        deleteConversationSettings: conn.prepare('DELETE FROM ai_conversation_settings WHERE conversation_id = ?'),

        getMemories: conn.prepare('SELECT * FROM ai_memories WHERE enabled = 1 ORDER BY pinned DESC, confidence DESC, updated_at DESC LIMIT ?'),
        getAllMemories: conn.prepare('SELECT * FROM ai_memories ORDER BY pinned DESC, confidence DESC, updated_at DESC LIMIT ?'),
        getMemory: conn.prepare('SELECT * FROM ai_memories WHERE id = ?'),
        insertMemory: conn.prepare(`
            INSERT INTO ai_memories (conversation_id, content, confidence, pinned, enabled, tags, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `),
        updateMemory: conn.prepare('UPDATE ai_memories SET content = ?, confidence = ?, pinned = ?, enabled = ?, tags = ?, updated_at = ? WHERE id = ?'),
        deleteMemory: conn.prepare('DELETE FROM ai_memories WHERE id = ?'),
        searchMemories: conn.prepare('SELECT * FROM ai_memories WHERE enabled = 1 AND content LIKE ? ORDER BY pinned DESC, confidence DESC LIMIT ?'),
        countMemories: conn.prepare('SELECT COUNT(*) as cnt FROM ai_memories WHERE enabled = 1'),

        getSummaries: conn.prepare('SELECT * FROM ai_context_summaries WHERE conversation_id = ? ORDER BY id ASC'),
        getLatestSummary: conn.prepare('SELECT * FROM ai_context_summaries WHERE conversation_id = ? ORDER BY id DESC LIMIT 1'),
        insertSummary: conn.prepare(`
            INSERT INTO ai_context_summaries (conversation_id, summary, message_range_start, message_range_end, created_at)
            VALUES (?, ?, ?, ?, ?)
        `),
        deleteSummaries: conn.prepare('DELETE FROM ai_context_summaries WHERE conversation_id = ?'),

        getPinnedMessages: conn.prepare(`
            SELECT m.* FROM messages m
            JOIN ai_pinned_messages p ON m.id = p.message_id
            WHERE p.conversation_id = ? ORDER BY m.id ASC
        `),
        getPinnedMessageIds: conn.prepare('SELECT message_id FROM ai_pinned_messages WHERE conversation_id = ?'),
        isMessagePinned: conn.prepare('SELECT 1 FROM ai_pinned_messages WHERE conversation_id = ? AND message_id = ?'),
        pinMessage: conn.prepare('INSERT OR IGNORE INTO ai_pinned_messages (conversation_id, message_id, created_at) VALUES (?, ?, ?)'),
        unpinMessage: conn.prepare('DELETE FROM ai_pinned_messages WHERE conversation_id = ? AND message_id = ?'),
        unpinAllMessages: conn.prepare('DELETE FROM ai_pinned_messages WHERE conversation_id = ?'),
        countPinnedMessages: conn.prepare('SELECT COUNT(*) as cnt FROM ai_pinned_messages WHERE conversation_id = ?'),

        getModelPreference: conn.prepare('SELECT * FROM ai_model_preferences WHERE provider_id = ? AND model_id = ?'),
        upsertModelPreference: conn.prepare(`
            INSERT OR REPLACE INTO ai_model_preferences (provider_id, model_id, favorited, hidden, last_used_at)
            VALUES (?, ?, ?, ?, ?)
        `),
        getFavoriteModels: conn.prepare('SELECT * FROM ai_model_preferences WHERE favorited = 1 ORDER BY last_used_at DESC'),
        getHiddenModels: conn.prepare('SELECT * FROM ai_model_preferences WHERE hidden = 1'),
        getAllModelPreferences: conn.prepare('SELECT * FROM ai_model_preferences'),
        markModelUsed: conn.prepare(`
            INSERT INTO ai_model_preferences (provider_id, model_id, last_used_at)
            VALUES (?, ?, ?)
            ON CONFLICT(provider_id, model_id) DO UPDATE SET last_used_at = excluded.last_used_at
        `),

        // Send rate / counters
        getSendCounterTelegram: conn.prepare('SELECT telegram_count FROM send_counters WHERE id = 1'),
        getSendCounterWhatsapp: conn.prepare('SELECT whatsapp_count FROM send_counters WHERE id = 1'),
        setSendCounterTelegram: conn.prepare('UPDATE send_counters SET telegram_count = ? WHERE id = 1'),
        setSendCounterWhatsapp: conn.prepare('UPDATE send_counters SET whatsapp_count = ? WHERE id = 1'),

        // Listening stats
        getListeningStat: conn.prepare('SELECT * FROM listening_stats WHERE trackId = ?'),
        upsertListeningStat: conn.prepare(`
            INSERT INTO listening_stats (trackId, playCount, listenedSeconds, lastPlayedAt, displayName, updatedAt)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(trackId) DO UPDATE SET
              playCount = excluded.playCount,
              listenedSeconds = excluded.listenedSeconds,
              lastPlayedAt = excluded.lastPlayedAt,
              displayName = excluded.displayName,
              updatedAt = excluded.updatedAt
        `),

        // Telegram audio bot
        getTelegramAudioTask: conn.prepare('SELECT * FROM telegram_audio_bot_tasks WHERE user_msg_id = ?'),
        setTelegramAudioTaskCleaned: conn.prepare('UPDATE telegram_audio_bot_tasks SET cleaned = 1 WHERE user_msg_id = ?'),
        incTelegramAudioTaskFinished: conn.prepare('UPDATE telegram_audio_bot_tasks SET finished = finished + 1 WHERE user_msg_id = ?'),
        getTelegramAudioTaskProgress: conn.prepare('SELECT finished, total FROM telegram_audio_bot_tasks WHERE user_msg_id = ?'),
        deleteTelegramAudioTask: conn.prepare('DELETE FROM telegram_audio_bot_tasks WHERE user_msg_id = ?'),
        deleteTelegramAudioLink: conn.prepare('DELETE FROM telegram_audio_task_link WHERE user_msg_id = ?'),
        insertTelegramAudioLink: conn.prepare('INSERT OR REPLACE INTO telegram_audio_task_link (task_id, user_msg_id) VALUES (?, ?)'),
        upsertTelegramAudioTask: conn.prepare('INSERT OR REPLACE INTO telegram_audio_bot_tasks (user_msg_id, chat_id, queued_msg_id, task_ids, total, finished, cleaned) VALUES (?, ?, ?, ?, ?, 0, 0)'),
        isTelegramAudioProcessed: conn.prepare('SELECT msg_id FROM telegram_audio_processed WHERE msg_id = ?'),
        insertTelegramAudioProcessed: conn.prepare('INSERT OR IGNORE INTO telegram_audio_processed (msg_id, ts) VALUES (?, ?)'),
        upsertTelegramAudioEphemeral: conn.prepare('INSERT OR REPLACE INTO telegram_audio_ephemeral (msg_id, chat_id, delete_at) VALUES (?, ?, ?)'),
        getExpiredTelegramAudio: conn.prepare('SELECT msg_id, chat_id FROM telegram_audio_ephemeral WHERE delete_at <= ?'),
        deleteTelegramAudioEphemeral: conn.prepare('DELETE FROM telegram_audio_ephemeral WHERE msg_id = ?'),
        deleteExpiredTelegramAudioProcessed: conn.prepare('DELETE FROM telegram_audio_processed WHERE ts < ?'),
    };

    return Object.freeze(stmts);
}