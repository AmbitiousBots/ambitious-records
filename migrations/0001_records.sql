CREATE TABLE types (
  type TEXT NOT NULL,
  version INTEGER NOT NULL CHECK(version >= 1),
  json TEXT NOT NULL CHECK(json_valid(json)),
  PRIMARY KEY(type, version)
) STRICT;
CREATE TABLE records (
  id TEXT PRIMARY KEY NOT NULL,
  type TEXT NOT NULL,
  type_version INTEGER NOT NULL,
  stage TEXT NOT NULL,
  fields_json TEXT NOT NULL CHECK(json_valid(fields_json)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(type, type_version) REFERENCES types(type, version)
) STRICT;
CREATE TABLE record_events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  record_id TEXT NOT NULL REFERENCES records(id),
  kind TEXT NOT NULL CHECK(kind IN ('created', 'updated', 'moved')),
  type TEXT NOT NULL,
  type_version INTEGER NOT NULL,
  from_stage TEXT,
  to_stage TEXT,
  patch_json TEXT NOT NULL CHECK(json_valid(patch_json)),
  at TEXT NOT NULL,
  actor TEXT NOT NULL,
  idem_key TEXT NOT NULL UNIQUE,
  request_json TEXT NOT NULL CHECK(json_valid(request_json)),
  result_json TEXT NOT NULL CHECK(json_valid(result_json)),
  FOREIGN KEY(type, type_version) REFERENCES types(type, version)
) STRICT;
CREATE TABLE uniques (
  type TEXT NOT NULL,
  field TEXT NOT NULL,
  value TEXT NOT NULL,
  record_id TEXT NOT NULL REFERENCES records(id),
  PRIMARY KEY(type, field, value)
) STRICT;
CREATE INDEX records_by_type_stage ON records(type, stage, id);
CREATE INDEX events_by_record ON record_events(record_id, seq);
CREATE INDEX uniques_by_record ON uniques(record_id);
