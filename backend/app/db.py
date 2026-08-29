from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterator


class Database:
    def __init__(self, path: Path):
        self.path = path
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.initialize()

    @contextmanager
    def connect(self) -> Iterator[sqlite3.Connection]:
        connection = sqlite3.connect(self.path)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        try:
            yield connection
            connection.commit()
        finally:
            connection.close()

    def initialize(self) -> None:
        with self.connect() as connection:
            connection.executescript("""
                CREATE TABLE IF NOT EXISTS runs (
                  id TEXT PRIMARY KEY, status TEXT NOT NULL, source_files TEXT NOT NULL,
                  target_schema TEXT NOT NULL, source_count INTEGER NOT NULL, created_at TEXT NOT NULL,
                  delivered_at TEXT
                );
                CREATE TABLE IF NOT EXISTS records (
                  id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
                  source_key TEXT NOT NULL, payload TEXT NOT NULL, status TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS mappings (
                  id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
                  source_field TEXT NOT NULL, target_field TEXT NOT NULL, confidence INTEGER NOT NULL,
                  reason TEXT NOT NULL, status TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS escalations (
                  id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
                  record_key TEXT NOT NULL, kind TEXT NOT NULL, title TEXT NOT NULL, detail TEXT NOT NULL,
                  confidence INTEGER NOT NULL, evidence TEXT NOT NULL, status TEXT NOT NULL,
                  resolution TEXT
                );
                CREATE TABLE IF NOT EXISTS events (
                  id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
                  event_type TEXT NOT NULL, detail TEXT NOT NULL, actor TEXT NOT NULL, created_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS deliveries (
                  id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
                  record_id TEXT NOT NULL, status TEXT NOT NULL, attempts INTEGER NOT NULL,
                  response TEXT NOT NULL, created_at TEXT NOT NULL
                );
            """)


def json_value(value: Any) -> str:
    return json.dumps(value, separators=(",", ":"), sort_keys=True)


def load_json(value: str) -> Any:
    return json.loads(value)
