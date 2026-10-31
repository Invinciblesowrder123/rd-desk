/* ============================================================
   家电研发推进中台 · 数据层与算法层
   数据真实存放于资料库三张数据表，页面读写直连云端
   ============================================================ */
(function () {
  'use strict';

  /* 三张资料库数据表（databaseId 硬编码在调用处，页面直连云端读写） */
  var TBL_PROJECT = 'XurtLd3EYpe29VppV0z0TJ';   /* 研发项目 */
  var TBL_LOG     = 'bI9MkKD1Zvp1UwmmY6UvfX';   /* 每日报工 */
  var TBL_WEEK    = 'nG1nopjeQW93K0wclTs4jR';   /* 每周复盘 */
  var TBL_NODE    = '1urnMOWB0VL3RL0pNiNILG';   /* 项目节点 */

  /* 预置示例项目的记录 ID，用于「清空示例」精准清理 */
  var DEMO_IDS = ['gXVt0tOsp16XWMgDaXn7BH', 'IX28dXqLMk7sSnEBWmIREt', 'nv1CEqdw7Avhxl85JjDrJi'];

  var STAGES = ['概念', '设计', '手板', '试产', '量产'];
  var PALETTE = ['#6366f1', '#14b8a6', '#8b5cf6', '#f59e0b', '#0ea5e9', '#ec4899', '#10b981', '#f97316'];

  /* 本地模式：由离线版注入 window.__LOCAL_MODE__，文案与状态随之切换 */
  var LOCAL = false;
  try { LOCAL = !!(window && window.__LOCAL_MODE__); } catch (e) { LOCAL = false; }

  var TODAY = '';
  var S = {
    loaded: false,
    loading: false,
    projects: [],
    logs: [],
    reviews: [],
    nodes: [],
    metrics: {},
    tab: 'today',
    weekOffset: 0,
    lastSync: null,
    syncState: 'ok',
    editingId: null,
    reportPid: null,
    /* 今日页项目快速筛选（阶段 / 状态 / 关键词），刷新数据不清空 */
    projFilter: { stage: '', status: '', q: '' },
    confetti: {},
    selColor: PALETTE[0],
    kptWeek: '',
    kptDirty: false
  };

  /* ---------------- 基础工具 ---------------- */
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function escapeHtml(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function icon(name, cls) {
    return '<svg class="ico ' + (cls || '') + '"><use href="#i-' + name + '"/></svg>';
  }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  function ymd(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }

  function parseYMD(s) {
    var p = String(s || '').split('-');
    return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]), 12, 0, 0);
  }

  function addDays(s, n) {
    var d = parseYMD(s);
    d.setDate(d.getDate() + n);
    return ymd(d);
  }

  /* b - a，单位天 */
  function dayDiff(a, b) {
    if (!a || !b) return 0;
    return Math.round((parseYMD(b) - parseYMD(a)) / 86400000);
  }

  /* 周一为一周起点 */
  function weekStartStr(s) {
    var d = parseYMD(s);
    var w = d.getDay();           /* 0=周日 */
    var back = (w === 0 ? 6 : w - 1);
    d.setDate(d.getDate() - back);
    return ymd(d);
  }

  var WEEK_CN = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

  function fmtMD(s) {
    if (!s) return '—';
    var p = String(s).split('-');
    return Number(p[1]) + '月' + Number(p[2]) + '日';
  }

  function fmtMDW(s) {
    if (!s) return '—';
    return fmtMD(s) + ' ' + WEEK_CN[parseYMD(s).getDay()];
  }

  function normDate(v) {
    if (!v) return '';
    var m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? m[1] + '-' + m[2] + '-' + m[3] : '';
  }

  function num(v, dft) {
    var n = Number(v);
    return isFinite(n) ? n : (dft || 0);
  }

  function fmtNum(n) {
    if (n == null || !isFinite(n)) return '—';
    var r = Math.round(n * 10) / 10;
    return String(r).replace(/\.0$/, '');
  }

  /* 研发节拍：最小时间单元 0.5 天（一天按 8 小时计），存储仍以分钟为准 */
  var MIN_PER_DAY = 480;
  var HALF_DAY = 240;

  function minToDays(min) { return min / MIN_PER_DAY; }

  /* 分钟 → 「x 天」，按 0.5 天对齐，不足半天按半天计 */
  function fmtDays(min) {
    if (!min) return '0 天';
    var half = Math.round(minToDays(min) * 2) / 2;
    if (half < 0.5) half = 0.5;
    return String(half).replace(/\.0$/, '') + ' 天';
  }

  /* 半天数 → 分钟，强制 0.5 步进 */
  function daysToMin(days) {
    var half = Math.round(Number(days) * 2) / 2;
    if (!(half > 0)) return 0;
    return half * MIN_PER_DAY;
  }

  function pct(rate) { return Math.round(rate * 100); }

  /* ---------------- SDK 访问 ---------------- */
  function sdk() {
    try {
      return (window.__SMART_PAGE__ && window.__SMART_PAGE__.database) || null;
    } catch (e) { return null; }
  }

  function hasSdk() { return !!sdk(); }

  /* 逐页拉全量：cursor 名必须是 startCursor，三重保护防死循环 */
  function pullPage(kind, startCursor) {
    var db = sdk();
    if (!db) return Promise.reject(new Error('NO_SDK'));
    if (kind === 'project') {
      return db.query({ databaseId: 'XurtLd3EYpe29VppV0z0TJ', pageSize: 200, startCursor: startCursor });
    }
    if (kind === 'log') {
      return db.query({ databaseId: 'bI9MkKD1Zvp1UwmmY6UvfX', pageSize: 200, startCursor: startCursor });
    }
    if (kind === 'node') {
      return db.query({ databaseId: '1urnMOWB0VL3RL0pNiNILG', pageSize: 200, startCursor: startCursor });
    }
    return db.query({ databaseId: 'nG1nopjeQW93K0wclTs4jR', pageSize: 200, startCursor: startCursor });
  }

  function pullAll(kind) {
    function page(startCursor, acc, guard) {
      acc = acc || [];
      guard = guard || 0;
      if (guard > 100) return Promise.resolve(acc);
      return pullPage(kind, startCursor).then(function (r) {
        var rows = (r && r.results) || [];
        acc = acc.concat(rows);
        var next = r && r.nextCursor;
        if (r && r.hasMore && next && next !== startCursor && rows.length) {
          return page(next, acc, guard + 1);
        }
        return acc;
      });
    }
    return page(undefined, [], 0);
  }

  function normalizeProject(row) {
    return {
      id: row._id || row.record_id || '',
      name: row['项目名'] || '未命名项目',
      stage: row['阶段'] || '设计',
      unit: row['单位'] || '项',
      total: num(row['总量'], 0),
      due: normDate(row['截止日']),
      color: row['配色'] || PALETTE[0],
      block: row['阻塞项'] || '',
      plan: row['预案'] || ''
    };
  }

  function normalizeLog(row) {
    return {
      id: row._id || row.record_id || '',
      pid: row['项目ID'] || '',
      pname: row['项目名称'] || '',
      date: normDate(row['日期']),
      qty: num(row['完成量'], 0),
      min: row['工时分钟'] == null ? null : num(row['工时分钟'], 0),
      backfill: !!row['补记'],
      note: row['备注'] || ''
    };
  }

  function normalizeNode(row) {
    return {
      id: row._id || row.record_id || '',
      pid: row['项目ID'] || '',
      name: row['节点名'] || '未命名节点',
      seq: num(row['序号'], 0),
      hours: num(row['预计工时'], 0),
      owner: row['负责人'] || '',
      planDate: normDate(row['计划完成日']),
      done: !!row['已完成'],
      doneDate: normDate(row['完成日']),
      note: row['备注'] || ''
    };
  }

  function normalizeReview(row) {
    return {
      id: row._id || row.record_id || '',
      week: row['周标识'] || '',
      keep: row['保持'] || '',
      problem: row['问题'] || '',
      tryit: row['尝试'] || '',
      next: row['下周预案'] || ''
    };
  }

  /* ---------------- 表单草稿（防刷新 / 登录跳转丢失输入） ---------------- */
  var LS_PROJ = 'wb_rd_proj_draft';
  var LS_REP = 'wb_rd_rep_draft';
  var DRAFT_TTL = 24 * 60 * 60 * 1000;

  function draftSave(key, data) {
    try { localStorage.setItem(key, JSON.stringify(data)); } catch (e) { /* 隐私模式下降级 */ }
  }

  function draftRead(key) {
    try {
      var raw = localStorage.getItem(key);
      if (!raw) return null;
      var o = JSON.parse(raw);
      if (!o || !o.ts || (Date.now() - o.ts) > DRAFT_TTL) {
        localStorage.removeItem(key);
        return null;
      }
      return o;
    } catch (e) { return null; }
  }

  function draftClear(key) {
    try { localStorage.removeItem(key); } catch (e) { /* 忽略 */ }
  }

  /* ---------------- 同步状态 ---------------- */

  /* 本地版没有"云端"，文案要跟着变，否则用户看到"没写入云端"会以为要去连网。
     用法：dst(cloudText, localText) */
  function dst(cloudText, localText) {
    return LOCAL ? localText : cloudText;
  }

  function setSync(state, msg) {
    S.syncState = state;
    if (state === 'ok') S.lastSync = new Date();

    var pillTxt = $('#syncPillTxt'), topTxt = $('#syncTopTxt');
    var pillDot = $('#syncPill .dot'), meDot = $('#meDot');
    var label;
    if (LOCAL) {
      label = state === 'busy'
        ? '保存中…'
        : (window.__REMOTE_STORE__ ? '本机数据库' : '本地存储');
    } else {
      label = state === 'busy' ? '同步中…' : (state === 'off' ? '未连接云端' : '已同步');
    }

    if (pillTxt) pillTxt.textContent = label;
    if (topTxt) topTxt.textContent = label;
    var cls = state === 'busy' ? 'dot busy' : (state === 'off' ? 'dot off' : 'dot');
    if (pillDot) pillDot.className = cls;
    if (meDot) meDot.className = cls;

    var meState = $('#meSyncState'), meTime = $('#meSyncTime');
    if (meState) meState.textContent = label;
    if (meTime) {
      var t = S.lastSync;
      var prefix = LOCAL ? '最近写入：' : '最近一次同步：';
      meTime.textContent = t
        ? prefix + pad2(t.getHours()) + ':' + pad2(t.getMinutes()) + ':' + pad2(t.getSeconds())
        : prefix + '—';
    }

    var bar = $('#offlineBar');
    if (bar) {
      if (state === 'off') {
        bar.classList.add('on');
        if (msg && $('#offlineTxt')) $('#offlineTxt').textContent = msg;
      } else {
        bar.classList.remove('on');
      }
    }

    var resyncBtn = $('#btnResync');
    if (resyncBtn) resyncBtn.disabled = (state === 'busy');
  }

  /* ---------------- 提示 ---------------- */
  /* 每条 toast 都自带关闭按钮，并且都会自动消失：
     错误类停留久一点（12s，给用户看清并按"重试"），普通 3.4s。
     鼠标悬停时暂停倒计时，方便用户去点重试按钮。 */
  var TOAST_TTL = { ok: 3400, info: 3400, err: 12000 };

  function toast(msg, kind, retry, retryText) {
    var wrap = $('#toastWrap');
    if (!wrap) return;
    var t = document.createElement('div');
    t.className = 'toast ' + (kind || '');
    var icoName = kind === 'ok' ? 'check' : (kind === 'err' ? 'alert' : 'info');
    t.innerHTML = icon(icoName, 'ico-sm') + '<span class="t-msg">' + escapeHtml(msg) + '</span>';

    var timer = null;
    var left = TOAST_TTL[kind || 'info'] || 3400;

    function dismiss() {
      if (timer) { clearTimeout(timer); timer = null; }
      if (t.parentNode) t.parentNode.removeChild(t);
    }

    function start() {
      if (timer) clearTimeout(timer);
      timer = setTimeout(dismiss, left);
    }

    function pause() {
      if (timer) { clearTimeout(timer); timer = null; }
    }

    if (typeof retry === 'function') {
      var b = document.createElement('button');
      b.className = 't-retry';
      b.textContent = retryText || '重试';
      b.onclick = function () {
        dismiss();
        retry();
      };
      t.appendChild(b);
    }

    /* 关闭按钮：任何一条 toast 都能手动关掉 */
    var x = document.createElement('button');
    x.className = 't-close';
    x.setAttribute('aria-label', '关闭提示');
    x.innerHTML = icon('close', 'ico-sm');
    x.onclick = function () { dismiss(); };
    t.appendChild(x);

    t.addEventListener('mouseenter', pause);
    t.addEventListener('mouseleave', start);

    wrap.appendChild(t);
    start();
    return { dismiss: dismiss };
  }

  /* 适配层（08_remotedb.js）在独立作用域里，靠这个拿到提示能力：
     例如"页面有新版本，请刷新"这类由轮询触发的提示 */
  window.__toast = toast;

  /* ---------------- 弹窗 ---------------- */
  function openMask(id) {
    var m = document.getElementById(id);
    if (m) m.classList.add('on');
  }

  function closeMask(id) {
    var m = document.getElementById(id);
    if (m) m.classList.remove('on');
  }

  var confirmCb = null;

  function askConfirm(title, bodyHtml, okText, cb) {
    var t = $('#cfTitle'), b = $('#cfBody'), ok = $('#cfOk');
    if (t) t.textContent = title;
    if (b) b.innerHTML = bodyHtml;
    if (ok) ok.textContent = okText || '确认删除';
    confirmCb = cb;
    openMask('maskConfirm');
  }

  /* ---------------- 指标计算 ---------------- */
  function buildIndex() {
    var byPid = {};
    S.logs.forEach(function (l) {
      if (!l.pid) return;
      if (!byPid[l.pid]) byPid[l.pid] = {};
      var cur = byPid[l.pid][l.date];
      if (!cur) cur = byPid[l.pid][l.date] = { qty: 0, min: 0, n: 0 };
      cur.qty += l.qty || 0;
      cur.min += (l.min || 0);
      cur.n += 1;
    });
    return byPid;
  }

  function computeMetrics(p, byDate, nodeList) {
    var nodes = nodeList || [];
    var nodeTotal = nodes.length;
    var nodeDone = 0, nodes7 = 0, todayNodes = 0;

    nodes.forEach(function (n) {
      if (!n.done) return;
      nodeDone++;
      if (n.doneDate === TODAY) todayNodes++;
      if (n.doneDate) {
        var back = dayDiff(n.doneDate, TODAY);
        if (back >= 0 && back <= 6) nodes7++;
      }
    });

    var remainNodes = Math.max(0, nodeTotal - nodeDone);
    var rate = nodeTotal > 0 ? nodeDone / nodeTotal : 0;
    var dLeft = p.due ? dayDiff(TODAY, p.due) : 0;

    /* 到期未完成节点：计划完成日已经到了（或更早）却还没关掉的节点。
       研发项目不是每天都有阶段性进展——缺报提醒只对"确实有事欠着"的
       项目出；节点全排在未来的项目不该被催（2026-10-30 用户提出）。
       注意 dayDiff(a, b) 的语义是 b - a，所以"planDate ≤ 今天"要写 >= 0。 */
    var dueNodes = 0;
    nodes.forEach(function (n) {
      if (n.done) return;
      if (n.planDate && dayDiff(n.planDate, TODAY) >= 0) dueNodes++;
    });

    /* 投入工时仍来自报工记录（工时是投入，与节点进度分开看） */
    var dates = Object.keys(byDate || {});
    var minSum = 0;
    dates.forEach(function (d) { minSum += byDate[d].min; });
    var todayMin = (byDate && byDate[TODAY]) ? byDate[TODAY].min : 0;

    /* 连续报工天数：每周（周一起）允许 1 个缓冲日，第一次缺报不中断 */
    var earliest = dates.length ? dates.slice().sort()[0] : '';
    var streak = 0, cursor = TODAY, misses = {}, guard = 0;
    while (guard++ < 400) {
      if (earliest && cursor < earliest) break;
      if (byDate && byDate[cursor]) {
        streak++;
      } else if (cursor !== TODAY) {
        var wk = weekStartStr(cursor);
        if (misses[wk]) break;
        misses[wk] = 1;   /* 缓冲日：消耗掉，不中断 */
      }
      cursor = addDays(cursor, -1);
    }

    /* 预计完成日：按近 7 天完成的节点数推算，没完成过节点就不猜 */
    var eta = '', etaGap = null, etaNote = '';
    if (nodeTotal > 0 && remainNodes === 0) {
      eta = 'done';
    } else if (nodeTotal > 0 && nodes7 > 0) {
      var need = Math.ceil(remainNodes / (nodes7 / 7));
      eta = addDays(TODAY, need);
      etaGap = p.due ? dayDiff(eta, p.due) : null;   /* 正数=提前，负数=拖后 */
      etaNote = '近 7 天完成 ' + nodes7 + ' 个节点';
    }

    /* 昨日状态 */
    var Y = addDays(TODAY, -1);
    var yStatus = 'ok';
    if (!(byDate && byDate[Y])) {
      if (earliest && earliest > Y) {
        yStatus = 'ok';
      } else {
        var ws = weekStartStr(Y), broken = false, k = ws;
        while (k < Y) {
          if (!(byDate && byDate[k])) { broken = true; break; }
          k = addDays(k, 1);
        }
        yStatus = broken ? 'broken' : 'buffer';
      }
    }

    return {
      nodeTotal: nodeTotal,
      nodeDone: nodeDone,
      remainNodes: remainNodes,
      rate: rate,
      dLeft: dLeft,
      streak: streak,
      nodes7: nodes7,
      eta: eta,
      etaGap: etaGap,
      etaNote: etaNote,
      todayNodes: todayNodes,
      todayMin: todayMin,
      dueNodes: dueNodes,
      overdue: (dLeft < 0 && remainNodes > 0) ? -dLeft : 0,
      logDays: dates.length,
      minSum: minSum,
      yStatus: yStatus
    };
  }

  function computeAll() {
    var byPid = buildIndex();
    S.metrics = {};
    S.projects.forEach(function (p) {
      S.metrics[p.id] = computeMetrics(p, byPid[p.id] || {}, nodesOf(p.id));
    });
    return byPid;
  }

  /* 每个项目只出一条待处理，优先级：逾期 > 连续缺报 > 缓冲日。
     缺报两类只对"当天或更早还有没报工的节点"的项目出（dueNodes > 0）：
     研发不是每天都有进展，节点全排在未来的项目别去催它。 */
  function attentionList() {
    var out = [];
    S.projects.forEach(function (p) {
      var m = S.metrics[p.id];
      if (!m) return;
      var kind = null;
      if (m.overdue > 0) kind = 'overdue';
      else if (m.dueNodes > 0 && m.yStatus === 'broken') kind = 'broken';
      else if (m.dueNodes > 0 && m.yStatus === 'buffer') kind = 'buffer';
      if (!kind) return;
      out.push({ kind: kind, p: p, m: m, w: kind === 'overdue' ? 1 : (kind === 'broken' ? 2 : 3) });
    });
    out.sort(function (a, b) { return a.w - b.w; });
    return out;
  }

  /* 项目排序：昨日缺报与逾期置顶 */
  function sortedProjects() {
    return S.projects.slice().sort(function (a, b) {
      var ma = S.metrics[a.id] || {}, mb = S.metrics[b.id] || {};
      var wa = ma.overdue > 0 ? 0 : (ma.yStatus === 'broken' ? 1 : (ma.yStatus === 'buffer' ? 2 : 3));
      var wb = mb.overdue > 0 ? 0 : (mb.yStatus === 'broken' ? 1 : (mb.yStatus === 'buffer' ? 2 : 3));
      if (wa !== wb) return wa - wb;
      if ((ma.remainNodes || 0) !== (mb.remainNodes || 0)) return (mb.remainNodes || 0) - (ma.remainNodes || 0);
      return String(a.name).localeCompare(String(b.name), 'zh');
    });
  }

  /* ---------------- 周区间 ---------------- */
  function weekRange(offset) {
    var start = addDays(weekStartStr(TODAY), offset * 7);
    return { start: start, end: addDays(start, 6) };
  }

  function weekStats(range) {
    var rows = {};
    S.projects.forEach(function (p) {
      rows[p.id] = { pid: p.id, name: p.name, color: p.color, nodes: 0, min: 0, days: {}, cnt: 0 };
    });
    /* 完成的节点按「完成日」计入所在周 */
    S.nodes.forEach(function (n) {
      if (!n.done || !n.doneDate) return;
      if (n.doneDate < range.start || n.doneDate > range.end) return;
      var r = rows[n.pid];
      if (r) r.nodes++;
    });
    S.logs.forEach(function (l) {
      if (l.date < range.start || l.date > range.end) return;
      var r = rows[l.pid];
      if (!r) return;
      r.min += (l.min || 0);
      r.days[l.date] = 1;
    });
    Object.keys(rows).forEach(function (k) {
      rows[k].cnt = Object.keys(rows[k].days).length;
    });
    return rows;
  }
