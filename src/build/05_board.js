
  /* ============================================================
     看板 · 渲染
     ============================================================ */
  function ringSVG(rate, color, size, stroke) {
    size = size || 62;
    stroke = stroke || 6;
    var r = (size - stroke) / 2;
    var c = 2 * Math.PI * r;
    var off = c * (1 - Math.max(0, Math.min(1, rate)));
    var done = rate >= 1;
    var col = done ? 'var(--green)' : color;
    return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '">' +
      '<circle cx="' + (size / 2) + '" cy="' + (size / 2) + '" r="' + r + '" fill="none" stroke="#eceffa" stroke-width="' + stroke + '"/>' +
      '<circle cx="' + (size / 2) + '" cy="' + (size / 2) + '" r="' + r + '" fill="none" stroke="' + col + '" stroke-width="' + stroke +
      '" stroke-linecap="round" stroke-dasharray="' + c.toFixed(1) + '" stroke-dashoffset="' + off.toFixed(1) + '"/>' +
      '</svg>';
  }

  function etaCell(p, m) {
    if (m.rate >= 1) return '<div class="n-v green">已完成</div>';
    if (!m.eta) {
      return '<div class="n-v" style="color:var(--ink-3);font-size:12.5px">暂无推算</div>' +
        '<div class="n-l" style="margin-top:1px">' + (m.nodeTotal && m.remainNodes > 0 ? '近 7 天没完成节点' : '还没有节点') + '</div>';
    }
    var gap = m.etaGap;
    var gapHtml = '';
    if (gap == null) gapHtml = '';
    else if (gap > 0) gapHtml = '<div class="n-l" style="color:var(--green);margin-top:1px">提前 ' + gap + ' 天</div>';
    else if (gap < 0) gapHtml = '<div class="n-l" style="color:var(--red);margin-top:1px">拖后 ' + (-gap) + ' 天</div>';
    else gapHtml = '<div class="n-l" style="color:var(--green);margin-top:1px">正好按期</div>';
    return '<div class="n-v">' + escapeHtml(fmtMD(m.eta)) + '</div>' + gapHtml;
  }

  /* ---------------- 近 14 天完成节点 ----------------
     数据源是项目节点表（不是报工）：已完成 + 完成日落在近 14 天。
     按负责人分组，组内按完成日倒序；组间按完成数倒序（数量优先，
     同数按姓名），这样一眼能看到最近谁在出货。 */
  var OWNER_COLORS = ['#6366f1', '#0ea5e9', '#14b8a6', '#f59e0b', '#ec4899',
    '#8b5cf6', '#10b981', '#f97316', '#64748b', '#e11d48'];

  /* 负责人头像色：按姓名哈希取色，与分组顺序无关，同人同色 */
  function ownerColor(name) {
    var h = 0, s = String(name || '');
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return OWNER_COLORS[Math.abs(h) % OWNER_COLORS.length];
  }

  /* 按期判定：完成日 vs 计划完成日。没排计划日的节点不评判 */
  function nodeTiming(n) {
    if (!n.planDate || !n.doneDate) return null;
    var gap = dayDiff(n.planDate, n.doneDate);   /* >0 = 比计划晚 */
    if (gap > 0) return { cls: 'late', txt: '拖 ' + gap + ' 天' };
    if (gap < 0) return { cls: 'on-time', txt: '提前 ' + (-gap) + ' 天' };
    return { cls: 'on-time', txt: '按期' };
  }

  function renderDoneNodes() {
    var box = $('#doneCard');
    if (!box) return;

    var days = [];
    for (var i = 13; i >= 0; i--) days.push(addDays(TODAY, -i));
    var start = days[0], end = days[13];

    var projById = {};
    S.projects.forEach(function (p) { projById[p.id] = p; });

    var done = [];
    S.nodes.forEach(function (n) {
      if (!n.done || !n.doneDate) return;
      if (n.doneDate < start || n.doneDate > end) return;
      done.push(n);
    });

    var head = '<div class="card-h"><h2>' + icon('check', 'ico-sm') + '近 14 天完成节点</h2>' +
      '<span class="muted tiny">' + escapeHtml(fmtMD(start)) + '–' + escapeHtml(fmtMD(end)) + ' · 按负责人汇总</span></div>';

    if (!done.length) {
      box.innerHTML = head + '<div class="empty">' +
        '<div class="e-ico">' + icon('check') + '</div>' +
        '<b>近 14 天还没有完成的节点</b>在「今日」把节点一键标成完成，这里就会按负责人自动汇总出来。</div>';
      return;
    }

    /* 每日完成节奏：14 根迷你柱，零增长的日子留灰底，缺口一眼可见 */
    var dayCount = {};
    days.forEach(function (d) { dayCount[d] = 0; });
    done.forEach(function (n) { dayCount[n.doneDate]++; });
    var maxDay = 0;
    days.forEach(function (d) { if (dayCount[d] > maxDay) maxDay = dayCount[d]; });

    var flowHtml = '<div class="dn-flow">' + days.map(function (d) {
      var c = dayCount[d];
      var h = c ? Math.max(5, Math.round(c / maxDay * 40)) : 2;
      return '<div class="dn-day' + (d === TODAY ? ' today' : '') + '" title="' +
        escapeHtml(fmtMD(d) + ' · ' + c + ' 个节点') + '">' +
        '<div class="dn-bar' + (c ? ' has' : ' zero') + '" style="height:' + h + 'px"></div>' +
        '<span class="dn-dnum">' + Number(d.split('-')[2]) + '</span>' +
        '</div>';
    }).join('') + '</div>';

    /* 摘要：总数 / 人数 / 按期拖期 */
    var byOwner = {};
    var onTime = 0, late = 0;
    done.forEach(function (n) {
      var key = n.owner || '未分配';
      (byOwner[key] = byOwner[key] || []).push(n);
      var t = nodeTiming(n);
      if (t) { if (t.cls === 'late') late++; else onTime++; }
    });

    var sumHtml = '<div class="dn-sum">' +
      '<span class="dn-chip brand">共 ' + done.length + ' 个节点</span>' +
      '<span class="dn-chip">' + Object.keys(byOwner).length + ' 位负责人</span>' +
      (onTime ? '<span class="dn-chip ok">按期 ' + onTime + '</span>' : '') +
      (late ? '<span class="dn-chip bad">拖期 ' + late + '</span>' : '') +
      '</div>';

    /* 负责人分组：组间按完成数倒序，组内按完成日倒序 */
    var groups = Object.keys(byOwner).map(function (k) {
      return {
        name: k,
        list: byOwner[k].slice().sort(function (a, b) {
          if (a.doneDate !== b.doneDate) return a.doneDate < b.doneDate ? 1 : -1;
          return (b.seq || 0) - (a.seq || 0);
        })
      };
    }).sort(function (a, b) {
      if (b.list.length !== a.list.length) return b.list.length - a.list.length;
      return a.name.localeCompare(b.name, 'zh');
    });

    var MAXROW = 6;
    var groupsHtml = groups.map(function (g) {
      var col = ownerColor(g.name);
      var rows = g.list.slice(0, MAXROW).map(function (n) {
        var p = projById[n.pid] || {};
        var t = nodeTiming(n);
        return '<div class="dn-row">' +
          '<span class="dn-rdot" style="background:' + escapeHtml(p.color || PALETTE[0]) + '"></span>' +
          '<div class="dn-rmain">' +
            '<div class="dn-rname" title="' + escapeHtml(n.name) + '">' + escapeHtml(n.name) + '</div>' +
            '<div class="dn-rsub">' + escapeHtml(p.name || '未知项目') + '</div>' +
          '</div>' +
          '<span class="dn-rdate">' + escapeHtml(fmtMD(n.doneDate)) + '</span>' +
          (t ? '<span class="chip ' + t.cls + '">' + escapeHtml(t.txt) + '</span>' : '') +
          '</div>';
      }).join('');
      var more = g.list.length > MAXROW
        ? '<div class="dn-more">还有 ' + (g.list.length - MAXROW) + ' 个…</div>' : '';
      return '<div class="dn-owner">' +
        '<div class="dn-oh">' +
          '<span class="dn-ava" style="background:' + col + '">' + escapeHtml(g.name.slice(0, 1)) + '</span>' +
          '<div class="dn-oid">' +
            '<div class="dn-oname">' + escapeHtml(g.name) + '</div>' +
            '<div class="dn-ometa">最近完成 ' + escapeHtml(fmtMD(g.list[0].doneDate)) + '</div>' +
          '</div>' +
          '<span class="dn-ocount">' + g.list.length + ' 个</span>' +
        '</div>' +
        '<div class="dn-list">' + rows + more + '</div>' +
        '</div>';
    }).join('');

    box.innerHTML = head +
      '<div class="dn-top">' + sumHtml +
        '<div class="dn-flowwrap"><span class="dn-flowt">每日完成</span>' + flowHtml + '</div>' +
      '</div>' +
      '<div class="dn-owners">' + groupsHtml + '</div>';
  }

  function renderBoard() {
    var grid = $('#boardGrid');
    if (!grid) return;

    if (!S.loaded) {
      grid.innerHTML = '<div class="card dn-card"><div class="skel" style="height:220px"></div></div>' +
        '<div class="card"><div class="skel" style="height:220px"></div></div>';
      return;
    }

    var html = ['<div class="card dn-card" id="doneCard"></div>'];
    grid.innerHTML = html.join('');
    renderDoneNodes();

    if (!S.projects.length) {
      var empty = document.createElement('div');
      empty.className = 'card';
      empty.innerHTML = '<div class="empty"><div class="e-ico">' + icon('board') + '</div>' +
        '<b>看板还没有项目</b>先在「今日」新建一个项目。</div>';
      grid.appendChild(empty);
      return;
    }

    var byPidLogs = {};
    S.logs.forEach(function (l) {
      if (!byPidLogs[l.pid]) byPidLogs[l.pid] = [];
      byPidLogs[l.pid].push(l);
    });

    sortedProjects().forEach(function (p) {
      var m = S.metrics[p.id] || {};
      var color = p.color || PALETTE[0];
      var logs = (byPidLogs[p.id] || []).slice().sort(function (a, b) {
        if (a.date === b.date) return String(b.id).localeCompare(String(a.id));
        return a.date < b.date ? 1 : -1;
      }).slice(0, 10);

      var ns = nodeStats(p.id);
      var cur = currentNode(p.id);
      var nodeStrip = '';
      var nodeList = nodesOf(p.id);
      if (nodeList.length) {
        nodeStrip =
          '<div class="node-strip">' +
            '<div class="ns-h">' +
              '<span>节点 <b>' + ns.done + '/' + ns.total + '</b> · 剩余 ' + (ns.total - ns.done) + ' 个</span>' +
              '<span>' + (cur ? (cur.planDate ? '下一节点 ' + escapeHtml(fmtMD(cur.planDate)) : '下一节点未排期') : '节点已全部完成') + '</span>' +
            '</div>' +
            ganttSVG(p, nodeList, {}) +
          '</div>';
      }

      var card = document.createElement('div');
      card.className = 'bcard';
      card.setAttribute('data-pid', p.id);

      var logsHtml = logs.length
        ? logs.map(function (l) {
            return '<div class="lg-row">' +
              '<span class="lg-date">' + escapeHtml(fmtMD(l.date)) + '</span>' +
              '<span class="lg-qty" style="color:' + escapeHtml(color) + '">' + (l.min ? fmtDays(l.min) : '—') + '</span>' +
              (l.backfill ? '<span class="chip back">补</span>' : '') +
              '<span class="lg-note">' + escapeHtml(l.note || '—') + '</span>' +
              '<button class="lg-del" data-act="del-log" data-id="' + escapeHtml(l.id) + '" aria-label="删除记录">' + icon('close', 'ico-sm') + '</button>' +
              '</div>';
          }).join('')
        : '<div class="tiny muted" style="padding:6px 0">还没有报工记录。</div>';

      card.innerHTML =
        '<div class="bar" style="background:' + escapeHtml(color) + '"></div>' +
        '<div class="b-in">' +
          '<div class="b-head">' +
            '<div class="ring">' + ringSVG(m.rate, color) +
              '<div class="ring-pct" style="color:' + (m.rate >= 1 ? 'var(--green)' : 'var(--ink)') + '">' + pct(m.rate) + '%</div>' +
            '</div>' +
            '<div class="b-title">' +
              '<h3>' + escapeHtml(p.name) + '</h3>' +
              '<div class="b-sub"><span class="chip stage-' + escapeHtml(p.stage || '设计') + '">' + escapeHtml(p.stage || '设计') + '</span>' +
                '<span>节点 ' + m.nodeDone + '/' + m.nodeTotal + '</span>' +
                '<span>截止 ' + escapeHtml(fmtMD(p.due)) + '</span>' +
                (m.overdue > 0 ? '<span class="chip late">逾期 ' + m.overdue + ' 天</span>' : '') +
              '</div>' +
            '</div>' +
          '</div>' +
          '<div class="b-nums">' +
            '<div class="b-num"><div class="n-l">已完成节点</div><div class="n-v">' + m.nodeDone + ' ÷ ' + m.nodeTotal +
              ' <small>个</small></div></div>' +
            '<div class="b-num"><div class="n-l">连续报工</div><div class="n-v' + (m.yStatus === 'broken' ? ' red' : '') + '">' +
              m.streak + ' <small>天</small></div></div>' +
            '<div class="b-num"><div class="n-l">预计完成日</div>' + etaCell(p, m) + '</div>' +
          '</div>' +
          nodeStrip +
          '<div class="b-plan">' + (p.block ? '<b>阻塞</b> ' + escapeHtml(p.block) : '') +
            (p.plan ? (p.block ? '<br>' : '') + '<b>预案</b> ' + escapeHtml(p.plan) : '') +
            (!p.block && !p.plan ? '<span class="muted">未填阻塞项与预案。</span>' : '') +
          '</div>' +
          '<div class="b-logs"><div class="lg-h"><span>最近报工</span><span>共 ' + (byPidLogs[p.id] || []).length + ' 条</span></div>' +
            logsHtml + '</div>' +
        '</div>';
      grid.appendChild(card);
    });
  }
