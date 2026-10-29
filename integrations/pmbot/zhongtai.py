# -*- coding: utf-8 -*-
"""中台数据接入（只读镜像）。

定位：研发推进中台是主系统，pmbot 是只读的交互层。
      本模块在每轮对话/推送前调用一次，把 `bridge/desk.db`（中台真源）
      镜像进 pmbot 自己的 projects / milestones，然后重算预警。

为什么镜像而不是直接查：
  pmbot 现有的读工具、日报渲染、按人汇报、预警重算全部建立在
  自己的 schema 上（projects/milestones/alerts），直接改这些工具的
  数据来源等于重写半个 bot。镜像后**读路径一行不用改**，写路径全部关闭。

对齐规则：
  * 项目以「项目编码」对齐（pmbot.projects.code 是 UNIQUE）
  * 节点以「项目编码 + 节点名」对齐（中台节点没有业务主键）
  * 中台消失的项目不删除，改标 status='closed'（免得连带删掉订单）
  * 中台消失的节点直接删除，同时清掉它的预警（否则日报会报幽灵）
"""
from __future__ import annotations

import os
import sqlite3
from pathlib import Path

# 中台「阶段」五档 → pmbot 的阶段代号
STAGE_MAP = {"概念": "kickoff", "设计": "ID", "手板": "EV", "试产": "PVT", "量产": "MP"}
# 中台「节点状态」四值 → pmbot 的节点状态
STATUS_MAP = {"待开始": "pending", "进行中": "doing", "已完成": "done", "阻塞": "blocked"}

REV_FILE = "zhongtai_rev.txt"


def _readonly(path: str) -> sqlite3.Connection:
    conn = sqlite3.connect(f"file:{Path(path).as_posix()}?mode=ro", uri=True, timeout=5)
    conn.row_factory = sqlite3.Row
    return conn


def source_rev(path: str) -> int:
    try:
        conn = _readonly(path)
        try:
            row = conn.execute("SELECT v FROM meta WHERE k='rev'").fetchone()
            return int(row["v"]) if row else 0
        finally:
            conn.close()
    except Exception:
        return -1


def _load(path: str) -> tuple[list[dict], list[dict]]:
    conn = _readonly(path)
    try:
        projects = [dict(r) for r in conn.execute("SELECT * FROM v_projects ORDER BY code")]
        nodes = [dict(r) for r in conn.execute("SELECT * FROM v_nodes ORDER BY project_id, seq")]
        return projects, nodes
    finally:
        conn.close()


def _d(v) -> str:
    return (v or "")[:10]


def sync(db, cfg, force: bool = False) -> dict:
    """把中台当前状态镜像进 pmbot.db。返回执行摘要。"""
    path = (getattr(cfg, "zhongtai_db", "") or "").strip()
    if not path or not os.path.exists(path):
        return {"ok": False, "reason": "中台库未配置或不存在", "path": path}

    rev = source_rev(path)
    marker = Path(cfg.home) / REV_FILE
    last = ""
    try:
        last = marker.read_text(encoding="utf-8").strip()
    except OSError:
        pass
    if not force and last == str(rev):
        return {"ok": True, "skipped": True, "rev": rev}

    try:
        projects, nodes = _load(path)
    except Exception as exc:                    # 库被锁 / 结构不对
        return {"ok": False, "reason": f"读取失败: {exc}"}

    by_code = {p["code"]: p for p in projects if p.get("code")}
    created = updated = nodes_new = nodes_upd = nodes_del = 0

    for code, p in by_code.items():
        stage = STAGE_MAP.get((p.get("stage") or "").strip(), "kickoff")
        fields = dict(
            name=p.get("name") or code,
            customer=p.get("customer") or "",
            owner=p.get("owner") or "",
            stage=stage,
            status="active",
            target_mp=_d(p.get("due_date")),
            note=p.get("note") or "",
        )
        row = db.one("SELECT id FROM projects WHERE code = ?", (code,))
        if row:
            pid = int(row["id"])
            sets = ", ".join(f"{k} = ?" for k in fields)
            db.exec(f"UPDATE projects SET {sets}, updated_at = datetime('now','localtime') "
                    f"WHERE id = ?", tuple(fields.values()) + (pid,))
            updated += 1
        else:
            pid = db.add_project(code, fields.pop("name"), **fields)
            created += 1

        # —— 节点：先更新/新增，再删中台已经没有的 ——
        mine = {r["name"]: r for r in db.milestones_of(pid)}
        wanted = set()
        for n in [x for x in nodes if x.get("project_id") == p.get("record_id")]:
            name = (n.get("name") or "").strip()
            if not name:
                continue
            wanted.add(name)
            fields_n = dict(
                plan_date=_d(n.get("plan_date")),
                actual_date=_d(n.get("done_date")),
                status=STATUS_MAP.get((n.get("status") or "").strip(), "pending"),
                owner=n.get("owner") or "",
                note=n.get("note") or "",
            )
            if name in mine:
                sets = ", ".join(f"{k} = ?" for k in fields_n)
                db.exec(f"UPDATE milestones SET {sets} WHERE id = ?",
                        tuple(fields_n.values()) + (int(mine[name]["id"]),))
                nodes_upd += 1
            else:
                db.add_milestone(pid, "custom", name, **fields_n)
                nodes_new += 1
        for name, r in mine.items():
            if name not in wanted:
                db.delete_milestone(int(r["id"]))
                nodes_del += 1

    # 中台已经没有的项目：不删，标记关闭
    if by_code:
        marks = ", ".join("?" for _ in by_code)
        db.exec(f"UPDATE projects SET status = 'closed' "
                f"WHERE status != 'closed' AND code NOT IN ({marks})", tuple(by_code))

    alerts = db.scan_alerts()

    try:
        marker.parent.mkdir(parents=True, exist_ok=True)
        marker.write_text(str(rev), encoding="utf-8")
    except OSError:
        pass

    return {"ok": True, "rev": rev, "projects_in": len(by_code),
            "created": created, "updated": updated,
            "nodes_new": nodes_new, "nodes_upd": nodes_upd, "nodes_del": nodes_del,
            "alerts_open": len(alerts)}
