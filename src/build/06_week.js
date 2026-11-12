
  /* ============================================================
     周报 · 渲染
     ============================================================ */
  function currentWeekKey() { return weekRange(S.weekOffset).start; }

  function findReview(key) {
    for (var i = 0; i < S.reviews.length; i++) {
      if (S.reviews[i].week === key) return S.reviews[i];
    }
    return null;
  }

  function deltaHtml(cur, prev, unit) {
    if (prev === 0 && cur === 0) return '<span class="delta flat">—</span>';
    if (prev === 0) return '<span class="delta up">新增</span>';
    var d = Math.round(((cur - prev) / prev) * 100);
    if (d > 0) return '<span class="delta up">+' + d + '%</span>';
    if (d < 0) return '<span class="delta down">' + d + '%</span>';
    return '<span class="delta flat">持平</span>';
  }

  function renderWeek() {
    if (!S.loaded) return;
    var wr = weekRange(S.weekOffset);
    var pw = weekRange(S.weekOffset - 1);
    var cur = weekStats(wr);
    var prev = weekStats(pw);

    var label = $('#wkLabel');
    if (label) label.textContent = fmtMD(wr.start) + ' – ' + fmtMD(wr.end);

    var nextBtn = $('#wkNext');
    if (nextBtn) nextBtn.disabled = (S.weekOffset >= 0);

    /* 表格 */
    var box = $('#wkTable');
    if (box) {
      if (!S.projects.length) {
        box.innerHTML = '<div class="empty"><b>没有项目可以汇总</b>先在「今日」新建项目。</div>';
      } else {
        var rows = [], tQty = 0, tDays = 0, tMin = 0, pQty = 0, tDelay = 0;
        S.projects.forEach(function (p) {
          var c = cur[p.id] || { nodes: 0, cnt: 0, min: 0, delays: [] };
          var b = prev[p.id] || { nodes: 0 };
          var dl = c.delays || [];
          tQty += c.nodes; tDays += c.cnt; tMin += c.min; pQty += b.nodes; tDelay += dl.length;
          rows.push(
            '<tr>' +
              '<td><div class="wk-name"><i style="background:' + escapeHtml(p.color || PALETTE[0]) + '"></i>' + escapeHtml(p.name) + '</div>' +
                '<div class="tiny muted" style="margin-left:14px">' + escapeHtml(p.stage || '') + ' · 单位 ' + escapeHtml(p.unit) + '</div></td>' +
              '<td class="num">' + c.nodes + ' <small class="muted">个</small></td>' +
              '<td class="num">' + (dl.length
                ? '<span class="chip late" title="' + escapeHtml(dl.map(function (n) {
                    return n.name + ' ' + (n.origPlanDate ? fmtMD(n.origPlanDate) + '→' : '') + fmtMD(n.planDate) +
                      (n.delayReason ? '（' + n.delayReason + '）' : '');
                  }).join('\n')) + '">' + dl.length + ' 项</span>'
                : '<span class="muted">—</span>') + '</td>' +
              '<td class="num">' + c.cnt + ' <small class="muted">天</small></td>' +
              '<td class="num">' + fmtDays(c.min) + '</td>' +
              '<td>' + deltaHtml(c.nodes, b.nodes, '') + '</td>' +
            '</tr>');
        });
        rows.push(
          '<tr style="background:#fafbff">' +
            '<td style="font-weight:700">合计</td>' +
            '<td class="num">' + tQty + ' <small class="muted">个</small></td>' +
            '<td class="num">' + (tDelay ? '<span class="chip late">' + tDelay + ' 项</span>' : '<span class="muted">—</span>') + '</td>' +
            '<td class="num">' + tDays + ' <small class="muted">天次</small></td>' +
            '<td class="num">' + fmtDays(tMin) + '</td>' +
            '<td>' + deltaHtml(tQty, pQty, '') + '</td>' +
          '</tr>');

        box.innerHTML =
          '<div style="overflow-x:auto"><table class="wk-table">' +
          '<thead><tr><th>项目</th><th>完成节点</th><th>本周延期</th><th>报工天数</th><th>投入工时（天）</th><th>环比上周</th></tr></thead>' +
          '<tbody>' + rows.join('') + '</tbody></table></div>';
      }
    }

    /* 四栏回填：仅在该周切换或没有未保存修改时才覆盖，避免切 Tab 丢输入 */
    var rv = findReview(wr.start);
    var saved = $('#kptSaved');
    if (S.kptWeek !== wr.start || !S.kptDirty) {
      $('#kptKeep').value = rv ? rv.keep : '';
      $('#kptProblem').value = rv ? rv.problem : '';
      $('#kptTry').value = rv ? rv.tryit : '';
      $('#kptNext').value = rv ? rv.next : '';
      S.kptWeek = wr.start;
      S.kptDirty = false;
      if (saved) saved.textContent = rv ? '已保存此周复盘' : '本周未保存';
    } else if (saved) {
      saved.textContent = '有未保存修改';
    }
  }

  function markKptDirty() {
    S.kptDirty = true;
    var saved = $('#kptSaved');
    if (saved) saved.textContent = '有未保存修改';
  }

  function saveKpt() {
    var db = sdk();
    if (!db) { toast(dst('当前未连接云端，复盘无法保存', '当前没有可用的数据存储，复盘无法保存'), 'err', function () { saveKpt(); }); return; }
    var key = currentWeekKey();
    var props = {
      '周标识': { text: key },
      '保持': { text: $('#kptKeep').value.trim() },
      '问题': { text: $('#kptProblem').value.trim() },
      '尝试': { text: $('#kptTry').value.trim() },
      '下周预案': { text: $('#kptNext').value.trim() }
    };
    var rv = findReview(key);
    var btn = $('#btnSaveKpt');
    btn.disabled = true;
    btn.textContent = '保存中…';
    setSync('busy');

    var job = rv
      ? db.updateRecord({ databaseId: 'nG1nopjeQW93K0wclTs4jR', recordId: rv.id, properties: props })
      : db.addRecord({ databaseId: 'nG1nopjeQW93K0wclTs4jR', properties: props });

    job.then(function () {
      toast(dst('本周复盘已保存到云端', '本周复盘已保存到本机数据库'), 'ok');
      S.kptDirty = false;
      return reloadData();
    }).catch(function (err) {
      setSync('off', dst('复盘保存失败：内容没有写入云端。', '复盘保存失败：内容没有写入本机数据库。'));
      toast(dst('保存失败，内容未写入云端', '保存失败，内容未写入本机数据库'), 'err', function () { saveKpt(); });
      if (window.console) console.error('[kpt] save failed', err);
    }).then(function () {
      btn.disabled = false;
      /* 和 02_body.html 的按钮初始文案保持一致，否则保存完会闪回旧版「保存到云端」 */
      btn.innerHTML = icon('save', 'ico-sm') + dst('保存到云端', '保存复盘');
    });
  }

  /* ---------------- 周报文本 ---------------- */
  function buildReportText() {
    var wr = weekRange(S.weekOffset);
    var pw = weekRange(S.weekOffset - 1);
    var cur = weekStats(wr);
    var prev = weekStats(pw);

    var lines = [];
    lines.push('【研发周报】' + fmtMD(wr.start) + ' – ' + fmtMD(wr.end));

    var tQty = 0, tMin = 0;
    var projLines = [];
    S.projects.forEach(function (p) {
      var c = cur[p.id] || { nodes: 0, cnt: 0, min: 0 };
      var b = prev[p.id] || { nodes: 0 };
      var m = S.metrics[p.id] || {};
      tQty += c.nodes; tMin += c.min;

      var delta = '';
      if (b.nodes === 0 && c.nodes > 0) delta = '（上周无完成）';
      else if (b.nodes > 0) {
        var dv = c.nodes - b.nodes;
        delta = '（较上周 ' + (dv >= 0 ? '+' : '') + dv + ' 个）';
      }

      var head = '· ' + p.name + (p.stage ? '（' + p.stage + '）' : '');
      var body = '  本周完成 ' + c.nodes + ' 个节点，报工 ' + c.cnt + ' 天，投入 ' + fmtDays(c.min) + delta;

      var status;
      if (m.nodeTotal === 0) {
        status = '还没拆节点。';
      } else if (m.remainNodes === 0) {
        status = '节点全部完成（' + m.nodeTotal + '/' + m.nodeTotal + '）。';
      } else {
        status = '节点进度 ' + m.nodeDone + '/' + m.nodeTotal + '，还剩 ' + m.remainNodes + ' 个';
        if (m.eta) {
          status += '，按近 7 天节奏预计 ' + fmtMD(m.eta);
          if (m.etaGap > 0) status += '，比截止日提前 ' + m.etaGap + ' 天';
          else if (m.etaGap < 0) status += '，比截止日拖后 ' + (-m.etaGap) + ' 天';
          else status += '，正好按期';
        } else {
          status += '，近 7 天没有完成节点，暂不推算完成日';
        }
        if (m.overdue > 0) status += '。⚠ 已逾期 ' + m.overdue + ' 天';
      }
      projLines.push(head + '\n' + body + '\n  ' + status);
    });

    lines.push('');
    lines.push('一、本周推进（合计完成 ' + tQty + ' 个节点 / 投入 ' + fmtDays(tMin) + '）');
    if (!projLines.length) lines.push('（本周暂无在研项目）');
    else lines.push(projLines.join('\n'));

    function sect(title, val) {
      lines.push('');
      lines.push(title);
      var v = (val || '').trim();
      if (!v) lines.push('（待补充）');
      else v.split('\n').forEach(function (x) { lines.push('· ' + x.trim()); });
    }

    sect('二、保持', $('#kptKeep').value);
    sect('三、问题', $('#kptProblem').value);
    sect('四、尝试', $('#kptTry').value);
    sect('五、下周预案', $('#kptNext').value);

    return lines.join('\n');
  }

  function generateReport() {
    var txt = buildReportText();
    var box = $('#reportPreview');
    if (box) {
      box.textContent = txt;
      box.classList.remove('pop-in');
      void box.offsetWidth;
      box.classList.add('pop-in');
    }
    return txt;
  }

  function copyReport() {
    var txt = $('#reportPreview') ? $('#reportPreview').textContent : '';
    if (!txt || txt.indexOf('点「生成周报文本」') === 0) txt = generateReport();
    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = txt;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); toast('周报文本已复制', 'ok'); }
      catch (e) { toast('复制失败，请手动选中复制', 'err'); }
      document.body.removeChild(ta);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(txt).then(function () {
        toast('周报文本已复制', 'ok');
      }).catch(fallback);
    } else fallback();
  }
