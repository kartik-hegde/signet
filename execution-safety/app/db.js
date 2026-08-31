import { DatabaseSync } from "node:sqlite";
import { rmSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const SCHEMA = `
CREATE TABLE users (
  id      TEXT PRIMARY KEY,
  email   TEXT NOT NULL,
  name    TEXT NOT NULL
);
CREATE TABLE events (
  id        TEXT PRIMARY KEY,
  name      TEXT NOT NULL,
  capacity  INTEGER NOT NULL,
  remaining INTEGER NOT NULL
);
CREATE TABLE bookings (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id),
  event_id   TEXT NOT NULL REFERENCES events(id),
  quantity   INTEGER NOT NULL,
  notes      TEXT NOT NULL DEFAULT '',
  status     TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE idempotency (
  key        TEXT PRIMARY KEY,
  state      TEXT NOT NULL,
  result     TEXT,
  created_at INTEGER NOT NULL
);
`;

const SEED = `
INSERT INTO users (id, email, name) VALUES
  ('u_ada',  'ada@example.test',  'Ada'),
  ('u_borg', 'borg@example.test', 'Borg');
INSERT INTO events (id, name, capacity, remaining) VALUES
  ('e_recital', 'Piano recital', 3, 3),
  ('e_lecture', 'Evening lecture', 50, 47);
INSERT INTO bookings (id, user_id, event_id, quantity, notes, status, created_at) VALUES
  ('b_seed_ada',  'u_ada',  'e_lecture', 2, 'aisle please', 'confirmed', 1000),
  ('b_seed_borg', 'u_borg', 'e_lecture', 1, '',             'confirmed', 1000);
`;

/** Creates a fresh database file. Reset is a file delete, which keeps trials cheap. */
export function freshDatabase(path) {
  mkdirSync(dirname(path), { recursive: true });
  rmSync(path, { force: true });
  rmSync(`${path}-journal`, { force: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(SCHEMA);
  db.exec(SEED);
  return db;
}

/** Read-only handle used by the oracle. The agent never reaches this. */
export function openReadOnly(path) {
  return new DatabaseSync(path, { readOnly: true });
}
