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
import threading
import time
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
        # 延期登记：把计划日往后推时自动记一笔，周报/月报据此体现
        {"name": "原计划日", "type": "date"}, {"name": "延期日", "type": "date"},
        {"name": "延期理由", "type": "text"}, {"name": "延期次数", "type": "number"},
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

# ============================================================
# 并发写保护
#
# 踩过的坑：页面「完成节点」会**同时**发两个写请求（节点置完成 + 记一条
# 报工），服务端是 ThreadingHTTPServer，两个线程各自新建连接同时写。
# SQLite 在 WAL 模式下，最后一个连接关闭时会删掉 -wal/-shm；两个线程
# 撞上"wal 文件刚被删、两边同时重建"时，其中一边会报
#   OperationalError: attempt to write a readonly database
# 结果是 Promise.all 整体 reject —— 节点写成功了、报工没写成，
# 页面上却弹"完成节点失败"，属于典型的"半成功"脏状态。
#
# 两道防线：
#   ① keeper 连接常驻，-wal/-shm 一直在，不会被删 → 不触发重建竞态
#   ② 写锁把所有写操作串行化 → 同一时刻只有一个写者在动
# 再加上失败重试兜底（readonly database / locked 都会重试）。
# ============================================================

_WRITE_LOCK = threading.RLock()
_KEEPER_CONN: sqlite3.Connection | None = None
_KEEPER_PATH = ""


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
    conn = sqlite3.connect(path, timeout=15)
    conn.row_factory = sqlite3.Row
    return conn


def _keeper(path: str) -> sqlite3.Connection:
    """常驻连接：让 -wal/-shm 一直存在，避免多线程同时重建它们。"""
    global _KEEPER_CONN, _KEEPER_PATH
    with _WRITE_LOCK:
        if _KEEPER_CONN is not None and _KEEPER_PATH == path:
            return _KEEPER_CONN
        conn = _connect(path)
        try:
            conn.execute("SELECT COUNT(*) FROM records").fetchone()
        except sqlite3.Error:
            conn.close()
            raise
        _KEEPER_CONN = conn
        _KEEPER_PATH = path
        return conn


def close_keeper() -> None:
    """进程退出前收掉常驻连接，让 SQLite 正常 checkpoint 并清理 -wal/-shm。"""
    global _KEEPER_CONN, _KEEPER_PATH
    with _WRITE_LOCK:
        if _KEEPER_CONN is not None:
            try:
                _KEEPER_CONN.execute("PRAGMA wal_checkpoint(TRUNCATE)")
            except sqlite3.Error:
                pass
            try:
                _KEEPER_CONN.close()
            except sqlite3.Error:
                pass
            _KEEPER_CONN = None
            _KEEPER_PATH = ""


_RETRYABLE = ("readonly database", "database is locked", "database table is locked")


def _is_retryable(exc: Exception) -> bool:
    msg = str(exc).lower()
    return any(k in msg for k in _RETRYABLE)


def _write(path: str, fn, retries: int = 5):
    """串行化执行一个写操作，遇到瞬时锁冲突自动重试。

    fn(conn) 收到一条连接，自己负责 commit / rollback。
    """
    last: Exception | None = None
    for attempt in range(retries):
        try:
            with _WRITE_LOCK:
                conn = _connect(path)
                try:
                    return fn(conn)
                finally:
                    conn.close()
        except sqlite3.OperationalError as exc:
            if not _is_retryable(exc):
                raise
            last = exc
            time.sleep(0.05 * (attempt + 1))
    raise last if last else RuntimeError("write failed")


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
    # 建一个常驻连接：让 -wal/-shm 不被回收，规避多线程并发写时的重建竞态
    _keeper(path)


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

    def _do(conn: sqlite3.Connection) -> dict:
        with conn:
            seq = conn.execute("SELECT COALESCE(MAX(seq),0)+1 s FROM records").fetchone()["s"]
            conn.execute(
                "INSERT INTO records(database_id,record_id,seq,data,updated_at) VALUES(?,?,?,?,?)",
                (db_id, rid, seq, json.dumps(data, ensure_ascii=False), _now()))
            rev_no = _bump(conn)
        return {"id": rid, "rev": rev_no}

    return _write(path, _do)


def update_record(path: str, db_id: str, rid: str, props: dict) -> dict:
    def _do(conn: sqlite3.Connection) -> dict:
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

    return _write(path, _do)


def delete_record(path: str, db_id: str, rid: str) -> dict:
    def _do(conn: sqlite3.Connection) -> dict:
        with conn:
            conn.execute("DELETE FROM records WHERE database_id=? AND record_id=?", (db_id, rid))
            rev_no = _bump(conn)
        return {"ok": True, "rev": rev_no}

    return _write(path, _do)


def batch(path: str, ops: list) -> dict:
    """一批写操作在**同一个事务**里完成：全成或全不成，rev 只 +1。

    这是"完成节点"这类复合动作的正解 —— 节点置完成 + 记一条报工
    必须同生共死，否则会出现"节点已完成但没有报工"的半成功状态。
    """
    if not ops:
        return {"rev": rev(path), "results": []}

    def _do(conn: sqlite3.Connection) -> dict:
        results = []
        with conn:
            for op in ops:
                kind = (op.get("op") or "").lower()
                db_id = op.get("databaseId") or ""
                props = op.get("properties") or {}
                if kind == "add":
                    rid = new_id()
                    data = {k: unwrap(v) for k, v in props.items()}
                    seq = conn.execute(
                        "SELECT COALESCE(MAX(seq),0)+1 s FROM records").fetchone()["s"]
                    conn.execute(
                        "INSERT INTO records(database_id,record_id,seq,data,updated_at) VALUES(?,?,?,?,?)",
                        (db_id, rid, seq, json.dumps(data, ensure_ascii=False), _now()))
                    results.append({"id": rid})
                elif kind == "update":
                    rid = op.get("recordId") or ""
                    row = conn.execute(
                        "SELECT data FROM records WHERE database_id=? AND record_id=?",
                        (db_id, rid)).fetchone()
                    if not row:
                        raise KeyError("RECORD_NOT_FOUND")
                    data = json.loads(row["data"])
                    for k, v in props.items():
                        data[k] = unwrap(v)
                    conn.execute(
                        "UPDATE records SET data=?, updated_at=? WHERE database_id=? AND record_id=?",
                        (json.dumps(data, ensure_ascii=False), _now(), db_id, rid))
                    results.append({"id": rid})
                elif kind == "delete":
                    rid = op.get("recordId") or ""
                    conn.execute("DELETE FROM records WHERE database_id=? AND record_id=?", (db_id, rid))
                    results.append({"ok": True})
                else:
                    raise ValueError("unknown op: %s" % kind)
            rev_no = _bump(conn)
        return {"rev": rev_no, "results": results}

    return _write(path, _do)


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
