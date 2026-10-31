
  /* ============================================================
     今日 · 渲染
     ============================================================ */
  function renderTodayHead() {
    var sub = $('#todaySub');
    if (!sub) return;
    if (!S.loaded) {
      sub.innerHTML = icon('clock', 'ico-sm') + '<span>' + dst('正在读取云端数据…', '正在读取本机数据…') + '</span>';
      return;
    }
    var n = S.projects.length;
    var total = 0;
    S.projects.forEach(function (p) { total += (S.metrics[p.id] || {}).todayNodes || 0; });
    sub.innerHTML = icon('clock', 'ico-sm') +
      '<span>' + escapeHtml(fmtMDW(TODAY)) + ' · ' + n + ' 个在研项目 · 今日完成 ' + total + ' 个节点</span>';
  }

  function renderKpi() {
    var box = $('#todayKpi');
    if (!box) return;
    if (!S.loaded) return;

    var todayNodes = 0, weekNodes = 0, pending = attentionList().length;
    var wr = weekRange(0);

    S.projects.forEach(function (p) {
      var m = S.metrics[p.id] || {};
      todayNodes += m.todayNodes || 0;
    });
    S.nodes.forEach(function (n) {
      if (n.done && n.doneDate >= wr.start && n.doneDate <= wr.end) weekNodes++;
    });

    var items = [
      { l: '在研项目', v: S.projects.length, u: '个', cls: '' },
      { l: '今日完成节点', v: todayNodes, u: '个', cls: todayNodes > 0 ? 'ok' : '' },
      { l: '待处理', v: pending, u: '项', cls: pending > 0 ? 'warn' : '' },
      { l: '本周完成节点', v: weekNodes, u: '个', cls: '' }
    ];

    box.innerHTML = items.map(function (it) {
      return '<div class="kpi ' + it.cls + '"><div class="k-label">' + escapeHtml(it.l) + '</div>' +
        '<div class="k-val" data-sp-bindable="database" data-sp-database-id="1urnMOWB0VL3RL0pNiNILG">' +
        escapeHtml(it.v) + '<em>' + escapeHtml(it.u) + '</em></div></div>';
    }).join('');
  }

  /* ============================================================
     项目快速筛选（只作用于「可直接报工」列表）
     口径与 attentionList / sortedProjects 对齐：逾期 > 昨日缺报 > 正常
     ============================================================ */
  /* 阶段候选项：优先云端 schema 回填，与新建项目弹窗一致 */
  function stageList() {
    var opts = (window.__SCHEMA_OPTIONS && window.__SCHEMA_OPTIONS['阶段']) || null;
    return opts && opts.length ? opts.map(function (o) { return o.text; }) : STAGES;
  }

  function statusOf(p) {
    var m = S.metrics[p.id] || {};
    if (m.overdue > 0) return 'overdue';
    if (m.yStatus === 'broken' || m.yStatus === 'buffer') return 'miss';
    return 'ok';
  }

  function pfCounts() {
    var byStage = {}, byStatus = { overdue: 0, miss: 0, ok: 0 };
    S.projects.forEach(function (p) {
      var st = p.stage || '设计';
      byStage[st] = (byStage[st] || 0) + 1;
      byStatus[statusOf(p)]++;
    });
    return { stage: byStage, status: byStatus, total: S.projects.length };
  }

  function filteredProjects() {
    var f = S.projFilter;
    var q = (f.q || '').toLowerCase();
    return sortedProjects().filter(function (p) {
      if (f.stage && (p.stage || '设计') !== f.stage) return false;
      if (f.status && statusOf(p) !== f.status) return false;
      if (q && String(p.name).toLowerCase().indexOf(q) === -1) return false;
      return true;
    });
  }

  function pfActive() {
    var f = S.projFilter;
    return !!(f.stage || f.status || f.q);
  }

  function syncPfSearchUi() {
    var wrap = $('#pfSearch'), q = $('#pfQ');
    if (wrap && q) wrap.classList.toggle('has-q', !!q.value);
  }

  function updatePfCount() {
    var el = $('#pfCount');
    if (!el) return;
    var total = S.projects.length;
    el.textContent = pfActive()
      ? ('显示 ' + filteredProjects().length + ' / ' + total + ' 个')
      : ('共 ' + total + ' 个项目');
  }

  function pfChip(group, value, label, n, on) {
    return '<button type="button" class="pf-chip' + (on ? ' on' : '') + '" data-pf="' + group +
      '" data-v="' + escapeHtml(value) + '">' + escapeHtml(label) +
      (n == null ? '' : '<em>' + n + '</em>') + '</button>';
  }

  /* 只重绘两个 chips 行；搜索框是静态 HTML，重绘会丢焦点和事件 */
  function renderProjFilter() {
    var box = $('#projFilter');
    if (!box) return;
    if (!S.loaded) { box.classList.add('hide'); return; }
    box.classList.remove('hide');

    var c = pfCounts(), f = S.projFilter;

    var stageRow = $('#pfStageRow');
    if (stageRow) {
      var sHtml = '<span class="pf-lbl">阶段</span>' + pfChip('stage', '', '全部', c.total, !f.stage);
      stageList().forEach(function (st) {
        sHtml += pfChip('stage', st, st, c.stage[st] || 0, f.stage === st);
      });
      stageRow.innerHTML = sHtml;
    }

    var statusRow = $('#pfStatusRow');
    if (statusRow) {
      var rows = [
        ['', '全部', c.total],
        ['overdue', '逾期', c.status.overdue],
        ['miss', '昨日缺报', c.status.miss],
        ['ok', '节奏正常', c.status.ok]
      ];
      var tHtml = '<span class="pf-lbl">状态</span>';
      rows.forEach(function (r) {
        tHtml += pfChip('status', r[0], r[1], r[2], f.status === r[0]);
      });
      statusRow.innerHTML = tHtml;
    }

    box.classList.toggle('filtering', pfActive());
    updatePfCount();
  }

  function resetProjFilter() {
    S.projFilter.stage = '';
    S.projFilter.status = '';
    S.projFilter.q = '';
    var q = $('#pfQ');
    if (q) q.value = '';
    syncPfSearchUi();
    renderProjFilter();
    renderProjects();
  }

  /* 今天要处理 */
  function renderAttn() {
    var box = $('#attnWrap');
    if (!box) return;
    var list = attentionList();
    if (!list.length) {
      box.innerHTML = '';
      return;
    }

    var html = ['<div class="attn-head"><h2>' + icon('alert', 'ico-sm') +
      '今天要处理<span class="chip" style="background:var(--red-soft);color:#be123c">' + list.length + '</span></h2>' +
      '<span class="muted tiny">只列当天及更早还有未报工节点的项目</span></div><div class="attn-list">'];

    list.forEach(function (it) {
      var p = it.p, m = it.m;
      if (it.kind === 'overdue') {
        var extra = '';
        if (m.yStatus === 'broken') extra = '<span class="chip late">昨日缺报</span>';
        else if (m.yStatus === 'buffer') extra = '<span class="chip buf">用了缓冲日</span>';
        html.push(
          '<div class="attn red">' +
            '<div class="a-ico">' + icon('alert') + '</div>' +
            '<div class="a-body">' +
              '<div class="a-title">' + escapeHtml(p.name) + '<span class="chip late">逾期 ' + m.overdue + ' 天</span>' + extra + '</div>' +
              '<div class="a-desc">截止 ' + escapeHtml(fmtMD(p.due)) + ' 已过，还有 ' + m.remainNodes + ' 个节点没关。要么今天推进一个，要么把截止日往后调。</div>' +
            '</div>' +
            '<div class="a-actions">' +
              '<button class="btn btn-sm btn-primary" data-act="report" data-pid="' + escapeHtml(p.id) + '">立即报工</button>' +
              '<button class="btn btn-sm" data-act="edit" data-pid="' + escapeHtml(p.id) + '">调整计划</button>' +
            '</div>' +
          '</div>');
      } else if (it.kind === 'broken') {
        html.push(
          '<div class="attn red">' +
            '<div class="a-ico">' + icon('clock') + '</div>' +
            '<div class="a-body">' +
              '<div class="a-title">' + escapeHtml(p.name) + '<span class="chip late">连续缺报</span></div>' +
              '<div class="a-desc">昨日（' + escapeHtml(fmtMD(addDays(TODAY, -1))) + '）未报工，本周缓冲日已用完，连续记录断在此处。还有 ' + m.dueNodes + ' 个节点计划已到还没关，今天推进一下再补记。</div>' +
            '</div>' +
            '<div class="a-actions">' +
              '<button class="btn btn-sm btn-primary" data-act="report" data-pid="' + escapeHtml(p.id) + '">立即报工</button>' +
              '<button class="btn btn-sm" data-act="report-y" data-pid="' + escapeHtml(p.id) + '">补记昨天</button>' +
            '</div>' +
          '</div>');
      } else {
        html.push(
          '<div class="attn amber">' +
            '<div class="a-ico">' + icon('shield') + '</div>' +
            '<div class="a-body">' +
              '<div class="a-title">' + escapeHtml(p.name) + '<span class="chip buf">缓冲日</span></div>' +
              '<div class="a-desc">昨日未报工，已自动用掉本周 1 个缓冲日，连续 ' + m.streak + ' 天保留未断。有 ' + m.dueNodes + ' 个节点计划已到，今天补上，节奏就还在。</div>' +
            '</div>' +
            '<div class="a-actions">' +
              '<button class="btn btn-sm btn-primary" data-act="report" data-pid="' + escapeHtml(p.id) + '">立即报工</button>' +
              '<button class="btn btn-sm" data-act="report-y" data-pid="' + escapeHtml(p.id) + '">补记昨天</button>' +
            '</div>' +
          '</div>');
      }
    });
    html.push('</div>');
    box.innerHTML = html.join('');
  }

  function deadlineChip(p, m) {
    if (m.overdue > 0) {
      return '<div class="m-v red">逾期 ' + m.overdue + ' 天</div>';
    }
    if (m.dLeft === 0) {
      return '<div class="m-v" style="color:var(--amber)">今天截止</div>';
    }
    return '<div class="m-v green">剩 ' + m.dLeft + ' 天</div>';
  }

  /* 项目卡 */
  function renderProjects() {
    var box = $('#projList');
    if (!box) return;
    if (!S.loaded) {
      box.innerHTML = '<div class="skel skel-card"></div><div class="skel skel-card"></div>';
      return;
    }
    if (!S.projects.length) {
      box.innerHTML = '<div class="empty"><div class="e-ico">' + icon('target') + '</div>' +
        '<b>还没有在研项目</b>建一个「关闭 320 个试产失效项」这样的任务，明天就有建议量了。</div>';
      return;
    }

    var list = filteredProjects();
    if (!list.length) {
      /* 有项目但被筛空了：给一条明确的退路，而不是空白 */
      box.innerHTML = '<div class="empty"><div class="e-ico">' + icon('search') + '</div>' +
        '<b>没有符合筛选条件的项目</b>换个关键词或阶段试试，也可以直接看全部 ' + S.projects.length + ' 个项目。' +
        '<div style="margin-top:12px"><button class="btn btn-sm" data-act="clear-filter">重置筛选</button></div></div>';
      var hint0 = $('#listHint');
      if (hint0) hint0.textContent = '筛选中 · 0 / ' + S.projects.length + ' 个项目';
      updatePfCount();
      return;
    }

    var html = [];
    list.forEach(function (p) {
      var m = S.metrics[p.id] || {};
      var color = p.color || PALETTE[0];
      var stageCls = 'stage-' + (p.stage || '设计');
      var planTxt = p.plan
        ? '<b>预案</b> ' + escapeHtml(p.plan)
        : '<span class="muted">未填预案。阻塞真出现时，容易临场拍脑袋，建议补一条「如果……就……」。</span>';

      var ns = nodeStats(p.id);
      var cur = currentNode(p.id);
      var nodeHero;
      if (cur) {
        var metaBits = [];
        if (cur.owner) metaBits.push(cur.owner);
        if (cur.hours > 0) metaBits.push('预计 ' + fmtDays(cur.hours * MIN_PER_DAY));
        if (cur.planDate) metaBits.push('计划 ' + fmtMD(cur.planDate));
        nodeHero =
          '<div class="node-hero">' +
            '<div class="nh-main">' +
              '<div class="nh-label">下一节点</div>' +
              '<div class="nh-name">' + escapeHtml(cur.name) + '</div>' +
              '<div class="nh-meta">' + escapeHtml(metaBits.join(' · ')) + '</div>' +
            '</div>' +
            '<button class="btn btn-primary" data-act="done-node" data-nid="' + escapeHtml(cur.id) + '">' +
              icon('check', 'ico-sm') + '完成节点</button>' +
          '</div>';
      } else if (ns.total > 0) {
        nodeHero =
          '<div class="node-hero done">' +
            '<div class="nh-main">' +
              '<div class="nh-label">节点已全部完成</div>' +
              '<div class="nh-name">共 ' + ns.total + ' 个节点已全部关闭</div>' +
              '<div class="nh-meta">还想继续推进的话，去「管理节点」再加几个。</div>' +
            '</div>' +
            '<button class="btn" data-act="report" data-pid="' + escapeHtml(p.id) + '">自定义报工</button>' +
          '</div>';
      } else {
        nodeHero =
          '<div class="node-hero empty">' +
            '<div class="nh-main">' +
              '<div class="nh-label">还没拆节点</div>' +
              '<div class="nh-name">拆成能一键关闭的节点</div>' +
              '<div class="nh-meta">例如「评审完 60 份」「样机到位并复测」，之后每天点一下就能打卡。</div>' +
            '</div>' +
            '<button class="btn btn-primary" data-act="nodes" data-pid="' + escapeHtml(p.id) + '">' + icon('plus', 'ico-sm') + '拆节点</button>' +
          '</div>';
      }

      var nodeList = nodesOf(p.id);
      var ganttBlock = nodeList.length
        ? '<div class="gantt-wrap">' + ganttSVG(p, nodeList, { compact: true }) + '</div>'
        : '';

      var tags = '';
      if (m.yStatus === 'buffer') tags += '<span class="chip buf">缓冲日</span>';
      if (m.yStatus === 'broken') tags += '<span class="chip late">昨日缺报</span>';
      if (m.overdue > 0) tags += '<span class="chip late">逾期</span>';

      html.push(
        '<div class="pcard" data-pid="' + escapeHtml(p.id) + '">' +
          '<div class="bar" style="background:' + escapeHtml(color) + '"></div>' +
          '<div class="p-in">' +
            '<div class="p-top">' +
              '<div style="flex:1;min-width:0">' +
                '<div class="p-name">' + escapeHtml(p.name) + '</div>' +
                '<div class="p-unit"><span class="chip ' + stageCls + '">' + escapeHtml(p.stage || '设计') + '</span>' +
                  tags +
                  '<span>节点 ' + m.nodeDone + '/' + m.nodeTotal + '</span>' +
                '</div>' +
              '</div>' +
              '<div class="p-menu">' +
                '<button class="btn btn-icon" data-act="edit" data-pid="' + escapeHtml(p.id) + '" aria-label="编辑项目">' + icon('pencil', 'ico-sm') + '</button>' +
                '<button class="btn btn-icon" data-act="del" data-pid="' + escapeHtml(p.id) + '" aria-label="删除项目">' + icon('trash', 'ico-sm') + '</button>' +
              '</div>' +
            '</div>' +
            '<div class="p-metrics">' +
              '<div class="metric"><div class="m-l">节点进度</div><div class="m-v">' + m.nodeDone + ' / ' + m.nodeTotal + '</div></div>' +
              '<div class="metric"><div class="m-l">剩余节点</div><div class="m-v">' + m.remainNodes + ' <small>个</small></div></div>' +
              '<div class="metric"><div class="m-l">截止</div>' + deadlineChip(p, m) + '</div>' +
              '<div class="metric"><div class="m-l">连续报工</div><div class="m-v">' + (m.streak || 0) + ' <small>天</small></div></div>' +
            '</div>' +
            '<div class="plan-line">' + icon('flag', 'ico-sm') + '<div class="p-txt">' + planTxt + '</div></div>' +
            nodeHero +
            '<div class="node-bar">' +
              '<span>节点 ' + ns.done + '/' + ns.total + ' · 今日完成 ' + m.todayNodes + ' 个' +
                (m.todayMin > 0 ? ' · 投入 ' + fmtDays(m.todayMin) : '') + '</span>' +
              '<span>' +
                '<button data-act="nodes" data-pid="' + escapeHtml(p.id) + '">管理节点</button>' +
                ' · <button data-act="report" data-pid="' + escapeHtml(p.id) + '">自定义报工</button>' +
              '</span>' +
            '</div>' +
            ganttBlock +
          '</div>' +
        '</div>');
    });
    box.innerHTML = html.join('');

    var hint = $('#listHint');
    if (hint) {
      hint.textContent = pfActive()
        ? '筛选中 · ' + list.length + ' / ' + S.projects.length + ' 个项目'
        : '点「完成节点」即记一次报工 · ' + S.projects.length + ' 个项目';
    }
    updatePfCount();
  }

  /* 右侧风险栏 */
  function renderSide() {
    var box = $('#sideRisk');
    if (!box || !S.loaded) {
      if (box) box.innerHTML = '<div class="card"><div class="skel" style="height:90px"></div></div>';
      return;
    }

    var blocked = S.projects.filter(function (p) { return p.block; });
    var html = [];

    html.push('<div class="card"><div class="card-h"><h2>' + icon('alert', 'ico-sm') + '阻塞与预案</h2>' +
      '<span class="muted tiny">' + blocked.length + ' 条</span></div>');
    if (!blocked.length) {
      html.push('<div class="tiny muted">暂无登记的阻塞项。研发节奏里「等样机、等供应商、评审冻结」最耗时间，建议每个项目都写一条。</div>');
    } else {
      blocked.forEach(function (p) {
        html.push('<div class="risk-item">' +
          '<div class="risk-name"><i style="background:' + escapeHtml(p.color || PALETTE[0]) + '"></i>' + escapeHtml(p.name) + '</div>' +
          '<div class="risk-txt">' + escapeHtml(p.block) + '</div>' +
          (p.plan ? '<div class="risk-txt"><em>如果出现：</em>' + escapeHtml(p.plan) + '</div>' : '') +
          '</div>');
      });
    }
    html.push('</div>');

    var wr = weekRange(0);
    var stats = weekStats(wr);
    html.push('<div class="card"><div class="card-h"><h2>' + icon('target', 'ico-sm') + '本周节奏</h2>' +
      '<span class="muted tiny">' + escapeHtml(fmtMD(wr.start)) + '–' + escapeHtml(fmtMD(wr.end)) + '</span></div>');
    if (!S.projects.length) {
      html.push('<div class="tiny muted">建项目后这里显示每个项目的本周推进量。</div>');
    } else {
      S.projects.forEach(function (p) {
        var st = stats[p.id] || { qty: 0, cnt: 0 };
        var m = S.metrics[p.id] || {};
        html.push('<div class="ring-mini">' +
          '<i style="width:9px;height:9px;border-radius:3px;background:' + escapeHtml(p.color || PALETTE[0]) + '"></i>' +
          '<span class="rm-name">' + escapeHtml(p.name) + '</span>' +
          '<span class="rm-val">' + st.nodes + ' 个 / ' + st.cnt + ' 天</span>' +
          '<span class="rm-val" style="color:var(--ink-3);min-width:34px;text-align:right">' + (m.streak || 0) + '天</span>' +
          '</div>');
      });
    }
    html.push('</div>');

    box.innerHTML = html.join('');
  }

  /* ============================================================
     项目表单
     ============================================================ */
  function openProjectModal(id) {
    S.editingId = id || null;
    var p = null;
    if (id) {
      for (var i = 0; i < S.projects.length; i++) {
        if (S.projects[i].id === id) { p = S.projects[i]; break; }
      }
    }
    $('#projModalTitle').textContent = p ? '编辑项目' : '新建项目';

    /* 阶段下拉：优先用云端 schema 回填，保证与表内选项一致 */
    var sel = $('#fStage');
    var opts = (window.__SCHEMA_OPTIONS && window.__SCHEMA_OPTIONS['阶段']) || null;
    var list = opts && opts.length ? opts.map(function (o) { return o.text; }) : STAGES;
    sel.innerHTML = list.map(function (t) { return '<option value="' + escapeHtml(t) + '">' + escapeHtml(t) + '</option>'; }).join('');

    var dr = (!p) ? draftRead(LS_PROJ) : null;
    $('#fName').value = p ? p.name : (dr ? dr.name || '' : '');
    $('#fUnit').value = p ? p.unit : (dr ? dr.unit || '' : '');
    $('#fTotal').value = p ? p.total : (dr && dr.total ? dr.total : '');
    $('#fDue').value = p ? p.due : (dr && dr.due ? dr.due : addDays(TODAY, 30));
    $('#fBlock').value = p ? p.block : (dr ? dr.block || '' : '');
    $('#fPlan').value = p ? p.plan : (dr ? dr.plan || '' : '');
    sel.value = p ? (p.stage || '设计') : (dr && dr.stage ? dr.stage : '设计');

    S.selColor = p ? (p.color || PALETTE[0]) : (dr && dr.color ? dr.color : PALETTE[0]);
    var sw = $('#fSwatches');
    sw.innerHTML = PALETTE.map(function (c) {
      return '<button class="sw ' + (c === S.selColor ? 'on' : '') + '" data-color="' + c + '" style="background:' + c + '" aria-label="配色 ' + c + '"></button>';
    }).join('');

    openMask('maskProj');
    if (dr) toast('已恢复上次未提交的项目草稿');
    setTimeout(function () { try { $('#fName').focus(); } catch (e) {} }, 120);
  }

  function saveProject() {
    var name = $('#fName').value.trim();
    var unit = $('#fUnit').value.trim() || '项';
    var total = Number($('#fTotal').value) || 0;
    var due = $('#fDue').value;
    var stage = $('#fStage').value;

    if (!name) { toast('请填写型号 / 项目名', 'err'); return; }
    if (!due) { toast('请选择截止日', 'err'); return; }

    var props = {
      '项目名': { text: name },
      '阶段': { select: stage },
      '单位': { text: unit || '项' },
      '总量': { number: total > 0 ? total : 0 },
      '截止日': { date: due },
      '配色': { text: S.selColor },
      '阻塞项': { text: $('#fBlock').value.trim() },
      '预案': { text: $('#fPlan').value.trim() }
    };

    var db = sdk();
    if (!db) { toast(dst('当前未连接云端，改动无法保存', '当前没有可用的数据存储，改动无法保存'), 'err', function () { saveProject(); }); return; }

    var btn = $('#projSave');
    btn.disabled = true;
    btn.textContent = '保存中…';
    setSync('busy');

    var p = S.editingId
      ? db.updateRecord({ databaseId: 'XurtLd3EYpe29VppV0z0TJ', recordId: S.editingId, properties: props })
      : db.addRecord({ databaseId: 'XurtLd3EYpe29VppV0z0TJ', properties: props });

    p.then(function () {
      toast(S.editingId ? '项目已更新' : '项目已创建', 'ok');
      draftClear(LS_PROJ);
      closeMask('maskProj');
      return reloadData();
    }).catch(function (err) {
      setSync('off', dst('写入失败：改动没有保存到云端，请检查网络后重试。',
        '写入失败：改动没有保存到本机数据库，请重试。'));
      toast(dst('保存失败，数据未写入云端', '保存失败，数据未写入本机数据库'), 'err', function () { saveProject(); });
      if (window.console) console.error('[project] save failed', err);
    }).then(function () {
      btn.disabled = false;
      btn.textContent = '保存';
    });
  }

  function deleteProject(id) {
    var p = null;
    for (var i = 0; i < S.projects.length; i++) if (S.projects[i].id === id) p = S.projects[i];
    if (!p) return;
    var mine = S.logs.filter(function (l) { return l.pid === id; });

    askConfirm('删除项目？',
      '将删除 <b>' + escapeHtml(p.name) + '</b> 及其 ' + mine.length + ' 条报工记录。<br><br>这个动作不可恢复，' + dst('云端数据会一并清除。', '本机数据会一并清除。'),
      '确认删除', function () {
        var db = sdk();
        if (!db) { toast(dst('当前未连接云端', '当前没有可用的数据存储'), 'err'); return; }
        closeMask('maskConfirm');
        setSync('busy');
        var jobs = mine.map(function (l) {
          return db.deleteRecord({ databaseId: 'bI9MkKD1Zvp1UwmmY6UvfX', recordId: l.id });
        });
        Promise.all(jobs).then(function () {
          return db.deleteRecord({ databaseId: 'XurtLd3EYpe29VppV0z0TJ', recordId: id });
        }).then(function () {
          toast('项目已删除', 'ok');
          return reloadData();
        }).catch(function (err) {
          setSync('off', dst('删除失败：云端未确认，数据可能仍在。', '删除失败：数据没有完整写入，可能仍在。'));
          toast('删除失败，请重试', 'err', function () { deleteProject(id); });
          if (window.console) console.error('[project] delete failed', err);
        });
      });
  }

  function deleteLog(id) {
    askConfirm('删除这条报工记录？', '删除后该日的推进量与工时都会从统计中移除，不可恢复。', '确认删除', function () {
      var db = sdk();
      if (!db) { toast(dst('当前未连接云端', '当前没有可用的数据存储'), 'err'); return; }
      closeMask('maskConfirm');
      setSync('busy');
      db.deleteRecord({ databaseId: 'bI9MkKD1Zvp1UwmmY6UvfX', recordId: id }).then(function () {
        toast('记录已删除', 'ok');
        return reloadData();
      }).catch(function (err) {
        setSync('off', dst('删除失败：云端未确认。', '删除失败：数据没有完整写入。'));
        toast('删除失败，请重试', 'err', function () { deleteLog(id); });
        if (window.console) console.error('[log] delete failed', err);
      });
    });
  }

  /* ============================================================
     报工
     ============================================================ */
  function openReportModal(pid, date, presetQty) {
    S.reportPid = pid;
    var p = null;
    for (var i = 0; i < S.projects.length; i++) if (S.projects[i].id === pid) p = S.projects[i];
    if (!p) return;
    var m = S.metrics[pid] || {};

    var dr = draftRead(LS_REP);
    var useDr = !!(dr && dr.pid === pid);
    var dftDate = date || (useDr && dr.date ? dr.date : TODAY);

    $('#repTitle').textContent = '报工 · ' + p.name;
    $('#repProj').value = p.name;
    $('#repDate').value = dftDate;
    void m;
    $('#repWork').value = (useDr && dr.work != null && dr.work !== '') ? dr.work : '';
    $('#repWorkQuick').innerHTML = [0.5, 1, 1.5, 2].map(function (d) {
      return '<button type="button" data-work="' + d + '">' + d + ' 天</button>';
    }).join('');
    $('#repNote').value = (useDr && dr.note) ? dr.note : '';

    var quick = $('#repQuick');
    var chips = [];
    for (var k = 0; k < 7; k++) {
      var d = addDays(TODAY, -k);
      chips.push('<button data-date="' + d + '" class="' + (d === dftDate ? 'on' : '') + '">' +
        (k === 0 ? '今天' : (k === 1 ? '昨天' : fmtMD(d))) + '</button>');
    }
    quick.innerHTML = chips.join('');

    openMask('maskReport');
  }

  function saveReport() {
    var pid = S.reportPid;
    var p = null;
    for (var i = 0; i < S.projects.length; i++) if (S.projects[i].id === pid) p = S.projects[i];
    if (!p) return;

    var date = $('#repDate').value;
    var workRaw = $('#repWork').value;
    var note = $('#repNote').value.trim();

    if (!date) { toast('请选择报工日期', 'err'); return; }
    if (date > TODAY) { toast('不能给未来日期报工', 'err'); return; }
    if (!(daysToMin(workRaw) > 0) && !note) { toast('填一下投入工时或备注', 'err'); return; }

    var props = {
      '项目ID': { text: p.id },
      '项目名称': { text: p.name },
      '日期': { date: date },
      '补记': { checkbox: date < TODAY },
      '备注': { text: note }
    };
    var workMin = daysToMin(workRaw);
    if (workMin > 0) props['工时分钟'] = { number: workMin };

    var db = sdk();
    if (!db) { toast(dst('当前未连接云端，报工无法保存', '当前没有可用的数据存储，报工无法保存'), 'err', function () { saveReport(); }); return; }

    var btn = $('#repSave');
    btn.disabled = true;
    btn.textContent = '保存中…';
    setSync('busy');

    var beforeRate = (S.metrics[pid] || {}).rate || 0;

    db.addRecord({ databaseId: 'bI9MkKD1Zvp1UwmmY6UvfX', properties: props }).then(function () {
      toast(date < TODAY ? '已补记 ' + fmtMD(date) : '已报工', 'ok');
      draftClear(LS_REP);
      closeMask('maskReport');
      return reloadData();
    }).then(function () {
      var m = S.metrics[pid] || {};
      if (m.rate >= 1 && beforeRate < 1) {
        playConfetti(p.color);
        toast('「' + p.name + '」已 100% 关闭', 'ok');
      }
    }).catch(function (err) {
      setSync('off', dst('报工失败：这条记录没有写入云端。', '报工失败：这条记录没有写入本机数据库。'));
      toast('报工失败，数据未保存', 'err', function () { saveReport(); });
      if (window.console) console.error('[report] save failed', err);
    }).then(function () {
      btn.disabled = false;
      btn.textContent = '保存报工';
    });
  }
