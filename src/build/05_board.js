
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

  function renderChart() {
    var box = $('#chartCard');
    if (!box) return;

    var days = [];
    for (var i = 13; i >= 0; i--) days.push(addDays(TODAY, -i));

    var byPid = buildIndex();
    var totals = days.map(function (d) {
      var t = 0;
      S.projects.forEach(function (p) {
        var rec = (byPid[p.id] || {})[d];
        if (rec) t += rec.min || 0;
      });
      return t;
    });
    var maxTotal = Math.max.apply(null, totals.concat([0]));

    var head = '<div class="card-h"><h2>' + icon('clock', 'ico-sm') + '近 14 天投入工时</h2>' +
      '<span class="muted tiny">' + escapeHtml(fmtMD(days[0])) + '–' + escapeHtml(fmtMD(days[13])) + ' · 分项目堆叠（单位：天）</span></div>';

    if (!maxTotal) {
      box.innerHTML = head + '<div class="empty" style="padding:26px 16px">' +
        '<b>还没有填写工时的记录</b>报工时填了「投入工时」，这里才会长出柱子。没填的记录不会被硬凑成柱子。</div>';
      return;
    }

    var W = 720, H = 216, padL = 36, padR = 8, padT = 12, padB = 28;
    var plotW = W - padL - padR, plotH = H - padT - padB;
    var slot = plotW / days.length;
    var barW = slot * 0.56;

    /* 纵轴按 0.5 天台阶取刻度，保证每条线都是半天倍数 */
    var maxDays = maxTotal / MIN_PER_DAY;
    var stepDays = 0.5;
    while (maxDays / stepDays > 5) stepDays = Math.round((stepDays + 0.5) * 2) / 2;
    var gridCount = Math.max(1, Math.ceil(maxDays / stepDays));
    var maxMin = gridCount * stepDays * MIN_PER_DAY;
    if (maxMin <= 0) { maxMin = HALF_DAY; gridCount = 1; stepDays = 0.5; }

    var parts = ['<svg class="chart-svg" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="近 14 天投入工时堆叠柱状图">'];

    /* 网格 */
    for (var g = 0; g <= gridCount; g++) {
      var y = padT + plotH - (plotH * g / gridCount);
      parts.push('<line x1="' + padL + '" y1="' + y.toFixed(1) + '" x2="' + (W - padR) + '" y2="' + y.toFixed(1) +
        '" stroke="#eef1f8" stroke-width="1"/>');
      parts.push('<text x="' + (padL - 7) + '" y="' + (y + 3.5).toFixed(1) + '" text-anchor="end" font-size="9" fill="#9aa3b8">' +
        (g * stepDays) + 'd</text>');
    }

    /* 柱子 */
    days.forEach(function (d, idx) {
      var x = padL + idx * slot + (slot - barW) / 2;
      var accH = 0;
      S.projects.forEach(function (p) {
        var rec = (byPid[p.id] || {})[d];
        var min = rec ? (rec.min || 0) : 0;
        if (!min) return;   /* 未填工时：不占高度 */
        var h = (min / maxMin) * plotH;
        var y = padT + plotH - accH - h;
        parts.push('<rect x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + barW.toFixed(1) +
          '" height="' + Math.max(1, h).toFixed(1) + '" rx="2.5" fill="' + escapeHtml(p.color || PALETTE[0]) + '">' +
          '<title>' + escapeHtml(p.name + ' · ' + fmtMD(d) + ' · ' + fmtDays(min)) + '</title></rect>');
        accH += h;
      });

      /* 当天合计标签只在最高那几根上标 */
      if (totals[idx] > 0) {
        var ty = padT + plotH - accH - 5;
        parts.push('<text x="' + (x + barW / 2).toFixed(1) + '" y="' + ty.toFixed(1) + '" text-anchor="middle" font-size="9" fill="#6b7590">' +
          (Math.round(totals[idx] / MIN_PER_DAY * 2) / 2) + '</text>');
      }

      parts.push('<text x="' + (x + barW / 2).toFixed(1) + '" y="' + (H - 9) + '" text-anchor="middle" font-size="9" fill="#9aa3b8">' +
        Number(d.split('-')[2]) + '</text>');
    });

    parts.push('<line x1="' + padL + '" y1="' + (padT + plotH) + '" x2="' + (W - padR) + '" y2="' + (padT + plotH) + '" stroke="#dfe5f2" stroke-width="1"/>');
    parts.push('</svg>');

    var legend = '<div class="legend">' + S.projects.map(function (p) {
      return '<span><i style="background:' + escapeHtml(p.color || PALETTE[0]) + '"></i>' + escapeHtml(p.name) + '</span>';
    }).join('') + '</div>';

    box.innerHTML = head + '<div class="chart-box">' + parts.join('') + '</div>' + legend;
  }

  function renderBoard() {
    var grid = $('#boardGrid');
    if (!grid) return;

    if (!S.loaded) {
      grid.innerHTML = '<div class="card chart-card"><div class="skel" style="height:200px"></div></div>' +
        '<div class="card"><div class="skel" style="height:220px"></div></div>';
      return;
    }

    var html = ['<div class="card chart-card" id="chartCard"></div>'];
    grid.innerHTML = html.join('');
    renderChart();

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
