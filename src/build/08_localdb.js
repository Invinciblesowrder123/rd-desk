/* ============================================================
   本地存储适配层（离线版专用）
   模拟资料库数据库 SDK 的接口形状，业务代码零改动
   ============================================================ */
(function () {
  /* 数据版本：换数据（或换了 seed.json）就改这里，旧 localStorage 自动弃用重播 */
  var SEED_VERSION = '2026-10-29.3';
  var STORE_KEY = 'rd_local_store';

  var T_PROJECT = 'XurtLd3EYpe29VppV0z0TJ';
  var T_LOG = 'bI9MkKD1Zvp1UwmmY6UvfX';
  var T_WEEK = 'nG1nopjeQW93K0wclTs4jR';
  var T_NODE = '1urnMOWB0VL3RL0pNiNILG';

  var SEED = window.__LOCAL_SEED__ || { projects: [], nodes: [], logs: [], reviews: [] };

  var SCHEMAS = {};
  SCHEMAS[T_PROJECT] = {
    id: T_PROJECT,
    title: '研发项目',
    properties: [
      { id: 'f1', name: '项目名', type: 'text' },
      { id: 'f2', name: '阶段', type: 'select', config: { options: [
        { id: 'o1', text: '概念' }, { id: 'o2', text: '设计' }, { id: 'o3', text: '手板' },
        { id: 'o4', text: '试产' }, { id: 'o5', text: '量产' }
      ] } },
      { id: 'f3', name: '单位', type: 'text' },
      { id: 'f4', name: '总量', type: 'number' },
      { id: 'f5', name: '截止日', type: 'date' },
      { id: 'f6', name: '配色', type: 'text' },
      { id: 'f7', name: '阻塞项', type: 'text' },
      { id: 'f8', name: '预案', type: 'text' }
    ]
  };
  SCHEMAS[T_LOG] = {
    id: T_LOG,
    title: '每日报工',
    properties: [
      { id: 'g1', name: '项目ID', type: 'text' },
      { id: 'g2', name: '项目名称', type: 'text' },
      { id: 'g3', name: '日期', type: 'date' },
      { id: 'g4', name: '完成量', type: 'number' },
      { id: 'g5', name: '工时分钟', type: 'number' },
      { id: 'g6', name: '补记', type: 'checkbox' },
      { id: 'g7', name: '备注', type: 'text' }
    ]
  };
  SCHEMAS[T_NODE] = {
    id: T_NODE,
    title: '项目节点',
    properties: [
      { id: 'h1', name: '项目ID', type: 'text' },
      { id: 'h2', name: '节点名', type: 'text' },
      { id: 'h3', name: '序号', type: 'number' },
      { id: 'h4', name: '预计工时', type: 'number' },
      { id: 'h5', name: '计划完成日', type: 'date' },
      { id: 'h6', name: '已完成', type: 'checkbox' },
      { id: 'h7', name: '完成日', type: 'date' },
      { id: 'h8', name: '备注', type: 'text' }
    ]
  };
  SCHEMAS[T_WEEK] = {
    id: T_WEEK,
    title: '每周复盘',
    properties: [
      { id: 'w1', name: '周标识', type: 'text' },
      { id: 'w2', name: '保持', type: 'text' },
      { id: 'w3', name: '问题', type: 'text' },
      { id: 'w4', name: '尝试', type: 'text' },
      { id: 'w5', name: '下周预案', type: 'text' }
    ]
  };

  function uid(prefix) {
    return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function emptyStore() {
    var s = {};
    s.__v = SEED_VERSION;
    s[T_PROJECT] = [];
    s[T_LOG] = [];
    s[T_WEEK] = [];
    s[T_NODE] = [];
    return s;
  }

  function seedStore() {
    var s = emptyStore();
    (function (rows, key) {
      for (var i = 0; i < rows.length; i++) {
        var r = rows[i];
        if (!r || !r._id) continue;
        s[key].push(r);
      }
    })(SEED.projects || [], T_PROJECT);
    (function (rows, key) {
      for (var i = 0; i < rows.length; i++) {
        var r = rows[i];
        if (!r || !r._id) continue;
        s[key].push(r);
      }
    })(SEED.logs || [], T_LOG);
    (function (rows, key) {
      for (var i = 0; i < rows.length; i++) {
        var r = rows[i];
        if (!r || !r._id) continue;
        s[key].push(r);
      }
    })(SEED.reviews || [], T_WEEK);
    (function (rows, key) {
      for (var i = 0; i < rows.length; i++) {
        var r = rows[i];
        if (!r || !r._id) continue;
        s[key].push(r);
      }
    })(SEED.nodes || [], T_NODE);
    return s;
  }

  function load() {
    var raw = null;
    try { raw = localStorage.getItem(STORE_KEY); } catch (e) { raw = null; }
    if (raw) {
      try {
        var parsed = JSON.parse(raw);
        /* 数据版本不符 → 视为旧数据，丢弃重播（避免看到过期内容） */
        if (parsed && parsed.__v === SEED_VERSION &&
            parsed[T_PROJECT] && parsed[T_LOG] && parsed[T_WEEK]) {
          if (!parsed[T_NODE]) { parsed[T_NODE] = []; save(parsed); }   /* 老数据补节点表 */
          return parsed;
        }
      } catch (e) { /* 损坏则重建 */ }
    }
    var fresh = seedStore();
    save(fresh);
    return fresh;
  }

  function save(store) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch (e) { /* 配额满 / 隐私模式 */ }
  }

  /* PropertyValue oneof → 纯值 */
  function unwrap(prop) {
    if (prop === null || prop === undefined) return null;
    if (typeof prop !== 'object') return prop;
    var keys = ['text', 'number', 'date', 'checkbox', 'select', 'multi_select', 'url', 'image', 'attachment'];
    for (var i = 0; i < keys.length; i++) {
      if (Object.prototype.hasOwnProperty.call(prop, keys[i])) return prop[keys[i]];
    }
    return null;
  }

  var listeners = [];

  function notify(databaseId) {
    setTimeout(function () {
      for (var i = 0; i < listeners.length; i++) {
        try { listeners[i]({ databaseIds: [databaseId] }); } catch (e) { /* 忽略 */ }
      }
    }, 0);
  }

  var api = {
    query: function (params) {
      var id = params.databaseId;
      var store = load();
      var rows = store[id] || [];
      var start = 0;
      if (params.startCursor) {
        for (var i = 0; i < rows.length; i++) {
          if (rows[i]._id === params.startCursor) { start = i + 1; break; }
        }
      }
      var size = Math.min(params.pageSize || 50, 200);
      var slice = rows.slice(start, start + size);
      var hasMore = (start + size) < rows.length;
      return Promise.resolve({
        results: slice.slice(),
        nextCursor: hasMore && slice.length ? slice[slice.length - 1]._id : '',
        hasMore: hasMore
      });
    },

    addRecord: function (params) {
      var id = params.databaseId;
      var store = load();
      if (!store[id]) store[id] = [];
      var row = { _id: uid('r') };
      var props = params.properties || {};
      Object.keys(props).forEach(function (k) { row[k] = unwrap(props[k]); });
      store[id].push(row);
      save(store);
      notify(id);
      return Promise.resolve({ id: row._id });
    },

    updateRecord: function (params) {
      var id = params.databaseId;
      var store = load();
      var rows = store[id] || [];
      var hit = null;
      for (var i = 0; i < rows.length; i++) {
        if (rows[i]._id === params.recordId) { hit = rows[i]; break; }
      }
      if (!hit) return Promise.reject(new Error('RECORD_NOT_FOUND'));
      var props = params.properties || {};
      Object.keys(props).forEach(function (k) { hit[k] = unwrap(props[k]); });
      save(store);
      notify(id);
      return Promise.resolve({ id: params.recordId });
    },

    deleteRecord: function (params) {
      var id = params.databaseId;
      var store = load();
      var rows = store[id] || [];
      var kept = [];
      for (var i = 0; i < rows.length; i++) {
        if (rows[i]._id !== params.recordId) kept.push(rows[i]);
      }
      store[id] = kept;
      save(store);
      notify(id);
      return Promise.resolve({});
    },

    getSchema: function (params) {
      return Promise.resolve(SCHEMAS[params.databaseId] || { properties: [] });
    },

    onUpdated: function (handler) {
      if (typeof handler === 'function') listeners.push(handler);
    }
  };

  /* 跨标签页：另一个窗口改了数据，本页跟着刷新 */
  window.addEventListener('storage', function (e) {
    if (e.key === STORE_KEY) notify(T_LOG);
  });

  window.__LOCAL_MODE__ = true;
  window.__SMART_PAGE__ = { database: api };
})();
