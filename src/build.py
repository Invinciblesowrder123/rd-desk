import json
import os

BASE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(BASE)
BUILD = os.path.join(BASE, 'build')
LOCAL_DIR = os.path.join(ROOT, 'local')
DATA_DIR = os.path.join(ROOT, 'data')
SEED_DEMO = os.path.join(DATA_DIR, 'seed.demo.json')

PARTS = ['03_core.js', '04_today.js', '05_board.js', '06_week.js', '09_nodes.js', '10_month.js', '07_me.js']


def read(name):
    with open(os.path.join(BUILD, name), encoding='utf-8') as f:
        return f.read()


def shell():
    head = read('01_head.html')
    body = read('02_body.html').replace('href="#i-doc"', 'href="#i-report"')
    return head, body


def app_js():
    return ''.join(read(p) for p in PARTS)


def _wrap(head, body, scripts):
    return (head + body
            + ''.join("\n<script>\n" + s + "\n</script>" for s in scripts)
            + "\n</body>\n</html>\n")


def _write(path, html):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', encoding='utf-8') as f:
        f.write(html)
    return path


def build_remote():
    """本地 L2：数据真身在本机服务端 SQLite，页面走 /api 读写。

    页面本身不含任何数据，换机只需换 bridge/desk.db。
    """
    head, body = shell()
    return _write(os.path.join(LOCAL_DIR, 'index.html'),
                  _wrap(head, body, [read('08_remotedb.js'), app_js()]))


def build_legacy():
    """本地旧版：纯 localStorage，与服务端无关（应急备份 / 离线看板用）。

    数据内联进 HTML，所以**只允许用演示数据**：seed.demo.json 是脱敏后的
    样例，真实 seed.json 永远不会进包（见 .gitignore 与 tools/pack 流程）。
    """
    head, body = shell()
    if not os.path.exists(SEED_DEMO):
        raise SystemExit('缺少 data/seed.demo.json，无法构建 legacy.html')
    with open(SEED_DEMO, encoding='utf-8') as f:
        seed = json.load(f)
    seed_js = ('window.__LOCAL_SEED__ = '
               + json.dumps(seed, ensure_ascii=False, separators=(',', ':')) + ';')
    return _write(os.path.join(LOCAL_DIR, 'legacy.html'),
                  _wrap(head, body, [seed_js, read('08_localdb.js'), app_js()]))


if __name__ == '__main__':
    print('index   ->', build_remote())
    print('legacy  ->', build_legacy())
