/* ============================================================
   L2 远程存储适配层
   数据真身在本机服务端 SQLite（bridge/desk.db），页面只负责读写
   接口形状与资料库 SDK 完全一致，业务代码零改动
   ============================================================ */
(function () {
  var API = '/api';

  var T_PROJECT = 'XurtLd3EYpe29VppV0z0TJ';
  var T_LOG = 'bI9MkKD1Zvp1UwmmY6UvfX';
  var T_WEEK = 'nG1nopjeQW93K0wclTs4jR';
  var T_NODE = '1urnMOWB0VL3RL0pNiNILG';
  var ALL = [T_PROJECT, T_LOG, T_WEEK, T_NODE];

  function req(url, opt) {
    return fetch(url, opt).then(function (r) {
      return r.json()['catch'](function () { return {}; }).then(function (body) {
        if (!r.ok) throw new Error((body && body.error) || ('HTTP ' + r.status));
        return body;
      });
    });
  }

  function post(url, payload) {
    return req(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {})
    });
  }

  /* ---------------- 列表器：轮询版本号 ---------------- */
  var listeners = [];
  var seenRev = null;
  var seenBuild = null;
  var staleNoticed = false;
  var pollTimer = null;

  function fire() {
    for (var i = 0; i < listeners.length; i++) {
      try { listeners[i]({ databaseIds: ALL }); } catch (e) { /* 忽略 */ }
    }
  }

  /* 页面跑的是打开那一刻的构建：前端改了不刷新，就会一直用旧逻辑
     （踩过的坑：完成节点报错、错误提示关不掉，其实都是旧版代码的表现）。
     服务端在 /api/rev 里带上 index.html 的构建戳，变了就提醒刷新一次。 */
  function checkBuild(build) {
    if (typeof build !== 'number' || !build) return;
    if (seenBuild === null) { seenBuild = build; return; }
    if (build === seenBuild || staleNoticed) return;
    staleNoticed = true;
    if (window.__toast) {
      window.__toast('页面有新版本，刷新后生效', 'err',
        function () { window.location.reload(); }, '刷新');
    }
  }

  function poll() {
    if (document.visibilityState === 'hidden') return;
    req(API + '/rev').then(function (d) {
      checkBuild(d.build);
      if (seenRev === null) { seenRev = d.rev; return; }
      if (d.rev !== seenRev) { seenRev = d.rev; fire(); }
    })['catch'](function () { /* 服务没起：静默，等下次轮询 */ });
  }

  function startPoll() {
    if (pollTimer) return;
    pollTimer = setInterval(poll, 3000);
    poll();
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') poll();
    });
  }

  /* ---------------- 记录自身写入引起的版本变化，不要重复刷新 ---------------- */
  function noteRev(d) {
    if (d && typeof d.rev === 'number') seenRev = d.rev;
  }

  var api = {
    query: function (params) {
      var dbId = params.databaseId;
      var size = Math.min(params.pageSize || 50, 200);
      var url = API + '/db/' + encodeURIComponent(dbId) + '/records?size=' + size;
      if (params.startCursor) url += '&cursor=' + encodeURIComponent(params.startCursor);
      return req(url).then(function (d) {
        if (typeof d.rev === 'number' && seenRev === null) seenRev = d.rev;
        return {
          results: d.results || [],
          nextCursor: d.nextCursor || '',
          hasMore: !!d.hasMore
        };
      });
    },

    addRecord: function (params) {
      return post(API + '/db/' + encodeURIComponent(params.databaseId) + '/records',
        { properties: params.properties || {} }).then(function (d) {
        noteRev(d);
        return { id: d.id };
      });
    },

    updateRecord: function (params) {
      return post(API + '/db/' + encodeURIComponent(params.databaseId) + '/records/' +
        encodeURIComponent(params.recordId) + '/update',
        { properties: params.properties || {} }).then(function (d) {
        noteRev(d);
        return { id: d.id };
      });
    },

    deleteRecord: function (params) {
      return post(API + '/db/' + encodeURIComponent(params.databaseId) + '/records/' +
        encodeURIComponent(params.recordId) + '/delete', {}).then(function (d) {
        noteRev(d);
        return {};
      });
    },

    /* 原子批量写：复合动作（完成节点 = 置完成 + 记报工）必须同生共死，
       否则会留下"节点已完成但没报工"的半成功状态。 */
    batch: function (ops) {
      return post(API + '/batch', { ops: ops || [] }).then(function (d) {
        noteRev(d);
        return d;
      });
    },

    getSchema: function (params) {
      return req(API + '/db/' + encodeURIComponent(params.databaseId) + '/schema');
    },

    onUpdated: function (handler) {
      if (typeof handler === 'function') {
        listeners.push(handler);
        startPoll();
      }
    }
  };

  /* 页面用它判断"是否本地版"（决定文案与是否隐藏云端入口） */
  window.__LOCAL_MODE__ = true;
  window.__REMOTE_STORE__ = true;
  window.__SMART_PAGE__ = { database: api };
})();
