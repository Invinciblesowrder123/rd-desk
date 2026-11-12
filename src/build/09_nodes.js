
  /* ============================================================
     项目节点：计划 + 一键完成（完成即记一次报工）
     ============================================================ */
  var TBL_NODE = '1urnMOWB0VL3RL0pNiNILG';

  function nodesOf(pid) {
    var list = S.nodes.filter(function (n) { return n.pid === pid; });
    list.sort(function (a, b) {
      if (a.seq !== b.seq) return a.seq - b.seq;
      if (a.planDate && b.planDate) return a.planDate < b.planDate ? -1 : 1;
      return 0;
    });
    return list;
  }

  function nodeStats(pid) {
    var list = nodesOf(pid), done = 0;
    list.forEach(function (n) { if (n.done) done++; });
    return { total: list.length, done: done, list: list };
  }

  /* ---------------- 节点甘特图 ----------------
     每根条 = 一个节点：按「计划完成日 - 预计工时」推算起止，横轴为日历
     done=绿；过计划日未完成=红；下一节点=紫；其余=项目色 */
  function nodeBar(n) {
    var end = n.planDate || n.doneDate || TODAY;
    var len = Math.max(1, Math.ceil(n.hours || 1));
    /* 工期含首尾：3 天且 10-29 完成 → 10-27 开始 */
    return { start: addDays(end, -(len - 1)), end: end };
  }

  function ganttSVG(p, nodes, opts) {
    opts = opts || {};
    var compact = !!opts.compact;
    if (!nodes || !nodes.length) return '';

    var minD = TODAY, maxD = TODAY;
    nodes.forEach(function (n) {
      var r = nodeBar(n);
      if (r.start < minD) minD = r.start;
      if (r.end > maxD) maxD = r.end;
      if (n.doneDate && n.doneDate > maxD) maxD = n.doneDate;
    });
    if (p.due) {
      if (p.due > maxD) maxD = p.due;
      if (p.due < minD) minD = p.due;
    }
    minD = addDays(minD, -1);
    maxD = addDays(maxD, 1);
    if (dayDiff(minD, maxD) < 9) maxD = addDays(minD, 9);
    var span = dayDiff(minD, maxD) + 1;

    /* 并联节点按开始日排布，视觉上呈阶梯；标签仍用节点序号 */
    var ordered = nodes.map(function (n) {
      return { n: n, bar: nodeBar(n) };
    }).sort(function (a, b) {
      if (a.bar.start !== b.bar.start) return a.bar.start < b.bar.start ? -1 : 1;
      return (a.n.seq || 0) - (b.n.seq || 0);
    });

    var maxRows = compact ? 5 : 8;
    var rows = ordered.slice(0, maxRows);
    var extra = ordered.length - rows.length;

    var rowH = compact ? 12 : 17;
    var padL = compact ? 4 : 88;
    var padR = 6;
    var padT = 4;
    /* 有未显示节点时底部多留一行，避免 +N 与两端日期挤在同一基线 */
    var padB = compact ? (extra > 0 ? 22 : 12) : (extra > 0 ? 26 : 18);
    var W = compact ? 320 : 560;
    var H = padT + rows.length * rowH + padB;
    var dayW = (W - padL - padR) / span;

    function xLeft(d) { return padL + dayDiff(minD, d) * dayW; }
    function xMid(d) { return xLeft(d) + dayW / 2; }

    var nextId = (currentNode(p.id) || {}).id;
    var parts = ['<svg class="gantt" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' +
      escapeHtml(p.name + ' 节点甘特图') + '">'];

    /* 周刻度网格：每 7 天一格 */
    for (var g = 0; g <= span; g += 7) {
      var gx = xLeft(addDays(minD, g));
      parts.push('<line x1="' + gx.toFixed(1) + '" y1="' + padT + '" x2="' + gx.toFixed(1) + '" y2="' +
        (H - padB) + '" stroke="#eef1f8" stroke-width="1"/>');
      if (!compact) {
        parts.push('<text x="' + gx.toFixed(1) + '" y="' + (H - 5) + '" text-anchor="middle" font-size="9" fill="#9aa3b8">' +
          Number(addDays(minD, g).split('-')[2]) + '</text>');
      }
    }

    /* 项目截止线 */
    if (p.due) {
      var dx = xMid(p.due);
      var late = p.due < TODAY;
      parts.push('<line x1="' + dx.toFixed(1) + '" y1="' + padT + '" x2="' + dx.toFixed(1) + '" y2="' + (H - padB) +
        '" stroke="' + (late ? '#e11d48' : '#059669') + '" stroke-width="1" stroke-dasharray="3 3" opacity=".55"/>');
    }

    /* 今天 */
    var tx = xMid(TODAY);
    parts.push('<line x1="' + tx.toFixed(1) + '" y1="' + padT + '" x2="' + tx.toFixed(1) + '" y2="' + (H - padB) +
      '" stroke="#6366f1" stroke-width="1.4" opacity=".85"/>');
    if (!compact) {
      parts.push('<text x="' + tx.toFixed(1) + '" y="' + (padT + 8) + '" text-anchor="middle" font-size="8" fill="#6366f1">今天</text>');
    }

    /* 节点条 */
    rows.forEach(function (item, i) {
      var n = item.n;
      var r = item.bar;
      var y = padT + i * rowH + 2;
      var hgt = rowH - 5;
      var x1 = xLeft(r.start);
      var w = Math.max(dayW * 0.9, (dayDiff(r.start, r.end) + 1) * dayW);
      var fill = p.color || '#6366f1';
      var op = '0.5';
      if (n.done) { fill = '#059669'; op = '0.9'; }
      else if (n.planDate && n.planDate < TODAY) { fill = '#e11d48'; op = '0.85'; }
      else if (n.id === nextId) { fill = '#6366f1'; op = '0.95'; }

      var tip = n.name + (n.owner ? ' · ' + n.owner : '') +
        (n.planDate ? ' · 计划 ' + fmtMD(n.planDate) : '') +
        (n.hours ? ' · 预计 ' + fmtDays(n.hours * MIN_PER_DAY) : '') +
        (n.done && n.doneDate ? ' · 完成于 ' + fmtMD(n.doneDate) : '');

      parts.push('<rect x="' + x1.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + w.toFixed(1) +
        '" height="' + hgt.toFixed(1) + '" rx="3" fill="' + fill + '" opacity="' + op + '"><title>' +
        escapeHtml(tip) + '</title></rect>');

      if (!compact) {
        var label = (n.seq || (i + 1)) + ' ' + (n.owner || n.name);
        parts.push('<text x="' + (padL - 6) + '" y="' + (y + hgt - 1).toFixed(1) +
          '" text-anchor="end" font-size="9" fill="#6b7590">' + escapeHtml(label) + '</text>');
      }
    });

    if (compact) {
      parts.push('<text x="' + padL + '" y="' + (H - 2) + '" font-size="8" fill="#9aa3b8">' +
        escapeHtml(fmtMD(addDays(minD, 1))) + '</text>');
      parts.push('<text x="' + (W - padR) + '" y="' + (H - 2) + '" text-anchor="end" font-size="8" fill="#9aa3b8">' +
        escapeHtml(fmtMD(addDays(maxD, -1))) + '</text>');
    }

    if (extra > 0) {
      /* 单独一行、右对齐，位置在两端日期之上，不与它们共用基线 */
      parts.push('<text x="' + (W - padR) + '" y="' + (compact ? H - 12 : H - 13) +
        '" text-anchor="end" font-size="8" fill="#9aa3b8">+' + extra + ' 个未显示</text>');
    }

    parts.push('</svg>');
    return parts.join('');
  }

  /* 下一个待完成节点（按序号/计划日） */
  function currentNode(pid) {
    var list = nodesOf(pid);
    for (var i = 0; i < list.length; i++) {
      if (!list[i].done) return list[i];
    }
    return null;
  }

  function findNode(id) {
    for (var i = 0; i < S.nodes.length; i++) {
      if (S.nodes[i].id === id) return S.nodes[i];
    }
    return null;
  }

  function findProject(pid) {
    for (var i = 0; i < S.projects.length; i++) {
      if (S.projects[i].id === pid) return S.projects[i];
    }
    return null;
  }

  /* ---------------- 一键完成节点 ---------------- */
  function completeNode(nid) {
    var n = findNode(nid);
    if (!n) return;
    var p = findProject(n.pid);
    if (!p) return;
    var db = sdk();
    if (!db) { toast('当前没有可用的数据存储', 'err'); return; }

    var beforeRate = (S.metrics[p.id] || {}).rate || 0;
    setSync('busy');

    var lp = {
      '项目ID': { text: p.id },
      '项目名称': { text: p.name },
      '日期': { date: TODAY },
      '补记': { checkbox: false },
      '备注': { text: n.name }
    };
    if (n.hours > 0) lp['工时分钟'] = { number: Math.round(n.hours * MIN_PER_DAY) };

    /* ① 节点置完成 ② 同时记一条报工（备注写节点名，用于连续天数与工时统计）
       两步必须同生共死：以前并发发两个请求，服务端偶发只成功一半，
       会留下"节点已完成但没报工"的脏状态（进度和统计对不上）。 */
    var ops = [
      {
        op: 'update',
        databaseId: TBL_NODE,
        recordId: nid,
        properties: { '已完成': { checkbox: true }, '完成日': { date: TODAY } }
      },
      { op: 'add', databaseId: 'bI9MkKD1Zvp1UwmmY6UvfX', properties: lp }
    ];

    var job = (typeof db.batch === 'function')
      ? db.batch(ops)
      : Promise.all([
          db.updateRecord({
            databaseId: TBL_NODE,
            recordId: nid,
            properties: { '已完成': { checkbox: true }, '完成日': { date: TODAY } }
          }),
          db.addRecord({ databaseId: 'bI9MkKD1Zvp1UwmmY6UvfX', properties: lp })
        ]);

    job.then(function () {
      toast('已完成「' + n.name + '」' + (n.hours > 0 ? ' · ' + fmtDays(n.hours * MIN_PER_DAY) : ''), 'ok');
      return reloadData();
    }).then(function () {
      var m = S.metrics[p.id] || {};
      if (m.rate >= 1 && beforeRate < 1) {
        playConfetti(p.color);
        toast('「' + p.name + '」已 100% 关闭', 'ok');
      }
    }).catch(function (err) {
      setSync('off', '完成节点失败：数据没有完整写入，请重试。');
      toast('完成节点失败，请重试', 'err', function () { completeNode(nid); });
      if (window.console) console.error('[node] complete failed', err);
    });
  }

  /* ---------------- 改实际完成日 ----------------
     完成日是「撤销」用来认领报工的依据（l.date === n.doneDate），
     所以只改节点表的日期会让那条报工变成孤儿：撤销匹配不到 → 删不掉 →
     工时和数量永久重复计。必须一次 batch 把两边一起改。 */
  function saveDoneDate(nid) {
    var n = findNode(nid);
    if (!n) return;
    var inp = $('#ndDoneDate');
    var date = inp ? inp.value : '';
    if (!date) { toast('请选择实际完成日', 'err'); return; }
    if (date > TODAY) { toast('实际完成日不能晚于今天', 'err'); return; }
    if (date === n.doneDate) { editingDoneNid = null; renderNodeList(); return; }

    var db = sdk();
    if (!db) { toast('当前没有可用的数据存储', 'err'); return; }

    /* 找出这次「完成」写进去的那条报工 */
    var related = [];
    if (n.doneDate) {
      related = S.logs.filter(function (l) {
        return l.pid === n.pid && l.note === n.name && l.date === n.doneDate;
      });
    } else {
      /* 老数据没存完成日：只有唯一一条候选时才敢认领，多条一律不动，避免误改别人的报工 */
      var cand = S.logs.filter(function (l) {
        return l.pid === n.pid && l.note === n.name;
      });
      if (cand.length === 1) related = cand;
    }

    var ops = [{
      op: 'update',
      databaseId: TBL_NODE,
      recordId: nid,
      properties: { '完成日': { date: date } }
    }];
    related.forEach(function (l) {
      ops.push({
        op: 'update',
        databaseId: TBL_LOG,
        recordId: l.id,
        properties: { '日期': { date: date }, '补记': { checkbox: date < TODAY } }
      });
    });

    setSync('busy');
    var job;
    if (typeof db.batch === 'function') {
      job = db.batch(ops);
    } else {
      job = ops.reduce(function (p, op) {
        return p.then(function () {
          return db.updateRecord({ databaseId: op.databaseId, recordId: op.recordId, properties: op.properties });
        });
      }, Promise.resolve());
    }

    job.then(function () {
      editingDoneNid = null;
      toast('实际完成日已改为 ' + fmtMD(date) +
        (related.length ? ' · 同步 ' + related.length + ' 条报工' : ''), 'ok');
      return reloadData();
    }).catch(function (err) {
      setSync('off', '改期失败：数据没有完整写入，请重试。');
      toast('改期失败，请重试', 'err', function () { saveDoneDate(nid); });
      if (window.console) console.error('[node] edit done-date failed', err);
    });
  }

  function cancelEditDone() {
    editingDoneNid = null;
    renderNodeList();
  }

  function startEditDone(nid) {
    editingPlanNid = null;      /* 两个编辑框互斥 */
    editingDoneNid = nid;
    renderNodeList();
    var inp = $('#ndDoneDate');
    if (!inp) return;
    try { inp.focus(); } catch (e) {}
    /* Chrome 支持直接弹日历，不支持的浏览器忽略即可 */
    try { if (typeof inp.showPicker === 'function') inp.showPicker(); } catch (e) {}
  }

  /* ---------------- 改计划完成日 ----------------
     计划日不参与报工匹配，改它只影响甘特、按期判定和「已过计划日」标记，
     所以一次单表 update 就够，不用 batch。 */
  function startEditPlan(nid) {
    editingDoneNid = null;      /* 两个编辑框互斥 */
    editingPlanNid = nid;
    renderNodeList();
    var inp = $('#ndPlanDate');
    if (!inp) return;
    try { inp.focus(); } catch (e) {}
    try { if (typeof inp.showPicker === 'function') inp.showPicker(); } catch (e) {}
  }

  function cancelEditPlan() {
    editingPlanNid = null;
    renderNodeList();
  }

  function savePlanDate(nid) {
    var n = findNode(nid);
    if (!n) return;
    var inp = $('#ndPlanDate');
    var date = inp ? inp.value : '';
    if (!date) { toast('请选择计划完成日', 'err'); return; }
    if (date === n.planDate) { editingPlanNid = null; renderNodeList(); return; }

    var db = sdk();
    if (!db) { toast('当前没有可用的数据存储', 'err'); return; }

    /* 往后推就是延期：记原计划日 + 登记日 + 理由（理由可不填）。
       提前或没排过期的，只改日期，不写延期字段。 */
    var later = !!(n.planDate && date > n.planDate);
    var reason = '';
    if (later) {
      var ri = $('#ndDelayReason');
      reason = ri ? String(ri.value || '').trim() : '';
    }

    var props = { '计划完成日': { date: date } };
    if (later) {
      props['原计划日'] = { date: n.planDate };
      props['延期日'] = { date: TODAY };
      props['延期理由'] = { text: reason };
      props['延期次数'] = { number: (n.delayCount || 0) + 1 };
    }

    setSync('busy');
    db.updateRecord({
      databaseId: TBL_NODE,
      recordId: nid,
      properties: props
    }).then(function () {
      editingPlanNid = null;
      var msg = '计划完成日改为 ' + fmtMD(date);
      if (later) {
        var short = reason.length > 14 ? reason.slice(0, 14) + '…' : reason;
        msg += ' · 已记一次延期' + (short ? '（' + short + '）' : '');
      }
      toast(msg, 'ok');
      return reloadData();
    }).catch(function (err) {
      setSync('off', '改期失败：数据没有完整写入，请重试。');
      toast('改计划日失败，请重试', 'err', function () { savePlanDate(nid); });
      if (window.console) console.error('[node] edit plan-date failed', err);
    });
  }

  /* 撤销完成：连同那条报工一起撤回，避免重复计数 */
  function undoNode(nid) {
    var n = findNode(nid);
    if (!n) return;
    var p = findProject(n.pid);
    if (!p) return;

    var related = S.logs.filter(function (l) {
      return l.pid === n.pid && l.note === n.name && (!n.doneDate || l.date === n.doneDate);
    });

    askConfirm('撤销这个节点？',
      '将把「<b>' + escapeHtml(n.name) + '</b>」改回未完成' +
      (related.length ? '，同时删除它产生的那 ' + related.length + ' 条报工记录（否则数量会重复计算）' : '') +
      '。<br><br>之后可以重新点完成。',
      '撤销完成', function () {
        var db = sdk();
        if (!db) { toast('当前没有可用的数据存储', 'err'); return; }
        closeMask('maskConfirm');
        setSync('busy');
        /* 删报工 + 改节点，同样要同生共死 */
        var ops = related.map(function (l) {
          return { op: 'delete', databaseId: 'bI9MkKD1Zvp1UwmmY6UvfX', recordId: l.id };
        });
        ops.push({
          op: 'update',
          databaseId: TBL_NODE,
          recordId: nid,
          /* 完成日一并清掉：留着旧日期，下次误按「完成」前它还会污染甘特与按期统计 */
          properties: { '已完成': { checkbox: false }, '完成日': { date: '' } }
        });
        var job = (typeof db.batch === 'function')
          ? db.batch(ops)
          : Promise.all(ops.map(function (op) {
              if (op.op === 'delete') return db.deleteRecord({ databaseId: op.databaseId, recordId: op.recordId });
              return db.updateRecord({ databaseId: op.databaseId, recordId: op.recordId, properties: op.properties });
            }));
        job.then(function () {
          toast('已撤销「' + n.name + '」', 'ok');
          return reloadData();
        }).catch(function (err) {
          setSync('off', '撤销失败：数据没有完整写入，请重试。');
          toast('撤销失败，请重试', 'err', function () { undoNode(nid); });
          if (window.console) console.error('[node] undo failed', err);
        });
      });
  }

  function deleteNode(nid) {
    var n = findNode(nid);
    if (!n) return;
    askConfirm('删除这个节点？',
      '「<b>' + escapeHtml(n.name) + '</b>」将从计划里移除。<br><br>' +
      (n.done ? '已经产生的报工记录不会删除。' : '节点还没完成，删除不影响已完成数量。'),
      '确认删除', function () {
        var db = sdk();
        if (!db) { toast('当前没有可用的数据存储', 'err'); return; }
        closeMask('maskConfirm');
        setSync('busy');
        db.deleteRecord({ databaseId: '1urnMOWB0VL3RL0pNiNILG', recordId: nid }).then(function () {
          toast('节点已删除', 'ok');
          return reloadData();
        }).catch(function (err) {
          setSync('off', dst('删除失败：云端未确认。', '删除失败：数据没有完整写入。'));
          toast('删除失败，请重试', 'err', function () { deleteNode(nid); });
          if (window.console) console.error('[node] delete failed', err);
        });
      });
  }

  /* ---------------- 节点弹窗 ---------------- */
  var nodePid = null;
  /* 正在改实际完成日的节点（null = 无）。日期是「撤销」匹配报工的依据，
     所以不能在行里随手一改就算完，见 saveDoneDate() */
  var editingDoneNid = null;
  /* 正在改计划完成日的节点。和完成日互斥：同时只开一个编辑框 */
  var editingPlanNid = null;

  function openNodeModal(pid) {
    nodePid = pid;
    editingDoneNid = null;
    editingPlanNid = null;
    var p = findProject(pid);
    if (!p) return;
    $('#nodeTitle').textContent = '节点 · ' + p.name;
    renderNodeList();

    $('#ndName').value = '';
    $('#ndHours').value = '';
    $('#ndDate').value = p.due || addDays(TODAY, 7);
    openMask('maskNode');
    setTimeout(function () { try { $('#ndName').focus(); } catch (e) {} }, 120);
  }

  function renderNodeList() {
    var box = $('#nodeList');
    if (!box) return;
    var p = findProject(nodePid);
    if (!p) { box.innerHTML = ''; return; }

    var st = nodeStats(nodePid);
    var head = '<div class="nd-sum">' + icon('flag', 'ico-sm') +
      '<span>共 ' + st.total + ' 个节点 · 已完成 ' + st.done + ' · 剩余 ' + (st.total - st.done) + '</span></div>';

    if (!st.list.length) {
      box.innerHTML = head + '<div class="empty" style="padding:18px 14px;margin-top:8px">' +
        '<b>还没有节点</b>拆成「评审完 60 份」「样机到位并复测」这样的节点，之后每天点一下就能打卡。</div>';
      return;
    }

    if (editingDoneNid && !st.list.some(function (x) { return x.id === editingDoneNid && x.done; })) {
      editingDoneNid = null;
    }
    if (editingPlanNid && !st.list.some(function (x) { return x.id === editingPlanNid; })) {
      editingPlanNid = null;
    }

    var rows = st.list.map(function (n, idx) {
      var meta = [];
      if (n.owner) meta.push(escapeHtml(n.owner));
      if (n.hours > 0) meta.push('预计 ' + fmtDays(n.hours * MIN_PER_DAY));

      /* 计划完成日：和完成日一样，点一下就能改。
         没排期的节点给一个虚线「排计划日」，别做成大按钮抢焦点。 */
      var planHtml = '';
      if (editingPlanNid === n.id) {
        planHtml = '<span class="nd-done-edit">' +
          '<input type="date" class="nd-date" id="ndPlanDate" value="' +
            escapeHtml(n.planDate || TODAY) + '" aria-label="计划完成日">' +
          '<button class="btn btn-sm btn-primary" data-act="save-plan" data-nid="' +
            escapeHtml(n.id) + '">保存</button>' +
          '<button class="btn btn-sm" data-act="cancel-plan">取消</button>' +
        '</span>' +
        /* 日期一旦往后推就露出来：延期理由可选填，不填也能存 */
        '<span class="nd-delay" id="ndDelayBox" hidden>' +
          '<input type="text" class="nd-delay-in" id="ndDelayReason" maxlength="60"' +
            ' placeholder="延期理由（可不填），如：供应商模具排期未确认">' +
        '</span>';
      } else {
        planHtml = '<button type="button" class="nd-plan-date' + (n.planDate ? '' : ' none') +
          '" data-act="edit-plan" data-nid="' + escapeHtml(n.id) + '" title="点击修改计划完成日">' +
          (n.planDate ? '计划 ' + fmtMD(n.planDate) : '排计划日') + '</button>';
      }

      /* 完成日：默认是一个胶囊按钮，点开变日期选择器。
         这条日期同时决定撤销时要删哪条报工，改动需连报工一起改。 */
      var doneHtml = '';
      if (n.done) {
        if (editingDoneNid === n.id) {
          doneHtml = '<span class="nd-done-edit">' +
            '<input type="date" class="nd-date" id="ndDoneDate" value="' +
              escapeHtml(n.doneDate || TODAY) + '" max="' + TODAY + '" aria-label="实际完成日">' +
            '<button class="btn btn-sm btn-primary" data-act="save-done" data-nid="' +
              escapeHtml(n.id) + '">保存</button>' +
            '<button class="btn btn-sm" data-act="cancel-done">取消</button>' +
          '</span>';
        } else {
          doneHtml = '<button type="button" class="nd-done-date" data-act="edit-done" data-nid="' +
            escapeHtml(n.id) + '" title="点击修改实际完成日">' +
            (n.doneDate ? '完成于 ' + fmtMD(n.doneDate) : '补填完成日') + '</button>';
        }
      }

      var late = !n.done && n.planDate && n.planDate < TODAY;
      var metaHtml = meta.join(' · ');
      if (planHtml) metaHtml += (metaHtml ? ' · ' : '') + planHtml;
      if (doneHtml) metaHtml += (metaHtml ? ' · ' : '') + doneHtml;

      return '<div class="node-row ' + (n.done ? 'is-done' : '') + '">' +
        '<span class="nd-seq">' + (n.done ? '✓' : (idx + 1)) + '</span>' +
        '<div class="nd-main">' +
          '<div class="nd-name">' + escapeHtml(n.name) +
            (late ? '<span class="chip late">已过计划日</span>' : '') + '</div>' +
          '<div class="nd-meta">' + metaHtml + '</div>' +
        '</div>' +
        (n.done
          ? '<button class="btn btn-sm" data-act="undo-node" data-nid="' + escapeHtml(n.id) + '">撤销</button>'
          : '<button class="btn btn-sm btn-primary" data-act="done-node" data-nid="' + escapeHtml(n.id) + '">完成</button>') +
        '<button class="lg-del" data-act="del-node" data-nid="' + escapeHtml(n.id) + '" aria-label="删除节点">' + icon('close', 'ico-sm') + '</button>' +
      '</div>';
    }).join('');

    box.innerHTML = head + '<div class="nd-list">' + rows + '</div>';
  }

  function addNode() {
    var p = findProject(nodePid);
    if (!p) return;
    var name = $('#ndName').value.trim();
    if (!name) { toast('请填写节点名', 'err'); return; }

    var hours = Number($('#ndHours').value);
    var planDate = $('#ndDate').value;
    var owner = $('#ndOwner').value.trim();

    var db = sdk();
    if (!db) { toast('当前没有可用的数据存储', 'err'); return; }

    var seq = 1;
    nodesOf(p.id).forEach(function (n) { if (n.seq >= seq) seq = n.seq + 1; });

    var props = {
      '项目ID': { text: p.id },
      '节点名': { text: name },
      '序号': { number: seq },
      '负责人': { text: owner },
      '预计工时': { number: hours > 0 ? hours : 0 },
      '已完成': { checkbox: false },
      '备注': { text: '' }
    };
    if (planDate) props['计划完成日'] = { date: planDate };

    var btn = $('#ndAdd');
    btn.disabled = true;
    btn.textContent = '添加中…';
    setSync('busy');

    db.addRecord({ databaseId: '1urnMOWB0VL3RL0pNiNILG', properties: props }).then(function () {
      toast('节点已添加', 'ok');
      $('#ndName').value = '';
      $('#ndHours').value = '';
      $('#ndOwner').value = '';
      return reloadData();
    }).then(function () {
      renderNodeList();
    }).catch(function (err) {
      setSync('off', dst('添加节点失败：没有写入云端。', '添加节点失败：没有写入本机数据库。'));
      toast('添加节点失败，请重试', 'err', addNode);
      if (window.console) console.error('[node] add failed', err);
    }).then(function () {
      btn.disabled = false;
      btn.textContent = '+ 添加节点';
    });
  }

  /* 完成/撤销后刷新弹窗里的列表（reloadData 会调用 renderNodeList） */
  function bindNodeEvents() {
    $('#nodeClose').addEventListener('click', function () { closeMask('maskNode'); });
    $('#ndAdd').addEventListener('click', addNode);
    $('#maskNode').addEventListener('click', function (e) {
      if (e.target === this) this.classList.remove('on');
    });

    /* 改日期的输入框是动态渲染的，用委托接 Enter 保存 / Esc 取消 */
    document.addEventListener('keydown', function (e) {
      var t = e.target;
      if (!t || !t.id) return;
      if (t.id === 'ndDoneDate') {
        if (e.key === 'Enter') {
          e.preventDefault();
          if (editingDoneNid) saveDoneDate(editingDoneNid);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          cancelEditDone();
        }
      } else if (t.id === 'ndPlanDate') {
        if (e.key === 'Enter') {
          e.preventDefault();
          if (editingPlanNid) savePlanDate(editingPlanNid);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          cancelEditPlan();
        }
      }
    });

    /* 计划日往后推 → 露出延期理由输入框（不填也能保存） */
    document.addEventListener('change', function (e) {
      var t = e.target;
      if (!t || t.id !== 'ndPlanDate') return;
      var n = editingPlanNid ? findNode(editingPlanNid) : null;
      var box = $('#ndDelayBox');
      if (!box || !n) return;
      var later = !!(n.planDate && t.value && t.value > n.planDate);
      box.hidden = !later;
      if (later) {
        var ri = $('#ndDelayReason');
        if (ri) { try { ri.focus(); } catch (e2) {} }
      }
    });
  }
