
  /* ============================================================
     项目月报：按月挑出「真有进展」的节点，输出一页纸
     ------------------------------------------------------------
     判定口径（两条都算本月实际进度，分开呈现）：
       ① 节点完成日落在该月 —— 结果，写进项目明细
       ② 该月有报工         —— 过程，写在项目摘要行
     只筛「完成日」会漏掉投入了但没关节点的工作；
     只筛报工又会把「报工了却毫无产出」算成进展。所以两条取并集。
     ============================================================ */

  
  var MP_MAX_NODES = 5;     /* 每个项目最多列几行节点（横向双栏一页的预算） */

  var moMonth = '';         /* 当前月份 YYYY-MM */
  var moSel = null;         /* 选中的项目 id 数组；null = 未初始化（按全选） */
  var moSig = '';           /* 选项签名：变了才重建 select，避免打断键盘选择 */

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  function monthOf(d) { return d ? String(d).slice(0, 7) : ''; }

  function addMonths(mk, n) {
    var y = Number(mk.slice(0, 4));
    var m = Number(mk.slice(5, 7)) - 1 + n;
    y += Math.floor(m / 12);
    m = ((m % 12) + 12) % 12;
    return y + '-' + pad2(m + 1);
  }

  function monthText(mk) {
    var p = String(mk).split('-');
    return p[0] + ' 年 ' + Number(p[1]) + ' 月';
  }

  function monthBounds(mk) {
    var y = Number(mk.slice(0, 4)), m = Number(mk.slice(5, 7));
    var last = new Date(y, m, 0).getDate();   /* 下月第 0 天 = 本月最后一天 */
    return { start: mk + '-01', end: mk + '-' + pad2(last), days: last };
  }

  /* 紧凑日期：「10-23」，月报里比「10月23日」省地方 */
  function fmtMDc(d) {
    if (!d) return '—';
    var p = String(d).split('-');
    return pad2(Number(p[1])) + '-' + pad2(Number(p[2]));
  }

  /* 「计划 → 实际」对照：光给偏差天数（拖 6 天）读者得自己倒推原定哪天，
     所以把两个日期并排摆出来。没排计划日的节点计划侧留「—」，不编造。 */
  function fmtPlanActual(n) {
    return '<span class="d-pl">' + escapeHtml(n.planDate ? fmtMDc(n.planDate) : '—') + '</span>' +
      '<span class="d-ar">→</span>' +
      '<span class="d-ac">' + escapeHtml(fmtMDc(n.doneDate)) + '</span>';
  }

  /* 可选月份：数据里出现过的月份 + 最近 8 个月（保证空月份也能选来看） */
  function monthOptions() {
    var set = {};
    S.nodes.forEach(function (n) { if (n.doneDate) set[monthOf(n.doneDate)] = 1; });
    S.logs.forEach(function (l) { if (l.date) set[monthOf(l.date)] = 1; });
    var base = monthOf(TODAY) || '2026-01';
    set[base] = 1;
    for (var i = 1; i <= 8; i++) set[addMonths(base, -i)] = 1;
    return Object.keys(set).sort().reverse();
  }

  /* ---------------- 取数 ----------------
     sel = 项目 id 数组；null 表示不限（等价全选），[] 表示全不选 */
  function monthReport(mk, sel) {
    var projById = {}, byPid = {}, rows = [];
    S.projects.forEach(function (p) { projById[p.id] = p; });

    function bucket(p) {
      if (!byPid[p.id]) {
        byPid[p.id] = { p: p, nodes: [], logs: [], days: {}, min: 0, logDays: 0, delays: [] };
        rows.push(byPid[p.id]);
      }
      return byPid[p.id];
    }

    S.nodes.forEach(function (n) {
      if (!n.done || !n.doneDate || monthOf(n.doneDate) !== mk) return;
      var p = projById[n.pid];
      if (p) bucket(p).nodes.push(n);
    });

    S.logs.forEach(function (l) {
      if (!l.date || monthOf(l.date) !== mk) return;
      var p = projById[l.pid];
      if (!p) return;
      var r = bucket(p);
      r.logs.push(l);
      r.days[l.date] = 1;
      r.min += (l.min || 0);
    });

    /* 本月登记的延期：节点哪怕已经完成，也要在月报里留痕 */
    S.nodes.forEach(function (n) {
      if (!n.delayDate || monthOf(n.delayDate) !== mk) return;
      var p = projById[n.pid];
      if (p) bucket(p).delays.push(n);
    });

    if (sel) {
      var keep = {};
      sel.forEach(function (id) { keep[id] = 1; });
      rows = rows.filter(function (r) { return !!keep[r.p.id]; });
    }

    rows.forEach(function (r) {
      r.nodes.sort(function (a, b) {
        if (a.doneDate === b.doneDate) return (a.seq || 0) - (b.seq || 0);
        return a.doneDate < b.doneDate ? -1 : 1;
      });
      r.logDays = Object.keys(r.days).length;
    });

    /* 有节点关闭的排前面（那是硬结果），其次报工天数多的 */
    rows.sort(function (a, b) {
      if (!!b.nodes.length !== !!a.nodes.length) return b.nodes.length ? 1 : -1;
      if (b.nodes.length !== a.nodes.length) return b.nodes.length - a.nodes.length;
      if (b.logDays !== a.logDays) return b.logDays - a.logDays;
      return String(a.p.name).localeCompare(String(b.p.name), 'zh');
    });

    var sum = { nodes: 0, projs: rows.length, logDays: 0, min: 0, onTime: 0, late: 0, doneProjs: 0, rate: null, delays: 0 };
    rows.forEach(function (r) {
      sum.nodes += r.nodes.length;
      sum.logDays += r.logDays;
      sum.delays += r.delays.length;
      sum.min += r.min;
      if (r.nodes.length) sum.doneProjs++;
      r.nodes.forEach(function (n) {
        var t = nodeTiming(n);
        if (!t) return;
        if (t.cls === 'late') sum.late++; else sum.onTime++;
      });
    });
    var judged = sum.onTime + sum.late;
    sum.rate = judged ? sum.onTime / judged : null;

    return { mk: mk, rows: rows, sum: sum };
  }

  /* ---------------- 一页纸 ---------------- */
  function mpKpi(val, label) {
    return '<div class="mp-kpi"><b>' + escapeHtml(String(val)) + '</b><span>' + escapeHtml(label) + '</span></div>';
  }

  function mpProjBlock(r) {
    var p = r.p;
    var m = S.metrics[p.id] || {};
    var nodes = r.nodes;

    var head = '<div class="mp-ph">' +
      '<span class="mp-dot" style="background:' + escapeHtml(p.color || PALETTE[0]) + '"></span>' +
      '<b class="mp-pn">' + escapeHtml(p.name) + '</b>' +
      (p.stage ? '<span class="mp-tag">' + escapeHtml(p.stage) + '</span>' : '') +
      '<span class="mp-prog">' +
        (m.nodeTotal
          ? '节点 ' + (m.nodeDone || 0) + '/' + m.nodeTotal + ' · ' + pct(m.rate || 0) + '%'
          : '未拆节点') +
      '</span>' +
      '</div>';

    var listHtml = '';
    if (nodes.length) {
      var shown = nodes.slice(0, MP_MAX_NODES);
      listHtml = '<table class="mp-nodes">' + shown.map(function (n) {
        var t = nodeTiming(n);
        return '<tr>' +
          '<td class="c-d">' + fmtPlanActual(n) + '</td>' +
          '<td class="c-n">' + escapeHtml(n.name) + '</td>' +
          '<td class="c-o">' + escapeHtml(n.owner || '') + '</td>' +
          '<td class="c-t">' + (t ? '<span class="mp-chip ' + t.cls + '">' + escapeHtml(t.txt) + '</span>' : '') + '</td>' +
          '</tr>';
      }).join('') + '</table>';
      if (nodes.length > MP_MAX_NODES) {
        listHtml += '<div class="mp-more">另有 ' + (nodes.length - MP_MAX_NODES) + ' 个节点本月完成</div>';
      }
    }

    /* 月报只讲节点产出，不摆报工数据；只有投入没关节点的项目给一句定性说明 */
    var brief = [];
    if (!nodes.length) brief.push('本月有投入，未关节点');
    if (p.block) brief.push('阻塞：' + p.block);
    if (p.plan) brief.push('预案：' + p.plan);
    var briefHtml = brief.length
      ? '<div class="mp-brief">' + brief.map(function (s) { return escapeHtml(s); }).join('　·　') + '</div>'
      : '';

    /* 延期单独一行标红：这是「该完成却推走了」的事实，不跟简报混在一起 */
    var delayHtml = '';
    if (r.delays && r.delays.length) {
      delayHtml = '<div class="mp-delay">' + r.delays.map(function (n) {
        return '<span class="mp-dl"><b>延期</b> ' + escapeHtml(n.name) + ' ' +
          (n.origPlanDate ? escapeHtml(fmtMDc(n.origPlanDate)) + ' → ' : '') +
          escapeHtml(fmtMDc(n.planDate)) +
          '（' + escapeHtml(n.delayReason || '未填理由') + '）</span>';
      }).join('') + '</div>';
    }

    return '<div class="mp-proj">' + head + listHtml + delayHtml + briefHtml + '</div>';
  }

  /* 每页放几个项目：2 栏 × 2 行。横向 A4 单栏实测只够两块，
     再多浏览器会把表格挤到下一页 —— 所以显式分页，宁可多一页也不省略项目。 */
  var MP_PER_PAGE = 6;          /* 每页最多几个项目 */
  var MP_LINES_PER_PAGE = 16;   /* 每页最多几行节点：光看项目数会撑破纸 */

  /* 按「项目数 + 节点行数」双限装箱，避免 6 个 5 行的项目把一页顶爆 */
  function paginateProjects(rows) {
    var pages = [], cur = [], lines = 0;
    rows.forEach(function (r) {
      /* 延期行也占高度，按 1 行节点计，避免带延期的项目把纸顶爆 */
      var ln = Math.min(r.nodes.length, MP_MAX_NODES) + Math.min(r.delays ? r.delays.length : 0, 3);
      if (cur.length && (cur.length >= MP_PER_PAGE || lines + ln > MP_LINES_PER_PAGE)) {
        pages.push(cur);
        cur = [];
        lines = 0;
      }
      cur.push(r);
      lines += ln;
    });
    if (cur.length) pages.push(cur);
    return pages;
  }

  function monthSheetHtml(rows, rep, pageNo, pageTotal) {
    var bd = monthBounds(rep.mk);
    var s = rep.sum;

    var head;
    if (pageNo === 1) {
      head = '<div class="mp-head">' +
        '<div class="mp-tt"><h2>项目进展月报</h2>' +
          '<div class="mp-mk">' + escapeHtml(monthText(rep.mk)) + '</div></div>' +
        '<div class="mp-meta">' +
          '<div><span>统计区间</span><b>' + escapeHtml(fmtMDc(bd.start)) + ' – ' + escapeHtml(fmtMDc(bd.end)) + '</b></div>' +
          '<div><span>输出日期</span><b>' + escapeHtml(fmtMDc(TODAY)) + '</b></div>' +
        '</div>' +
      '</div>' +
      '<div class="mp-kpis">' +
        mpKpi(s.nodes, '完成节点') +
        mpKpi(s.doneProjs, '有产出项目') +
        mpKpi(s.rate == null ? '—' : pct(s.rate) + '%', '按期率') +
      '</div>';
    } else {
      head = '<div class="mp-head mp-head-mini">' +
        '<div class="mp-tt"><h2>项目进展月报</h2>' +
          '<div class="mp-mk">' + escapeHtml(monthText(rep.mk)) + ' · 续</div></div>' +
        '<div class="mp-meta">' +
          '<div><span>统计区间</span><b>' + escapeHtml(fmtMDc(bd.start)) + ' – ' + escapeHtml(fmtMDc(bd.end)) + '</b></div>' +
        '</div>' +
      '</div>';
    }

    /* 两栏用 table 而不是 flex/multi-column：
       打印引擎对 table 的分页最可预测，flex 和 column 在打印上下文里都试过、
       都会把半页内容拆成两页。 */
    var half = Math.ceil(rows.length / 2);
    var cols = '<table class="mp-body"><tr>' +
      '<td class="mp-col">' + rows.slice(0, half).map(mpProjBlock).join('') + '</td>' +
      '<td class="mp-col">' + rows.slice(half).map(mpProjBlock).join('') + '</td>' +
      '</tr></table>';

    var foot = '<div class="mp-foot">' +
      escapeHtml(rep.mk.slice(0, 4) + ' 年 ' + Number(rep.mk.slice(5, 7)) + ' 月') +
      ' · 口径：节点完成日落在本月 · 日期列为「计划 → 实际」· 按期 = 实际不晚于计划 · 研发推进中台生成' +
      (pageTotal > 1 ? '　·　第 ' + pageNo + ' / ' + pageTotal + ' 页' : '') +
    '</div>';

    return '<div class="mp-sheet">' + head + cols + foot + '</div>';
  }

  function monthPaperHtml(rep) {
    if (!rep.rows.length) {
      return '<div class="mp-sheet">' +
        '<div class="mp-head mp-head-mini">' +
          '<div class="mp-tt"><h2>项目进展月报</h2>' +
            '<div class="mp-mk">' + escapeHtml(monthText(rep.mk)) + '</div></div>' +
        '</div>' +
        '<div class="mp-empty">本月没有记录到实际进度。<br>' +
          '<span>节点在「完成」时会写完成日，完成日落在本月就会出现在这里。</span></div>' +
      '</div>';
    }

    var chunks = paginateProjects(rep.rows);
    return chunks.map(function (rows, i) {
      return monthSheetHtml(rows, rep, i + 1, chunks.length);
    }).join('');
  }

  /* ---------------- 渲染 ---------------- */
  function renderMonth() {
    var box = $('#monthPaper');
    if (!box) return;

    if (!S.loaded) {
      box.innerHTML = '<div class="mp-empty">正在读取数据…</div>';
      return;
    }

    var months = monthOptions();
    if (!moMonth || months.indexOf(moMonth) < 0) moMonth = months[0];

    var projects = sortedProjects();
    var allIds = projects.map(function (p) { return p.id; });

    /* 首次进入默认全选；之后只剔除已删掉的项目，新增项目默认不勾（同 Excel 筛选） */
    if (moSel === null) {
      moSel = allIds.slice();
    } else {
      var exist = {};
      allIds.forEach(function (id) { exist[id] = 1; });
      moSel = moSel.filter(function (id) { return exist[id]; });
    }

    var sig = months.join(',') + '|' + allIds.join(',');
    if (sig !== moSig) {
      moSig = sig;
      var mm = $('#moMonth');
      if (mm) {
        mm.innerHTML = months.map(function (k) {
          return '<option value="' + k + '">' + monthText(k) + '</option>';
        }).join('');
      }
    }
    if ($('#moMonth')) $('#moMonth').value = moMonth;

    renderProjPicker(projects);

    var rep = monthReport(moMonth, moSel);
    if (!moSel.length && projects.length) {
      box.innerHTML = '<div class="mp-empty">没有勾选任何项目。<br>' +
        '<span>点上面的「项目」下拉，勾上要进月报的项目（或直接「全选」）。</span></div>';
    } else {
      box.innerHTML = monthPaperHtml(rep);
    }

    var stat = $('#moStat');
    if (stat) {
      if (!moSel.length && projects.length) {
        stat.innerHTML = '<span class="muted">未选择项目</span>';
      } else {
        stat.innerHTML = rep.rows.length
          ? '<b>' + rep.sum.nodes + '</b> 个节点完成 · <b>' + rep.sum.projs + '</b> 个项目有进展'
          : '<span class="muted">本月没有可统计的进度</span>';
      }
    }

    fitMonthPaper();
  }

  /* 预览自适应：横向 A4（297mm）比内容区宽，按容器宽度等比缩放，
     保证一眼看到整页而不是只看到左边四分之三。窄屏交给 CSS 的 100% 宽度。 */
  function fitMonthPaper() {
    var stage = $('.mo-stage'), paper = $('#monthPaper');
    if (!stage || !paper) return;
    paper.style.zoom = '';
    if (window.innerWidth <= 900) return;
    var avail = stage.clientWidth - 36;      /* 减去 .mo-stage 左右 padding */
    var sheet = paper.querySelector('.mp-sheet') || paper;
    var w = sheet.offsetWidth;
    if (avail > 0 && w > avail) paper.style.zoom = Math.max(0.4, avail / w);
  }

  /* 项目多选：Excel 式，全选 / 单勾都行，勾选直接决定月报里出现哪些项目 */
  function renderProjPicker(projects) {
    var listEl = $('#moProjList');
    if (!listEl) return;

    var selMap = {};
    moSel.forEach(function (id) { selMap[id] = 1; });

    var sc = listEl.scrollTop;
    listEl.innerHTML = projects.length
      ? projects.map(function (p) {
          return '<label class="mo-ms-item" title="' + escapeHtml(p.name) + '">' +
            '<input type="checkbox" value="' + escapeHtml(p.id) + '"' + (selMap[p.id] ? ' checked' : '') + '>' +
            '<i class="mo-ms-dot" style="background:' + escapeHtml(p.color || PALETTE[0]) + '"></i>' +
            '<span class="mo-ms-name">' + escapeHtml(p.name) + '</span>' +
          '</label>';
        }).join('')
      : '<div class="mo-ms-empty">还没有项目</div>';
    listEl.scrollTop = sc;   /* 重绘不打断滚动 */

    var all = projects.length, on = moSel.length;
    var label = $('#moProjLabel');
    if (label) {
      label.textContent = (all && on === all) ? '全部项目（' + all + '）'
        : (on === 0 ? '未选项目' : '已选 ' + on + ' / ' + all);
    }
    var allBox = $('#moProjAll');
    if (allBox) {
      allBox.checked = all > 0 && on === all;
      /* 半选态：原生 checkbox 只能用 JS 设 indeterminate */
      allBox.indeterminate = on > 0 && on < all;
    }
  }

  /* ---------------- 输出一页纸 ----------------
     走浏览器打印：@media print 里只留 #panel-month 的纸张，
     A4 / 无边距溢出，用户选「另存为 PDF」即得单页 PDF。 */
  function printMonth() {
    if (!S.loaded) { toast('数据还没加载完', 'err'); return; }
    document.body.classList.add('printing-month');
    try { window.print(); } catch (e) { /* 某些环境不支持，忽略 */ }
    setTimeout(function () {
      document.body.classList.remove('printing-month');
    }, 1200);
  }

  /* ---------------- 导出 PPTX ----------------
     一页 16:9，所有要素都是原生文本框 / 表格 / 形状，
     导出后在 PowerPoint 里每个字都能直接改，不是截图。
     依赖 local/vendor/pptxgen.bundle.js（本地文件，断网可用）。 */
  function hexColor(c) {
    return String(c || '#6366F1').replace('#', '').toUpperCase();
  }

  function pptxFileName(rep) {
    return '项目进展月报_' + rep.mk.slice(0, 4) + '年' + Number(rep.mk.slice(5, 7)) + '月.pptx';
  }

  function exportPptx() {
    if (!S.loaded) { toast('数据还没加载完', 'err'); return; }
    if (typeof PptxGenJS === 'undefined') {
      toast('PPT 组件没加载成功，刷新页面再试', 'err');
      return;
    }

    var rep = monthReport(moMonth, moSel);
    var pptx = new PptxGenJS();
    pptx.defineLayout({ name: 'MONTH', width: 13.333, height: 7.5 });
    pptx.layout = 'MONTH';

    var C = {
      ink: '1F2437', ink2: '5A6478', ink3: '8A94AB',
      brand: '6366F1', teal: '14B8A6', purple: '8B5CF6',
      green: '047857', red: 'BE123C', line: 'DFE4F0', tag: '4F46E5'
    };
    var FACE = 'Microsoft YaHei';
    var W = 13.333, PAD = 0.5, CW = W - PAD * 2;

    /* ---------- 分页：能放几个放几个，放不下续一页 ---------- */
    var COLW = (CW - 0.4) / 2;
    var LX = PAD, RX = PAD + COLW + 0.4;
    var PAGE_BOTTOM = 6.95;
    var TOP_FIRST = 2.42;   /* 首页顶部要给标题 + KPI 留位置 */
    var TOP_NEXT = 1.42;    /* 续页只放一行小标题 */
    var GAP = 0.16;
    var PPT_NODES = 8;      /* 单块最多列几个节点，再多一栏也放不下 */

    var bd = monthBounds(rep.mk);

    function blockParts(r) {
      var p = r.p, nodes = r.nodes, parts = [];
      if (!nodes.length) parts.push('本月有投入，未关节点');
      if (p.block) parts.push('阻塞：' + p.block);
      if (p.plan) parts.push('预案：' + p.plan);
      return parts;
    }

    function blockH(r) {
      var shown = Math.min(r.nodes.length, PPT_NODES);
      var h = 0.3 + shown * 0.22;
      if (r.nodes.length > shown) h += 0.2;
      if (blockParts(r).length) h += 0.26;
      if (r.delays && r.delays.length) h += 0.2 * Math.min(r.delays.length, 2);
      return h + GAP;
    }

    /* 装箱：首页左栏 → 首页右栏 → 续页左栏 → 续页右栏 … */
    var pages = [], pg = null, ci = 0, used = 0, avail = 0;

    function startPage(first) {
      pg = { cols: [[], []] };
      pages.push(pg);
      ci = 0;
      used = 0;
      avail = PAGE_BOTTOM - (first ? TOP_FIRST : TOP_NEXT);
    }

    startPage(true);
    rep.rows.forEach(function (r) {
      var h = blockH(r);
      if (used + h > avail) {
        if (ci === 0) { ci = 1; used = 0; }
        else { startPage(false); }
      }
      pg.cols[ci].push(r);
      used += h;
    });

    function drawHeader(sl, idx) {
      if (idx === 0) {
        sl.addText('项目进展月报', {
          x: PAD, y: 0.3, w: 6, h: 0.55, fontSize: 30, bold: true, color: C.ink, fontFace: FACE
        });
        sl.addText(monthText(rep.mk), {
          x: PAD + 0.02, y: 0.82, w: 5, h: 0.32, fontSize: 13, color: C.ink2, fontFace: FACE
        });
        sl.addText([
          { text: '统计区间  ', options: { color: C.ink3 } },
          { text: fmtMDc(bd.start) + ' – ' + fmtMDc(bd.end), options: { color: C.ink, bold: true } },
          { text: '     输出日期  ', options: { color: C.ink3 } },
          { text: fmtMDc(TODAY), options: { color: C.ink, bold: true } }
        ], { x: W - PAD - 4.6, y: 0.36, w: 4.6, h: 0.26, fontSize: 9, align: 'right', fontFace: FACE });
        sl.addShape(pptx.ShapeType.line, { x: PAD, y: 1.14, w: CW, h: 0, line: { color: C.ink, width: 1.5 } });

        var sm = rep.sum;
        var kpis = [
          [String(sm.nodes), '完成节点', C.brand],
          [String(sm.doneProjs), '有产出项目', C.teal],
          [sm.rate == null ? '—' : pct(sm.rate) + '%', '按期率', C.purple]
        ];
        var kw = (CW - 0.5) / 3;
        kpis.forEach(function (k, i) {
          var x = PAD + i * (kw + 0.25);
          sl.addShape(pptx.ShapeType.rect, {
            x: x, y: 1.32, w: kw, h: 0.92, fill: { color: 'F5F7FC' }, line: { color: 'F5F7FC' }
          });
          sl.addShape(pptx.ShapeType.rect, {
            x: x, y: 1.32, w: 0.055, h: 0.92, fill: { color: k[2] }, line: { color: k[2] }
          });
          sl.addText(k[0], {
            x: x + 0.18, y: 1.38, w: kw - 0.3, h: 0.44, fontSize: 22, bold: true, color: C.ink, fontFace: FACE
          });
          sl.addText(k[1], {
            x: x + 0.18, y: 1.84, w: kw - 0.3, h: 0.26, fontSize: 10, color: C.ink3, fontFace: FACE
          });
        });
      } else {
        sl.addText([
          { text: '项目进展月报', options: { bold: true, fontSize: 16, color: C.ink } },
          { text: '   ' + monthText(rep.mk) + ' · 续', options: { fontSize: 11, color: C.ink2 } }
        ], { x: PAD, y: 0.4, w: 8, h: 0.36, fontFace: FACE, valign: 'middle' });
        sl.addText([
          { text: '统计区间  ', options: { color: C.ink3 } },
          { text: fmtMDc(bd.start) + ' – ' + fmtMDc(bd.end), options: { color: C.ink, bold: true } }
        ], { x: W - PAD - 4.6, y: 0.44, w: 4.6, h: 0.26, fontSize: 9, align: 'right', fontFace: FACE });
        sl.addShape(pptx.ShapeType.line, { x: PAD, y: 0.95, w: CW, h: 0, line: { color: C.ink, width: 1.2 } });
      }
    }

    function drawFooter(sl, idx) {
      sl.addShape(pptx.ShapeType.line, {
        x: PAD, y: PAGE_BOTTOM, w: CW, h: 0, line: { color: C.line, width: 1 }
      });
      sl.addText('口径：节点完成日落在本月 · 日期列为「计划 → 实际」· 按期 = 实际不晚于计划 · 研发推进中台生成', {
        x: PAD, y: PAGE_BOTTOM + 0.06, w: CW - 1.3, h: 0.22, fontSize: 7.5, color: C.ink3, fontFace: FACE
      });
      if (pages.length > 1) {
        sl.addText('第 ' + (idx + 1) + ' / ' + pages.length + ' 页', {
          x: W - PAD - 1.2, y: PAGE_BOTTOM + 0.06, w: 1.2, h: 0.22, fontSize: 7.5,
          color: C.ink3, align: 'right', fontFace: FACE
        });
      }
    }

    function drawProj(sl, r, x, y, w) {
      var p = r.p, m = S.metrics[p.id] || {};
      var nodes = r.nodes;

      sl.addShape(pptx.ShapeType.rect, {
        x: x, y: y + 0.095, w: 0.075, h: 0.075,
        fill: { color: hexColor(p.color) }, line: { color: hexColor(p.color) }
      });
      sl.addText([
        { text: p.name, options: { bold: true, fontSize: 14, color: C.ink } },
        { text: p.stage ? '   ' + p.stage : '', options: { fontSize: 9.5, color: C.tag } }
      ], { x: x + 0.15, y: y, w: w - 1.9, h: 0.24, fontFace: FACE, valign: 'middle' });

      sl.addText(
        m.nodeTotal
          ? '节点 ' + (m.nodeDone || 0) + '/' + m.nodeTotal + ' · ' + pct(m.rate || 0) + '%'
          : '未拆节点',
        { x: x + w - 1.75, y: y, w: 1.75, h: 0.24, fontSize: 9.5, color: C.ink3,
          align: 'right', fontFace: FACE, valign: 'middle' }
      );

      var y2 = y + 0.3;
      if (nodes.length) {
        var shown = nodes.slice(0, PPT_NODES);
        var rows = shown.map(function (n) {
          var t = nodeTiming(n);
          return [
            { text: (n.planDate ? fmtMDc(n.planDate) : '—') + ' → ' + fmtMDc(n.doneDate),
              options: { color: C.ink2, fontFace: FACE } },
            { text: n.name, options: { color: C.ink, fontFace: FACE } },
            { text: n.owner || '', options: { color: C.ink3, fontFace: FACE, fontSize: 8.5 } },
            { text: t ? t.txt : '', options: { color: t && t.cls === 'late' ? C.red : C.green,
              bold: true, align: 'right', fontFace: FACE, fontSize: 8.5 } }
          ];
        });
        sl.addTable(rows, {
          x: x, y: y2, w: w, h: shown.length * 0.22,
          colW: [1.18, w - 2.66, 0.76, 0.72],
          rowH: 0.22, fontSize: 9.5, valign: 'middle', margin: 0.03,
          autoPage: false,   /* 关掉自动分页：它会重算行高，把表格撑成 1 英寸 */
          border: { type: 'solid', color: 'F0F3FA', pt: 0.5 }
        });
        y2 += shown.length * 0.22;
        if (nodes.length > shown.length) {
          sl.addText('另有 ' + (nodes.length - shown.length) + ' 个节点本月完成', {
            x: x, y: y2, w: w, h: 0.2, fontSize: 7.5, color: C.ink3, fontFace: FACE
          });
          y2 += 0.2;
        }
      }

      /* 延期行：PPT 里也标红，最多两行 */
      var dl = r.delays || [];
      var dlLines = Math.min(dl.length, 2);
      for (var di = 0; di < dlLines; di++) {
        sl.addText('延期 ' + dl[di].name + ' ' +
          (dl[di].origPlanDate ? fmtMDc(dl[di].origPlanDate) + ' → ' : '') + fmtMDc(dl[di].planDate) +
          '（' + (dl[di].delayReason || '未填理由') + '）' +
          (di === dlLines - 1 && dl.length > dlLines ? '  等 ' + dl.length + ' 项' : ''), {
          x: x, y: y2, w: w, h: 0.2, fontSize: 8, color: C.red, fontFace: FACE
        });
        y2 += 0.2;
      }

      var parts = blockParts(r);
      if (parts.length) {
        sl.addText(parts.join('   ·   '), {
          x: x, y: y2 + 0.02, w: w, h: 0.24, fontSize: 9, color: C.ink2, fontFace: FACE
        });
        y2 += 0.26;
      }
      return y2 - y + GAP;
    }

    if (!rep.rows.length) {
      var empty = pptx.addSlide();
      empty.background = { color: 'FFFFFF' };
      drawHeader(empty, 0);
      empty.addText('本月没有记录到实际进度。', {
        x: PAD, y: 3.6, w: CW, h: 0.5, fontSize: 14, color: C.ink3,
        align: 'center', fontFace: FACE
      });
      drawFooter(empty, 0);
    } else {
      pages.forEach(function (p, pi) {
        var sl = pptx.addSlide();
        sl.background = { color: 'FFFFFF' };
        drawHeader(sl, pi);
        var top = pi === 0 ? TOP_FIRST : TOP_NEXT;
        p.cols.forEach(function (items, k) {
          var y = top;
          items.forEach(function (r) { y += drawProj(sl, r, k ? RX : LX, y, COLW); });
        });
        drawFooter(sl, pi);
      });
    }

    var name = pptxFileName(rep);
    setSync('busy');
    pptx.writeFile({ fileName: name }).then(function () {
      setSync('ok');
      toast('已导出 ' + name, 'ok');
    }).catch(function (err) {
      setSync('off', '导出失败：没能生成 PPT 文件。');
      toast('导出 PPT 失败，请重试', 'err');
      if (window.console) console.error('[pptx] export failed', err);
    });
  }

  function toggleProjPanel(open) {
    var panel = $('#moProjPanel'), btn = $('#moProjBtn');
    if (!panel || !btn) return;
    var on = (open == null) ? !panel.classList.contains('on') : !!open;
    panel.classList.toggle('on', on);
    btn.setAttribute('aria-expanded', on ? 'true' : 'false');
  }

  function bindMonthEvents() {
    var mm = $('#moMonth'), pb = $('#moPrint'), pbPpt = $('#moPpt');
    if (mm) mm.addEventListener('change', function () { moMonth = this.value; renderMonth(); });
    if (pb) pb.addEventListener('click', printMonth);
    if (pbPpt) pbPpt.addEventListener('click', exportPptx);

    var btn = $('#moProjBtn');
    if (btn) btn.addEventListener('click', function (e) { e.stopPropagation(); toggleProjPanel(); });

    /* 面板内的点击不要冒泡到 document（否则刚点开就被关掉） */
    var panel = $('#moProjPanel');
    if (panel) panel.addEventListener('click', function (e) { e.stopPropagation(); });

    var list = $('#moProjList');
    if (list) list.addEventListener('change', function (e) {
      var cb = e.target;
      if (!cb || cb.type !== 'checkbox') return;
      var i = moSel.indexOf(cb.value);
      if (cb.checked && i < 0) moSel.push(cb.value);
      else if (!cb.checked && i >= 0) moSel.splice(i, 1);
      renderMonth();
    });

    var allBox = $('#moProjAll');
    if (allBox) allBox.addEventListener('change', function () {
      moSel = this.checked ? sortedProjects().map(function (p) { return p.id; }) : [];
      renderMonth();
    });

    var clear = $('#moProjClear');
    if (clear) clear.addEventListener('click', function () { moSel = []; renderMonth(); });

    /* 点别处收起面板 */
    document.addEventListener('click', function () { toggleProjPanel(false); });

    window.addEventListener('resize', function () {
      if (S.tab === 'month') fitMonthPaper();
    });

    window.addEventListener('afterprint', function () {
      document.body.classList.remove('printing-month');
    });
  }
