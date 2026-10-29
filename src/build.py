import json
import os

BASE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(BASE)
BUILD = os.path.join(BASE, 'build')
OUT = os.path.join(BASE, 'out')
LOCAL_DIR = os.path.join(ROOT, 'local')
DATA_DIR = os.path.join(ROOT, 'data')

PARTS = ['03_core.js', '04_today.js', '05_board.js', '06_week.js', '09_nodes.js', '07_me.js']


def read(name):
    with open(os.path.join(BUILD, name), encoding='utf-8') as f:
        return f.read()


def shell():
    head = read('01_head.html')
    body = read('02_body.html').replace('href="#i-doc"', 'href="#i-report"')
    return head, body


def app_js():
    return ''.join(read(p) for p in PARTS)


def load_seed():
    """legacy 版要内联一份数据：真实 seed 优先，没有就用演示数据。"""
    for path in (os.path.join(OUT, 'seed.json'),
                 os.path.join(DATA_DIR, 'seed.json'),
                 os.path.join(DATA_DIR, 'seed.demo.json')):
        if os.path.exists(path):
            with open(path, encoding='utf-8') as f:
                return json.load(f), path
    raise SystemExit('找不到种子数据：data/seed.demo.json 缺失')


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
    """主版本：数据真身在本机服务端 SQLite，页面走 /api 读写"""
    head, body = shell()
    return _write(os.path.join(LOCAL_DIR, 'index.html'),
                  _wrap(head, body, [read('08_remotedb.js'), app_js()]))


def build_legacy():
    """旧版：纯 localStorage，与服务端无关（应急备份 / 离线看板用）"""
    head, body = shell()
    seed, src = load_seed()
    print('   legacy 使用种子:', os.path.relpath(src, ROOT))
    seed_js = ('window.__LOCAL_SEED__ = '
               + json.dumps(seed, ensure_ascii=False, separators=(',', ':')) + ';')
    return _write(os.path.join(LOCAL_DIR, 'legacy.html'),
                  _wrap(head, body, [seed_js, read('08_localdb.js'), app_js()]))


if __name__ == '__main__':
    print('local   ->', build_remote())
    print('legacy  ->', build_legacy())
