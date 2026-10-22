import Database from 'better-sqlite3'
import { dbPath } from '../paths'

let db: Database.Database | null = null

const MIGRATIONS: string[] = [
  `
  CREATE TABLE projects (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    synopsis TEXT NOT NULL DEFAULT '',
    duration_sec INTEGER NOT NULL DEFAULT 60,
    language TEXT NOT NULL DEFAULT 'id',
    aspect_ratio TEXT NOT NULL DEFAULT '16:9',
    style_id TEXT NOT NULL DEFAULT 'stickman',
    tts_provider TEXT NOT NULL DEFAULT 'gemini',
    tts_voice TEXT NOT NULL DEFAULT 'Charon',
    image_model TEXT,
    status TEXT NOT NULL DEFAULT 'draft',
    step INTEGER NOT NULL DEFAULT 1,
    cover_asset_id TEXT,
    editor_json TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE characters (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    sheet_asset_id TEXT,
    sort INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX characters_project ON characters(project_id);
  CREATE TABLE clips (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    sort INTEGER NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    visual_prompt TEXT NOT NULL DEFAULT '',
    narration TEXT NOT NULL DEFAULT '',
    duration_ms INTEGER NOT NULL DEFAULT 5000,
    character_ids TEXT NOT NULL DEFAULT '[]',
    motion_type TEXT NOT NULL DEFAULT 'camera',
    camera_preset TEXT NOT NULL DEFAULT 'zoomin',
    motion_strength TEXT NOT NULL DEFAULT 'halus',
    video_prompt TEXT NOT NULL DEFAULT '',
    transition TEXT NOT NULL DEFAULT 'fade',
    image_asset_id TEXT,
    video_asset_id TEXT,
    audio_asset_id TEXT
  );
  CREATE INDEX clips_project ON clips(project_id, sort);
  CREATE TABLE assets (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    clip_id TEXT,
    character_id TEXT,
    kind TEXT NOT NULL,
    provider TEXT,
    model TEXT,
    prompt TEXT,
    remote_id TEXT,
    remote_url TEXT,
    local_path TEXT NOT NULL,
    duration_ms INTEGER,
    width INTEGER,
    height INTEGER,
    meta_json TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL
  );
  CREATE INDEX assets_project ON assets(project_id);
  CREATE TABLE jobs (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    clip_id TEXT,
    character_id TEXT,
    kind TEXT NOT NULL,
    provider TEXT NOT NULL,
    remote_id TEXT,
    status TEXT NOT NULL,
    progress REAL NOT NULL DEFAULT 0,
    message TEXT,
    error TEXT,
    payload_json TEXT NOT NULL DEFAULT '{}',
    result_asset_id TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX jobs_project ON jobs(project_id, status);
  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE TABLE secrets (
    provider TEXT PRIMARY KEY,
    value BLOB NOT NULL,
    last_ok INTEGER,
    last_message TEXT,
    checked_at INTEGER
  );
  `,
  `
  CREATE TABLE cache (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
  `,
  `
  ALTER TABLE projects ADD COLUMN video_model TEXT;
  `,
  // The script step sits between idea and storyboard, so later steps move up by one.
  `
  ALTER TABLE clips ADD COLUMN story TEXT NOT NULL DEFAULT '';
  ALTER TABLE clips ADD COLUMN visual_source TEXT;
  UPDATE projects SET step = step + 1 WHERE step >= 2;
  `,
  // Video resolution picked per project; null keeps the model's recommended one.
  `
  ALTER TABLE projects ADD COLUMN video_resolution TEXT;
  `,
  // Editor: camera over AI video, transition length, narration volume per clip.
  `
  ALTER TABLE clips ADD COLUMN video_camera TEXT NOT NULL DEFAULT 'static';
  ALTER TABLE clips ADD COLUMN video_strength TEXT NOT NULL DEFAULT 'halus';
  ALTER TABLE clips ADD COLUMN transition_ms INTEGER;
  ALTER TABLE clips ADD COLUMN voice_gain_db REAL NOT NULL DEFAULT 0;
  `,
  // Timeline editing: video in-point, voice trim and placement.
  `
  ALTER TABLE clips ADD COLUMN media_in_ms INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE clips ADD COLUMN voice_in_ms INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE clips ADD COLUMN voice_out_ms INTEGER;
  ALTER TABLE clips ADD COLUMN voice_start_ms INTEGER NOT NULL DEFAULT 0;
  `
]

export function getDb(): Database.Database {
  if (db) return db
  db = new Database(dbPath())
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  const version = db.pragma('user_version', { simple: true }) as number
  for (let v = version; v < MIGRATIONS.length; v++) {
    db.transaction(() => {
      db!.exec(MIGRATIONS[v])
      db!.pragma(`user_version = ${v + 1}`)
    })()
  }
  return db
}

export function closeDb(): void {
  db?.close()
  db = null
}
