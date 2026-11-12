
  /* ============================================================
     我的 · 渲染
     ============================================================ */
  function renderMe() {
    if (LOCAL) {
      var dsc = $('#meStoreDesc');
      if (dsc) {
        dsc.textContent = window.__REMOTE_STORE__
          ? '数据保存在本机服务端数据库（bridge/desk.db）。浏览器清缓存不影响；备份请停服务后复制数据库文件，页面不提供一键恢复。'
          : '项目数据保存在这台电脑的浏览器里（localStorage），清浏览器数据会一并丢失，建议定期导出备份';
      }
    }
    var c = $('#meCounts');
    if (!c) return;
    if (!S.loaded) { c.textContent = '正在读取…'; return; }
    c.textContent = S.projects.length + ' 个项目 · ' + S.nodes.length + ' 个节点 · ' + S.logs.length + ' 条报工记录 · ' + S.reviews.length + ' 份周复盘';
  }

  /* ============================================================
     备份：导出 / 恢复
     ============================================================ */
  /* 下载 JSON：L2 走服务端整行导出，legacy 走内存快照，共用这一段 */
  function downloadJson(obj, filename) {
    var blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      URL.revokeObjectURL(url);
      if (a.parentNode) a.parentNode.removeChild(a);
    }, 1200);
  }

  function exportJson() {
    if (window.__REMOTE_STORE__) {
      /* /api/export 返回 records.data 整行 JSON，含项目编码、客户、负责人、
         延期理由等全字段；比内存里 normalize 之后的对象完整得多。
         服务端没设 Content-Disposition，必须 fetch 后自己组装 Blob 才会下载。 */
      fetch('/api/export').then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      }).then(function (d) {
        /* 打上格式标记：这是原始整行留档，legacy 的 readBackupFile 会据此拒绝，
           避免有人拿它当旧版备份导入、清空 localStorage 后写入空记录。 */
        var payload = Object.assign({}, d, { _format: 'rd-desk-l2-raw', _readonly: true });
        downloadJson(payload, '研发推进中台-全量备份-' + TODAY + '.json');
        toast('已导出全量备份（原始记录，仅留档，不能用于页面导入）', 'ok');
      })['catch'](function (err) {
        toast('导出失败：' + (err && err.message ? err.message : '未知错误'), 'err');
        if (window.console) console.error('[export] failed', err);
      });
      return;
    }
    var payload = {
      app: 'rd-desk', version: 1, exportedAt: new Date().toISOString(),
      projects: S.projects, nodes: S.nodes, logs: S.logs, reviews: S.reviews
    };
    downloadJson(payload, '研发推进中台-备份-' + TODAY + '.json');
    toast('已导出备份文件', 'ok');
  }

  function readBackupFile(file) {
    if (window.__REMOTE_STORE__) {
      toast('本机数据库模式不支持此操作：请直接备份或替换 bridge/desk.db 文件', 'err');
      return;
    }
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      var data = null;
      try { data = JSON.parse(String(reader.result)); } catch (e) { data = null; }
      if (!data || (!data.projects && !data.logs)) {
        toast('这个文件不是有效的备份', 'err');
        return;
      }
      if (data._readonly || data._format === 'rd-desk-l2-raw') {
        toast('这是本机数据库的原始留档，不能用于页面导入', 'err');
        return;
      }
      var ps = data.projects || [], ls = data.logs || [], rs = data.reviews || [], ns = data.nodes || [];
      askConfirm('用备份覆盖当前数据？',
        '将清空现有的 <b>' + S.projects.length + '</b> 个项目、<b>' + S.nodes.length + '</b> 个节点、<b>' + S.logs.length +
        '</b> 条报工、<b>' + S.reviews.length + '</b> 份周复盘，并写入备份中的 <b>' + ps.length + '</b> 个项目、<b>' + ns.length +
        '</b> 个节点、<b>' + ls.length + '</b> 条报工、<b>' + rs.length + '</b> 份周复盘。<br><br>不可撤销。',
        '覆盖并写入', function () { doImport(ps, ns, ls, rs); });
    };
    reader.onerror = function () { toast('读取文件失败', 'err'); };
    reader.readAsText(file);
  }

  function doImport(ps, ns, ls, rs) {
    if (window.__REMOTE_STORE__) {
      closeMask('maskConfirm');
      toast('本机数据库模式不支持此操作：请直接备份或替换 bridge/desk.db 文件', 'err');
      return;
    }
    closeMask('maskConfirm');
    var db = sdk();
    if (!db) { toast('当前没有可用的数据存储', 'err'); return; }
    setSync('busy');

    var nameOf = {};
    ps.forEach(function (p) { nameOf[p.id] = p.name; });

    deleteMany('log', S.logs.map(function (l) { return l.id; }))
      .then(function () { return deleteMany('node', S.nodes.map(function (n) { return n.id; })); })
      .then(function () { return deleteMany('project', S.projects.map(function (p) { return p.id; })); })
      .then(function () { return deleteMany('week', S.reviews.map(function (r) { return r.id; })); })
      .then(function () {
        var i = 0;
        function addProj() {
          if (i >= ps.length) return Promise.resolve();
          var p = ps[i++];
          return db.addRecord({
            databaseId: 'XurtLd3EYpe29VppV0z0TJ',
            properties: {
              '项目名': { text: p.name || '未命名项目' },
              '阶段': { select: p.stage || '设计' },
              '单位': { text: p.unit || '项' },
              '总量': { number: Number(p.total) || 0 },
              '截止日': { date: p.due || TODAY },
              '配色': { text: p.color || '#6366f1' },
              '阻塞项': { text: p.block || '' },
              '预案': { text: p.plan || '' }
            }
          }).then(addProj);
        }
        return addProj();
      })
      .then(function () { return reloadData(); })
      .then(function () {
        var byName = {};
        S.projects.forEach(function (p) { byName[p.name] = p.id; });
        var k2 = 0;
        function addNode() {
          if (k2 >= ns.length) return Promise.resolve();
          var n = ns[k2++];
          var pname = nameOf[n.pid] || n.pname || '';
          var props = {
            '项目ID': { text: byName[pname] || '' },
            '节点名': { text: n.name || '未命名节点' },
            '序号': { number: Number(n.seq) || 1 },
            '预计工时': { number: Number(n.hours) || 0 },
            '已完成': { checkbox: !!n.done },
            '备注': { text: n.note || '' }
          };
          if (n.planDate) props['计划完成日'] = { date: n.planDate };
          if (n.doneDate) props['完成日'] = { date: n.doneDate };
          return db.addRecord({ databaseId: '1urnMOWB0VL3RL0pNiNILG', properties: props }).then(addNode);
        }
        return addNode();
      })
      .then(function () {
        var byName = {};
        S.projects.forEach(function (p) { byName[p.name] = p.id; });
        var j = 0;
        function addLog() {
          if (j >= ls.length) return Promise.resolve();
          var l = ls[j++];
          var nm = l.pname || nameOf[l.pid] || '';
          var props = {
            '项目ID': { text: byName[nm] || '' },
            '项目名称': { text: nm },
            '日期': { date: l.date },
            '完成量': { number: Number(l.qty) || 0 },
            '补记': { checkbox: !!l.backfill },
            '备注': { text: l.note || '' }
          };
          if (l.min != null && l.min !== '') props['工时分钟'] = { number: Number(l.min) || 0 };
          return db.addRecord({ databaseId: 'bI9MkKD1Zvp1UwmmY6UvfX', properties: props }).then(addLog);
        }
        return addLog();
      })
      .then(function () {
        var k = 0;
        function addReview() {
          if (k >= rs.length) return Promise.resolve();
          var r = rs[k++];
          return db.addRecord({
            databaseId: 'nG1nopjeQW93K0wclTs4jR',
            properties: {
              '周标识': { text: r.week || '' },
              '保持': { text: r.keep || '' },
              '问题': { text: r.problem || '' },
              '尝试': { text: r.tryit || '' },
              '下周预案': { text: r.next || '' }
            }
          }).then(addReview);
        }
        return addReview();
      })
      .then(function () {
        toast('备份已恢复', 'ok');
        return reloadData();
      })
      .catch(function (err) {
        setSync('off', '恢复失败：数据可能只写入了一部分，请检查后再操作。');
        toast('恢复失败，请重试或换一个备份文件', 'err');
        if (window.console) console.error('[backup] import failed', err);
      });
  }

  /* ============================================================
     统一刷新入口（唯一调度点，渲染函数之间不互调）
     ============================================================ */
  function refreshAll() {
    renderTodayHead();
    renderKpi();
    renderAttn();
    renderProjFilter();
    renderProjects();
    renderSide();
    renderBoard();
    renderWeek();
    renderMonth();
    renderMe();
  }

  /* ============================================================
     数据读取
     ============================================================ */
  var schemaLoaded = false;

  function loadSchemaOnce() {
    var db = sdk();
    if (!db || schemaLoaded) return;
    schemaLoaded = true;
    db.getSchema({ databaseId: 'XurtLd3EYpe29VppV0z0TJ' }).then(function (sc) {
      var map = {};
      ((sc && sc.properties) || []).forEach(function (f) {
        if ((f.type === 'select' || f.type === 'multi_select') && f.config && f.config.options) {
          map[f.name] = f.config.options;
        }
      });
      window.__SCHEMA_OPTIONS = map;
    }).catch(function (err) {
      schemaLoaded = false;
      if (window.console) console.error('[schema] load failed', err);
    });
  }

  function reloadData() {
    if (!hasSdk()) {
      S.loaded = true;
      setSync('off', dst('离线模式：未连接到资料库，数据不会保存。', '离线模式：没能连上本机数据库，数据不会保存。'));
      refreshAll();
      return Promise.resolve();
    }
    setSync('busy');
    return Promise.all([pullAll('project'), pullAll('log'), pullAll('week'), pullAll('node')]).then(function (res) {
      S.projects = res[0].map(normalizeProject).filter(function (p) { return !!p.id; });
      S.logs = res[1].map(normalizeLog).filter(function (l) { return !!l.id; });
      S.reviews = res[2].map(normalizeReview).filter(function (r) { return !!r.id; });
      S.nodes = res[3].map(normalizeNode).filter(function (n) { return !!n.id; });
      S.loaded = true;
      computeAll();
      setSync('ok');
      refreshAll();
      if (nodePid) renderNodeList();
    }).catch(function (err) {
      S.loaded = true;
      setSync('off', dst('读取失败：没能从云端取到数据，页面显示的是上一次成功加载的内容。',
           '读取失败：没能从本机数据库取到数据，页面显示的是上一次成功加载的内容。'));
      refreshAll();
      toast('数据读取失败，可重试', 'err', function () { reloadData(); });
      if (window.console) console.error('[data] load failed', err);
    });
  }

  /* 数据变更订阅，防抖后重拉（只处理本页涉及的表） */
  var updatedTimer = null;
  function subscribeUpdates() {
    var db = sdk();
    if (!db || typeof db.onUpdated !== 'function') return;
    db.onUpdated(function (payload) {
      var ids = (payload && payload.databaseIds) || [];
      var mine = [TBL_PROJECT, TBL_LOG, TBL_WEEK, TBL_NODE];
      var hit = false;
      for (var i = 0; i < ids.length; i++) {
        if (mine.indexOf(ids[i]) !== -1) { hit = true; break; }
      }
      if (!hit) return;
      if (updatedTimer) clearTimeout(updatedTimer);
      updatedTimer = setTimeout(function () { reloadData(); }, 400);
    });
  }

  /* ============================================================
     彩带
     ============================================================ */
  function playConfetti(color) {
    var box = $('#confettiBox');
    if (!box) return;
    var colors = [color || '#6366f1', '#8b5cf6', '#a855f7', '#f59e0b', '#14b8a6', '#e11d48'];
    for (var i = 0; i < 68; i++) {
      var piece = document.createElement('i');
      piece.style.left = (Math.random() * 100) + '%';
      piece.style.background = colors[i % colors.length];
      piece.style.animationDuration = (1.5 + Math.random() * 1.3) + 's';
      piece.style.animationDelay = (Math.random() * 0.4) + 's';
      piece.style.width = (5 + Math.random() * 6) + 'px';
      piece.style.height = (8 + Math.random() * 9) + 'px';
      box.appendChild(piece);
    }
    setTimeout(function () {
      box.innerHTML = '';
    }, 3400);
  }

  /* ============================================================
     清空
     ============================================================ */
  function deleteOne(kind, id) {
    var db = sdk();
    if (kind === 'project') return db.deleteRecord({ databaseId: 'XurtLd3EYpe29VppV0z0TJ', recordId: id });
    if (kind === 'log') return db.deleteRecord({ databaseId: 'bI9MkKD1Zvp1UwmmY6UvfX', recordId: id });
    if (kind === 'node') return db.deleteRecord({ databaseId: '1urnMOWB0VL3RL0pNiNILG', recordId: id });
    return db.deleteRecord({ databaseId: 'nG1nopjeQW93K0wclTs4jR', recordId: id });
  }

  /* 串行删除，避免瞬间打满单表 30 QPS */
  function deleteMany(kind, ids) {
    if (!sdk()) return Promise.reject(new Error('NO_SDK'));
    var i = 0;
    function step() {
      if (i >= ids.length) return Promise.resolve();
      var id = ids[i++];
      return deleteOne(kind, id).then(step);
    }
    return step();
  }

  function clearDemo() {
    if (window.__REMOTE_STORE__) {
      toast('本机数据库模式不支持此操作：请直接备份或替换 bridge/desk.db 文件', 'err');
      return;
    }
    var demoLogs = S.logs.filter(function (l) { return DEMO_IDS.indexOf(l.pid) !== -1; });
    askConfirm('清空示例数据？',
      '将删除预置的 ' + DEMO_IDS.length + ' 个示例项目及其 ' + demoLogs.length + ' 条报工记录。<br><br>你自己新建的项目和周复盘不受影响。',
      '确认清空', function () {
        closeMask('maskConfirm');
        setSync('busy');
        var demoNodes = S.nodes.filter(function (n) { return DEMO_IDS.indexOf(n.pid) !== -1; });
        deleteMany('log', demoLogs.map(function (l) { return l.id; })).then(function () {
          return deleteMany('node', demoNodes.map(function (n) { return n.id; }));
        }).then(function () {
          return deleteMany('project', DEMO_IDS.filter(function (id) {
            return S.projects.some(function (p) { return p.id === id; });
          }));
        }).then(function () {
          toast('示例数据已清空', 'ok');
          return reloadData();
        }).catch(function (err) {
          setSync('off', dst('清空失败：云端未确认。', '清空失败：数据没有完整写入。'));
          toast('清空失败，请重试', 'err', clearDemo);
          if (window.console) console.error('[demo] clear failed', err);
        });
      });
  }

  function clearAll() {
    if (window.__REMOTE_STORE__) {
      toast('本机数据库模式不支持此操作：请直接备份或替换 bridge/desk.db 文件', 'err');
      return;
    }
    var v = ($('#clearInput') ? $('#clearInput').value : '').trim();
    if (v !== '清空') {
      toast('请输入「清空」两个字再确认', 'err');
      return;
    }
    var total = S.projects.length + S.logs.length + S.reviews.length;
    askConfirm('清空全部数据？',
      '将删除 <b>' + S.projects.length + '</b> 个项目、<b>' + S.logs.length + '</b> 条报工记录、<b>' + S.reviews.length +
      '</b> 份周复盘，共 ' + total + ' 条。<br><br>' + dst('云端数据一并清除，不可恢复。', '本机数据一并清除，不可恢复。'),
      '全部删除', function () {
        closeMask('maskConfirm');
        setSync('busy');
        deleteMany('log', S.logs.map(function (l) { return l.id; })).then(function () {
          return deleteMany('node', S.nodes.map(function (n) { return n.id; }));
        }).then(function () {
          return deleteMany('project', S.projects.map(function (p) { return p.id; }));
        }).then(function () {
          return deleteMany('week', S.reviews.map(function (r) { return r.id; }));
        }).then(function () {
          if ($('#clearInput')) $('#clearInput').value = '';
          toast('全部数据已清空', 'ok');
          return reloadData();
        }).catch(function (err) {
          setSync('off', dst('清空失败：云端未确认，部分数据可能仍在。', '清空失败：数据没有完整写入，部分数据可能仍在。'));
          toast('清空失败，请重试', 'err', clearAll);
          if (window.console) console.error('[all] clear failed', err);
        });
      });
  }

  /* ============================================================
     Tab 切换
     ============================================================ */
  function switchTab(name) {
    S.tab = name;
    ['today', 'board', 'week', 'month', 'me'].forEach(function (t) {
      var panel = document.getElementById('panel-' + t);
      if (panel) panel.classList.toggle('hide', t !== name);
    });
    $$('[data-tab]').forEach(function (b) {
      b.classList.toggle('on', b.getAttribute('data-tab') === name);
    });
    try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch (e) { window.scrollTo(0, 0); }
    if (name === 'board' && S.loaded) renderBoard();
    if (name === 'week' && S.loaded) renderWeek();
    if (name === 'month' && S.loaded) renderMonth();
  }

  /* ============================================================
     事件绑定
     ============================================================ */
  function findAct(node) {
    while (node && node !== document) {
      if (node.getAttribute && node.getAttribute('data-act')) return node;
      node = node.parentNode;
    }
    return null;
  }

  function bindEvents() {
    /* Tab 导航 */
    $$('[data-tab]').forEach(function (b) {
      b.addEventListener('click', function () { switchTab(b.getAttribute('data-tab')); });
    });

    /* 卡片内动作（事件委托） */
    document.addEventListener('click', function (e) {
      var el = findAct(e.target);
      if (!el) return;
      var act = el.getAttribute('data-act');
      var pid = el.getAttribute('data-pid');
      var id = el.getAttribute('data-id');
      if (act === 'edit') openProjectModal(pid);
      else if (act === 'del') deleteProject(pid);
      else if (act === 'report') { openReportModal(pid, TODAY, 0); }
      else if (act === 'report-y') openReportModal(pid, addDays(TODAY, -1));
      else if (act === 'del-log') deleteLog(id);
      else if (act === 'nodes') openNodeModal(pid);
      else if (act === 'done-node') completeNode(el.getAttribute('data-nid'));
      else if (act === 'undo-node') undoNode(el.getAttribute('data-nid'));
      else if (act === 'del-node') deleteNode(el.getAttribute('data-nid'));
      else if (act === 'edit-done') startEditDone(el.getAttribute('data-nid'));
      else if (act === 'save-done') saveDoneDate(el.getAttribute('data-nid'));
      else if (act === 'cancel-done') cancelEditDone();
      else if (act === 'edit-plan') startEditPlan(el.getAttribute('data-nid'));
      else if (act === 'save-plan') savePlanDate(el.getAttribute('data-nid'));
      else if (act === 'cancel-plan') cancelEditPlan();
      else if (act === 'clear-filter') resetProjFilter();
    });

    /* 今日 · 项目快速筛选（阶段 / 状态 / 关键词） */
    var pfBox = $('#projFilter');
    if (pfBox) {
      pfBox.addEventListener('click', function (e) {
        var b = e.target;
        while (b && b !== this && !(b.getAttribute && b.getAttribute('data-pf'))) b = b.parentNode;
        if (!b || b === this) return;
        var group = b.getAttribute('data-pf');
        var v = b.getAttribute('data-v');
        S.projFilter[group] = (S.projFilter[group] === v) ? '' : v;   /* 再点一次 = 取消该维度 */
        renderProjFilter();
        renderProjects();
      });
    }
    var pfQEl = $('#pfQ');
    if (pfQEl) pfQEl.addEventListener('input', function () {
      S.projFilter.q = this.value.trim();
      syncPfSearchUi();
      renderProjects();
    });
    var pfQClear = $('#pfQClear');
    if (pfQClear) pfQClear.addEventListener('click', function () {
      var q = $('#pfQ');
      if (q) { q.value = ''; try { q.focus(); } catch (e3) {} }
      S.projFilter.q = '';
      syncPfSearchUi();
      renderProjects();
    });
    var pfReset = $('#pfReset');
    if (pfReset) pfReset.addEventListener('click', resetProjFilter);

    /* 新建入口 */
    $('#btnNewTop').addEventListener('click', function () { openProjectModal(null); });
    $('#btnNewBottom').addEventListener('click', function () { openProjectModal(null); });

    /* 项目弹窗 */
    $('#projCancel').addEventListener('click', function () { closeMask('maskProj'); });
    $('#projSave').addEventListener('click', saveProject);
    $('#fSwatches').addEventListener('click', function (e) {
      var b = e.target;
      while (b && b !== this && !b.getAttribute('data-color')) b = b.parentNode;
      if (!b || b === this) return;
      S.selColor = b.getAttribute('data-color');
      $$('#fSwatches .sw').forEach(function (x) { x.classList.toggle('on', x === b); });
      scheduleProjDraft();
    });

    /* 表单草稿：输入后 300ms 落本地，提交成功后清除（防刷新 / 登录跳转丢输入） */
    var tProjDraft = null;
    function scheduleProjDraft() {
      if (tProjDraft) clearTimeout(tProjDraft);
      tProjDraft = setTimeout(function () {
        if (S.editingId) return;
        var g = function (id) { var el = document.getElementById(id); return el ? el.value : ''; };
        draftSave(LS_PROJ, {
          name: g('fName'), unit: g('fUnit'), total: g('fTotal'), due: g('fDue'),
          stage: g('fStage'), block: g('fBlock'), plan: g('fPlan'),
          color: S.selColor, ts: Date.now()
        });
      }, 300);
    }
    ['fName', 'fUnit', 'fTotal', 'fDue', 'fBlock', 'fPlan'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.addEventListener('input', scheduleProjDraft);
    });
    if ($('#fStage')) $('#fStage').addEventListener('change', scheduleProjDraft);

    var tRepDraft = null;
    function scheduleRepDraft() {
      if (tRepDraft) clearTimeout(tRepDraft);
      tRepDraft = setTimeout(function () {
        if (!S.reportPid) return;
        var g = function (id) { var el = document.getElementById(id); return el ? el.value : ''; };
        draftSave(LS_REP, {
          pid: S.reportPid, date: g('repDate'),
          work: g('repWork'), note: g('repNote'), ts: Date.now()
        });
      }, 300);
    }
    ['repDate', 'repWork', 'repNote'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.addEventListener('input', scheduleRepDraft);
    });

    /* 工时按半天快捷填入 */
    document.addEventListener('click', function (e) {
      var b = e.target;
      while (b && b !== document && !(b.getAttribute && b.getAttribute('data-work'))) b = b.parentNode;
      if (!b || b === document) return;
      var w = b.getAttribute('data-work');
      var input = $('#repWork');
      if (!input) return;
      input.value = w;
      try { input.dispatchEvent(new Event('input')); } catch (e3) {}
    });

    /* 报工弹窗 */
    $('#repCancel').addEventListener('click', function () { closeMask('maskReport'); });
    $('#repSave').addEventListener('click', saveReport);
    $('#repQuick').addEventListener('click', function (e) {
      var b = e.target;
      while (b && b !== this && !b.getAttribute('data-date')) b = b.parentNode;
      if (!b || b === this) return;
      $('#repDate').value = b.getAttribute('data-date');
      $$('#repQuick button').forEach(function (x) { x.classList.toggle('on', x === b); });
      try { $('#repDate').dispatchEvent(new Event('input')); } catch (e2) {}
    });

    /* 确认弹窗 */
    $('#cfCancel').addEventListener('click', function () { closeMask('maskConfirm'); });
    $('#cfOk').addEventListener('click', function () {
      var cb = confirmCb;
      confirmCb = null;
      if (cb) cb();
    });

    /* 遮罩点击关闭 */
    ['maskProj', 'maskReport'].forEach(function (mid) {
      var m = document.getElementById(mid);
      if (!m) return;
      m.addEventListener('click', function (e) { if (e.target === m) m.classList.remove('on'); });
    });

    /* 周报 */
    $('#wkPrev').addEventListener('click', function () {
      S.weekOffset -= 1;
      renderWeek();
    });
    $('#wkNext').addEventListener('click', function () {
      if (S.weekOffset >= 0) return;
      S.weekOffset += 1;
      renderWeek();
    });
    $('#wkNow').addEventListener('click', function () {
      S.weekOffset = 0;
      renderWeek();
    });
    $('#btnSaveKpt').addEventListener('click', saveKpt);
    $('#btnGenReport').addEventListener('click', function () {
      generateReport();
      toast('周报文本已生成', 'ok');
    });
    $('#btnCopyReport').addEventListener('click', copyReport);
    $$('[data-kpt]').forEach(function (t) { t.addEventListener('input', markKptDirty); });

    /* 我的 */
    var resync = $('#btnResync');
    if (resync) resync.addEventListener('click', function () {
      toast('正在重新读取…');
      reloadData().then(function () {
        if (S.syncState === 'ok') toast(dst('已与云端同步', '已重新读取本机数据'), 'ok');
      });
    });
    /* 下面几个入口在 L2 下会被 applyLocalModeUi() 隐藏，但绑定仍要判空：
       删 DOM 会让 boot 在这里抛 TypeError，整页白屏。 */
    var exp = $('#btnExport'); if (exp) exp.addEventListener('click', exportJson);
    var imp = $('#btnImport');
    if (imp) imp.addEventListener('click', function () { var f = $('#importFile'); if (f) f.click(); });
    var impFile = $('#importFile');
    if (impFile) impFile.addEventListener('change', function () {
      var f = this.files && this.files[0];
      readBackupFile(f);
      this.value = '';
    });
    var clrDemo = $('#btnClearDemo'); if (clrDemo) clrDemo.addEventListener('click', clearDemo);
    var clrAll = $('#btnClearAll'); if (clrAll) clrAll.addEventListener('click', clearAll);

    /* 日期回填上限 */
    var repDate = $('#repDate');
    if (repDate) repDate.max = TODAY;

    /* 跨天自动校准 */
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState !== 'visible') return;
      var now = ymd(new Date());
      if (now !== TODAY) {
        TODAY = now;
        if ($('#repDate')) $('#repDate').max = TODAY;
        reloadData();
      }
    });
  }

  /* ============================================================
     启动：先渲染界面，再拉数据
     ============================================================ */
  /* ============================================================
     L2 专属 UI：收起云端时代遗留、且在 SQLite 真源下会伤数据的入口。
     只隐藏、不删 DOM —— bindEvents 里仍有引用，删节点会整页白屏。
     legacy（localStorage 应急版）不进这个分支，导出/恢复/PWA 引导都保留。
     ============================================================ */
  function applyLocalModeUi() {
    if (!window.__REMOTE_STORE__) return;
    var byId = function (id) { return document.getElementById(id); };
    ['rowImport', 'dangerZone', 'pwaCard'].forEach(function (id) {
      var el = byId(id);
      if (el) el.classList.add('hide');
    });
    /* 双保险：即使有人手动把卡片显示出来，按钮也不可点 */
    ['btnImport', 'btnClearDemo', 'btnClearAll', 'importFile'].forEach(function (id) {
      var el = byId(id);
      if (el) el.disabled = true;
    });
    var tip = byId('localDbTip');
    if (tip) tip.classList.remove('hide');
  }

  function boot() {
    TODAY = ymd(new Date());
    applyLocalModeUi();
    bindEvents();
    bindNodeEvents();
    bindMonthEvents();
    refreshAll();          /* 立刻出界面（骨架态），不空白等数据 */
    loadSchemaOnce();
    subscribeUpdates();
    reloadData();
    /* 离线条按真实存储类型给文案：L2 是本机数据库，legacy 是浏览器本地存储 */
    var ot = $('#offlineTxt');
    if (ot && LOCAL) ot.textContent = window.__REMOTE_STORE__
      ? '离线模式：没能连上本机数据库，改动暂不会保存。'
      : '离线模式：没能连上本地存储，改动暂不会保存。';
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
