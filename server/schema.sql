-- Crewmate schema. Derived from docs/DATA_MODEL.md — that file is the source of truth.
-- Ids are uuid4 strings. Timestamps are ISO-8601 UTC strings. JSON columns are TEXT.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS recordings (
    id               TEXT    PRIMARY KEY,
    task_name        TEXT    NOT NULL,
    video_path       TEXT    NOT NULL,
    duration_seconds REAL    NOT NULL,
    status           TEXT    NOT NULL
                             CHECK (status IN ('uploaded', 'comprehending', 'comprehended', 'failed')),
    error            TEXT,
    created_at       TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS briefs (
    id           TEXT    PRIMARY KEY,
    recording_id TEXT    NOT NULL REFERENCES recordings (id) ON DELETE CASCADE,
    content      TEXT    NOT NULL,
    version      INTEGER NOT NULL DEFAULT 1,
    created_at   TEXT    NOT NULL,
    updated_at   TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS runs (
    id            TEXT PRIMARY KEY,
    brief_id      TEXT NOT NULL REFERENCES briefs (id) ON DELETE RESTRICT,
    snapshot_name TEXT NOT NULL,
    "rows"        TEXT NOT NULL,
    status        TEXT NOT NULL
                       CHECK (status IN ('pending', 'running', 'complete', 'failed')),
    started_at    TEXT,
    finished_at   TEXT,
    created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS workers (
    id              TEXT    PRIMARY KEY,
    run_id          TEXT    NOT NULL REFERENCES runs (id) ON DELETE CASCADE,
    row_index       INTEGER NOT NULL,
    row_data        TEXT    NOT NULL,
    sandbox_id      TEXT,
    status          TEXT    NOT NULL
                            CHECK (status IN ('pending', 'running', 'complete', 'failed', 'skipped')),
    current_step_id INTEGER,
    last_screenshot TEXT,
    error           TEXT,
    created_at      TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS step_results (
    id              TEXT    PRIMARY KEY,
    worker_id       TEXT    NOT NULL REFERENCES workers (id) ON DELETE CASCADE,
    step_id         INTEGER NOT NULL,
    status          TEXT    NOT NULL
                            CHECK (status IN ('ok', 'retried', 'failed', 'skipped')),
    resolved_target TEXT,
    error           TEXT,
    duration_ms     INTEGER NOT NULL,
    created_at      TEXT    NOT NULL
);

-- The live grid reads every worker for a run on each SSE tick: the one hot read path.
CREATE INDEX IF NOT EXISTS idx_workers_run_id ON workers (run_id);
-- The results table expands a worker into its step history.
CREATE INDEX IF NOT EXISTS idx_step_results_worker_id ON step_results (worker_id);
