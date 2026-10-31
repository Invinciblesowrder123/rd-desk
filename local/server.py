# -*- coding: utf-8 -*-
"""本地中台服务端（L2）：数据真身在 bridge/desk.db，页面通过 /api 读写。

  GET  /api/rev                              全局版本号（页面轮询它感知别人改动）
                                             附带 index.html 构建戳 build
  GET  /api/db/<id>/records?cursor=&size=    分页取记录
  POST /api/db/<id>/records                  {properties}
  POST /api/db/<id>/records/<rid>/update     {properties}
  POST /api/db/<id>/records/<rid>/delete
  GET  /api/db/<id>/schema
  GET  /api/export                           整库导出（备份 / 给 bot 联查）
  其余路径 → 静态文件

用法：
  python local/server.py             # 8787
  python local/server.py 8790        # 换端口
"""
from __future__ import annotations

import json
import os
import sys
import threading
import time
import traceback
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import deskdb  # noqa: E402

BASE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(BASE)
BRIDGE_DIR = os.path.join(ROOT, "bridge")
DB_PATH = os.path.join(BRIDGE_DIR, "desk.db")


def _pick_seed() -> str:
    """首启种子：优先真实数据 data/seed.json，没有就用演示数据 data/seed.demo.json。"""
    for name in ("seed.json", "seed.demo.json"):
        p = os.path.join(ROOT, "data", name)
        if os.path.exists(p):
            return p
    return ""


SEED_PATH = _pick_seed()
MAX_BODY = 4 * 1024 * 1024

INDEX_HTML = os.path.join(BASE, "index.html")


def build_stamp() -> int:
    """index.html 的构建戳（mtime，秒）。

    页面在 /api/rev 里拿到它，和打开时的值比对：不一样就说明前端换了一版，
    提醒用户刷新。**不刷新会一直跑旧 JS**——这是反复踩到的坑（旧版"完成
    节点"并发两个写请求、错误提示关不掉，都出在这里）。
    """
    try:
        return int(os.path.getmtime(INDEX_HTML))
    except OSError:
        return 0


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=BASE, **kw)

    # ---------------- GET ----------------
    def do_GET(self) -> None:  # noqa: N802
        u = urlparse(self.path)
        p = u.path
        if not p.startswith("/api/"):
            return super().do_GET()
        try:
            if p == "/api/rev":
                return self._json(200, {"rev": deskdb.rev(DB_PATH),
                                        "build": build_stamp()})
            if p == "/api/export":
                return self._json(200, deskdb.export_all(DB_PATH))
            parts = [x for x in p.split("/") if x]      # api db <id> records|schema ...
            if len(parts) >= 3 and parts[1] == "db":
                db_id = parts[2]
                if len(parts) == 4 and parts[3] == "records":
                    q = parse_qs(u.query)
                    return self._json(200, deskdb.list_records(
                        DB_PATH, db_id,
                        cursor=(q.get("cursor") or [""])[0],
                        size=int((q.get("size") or ["50"])[0])))
                if len(parts) == 4 and parts[3] == "schema":
                    return self._json(200, deskdb.schema(db_id))
            return self._json(404, {"error": "unknown api"})
        except Exception as exc:
            return self._fail(exc)

    # ---------------- POST ----------------
    def do_POST(self) -> None:  # noqa: N802
        p = urlparse(self.path).path
        if not p.startswith("/api/"):
            return self._json(404, {"error": "unknown path"})
        try:
            body = self._read_json()
            parts = [x for x in p.split("/") if x]      # api db <id> records [<rid> action]
            if p == "/api/shutdown":
                # 优雅退出：先回响应，再收 SQLite 常驻连接，最后退进程
                self._json(200, {"ok": True, "message": "shutting down"})
                threading.Thread(target=_graceful_exit, daemon=True).start()
                return
            if len(parts) == 2 and parts[1] == "batch":
                # 原子批量写：复合动作（完成节点 = 置完成 + 记报工）必须同生共死
                return self._json(200, deskdb.batch(DB_PATH, body.get("ops") or []))
            if len(parts) < 4 or parts[1] != "db":
                return self._json(404, {"error": "unknown api"})
            db_id = parts[2]
            if len(parts) == 4 and parts[3] == "records":
                return self._json(200, deskdb.add_record(DB_PATH, db_id, body.get("properties") or {}))
            if len(parts) == 6 and parts[3] == "records":
                rid, action = parts[4], parts[5]
                if action == "update":
                    return self._json(200, deskdb.update_record(
                        DB_PATH, db_id, rid, body.get("properties") or {}))
                if action == "delete":
                    return self._json(200, deskdb.delete_record(DB_PATH, db_id, rid))
            return self._json(404, {"error": "unknown api"})
        except KeyError as exc:
            return self._json(404, {"error": str(exc)})
        except Exception as exc:
            return self._fail(exc)

    # ---------------- helpers ----------------
    def _read_json(self) -> dict:
        try:
            n = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            n = 0
        if n <= 0 or n > MAX_BODY:
            return {}
        raw = self.rfile.read(n)
        try:
            d = json.loads(raw.decode("utf-8"))
            return d if isinstance(d, dict) else {}
        except Exception:
            return {}

    def _fail(self, exc: Exception) -> None:
        traceback.print_exc()
        self._json(500, {"error": "%s: %s" % (type(exc).__name__, exc)})

    def _json(self, code: int, obj: dict) -> None:
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt: str, *args) -> None:
        if "/api/" in (args[0] if args else ""):
            sys.stderr.write("[api] %s\n" % (args[0] if args else ""))


def _graceful_exit() -> None:
    """收到 POST /api/shutdown 后走正常退出流程。

    为什么必须有这条路：强杀（taskkill /F）会直接打掉进程，SQLite 连接来不及
    关闭，-wal/-shm 残留。下一个进程恢复 WAL 时可能降级成只读模式，
    写操作就会报 "attempt to write a readonly database"（数据本身没坏）。
    所以停止服务必须先请它自己收尾，强杀只作为兜底。
    """
    time.sleep(0.15)                      # 给响应留出发送时间
    try:
        deskdb.close_keeper()              # checkpoint(TRUNCATE) + 关连接
    except Exception:
        traceback.print_exc()
    os._exit(0)


def main() -> None:
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8787
    info = deskdb.init(DB_PATH, SEED_PATH)
    print("本地中台   http://127.0.0.1:%d/index.html" % port)
    print("旧版备用   http://127.0.0.1:%d/legacy.html  （localStorage 独立数据）" % port)
    print("数据库     %s" % DB_PATH)
    print("  记录 %d 条（本次灌种子 %d 条）· rev=%s" % (info["rows"], info["seeded"], info["rev"]))
    print("导出口     http://127.0.0.1:%d/api/export" % port)
    print("Ctrl+C 停止")
    try:
        ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
    except KeyboardInterrupt:
        print("\n已停止")
    finally:
        # 收掉常驻连接，让 SQLite 正常 checkpoint 并清理 -wal/-shm
        deskdb.close_keeper()


if __name__ == "__main__":
    main()
