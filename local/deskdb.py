# -*- coding: utf-8 -*-
"""L2 服务端存储：bridge/desk.db 是数据的**真身**。

和 L1 的区别：
  L1  浏览器 localStorage 是真身，这里只是镜像（全量替换，多端互相覆盖）
  L2  这里是真身，页面通过 /api 读写它；localStorage 只当离线缓存

设计取舍：
  * 用「一条记录一行 JSON」而不是给每张表建列 —— 中台的四张表字段会变，
    JSON 存法让加字段不需要迁移；查询量在千级，性能不成问题。
  * `seq` 保证分页顺序稳定（record_id 是无序的随机串，不能当游标排序）。
  * `meta.rev` 是全局版本号，写一次 +1；页面靠轮询它感知"别人改了数据"。
"""
from __future__ import annotations

import json
import os
import secrets
import sqlite3
from datetime import datetime

T_PROJECT = "XurtLd3EYpe29VppV0z0TJ"
T_LOG = "bI9MkKD1Zvp1UwmmY6UvfX"
T_WEEK = "nG1nopjeQW93K0wclTs4jR"
T_NODE = "1urnMOWB0VL3RL0pNiNILG"

ALL_TABLES = (T_PROJECT, T_LOG, T_WEEK, T_NODE)

SCHEMA_SQL = """
PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS records (
    database_id TEXT NOT NULL,
    record_id   TEXT NOT NULL,
    seq         INTEGER NOT NULL,
    data        TEXT NOT NULL,
    updated_at  TEXT NOT NULL,
    PRIMARY KEY (database_id, record_id)
);
CREATE INDEX IF NOT EXISTS ix_records_seq ON records(database_id, seq);
CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT);
"""

# 记录是整行 JSON，方便加字段不用迁移；但 bot 要写 SQL，所以补一层关系视图。
# 中文键在 JSON 路径里要用 $."字段名" 的写法。
VIEWS = f"""
CREATE VIEW IF NOT EXISTS v_projects AS
SELECT record_id,
       json_extract(data,'$."项目编码"') AS code,
       json_extract(data,'$."项目名"')   AS name,
       json_extract(data,'$."客户"')     AS customer,
       json_extract(data,'$."负责人"')   AS owner,
       json_extract(data,'$."阶段"')     AS stage,
       substr(json_extract(data,'$."截止日"'),1,10) AS due_date,
       json_extract(data,'$."阻塞项"')   AS block_item,
       json_extract(data,'$."预案"')     AS plan,
       json_extract(data,'$."项目备注"') AS note
FROM records WHERE database_id='{T_PROJECT}';

CREATE VIEW IF NOT EXISTS v_nodes AS
SELECT record_id,
       json_extract(data,'$."项目ID"')     AS project_id,
       json_extract(data,'$."节点名"')     AS name,
       json_extract(data,'$."序号"')       AS seq,
       substr(json_extract(data,'$."计划完成日"'),1,10) AS plan_date,
       json_extract(data,'$."已完成"')     AS done,
       substr(json_extract(data,'$."完成日"'),1,10)     AS done_date,
       json_extract(data,'$."节点状态"')   AS status,
       json_extract(data,'$."负责人"')     AS owner,
       json_extract(data,'$."备注"')       AS note
FROM records WHERE database_id='{T_NODE}';

CREATE VIEW IF NOT EXISTS v_logs AS
SELECT record_id,
       json_extract(data,'$."项目ID"')   AS project_id,
       json_extract(data,'$."项目名称"') AS project,
       substr(json_extract(data,'$."日期"'),1,10) AS log_date,
       json_extract(data,'$."完成量"')   AS qty,
       json_extract(data,'$."工时分钟"') AS minutes,
       json_extract(data,'$."补记"')     AS backfill,
       json_extract(data,'$."备注"')     AS note
FROM records WHERE database_id='{T_LOG}';

CREATE VIEW IF NOT EXISTS v_reviews AS
SELECT record_id,
       json_extract(data,'$."周标识"')   AS week,
       json_extract(data,'$."保持"')     AS keep,
       json_extract(data,'$."问题"')     AS problem,
       json_extract(data,'$."尝试"')     AS try_it,
       json_extract(data,'$."下周预案"') AS next_plan
FROM records WHERE database_id='{T_WEEK}';
"""

# 页面只用它取「阶段」下拉的选项，其余字段类型仅供展示
SCHEMAS = {
    T_PROJECT: {"title": "研发项目", "properties": [
        {"name": "项目编码", "type": "text"}, {"name": "项目名", "type": "text"},
        {"name": "客户", "type": "text"}, {"name": "负责人", "type": "text"},
        {"name": "阶段", "type": "select", "config": {"options": [
            {"text": "概念"}, {"text": "设计"}, {"text": "手板"},
            {"text": "试产"}, {"text": "量产"}]}},
        {"name": "立项日期", "type": "date"}, {"name": "截止日", "type": "date"},
        {"name": "单位", "type": "text"}, {"name": "总量", "type": "number"},
        {"name": "配色", "type": "text"}, {"name": "阻塞项", "type": "text"},
        {"name": "预案", "type": "text"}, {"name": "项目备注", "type": "text"},
    ]},
    T_NODE: {"title": "项目节点", "properties": [
        {"name": "项目ID", "type": "text"}, {"name": "节点名", "type": "text"},
        {"name": "序号", "type": "number"}, {"name": "计划完成日", "type": "date"},
        {"name": "已完成", "type": "checkbox"}, {"name": "完成日", "type": "date"},
        {"name": "备注", "type": "text"}, {"name": "负责人", "type": "text"},
        {"name": "节点状态", "type": "select", "config": {"options": [
            {"text": "待开始"}, {"text": "进行中"}, {"text": "已完成"}, {"text": "阻塞"}]}},
    ]},
    T_LOG: {"title": "每日报工", "properties": [
        {"name": "项目ID", "type": "text"}, {"name": "项目名称", "type": "text"},
        {"name": "日期", "type": "date"}, {"name": "完成量", "type": "number"},
        {"name": "工时分钟", "type": "number"}, {"name": "补记", "type": "checkbox"},
        {"name": "备注", "type": "text"},
    ]},
    T_WEEK: {"title": "每周复盘", "properties": [
        {"name": "周标识", "type": "text"}, {"name": "保持", "type": "text"},
        {"name": "问题", "type": "text"}, {"name": "尝试", "type": "text"},
        {"name": "下周预案", "type": "text"},
    ]},
}

_ALPHABET = "useandom26T198340PX75pxJACKVERYMINDBUSHWOLFGQZbfghjklqvwyzrict"


def new_id(n: int = 20) -> str:
    return "".join(secrets.choice(_ALPHABET) for _ in range(n))


def _now() -> str:
    return datetime.now().astimezone().isoformat(timespec="seconds")


def unwrap(prop):
    """PropertyValue oneof -> 纯值（与页面 shim 的 unwrap 行为一致）"""
    if prop is None or not isinstance(prop, dict):
        return prop
    for k in ("text", "number", "date", "checkbox", "select", "multi_select", "url"):
        if k in prop:
            return prop[k]
    return None


def _connect(path: str) -> sqlite3.Connection:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    conn = sqlite3.connect(path, timeout=10)
    conn.row_factory = sqlite3.Row
    return conn


def init(path: str, seed_path: str = "") -> dict:
    """建表；若是空库且给了 seed，就灌一次种子。"""
    conn = _connect(path)
    try:
        conn.executescript(SCHEMA_SQL)
        conn.executescript(VIEWS)
        conn.commit()
        n = conn.execute("SELECT COUNT(*) c FROM records").fetchone()["c"]
        seeded = 0
        if n == 0 and seed_path and os.path.exists(seed_path):
            with open(seed_path, encoding="utf-8") as f:
                seed = json.load(f)
            pairs = [("projects", T_PROJECT), ("nodes", T_NODE),
                     ("logs", T_LOG), ("reviews", T_WEEK)]
            with conn:
                seq = 0
                for key, db_id in pairs:
                    for row in seed.get(key) or []:
                        rec = dict(row)
                        rid = rec.pop("_id", "") or new_id()
                        seq += 1
                        conn.execute(
                            "INSERT OR REPLACE INTO records(database_id,record_id,seq,data,updated_at)"
                            " VALUES(?,?,?,?,?)",
                            (db_id, rid, seq, json.dumps(rec, ensure_ascii=False), _now()))
                        seeded += 1
                conn.execute("INSERT OR REPLACE INTO meta(k,v) VALUES('rev','1')")
        if not conn.execute("SELECT v FROM meta WHERE k='rev'").fetchone():
            conn.execute("INSERT INTO meta(k,v) VALUES('rev','0')")
            conn.commit()
        return {"rows": conn.execute("SELECT COUNT(*) c FROM records").fetchone()["c"],
                "seeded": seeded, "rev": rev(path, conn=conn)}
    finally:
        conn.close()


def rev(path: str, conn: sqlite3.Connection | None = None) -> int:
    own = conn is None
    if own:
        conn = _connect(path)
    try:
        row = conn.execute("SELECT v FROM meta WHERE k='rev'").fetchone()
        return int(row["v"]) if row else 0
    finally:
        if own:
            conn.close()


def _bump(conn: sqlite3.Connection) -> int:
    conn.execute("UPDATE meta SET v=CAST(CAST(v AS INTEGER)+1 AS TEXT) WHERE k='rev'")
    row = conn.execute("SELECT v FROM meta WHERE k='rev'").fetchone()
    return int(row["v"]) if row else 0


def _row(r: sqlite3.Row) -> dict:
    d = json.loads(r["data"])
    d["_id"] = r["record_id"]
    return d


def list_records(path: str, db_id: str, cursor: str = "", size: int = 50) -> dict:
    conn = _connect(path)
    try:
        size = max(1, min(int(size or 50), 200))
        if cursor:
            base = conn.execute(
                "SELECT seq FROM records WHERE database_id=? AND record_id=?",
                (db_id, cursor)).fetchone()
            start = base["seq"] if base else -1
            rows = conn.execute(
                "SELECT * FROM records WHERE database_id=? AND seq>? ORDER BY seq LIMIT ?",
                (db_id, start, size + 1)).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM records WHERE database_id=? ORDER BY seq LIMIT ?",
                (db_id, size + 1)).fetchall()
        has_more = len(rows) > size
        rows = rows[:size]
        return {"results": [_row(r) for r in rows],
                "nextCursor": rows[-1]["record_id"] if rows else "",
                "hasMore": has_more}
    finally:
        conn.close()


def add_record(path: str, db_id: str, props: dict) -> dict:
    data = {k: unwrap(v) for k, v in (props or {}).items()}
    rid = new_id()
    conn = _connect(path)
    try:
        with conn:
            seq = conn.execute("SELECT COALESCE(MAX(seq),0)+1 s FROM records").fetchone()["s"]
            conn.execute(
                "INSERT INTO records(database_id,record_id,seq,data,updated_at) VALUES(?,?,?,?,?)",
                (db_id, rid, seq, json.dumps(data, ensure_ascii=False), _now()))
            rev_no = _bump(conn)
        return {"id": rid, "rev": rev_no}
    finally:
        conn.close()


def update_record(path: str, db_id: str, rid: str, props: dict) -> dict:
    conn = _connect(path)
    try:
        row = conn.execute("SELECT data FROM records WHERE database_id=? AND record_id=?",
                           (db_id, rid)).fetchone()
        if not row:
            raise KeyError("RECORD_NOT_FOUND")
        data = json.loads(row["data"])
        for k, v in (props or {}).items():
            data[k] = unwrap(v)
        with conn:
            conn.execute("UPDATE records SET data=?, updated_at=? WHERE database_id=? AND record_id=?",
                         (json.dumps(data, ensure_ascii=False), _now(), db_id, rid))
            rev_no = _bump(conn)
        return {"id": rid, "rev": rev_no}
    finally:
        conn.close()


def delete_record(path: str, db_id: str, rid: str) -> dict:
    conn = _connect(path)
    try:
        with conn:
            conn.execute("DELETE FROM records WHERE database_id=? AND record_id=?", (db_id, rid))
            rev_no = _bump(conn)
        return {"ok": True, "rev": rev_no}
    finally:
        conn.close()


def schema(db_id: str) -> dict:
    s = SCHEMAS.get(db_id)
    if not s:
        return {"properties": []}
    return {"id": db_id, **s}


def export_all(path: str) -> dict:
    """整库导出成页面那种 {projects,nodes,logs,reviews} 结构（备份 / 给 bot 用）"""
    pairs = [("projects", T_PROJECT), ("nodes", T_NODE),
             ("logs", T_LOG), ("reviews", T_WEEK)]
    out = {"exportedAt": _now(), "rev": rev(path)}
    conn = _connect(path)
    try:
        for key, db_id in pairs:
            rows = conn.execute(
                "SELECT * FROM records WHERE database_id=? ORDER BY seq", (db_id,)).fetchall()
            out[key] = [_row(r) for r in rows]
    finally:
        conn.close()
    return out
