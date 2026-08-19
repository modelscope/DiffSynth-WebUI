from __future__ import annotations

import sqlite3
import threading
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator, Optional, Tuple

from . import config


_SCHEMA_TASKS = """
CREATE TABLE IF NOT EXISTS tasks (
    id            TEXT PRIMARY KEY,
    name          TEXT NOT NULL,
    model_type    TEXT NOT NULL,
    dataset       TEXT,
    config_json   TEXT NOT NULL,
    task_dir      TEXT,
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL
);
"""

_SCHEMA_TASK_RUNS = """
CREATE TABLE IF NOT EXISTS task_runs (
    id            TEXT PRIMARY KEY,
    task_id        TEXT NOT NULL,
    task_name      TEXT NOT NULL,
    status        TEXT NOT NULL DEFAULT 'preparing',
    config_json   TEXT NOT NULL,
    command_json  TEXT,
    output_path   TEXT NOT NULL,
    log_path      TEXT,
    os_pid        INTEGER,
    returncode    INTEGER,
    created_at    TEXT NOT NULL,
    started_at    TEXT,
    finished_at   TEXT,
    sampling_status      TEXT NOT NULL DEFAULT 'not_started',
    sampling_current     INTEGER NOT NULL DEFAULT 0,
    sampling_total       INTEGER NOT NULL DEFAULT 0,
    sampling_checkpoint  TEXT,
    sampling_script      TEXT,
    sampling_message     TEXT,
    sampling_started_at  TEXT,
    sampling_finished_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_task_runs_task_id ON task_runs (task_id, created_at DESC);
"""

_SCHEMA_SETTINGS = """
CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS caption_models (
    id                  TEXT PRIMARY KEY,
    name                TEXT NOT NULL UNIQUE,
    base_url            TEXT NOT NULL,
    api_key             TEXT NOT NULL,
    model_id            TEXT NOT NULL,
    supports_image      INTEGER NOT NULL DEFAULT 1,
    supports_video      INTEGER NOT NULL DEFAULT 0,
    supports_audio      INTEGER NOT NULL DEFAULT 0,
    created_at          TEXT NOT NULL,
    updated_at          TEXT NOT NULL
);
"""


_INIT_LOCK = threading.Lock()
_INITIALIZED_PATHS: Optional[Tuple[Path, Path]] = None


def _connect(path: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(path, timeout=30)
    conn.execute("PRAGMA busy_timeout = 30000")
    return conn


def _init_db(path: Path, schema: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with _connect(path) as conn:
        conn.executescript(schema)


def init_all() -> None:
    global _INITIALIZED_PATHS
    paths = (config.DB_PATH.resolve(), config.SETTINGS_DB_PATH.resolve())
    if _INITIALIZED_PATHS == paths:
        return
    with _INIT_LOCK:
        if _INITIALIZED_PATHS == paths:
            return
        config.ensure_dirs()
        _init_db(paths[0], _SCHEMA_TASKS + _SCHEMA_TASK_RUNS)
        with _connect(paths[0]) as conn:
            conn.execute(
                "CREATE UNIQUE INDEX IF NOT EXISTS idx_task_runs_one_active "
                "ON task_runs (task_id) "
                "WHERE status IN ('preparing', 'running', 'sampling')"
            )
        _init_db(paths[1], _SCHEMA_SETTINGS)
        _INITIALIZED_PATHS = paths


@contextmanager
def tasks_conn() -> Iterator[sqlite3.Connection]:
    init_all()
    conn = _connect(config.DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


@contextmanager
def settings_conn() -> Iterator[sqlite3.Connection]:
    init_all()
    conn = _connect(config.SETTINGS_DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()
