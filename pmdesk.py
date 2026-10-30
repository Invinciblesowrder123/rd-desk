# -*- coding: utf-8 -*-
"""PM_desk 统一启停编排器。

管三件事：
  center  研发推进中台服务（local/server.py，端口 8787）—— 必须
  bot     飞书长连接监听（pmbot run_pmbot.py feishu-ws --env .env.prod）—— 必须
  web     pmbot 本地网页聊天（run_pmbot.py serve --port 8000）—— 可选，默认不启

用法：
  python pmdesk.py start            启全部（center + bot）
  python pmdesk.py start center     只启中台
  python pmdesk.py stop             停全部
  python pmdesk.py stop bot --dry-run   只看看会杀哪些进程，不动手
  python pmdesk.py status           看状态
  python pmdesk.py doctor           排查：解释器/端口/进程/日志
  python pmdesk.py restart center   重启某个
  python pmdesk.py start --python <exe>   指定 center 用的解释器

设计要点：
  * 停止不按进程名瞎杀（本机还有别的 python.exe），而是**按命令行特征**精确匹配，
    所以手工启动的实例也能一起收掉。
  * 同时记录自己拉起的 PID，双保险。
  * 日志落到 logs/<组件>.log，出问题直接看这里。
  * **解释器不靠 PATH**：Windows 的 Store 别名（WindowsApps\\python.exe）是
    0 字节桩，执行返回 9009，必须实测筛选，见 resolve_python()。
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent
LOCAL_DIR = ROOT / "local"
LOG_DIR = ROOT / "logs"
PID_FILE = LOG_DIR / "pids.json"

PMBOT_DIR = Path(os.environ.get("PMBOT_DIR") or (ROOT.parent / "pmbot")).resolve()
PMBOT_PY = PMBOT_DIR / "python-embed" / "python.exe"
PMBOT_ENV = ".env.prod"

CENTER_PORT = 8787
WEB_PORT = 8000

# ---------------------------------------------------------------- 解释器解析
# 坑：这台机器（以及大量 Win10/11 用户）的 PATH 里只有 Microsoft Store 的
# 应用执行别名 C:\Users\<u>\AppData\Local\Microsoft\WindowsApps\python.exe。
# 那是个 0 字节的桩程序：直接执行返回 9009、不产生任何输出，
# 所以「where python 找得到」≠「python 能用」。
# 一律以实测（-c "import sys"）判定，桩会被直接淘汰。
STORE_ALIAS_MARK = "microsoft\\windowsapps"

CENTER_PY = ""          # 运行时由 resolve_python() 填，center 组件用它


def _usable_python(path) -> bool:
    """候选解释器是否真的能跑（挡掉 Store 别名桩和残废安装）。"""
    if not path:
        return False
    try:
        p = Path(path)
    except (TypeError, ValueError):
        return False
    if STORE_ALIAS_MARK in str(p).lower():
        return False
    if not p.is_file():
        return False
    try:
        r = subprocess.run([str(p), "-c", "import sys"],
                           capture_output=True, timeout=25)
    except (OSError, subprocess.SubprocessError):
        return False
    return r.returncode == 0


def _python_candidates() -> list[str]:
    """按优先级列出本机上可能存在的 Python 解释器。"""
    cands: list[str] = []
    home = Path(os.path.expanduser("~"))
    wb = home / ".workbuddy" / "binaries" / "python" / "versions"
    if wb.is_dir():
        for d in sorted(wb.iterdir(), reverse=True):
            cands.append(str(d / "python.exe"))
    localapp = os.environ.get("LOCALAPPDATA", "")
    if localapp:
        pdir = Path(localapp) / "Programs" / "Python"
        if pdir.is_dir():
            for d in sorted(pdir.iterdir(), reverse=True):
                if d.name.lower().startswith("python3"):
                    cands.append(str(d / "python.exe"))
    for base in ("C:/Python314", "C:/Python313", "C:/Python312", "C:/Python311",
                 "C:/Python310", "D:/Python314", "D:/Python313", "D:/Python312"):
        cands.append(base + "/python.exe")
    cands.append(str(PMBOT_PY))          # pmbot 自带内嵌版，最后兜底
    return cands


def resolve_python(explicit: str | None = None) -> str | None:
    """挑一个真正可用的 Python：显式指定 > 当前解释器 > 内嵌/常见安装位置。"""
    order: list[str] = []
    if explicit:
        order.append(explicit)
    order.append(sys.executable)
    order.extend(_python_candidates())
    for c in order:
        if _usable_python(c):
            # 只做绝对化，**不要** Path.resolve()：那会把 symlink/junction
            # 展开成安装目录（如 D:\Workbuddy\resources\vendor\python），
            # 应用升级换路径就失效了。保留调用方给的原始路径。
            return os.path.abspath(c)
    return None


def port_busy(port: int) -> int:
    """端口被谁占着（返回 pid，0 = 空闲）。"""
    import socket
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        s.bind(("127.0.0.1", port))
        return 0
    except OSError:
        return -1
    finally:
        s.close()


# 组件定义：name -> (命令行生成函数, 工作目录, 命令行特征[ASCII，用于精确停/查])
COMPONENTS = {
    "center": {
        "cmd": lambda: [CENTER_PY, "server.py", str(CENTER_PORT)],
        "cwd": LOCAL_DIR,
        "match": ["server.py %d" % CENTER_PORT],
        "label": "研发推进中台",
        "url": "http://127.0.0.1:%d/api/rev" % CENTER_PORT,
        "optional": False,
    },
    "bot": {
        "cmd": lambda: [str(PMBOT_PY), "run_pmbot.py", "feishu-ws",
                        "--env", PMBOT_ENV, "--verbose"],
        "cwd": PMBOT_DIR,
        "match": ["run_pmbot.py", "feishu-ws", PMBOT_ENV],
        "label": "飞书 bot（长连接）",
        "url": "",
        "optional": False,
    },
    "web": {
        "cmd": lambda: [str(PMBOT_PY), "run_pmbot.py", "serve", "--port", str(WEB_PORT)],
        "cwd": PMBOT_DIR,
        "match": ["run_pmbot.py", "serve"],
        "label": "pmbot 网页聊天",
        "url": "http://127.0.0.1:%d/health" % WEB_PORT,
        "optional": True,
    },
}
DEFAULT_TARGETS = ["center", "bot"]


# ---------------------------------------------------------------- 进程枚举
# 注意：这台机器的 PATH 里没有 powershell（子进程里会 FileNotFoundError），
# 必须用 System32 下的完整路径。wmic 已被安全策略拉黑，不要用。
SYSROOT = os.environ.get("SystemRoot", r"C:\Windows")
PS1 = os.path.join(SYSROOT, "System32", "WindowsPowerShell", "v1.0", "powershell.exe")


def _run(cmd: list[str]) -> str:
    try:
        p = subprocess.run(cmd, capture_output=True, timeout=25)
    except (OSError, subprocess.SubprocessError):
        return ""
    raw = p.stdout or b""
    for enc in ("utf-8", "mbcs"):
        try:
            return raw.decode(enc)
        except (UnicodeDecodeError, LookupError):
            continue
    return raw.decode("utf-8", "replace")


def _python_procs() -> list[tuple[int, str]]:
    """列出所有 python.exe 的 (pid, 命令行)。"""
    ps = (
        "[Console]::OutputEncoding=[Text.Encoding]::UTF8; "
        "Get-CimInstance Win32_Process -Filter \"Name='python.exe'\" "
        "| ForEach-Object { \"$($_.ProcessId)|$($_.CommandLine)\" }"
    )
    text = _run([PS1, "-NoProfile", "-NonInteractive", "-Command", ps])
    procs: list[tuple[int, str]] = []
    for line in text.replace("\r", "").split("\n"):
        if "|" not in line:
            continue
        head, _, cmdline = line.partition("|")
        head = head.strip()
        if head.isdigit():
            procs.append((int(head), cmdline))
    return procs


def find(name: str) -> list[int]:
    pats = COMPONENTS[name]["match"]
    out = []
    for pid, cmdline in _python_procs():
        if pid == os.getpid():
            continue
        if all(p in cmdline for p in pats):
            out.append(pid)
    return out


def _alive(pid: int) -> bool:
    try:
        out = subprocess.run(["tasklist", "/FI", "PID eq %d" % pid, "/NH"],
                             capture_output=True, text=True, timeout=10)
        return str(pid) in (out.stdout or "")
    except Exception:
        return False


def _kill(pids: list[int], dry: bool = False) -> int:
    killed = 0
    for pid in pids:
        if dry:
            print("   [dry-run] 会结束 PID %d" % pid)
            killed += 1
            continue
        r = subprocess.run(["taskkill", "/T", "/F", "/PID", str(pid)],
                           capture_output=True, text=True)
        ok = r.returncode == 0
        print("   %s PID %d" % ("已结束" if ok else "结束失败", pid))
        if ok:
            killed += 1
    return killed


_OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))  # 本机探测必须绕开公司代理


def _http_ok(url: str, timeout: float = 1.5) -> bool:
    try:
        with _OPENER.open(url, timeout=timeout) as r:
            return 200 <= r.status < 300
    except (urllib.error.URLError, OSError, ValueError):
        return False


# ---------------------------------------------------------------- pid 记录
def _load_pids() -> dict:
    try:
        return json.loads(PID_FILE.read_text(encoding="utf-8"))
    except Exception:
        return {}


def _save_pids(data: dict) -> None:
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    PID_FILE.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")


# ---------------------------------------------------------------- 命令
def cmd_status() -> int:
    print("组件状态")
    print("-" * 58)
    all_ok = True
    for name, meta in COMPONENTS.items():
        pids = find(name)
        if name == "bot" and not PMBOT_PY.exists():
            state = "未安装（可选）"
        elif meta["optional"] and not pids:
            state = "未启动（可选）"
        elif meta["url"]:
            state = "运行中" if _http_ok(meta["url"]) else ("进程在但接口不通" if pids else "未启动")
        else:
            state = "运行中" if pids else "未启动"
        if not pids and not meta["optional"]:
            all_ok = False
        print("  %-7s %-14s %-18s %s" % (
            name, meta["label"], state,
            ("PID " + ", ".join(map(str, pids))) if pids else ""))
    print("-" * 58)
    print("中台地址  http://127.0.0.1:%d/index.html" % CENTER_PORT)
    print("解释器    %s" % (CENTER_PY or "未解析（--python 可指定）"))
    print("日志目录  %s" % LOG_DIR)
    return 0 if all_ok else 1


def cmd_start(targets: list[str]) -> int:
    rc = 0
    for name in targets:
        meta = COMPONENTS[name]
        running = find(name)
        if running:
            print("[%s] 已在运行（PID %s），跳过" % (name, ", ".join(map(str, running))))
            continue
        if name == "bot" and not PMBOT_PY.exists():
            # pmbot 是可选的辅助系统；没装就只跑中台，不算失败
            print("[bot] 未安装 pmbot（找不到 %s），跳过。中台不受影响。" % PMBOT_PY)
            print("      需要飞书集成时，把 pmbot 放成同级目录或设置 PMBOT_DIR。")
            continue
        if name == "center" and not CENTER_PY:
            print("[center] 找不到可用的 Python 解释器，无法启动服务")
            rc = 1
            continue

        LOG_DIR.mkdir(parents=True, exist_ok=True)
        log_path = LOG_DIR / ("%s.log" % name)
        log = open(log_path, "ab")
        log.write(("\n===== %s start =====\n" % time.strftime("%Y-%m-%d %H:%M:%S")).encode("utf-8"))
        log.flush()

        flags = 0
        if os.name == "nt":
            flags = (subprocess.DETACHED_PROCESS
                     | subprocess.CREATE_NEW_PROCESS_GROUP
                     | subprocess.CREATE_NO_WINDOW)
        try:
            proc = subprocess.Popen(
                meta["cmd"](), cwd=str(meta["cwd"]),
                stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT,
                creationflags=flags, close_fds=True)
        except Exception as exc:
            print("[%s] 启动失败：%s" % (name, exc))
            log.close()
            rc = 1
            continue
        finally:
            pass

        print("[%s] 已启动 PID %d，日志 %s" % (name, proc.pid, log_path))
        data = _load_pids()
        data[name] = proc.pid
        _save_pids(data)

        # 就绪探测
        deadline = time.time() + 25
        ready = False
        while time.time() < deadline:
            if meta["url"] and _http_ok(meta["url"]):
                ready = True
                break
            if not meta["url"] and find(name):
                ready = True
                break
            if proc.poll() is not None:
                print("[%s] 进程已退出（rc=%s），详见日志" % (name, proc.returncode))
                rc = 1
                break
            time.sleep(0.6)
        if ready and proc.poll() is None:
            print("[%s] 就绪" % name)
        elif not ready:
            hint = ""
            if name == "center" and port_busy(CENTER_PORT):
                hint = "（端口 %d 已被别的程序占用）" % CENTER_PORT
            print("[%s] 启动超时：25 秒内未就绪%s，详见 %s" % (name, hint, log_path))
            rc = 1
        log.close()
    return rc


def cmd_stop(targets: list[str], dry: bool = False) -> int:
    rc = 0
    for name in targets:
        # 只认真实匹配到的进程：pid 文件里记的号可能已被系统复用给别的程序，不能盲杀
        pids = find(name)
        if not pids:
            print("[%s] 没在运行" % name)
            continue
        print("[%s] %s %d 个进程" % (name, "将结束" if dry else "结束", len(pids)))
        n = _kill(pids, dry=dry)
        if not dry:
            data = _load_pids()
            data.pop(name, None)
            _save_pids(data)
            if n and find(name):
                print("[%s] 警告：仍有残留进程" % name)
                rc = 1
    return rc


def cmd_doctor() -> int:
    """排查为什么起不来：解释器、端口、进程、日志。"""
    print("环境诊断")
    print("-" * 58)
    print("  当前解释器      %s" % sys.executable)
    print("  当前解释器可用  %s" % ("是" if _usable_python(sys.executable) else "否（Store 别名桩？）"))
    picked = resolve_python()
    print("  探测到的可用解释器  %s" % (picked or "无"))
    print("  center 将使用    %s" % (CENTER_PY or "无"))
    print("  bot 将使用       %s" % (PMBOT_PY if PMBOT_PY.exists() else "缺失"))
    print("-" * 58)
    for port in (CENTER_PORT, WEB_PORT):
        busy = port_busy(port)
        print("  端口 %-6d %s" % (port, "被占用" if busy else "空闲"))
    print("-" * 58)
    for name, meta in COMPONENTS.items():
        pids = find(name)
        print("  %-7s %s" % (name, ("PID " + ", ".join(map(str, pids))) if pids else "未运行"))
    print("-" * 58)
    print("  日志目录         %s" % LOG_DIR)
    for f in sorted(LOG_DIR.glob("*.log")):
        print("    %-12s %d bytes" % (f.name, f.stat().st_size))
    print("=" * 58)
    print("提示：若 PATH 里只有 Microsoft\\WindowsApps\\python.exe，那是 0 字节")
    print("      的 Store 占位桩，执行返回 9009 且无输出——必须装真正的 Python，")
    print("      或让 start-all.bat 从本机已有路径里挑一个（它会自动找）。")
    return 0


def main(argv: list[str]) -> int:
    # 参数解析：--python <path> / --python=<path> 要成对吃掉，不能混进组件名
    explicit_python: str | None = None
    rest: list[str] = []
    i = 0
    while i < len(argv):
        a = argv[i]
        if a == "--python":
            i += 1
            if i < len(argv):
                explicit_python = argv[i]
        elif a.startswith("--python="):
            explicit_python = a.split("=", 1)[1]
        elif a.startswith("--"):
            pass                      # 其它开关忽略
        else:
            rest.append(a)
        i += 1

    global CENTER_PY
    CENTER_PY = resolve_python(explicit_python) or ""

    arg = rest
    dry = "--dry-run" in argv
    action = arg[0] if arg else "status"
    targets = arg[1:] or DEFAULT_TARGETS

    for t in targets:
        if t not in COMPONENTS:
            print("未知组件 %s，可选：%s" % (t, " / ".join(COMPONENTS)))
            return 2

    if action == "status":
        return cmd_status()
    if action == "doctor":
        return cmd_doctor()
    if action == "start":
        return cmd_start(targets)
    if action == "stop":
        return cmd_stop(targets, dry=dry)
    if action == "restart":
        rc = cmd_stop(targets, dry=dry)
        time.sleep(1)
        return rc or cmd_start(targets)
    if action == "all" or action == "up":
        return cmd_start(DEFAULT_TARGETS)
    if action == "down":
        return cmd_stop(DEFAULT_TARGETS, dry=dry)
    print(__doc__)
    return 2


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
