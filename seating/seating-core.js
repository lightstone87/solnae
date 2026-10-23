/* 시험 좌석 배치 프로그램 — 핵심 로직 (브라우저·Node 공용)
 * 1) 시간표·기초 자료 파싱  2) 좌석 배치 계산  3) HWPX 생성(템플릿 header.xml에 스타일 추가 + section0.xml 생성)
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SeatingCore = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var COLORS = ['#CFE8DA', '#FFF2A8', '#FBD5B5', '#DCD0F0'];   // 과목 가나다 순 색 (최대 4)
  var COLOR_NONE = '#E4E4E4';
  var NONE = '미응시';

  /* ================================================================ 문자열 */
  function norm(s) { return String(s || '').replace(/\([^)]*\)/g, '').replace(/\s+/g, ''); }        // 매칭용
  function disp(s) { return String(s || '').replace(/\([^)]*\)/g, '').replace(/\s+/g, ' ').trim(); } // 표시용
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function koSort(a, b) { return a < b ? -1 : a > b ? 1 : 0; }   // 유니코드 순 = 가나다 순

  /* ================================================================ 파싱 */
  // 시간표(2차원 배열) → 해당 학년의 시험 교시 목록
  function parseTimetable(tt, grade) {
    var dates = tt[0] || [], periods = tt[1] || [];
    var timeRow = tt.find(function (r) { return String(r[0]).trim() === '본시험'; }) || [];
    var gradeRow = tt.find(function (r) { return String(r[0]).trim() === grade + '학년'; }) || [];
    var slots = [], cur = '';
    for (var i = 1; i < periods.length; i++) {
      if (i < dates.length && String(dates[i]).trim()) cur = String(dates[i]).trim();
      var cell = i < gradeRow.length ? String(gradeRow[i]) : '';
      if (!cell.trim()) continue;
      var parts = cell.split('/');
      var codes = {}, names = [];
      parts.forEach(function (p) {
        var name = disp(p); if (!name) return;
        var m = /\((\d+)\)/.exec(p);
        codes[name] = m ? m[1] : '';
        if (names.indexOf(name) < 0) names.push(name);
      });
      names.sort(koSort);
      slots.push({ date: cur, period: String(periods[i]).trim(), time: String(timeRow[i] || '').replace(/\n/g, '').trim(), subjects: names, codes: codes });
    }
    return slots;
  }

  // 기초 자료 행 [학년, 학급, 번호, 성명, 과목, 비고] → {grade: {cls: {no: student}}}
  function buildRosters(students) {
    var R = {};
    students.forEach(function (r) {
      var g = Number(r[0]), c = Number(r[1]), no = Number(r[2]);
      if (!g || !c || !no) return;
      var byCls = R[g] || (R[g] = {});
      var roster = byCls[c] || (byCls[c] = {});
      var st = roster[no] || (roster[no] = { no: no, name: String(r[3] || '').trim(), deoham: false, subjects: {} });
      st.subjects[norm(r[4])] = true;
      if (String(r[5] || '').trim() === '더함') st.deoham = true;
    });
    return R;
  }

  function rosterList(roster) { return Object.keys(roster).map(Number).sort(function (a, b) { return a - b; }).map(function (k) { return roster[k]; }); }

  /* ================================================================ 배치 */
  // caps: 줄별 책상 수 [6,6,5,5,5] (교탁에서 본 오른쪽 줄 = 인쇄물 왼쪽 줄부터)
  function arrange(roster, slot, caps) {
    var list = rosterList(roster);
    var groups = [], seated = [], taken = {};
    slot.subjects.forEach(function (sub, k) {
      var key = norm(sub);
      var members = list.filter(function (s) { return s.subjects[key]; });
      var g = { subject: sub, color: COLORS[k % COLORS.length], members: members.filter(function (s) { return !s.deoham; }),
                deoham: members.filter(function (s) { return s.deoham; }), total: members.length };
      groups.push(g);
      g.members.forEach(function (s) { seated.push({ no: s.no, name: s.name, subject: sub, color: g.color }); });
      members.forEach(function (s) { taken[s.no] = true; });
    });
    var none = list.filter(function (s) { return !taken[s.no] && !s.deoham; });
    none.forEach(function (s) { seated.push({ no: s.no, name: s.name, subject: NONE, color: COLOR_NONE }); });
    var cols = caps.length, rows = Math.max.apply(null, caps.concat([1]));
    var grid = [];
    for (var r = 0; r < rows; r++) { grid.push([]); for (var c = 0; c < cols; c++) grid[r].push(r >= caps[c] ? 'X' : null); }
    var i = 0;
    for (var c2 = 0; c2 < cols; c2++) for (var r2 = 0; r2 < caps[c2]; r2++) if (i < seated.length) grid[r2][c2] = seated[i++];
    var capacity = caps.reduce(function (a, b) { return a + b; }, 0);
    return { groups: groups, grid: grid, rows: rows, cols: cols, caps: caps, nNone: none.length, nSeated: seated.length,
             capacity: capacity, overflow: Math.max(0, seated.length - capacity), seated: seated };
  }

  // 인원에 맞춘 기본 줄 구성: n명을 5줄에 고르게, 남는 인원은 앞줄부터
  function defaultCaps(n) {
    var base = Math.floor(n / 5), extra = n % 5, caps = [];
    for (var i = 0; i < 5; i++) caps.push(base + (i < extra ? 1 : 0));
    return caps;
  }

  /* ================================================================ 점검 */
  function checkClass(roster, slots, caps) {
    var list = rosterList(roster), msgs = [];
    var seatedCount = list.filter(function (s) { return !s.deoham; }).length;
    var capacity = caps.reduce(function (a, b) { return a + b; }, 0);
    msgs.push({ level: capacity >= seatedCount ? 'ok' : 'err', text: '좌석 ' + capacity + '석 ' + (capacity >= seatedCount ? '≥' : '<') + ' 착석 ' + seatedCount + '명' + (capacity < seatedCount ? ' — 좌석이 부족합니다. 좌석 설정을 수정하세요' : '') });
    var zero = [];
    slots.forEach(function (sl) {
      sl.subjects.forEach(function (sub) {
        var key = norm(sub);
        if (!list.some(function (s) { return s.subjects[key]; })) zero.push(sl.date + ' ' + sl.period + '교시 ' + sub);
      });
    });
    msgs.push(zero.length ? { level: 'warn', text: '응시생 0명 과목: ' + zero.join(', ') + ' — 미응시만으로 출력됨' } : { level: 'ok', text: '모든 시험 과목에 응시생 있음' });
    var dh = list.filter(function (s) { return s.deoham; });
    msgs.push({ level: 'info', text: '더함반 학생: ' + (dh.length ? dh.map(function (s) { return s.no + '번 ' + s.name; }).join(', ') : '없음') });
    var max = list.length ? list[list.length - 1].no : 0, missing = [];
    for (var n = 1; n <= max; n++) if (!roster[n]) missing.push(n + '번');
    msgs.push({ level: 'info', text: '결번: ' + (missing.length ? missing.join(', ') : '없음') + ' (1~' + max + '번 ' + list.length + '명)' });
    return msgs;
  }

  // 시간표 과목명 중 그 학년 기초 자료에 없는 과목
  function checkSubjects(slots, byCls) {
    var all = {};
    Object.keys(byCls || {}).forEach(function (c) { rosterList(byCls[c]).forEach(function (s) { Object.keys(s.subjects).forEach(function (k) { all[k] = true; }); }); });
    var bad = [];
    slots.forEach(function (sl) { sl.subjects.forEach(function (sub) { if (!all[norm(sub)] && bad.indexOf(sub) < 0) bad.push(sub); }); });
    return bad;
  }

  /* ================================================================ HWPX */
  var MM = 283.46, BODY_W = 51026, HEAD_H = 11252 + 600 + 700, HEAD_LINE = 1952, DESK_W = 26903, DESK_H = 3683,
      CELL_H_MAX = 9637, GRID_BUDGET = 47800;
  var PP = { HEAD_C: 20, HEAD_SUBJ: 21, LEFT: 22, GRID: 23, GAP: 24, TAIL: 25, CELL: 26 };
  var CP = { TIME: 8, SUBJ: 9, DESK: 10, WHEN: 11, LABEL: 12, LABEL_B: 13, NAME: 17, TAIL: 18, SQ_NONE: 16 };
  var CP_SQ_BASE = { 0: 14, 1: 15 };
  var BF = { NONE: 4, DESK: 5, HEAD: 6 };

  function charPr(id, height, bold, color) {
    return '<hh:charPr id="' + id + '" height="' + height + '" textColor="' + (color || '#000000') + '" shadeColor="none" useFontSpace="0" useKerning="0" symMark="NONE" borderFillIDRef="2">' +
      '<hh:fontRef hangul="0" latin="0" hanja="0" japanese="0" other="0" symbol="0" user="0"/>' +
      '<hh:ratio hangul="100" latin="100" hanja="100" japanese="100" other="100" symbol="100" user="100"/>' +
      '<hh:spacing hangul="0" latin="0" hanja="0" japanese="0" other="0" symbol="0" user="0"/>' +
      '<hh:relSz hangul="100" latin="100" hanja="100" japanese="100" other="100" symbol="100" user="100"/>' +
      '<hh:offset hangul="0" latin="0" hanja="0" japanese="0" other="0" symbol="0" user="0"/>' +
      (bold ? '<hh:bold/>' : '') + '<hh:underline type="NONE" shape="SOLID" color="#000000"/><hh:strikeout shape="NONE" color="#000000"/>' +
      '<hh:outline type="NONE"/><hh:shadow type="NONE" color="#C0C0C0" offsetX="10" offsetY="10"/></hh:charPr>';
  }
  function borderFill(id, fill, type) {
    var bd = ['left', 'right', 'top', 'bottom'].map(function (s) { return '<hh:' + s + 'Border type="' + type + '" width="' + (type === 'SOLID' ? '0.12 mm' : '0.1 mm') + '" color="#000000"/>'; }).join('');
    return '<hh:borderFill id="' + id + '" threeD="0" shadow="0" centerLine="NONE" breakCellSeparateLine="0">' +
      '<hh:slash type="NONE" Crooked="0" isCounter="0"/><hh:backSlash type="NONE" Crooked="0" isCounter="0"/>' + bd +
      '<hh:diagonal type="SOLID" width="0.1 mm" color="#000000"/>' +
      (fill ? '<hc:fillBrush><hc:winBrush faceColor="' + fill + '" hatchColor="#000000" alpha="0"/></hc:fillBrush>' : '') + '</hh:borderFill>';
  }

  function Styles(headerXml) {
    this.h = headerXml;
    this.bfN = Number(/<hh:borderFills itemCnt="(\d+)"/.exec(headerXml)[1]);
    this.cpN = Number(/<hh:charProperties itemCnt="(\d+)"/.exec(headerXml)[1]);
    this.bfs = []; this.cps = [];
    var self = this;
    this.BF_COLOR = COLORS.map(function (c) { return self.addBf(c, 'SOLID'); });
    this.CP_SQ = COLORS.map(function (c, k) { return k in CP_SQ_BASE ? CP_SQ_BASE[k] : self.addCp(1300, false, c); });
    this.CP_RED = this.addCp(1200, true, '#B00020');
    this.CP_SUBJ_LABEL = this.addCp(1600, false);
    this.CP_SUBJ_LIST = this.addCp(1600, true);
    this.CP_TITLE26 = this.addCp(2600, false, '#404040');
    this.BF_BLANK = this.addBf(null, 'NONE');
  }
  Styles.prototype.addBf = function (fill, type) { var i = this.bfN + this.bfs.length + 1; this.bfs.push(borderFill(i, fill, type)); return i; };
  Styles.prototype.addCp = function (h, b, c) { var i = this.cpN + this.cps.length; this.cps.push(charPr(i, h, b, c)); return i; };
  Styles.prototype.headerXml = function () {
    return this.h
      .replace('<hh:borderFills itemCnt="' + this.bfN + '"', '<hh:borderFills itemCnt="' + (this.bfN + this.bfs.length) + '"')
      .replace('</hh:borderFills>', this.bfs.join('') + '</hh:borderFills>')
      .replace('<hh:charProperties itemCnt="' + this.cpN + '"', '<hh:charProperties itemCnt="' + (this.cpN + this.cps.length) + '"')
      .replace('</hh:charProperties>', this.cps.join('') + '</hh:charProperties>');
  };

  var idSeq = 1000;
  function nid() { return String(++idSeq); }
  function lineseg(h, w) {
    h = h || 1000; w = w || BODY_W;
    return '<hp:linesegarray><hp:lineseg textpos="0" vertpos="0" vertsize="' + h + '" textheight="' + h + '" baseline="' + Math.floor(h * 0.85) +
      '" spacing="' + Math.floor(h * 0.3) + '" horzpos="0" horzsize="' + w + '" flags="393216"/></hp:linesegarray>';
  }
  function runsXml(runs) {
    var out = runs.map(function (r) { return typeof r === 'string' ? r : '<hp:run charPrIDRef="' + r[0] + '"><hp:t>' + esc(r[1]) + '</hp:t></hp:run>'; }).join('');
    return out || '<hp:run charPrIDRef="0"/>';
  }
  function para(runs, pp, opt) {
    opt = opt || {};
    return '<hp:p id="' + nid() + '" paraPrIDRef="' + pp + '" styleIDRef="0" pageBreak="' + (opt.pageBreak ? 1 : 0) + '" columnBreak="0" merged="0">' +
      (opt.prefix || '') + runsXml(runs) + lineseg(opt.h, opt.w) + '</hp:p>';
  }
  function tblRun(width, height, rowsXml, ncols, nrows, bf, inL, inT) {
    return '<hp:run charPrIDRef="0"><hp:tbl id="' + nid() + '" zOrder="' + nid() + '" numberingType="TABLE" textWrap="TOP_AND_BOTTOM" textFlow="BOTH_SIDES" lock="0" dropcapstyle="None" pageBreak="CELL" repeatHeader="0" ' +
      'rowCnt="' + nrows + '" colCnt="' + ncols + '" cellSpacing="0" borderFillIDRef="' + bf + '" noAdjust="0">' +
      '<hp:sz width="' + width + '" widthRelTo="ABSOLUTE" height="' + height + '" heightRelTo="ABSOLUTE" protect="0"/>' +
      '<hp:pos treatAsChar="1" affectLSpacing="0" flowWithText="1" allowOverlap="0" holdAnchorAndSO="0" vertRelTo="PARA" horzRelTo="PARA" vertAlign="TOP" horzAlign="LEFT" vertOffset="0" horzOffset="0"/>' +
      '<hp:outMargin left="0" right="0" top="0" bottom="0"/><hp:inMargin left="' + inL + '" right="' + inL + '" top="' + inT + '" bottom="' + inT + '"/>' +
      rowsXml.join('') + '</hp:tbl><hp:t/></hp:run>';
  }
  function cell(col, row, w, h, bf, paras) {
    return '<hp:tc name="" header="0" hasMargin="0" protect="0" editable="0" dirty="0" borderFillIDRef="' + bf + '">' +
      '<hp:subList id="" textDirection="HORIZONTAL" lineWrap="BREAK" vertAlign="CENTER" linkListIDRef="0" linkListNextIDRef="0" textWidth="0" textHeight="0" hasTextRef="0" hasNumRef="0">' +
      paras.join('') + '</hp:subList><hp:cellAddr colAddr="' + col + '" rowAddr="' + row + '"/><hp:cellSpan colSpan="1" rowSpan="1"/>' +
      '<hp:cellSz width="' + w + '" height="' + h + '"/><hp:cellMargin left="283" right="283" top="141" bottom="141"/></hp:tc>';
  }
  function textWidthMm(s, pt) {
    var w = 0;
    for (var i = 0; i < s.length; i++) w += pt * 0.353 * (s.charCodeAt(i) > 0x2E7F ? 1.0 : 0.52);
    return w;
  }

  // 한 교시(1쪽) 문단들
  function pageParas(st, slot, grade, cls, res, examTitle, secprXml) {
    var cols = res.cols, rows = res.rows, W_IN = BODY_W - 2 * 850;
    var subjList = slot.subjects.map(function (x) { return slot.codes[x] ? x + '(' + slot.codes[x] + ')' : x; }).join(' / ');
    var hp = [
      para([[st.CP_TITLE26, examTitle + ' 자리배치표']], PP.HEAD_C, { h: 2600, w: W_IN }),
      para([[CP.WHEN, '  ' + slot.date + ' ' + slot.period + '교시'], [CP.TIME, '(' + slot.time + ')      '], [CP.WHEN, grade + '학년 ' + cls + '반']], PP.HEAD_C, { h: 1800, w: W_IN }),
      para([[st.CP_SUBJ_LABEL, '시험과목 : '], [st.CP_SUBJ_LIST, subjList]], PP.HEAD_SUBJ, { h: 1600, w: W_IN })
    ];
    var line = [], plain = '';
    res.groups.forEach(function (g, k) {
      line.push([st.CP_SQ[k % st.CP_SQ.length], '■ '], [CP.LABEL, g.subject + ' '], [CP.LABEL_B, g.total + '명']);
      plain += '■ ' + g.subject + ' ' + g.total + '명';
      if (g.deoham.length) {
        var d = '(' + g.deoham.map(function (s) { return s.no + '번 ' + s.name + ' 더함반'; }).join(', ') + ')';
        line.push([st.CP_RED, d]); plain += d;
      }
      line.push([CP.LABEL, ' ']); plain += ' ';
    });
    var nn = res.nNone ? res.nNone + '명' : '없음';
    line.push([CP.SQ_NONE, '■ '], [CP.LABEL, '미응시 '], [CP.LABEL_B, nn]);
    plain += '■ 미응시 ' + nn;
    hp.push(para(line, PP.HEAD_C, { h: 1300, w: W_IN }));
    var extraLines = Math.max(0, Math.floor(textWidthMm(plain, 12) / 170));
    var headH = HEAD_H + HEAD_LINE * extraLines;
    var head = tblRun(BODY_W, headH, ['<hp:tr>' + cell(0, 0, BODY_W, headH - 481, BF.HEAD, hp) + '</hp:tr>'], 1, 1, BF.HEAD, 850, 850);
    var desk = tblRun(DESK_W, DESK_H, ['<hp:tr>' + cell(0, 0, DESK_W, DESK_H, BF.DESK, [para([[CP.DESK, '교   탁']], PP.GRID, { h: 2600, w: DESK_W - 566 })]) + '</hp:tr>'], 1, 1, BF.DESK, 283, 141);
    var cw = Math.min(Math.floor(BODY_W / cols), Math.floor(46 * MM));
    var ch = Math.min(CELL_H_MAX, Math.floor((GRID_BUDGET - HEAD_LINE * extraLines) / rows));
    var subjIndex = {}; res.groups.forEach(function (g, k) { subjIndex[g.subject] = k; });
    var trs = [];
    for (var r = 0; r < rows; r++) {
      var tcs = [];
      for (var c = 0; c < cols; c++) {
        var s = res.grid[r][c];
        if (!s || s === 'X') tcs.push(cell(c, r, cw, ch, st.BF_BLANK, [para([], PP.CELL, { w: cw - 566 })]));
        else {
          var bf = s.subject === NONE ? BF.NONE : st.BF_COLOR[subjIndex[s.subject] % st.BF_COLOR.length];
          tcs.push(cell(c, r, cw, ch, bf, [para([[CP.NAME, s.no + '. ' + s.name]], PP.CELL, { h: 1400, w: cw - 566 }),
                                           para([[CP.SUBJ, s.subject]], PP.CELL, { h: 1200, w: cw - 566 })]));
        }
      }
      trs.push('<hp:tr>' + tcs.join('') + '</hp:tr>');
    }
    var grid = tblRun(cw * cols, ch * rows, trs, cols, rows, st.BF_BLANK, 283, 141);
    var first = !!secprXml;
    return [
      para([head], PP.LEFT, { pageBreak: !first, h: headH, prefix: first ? '<hp:run charPrIDRef="0">' + secprXml + '</hp:run>' : '' }),
      para([], PP.GAP),
      para([desk], PP.GAP, { h: DESK_H }),
      para([], PP.GAP),
      para([grid], PP.GRID, { h: ch * rows }),
      para(['<hp:run charPrIDRef="' + CP.TAIL + '"/>'], PP.TAIL, { h: 900 })
    ];
  }

  /**
   * HWPX 생성
   * @param templateZip  JSZip 인스턴스(템플릿 hwpx 로드됨)
   * @param pages        [{slot, grade, cls, res}] — 쪽 순서대로
   * @param examTitle    '2026학년도 2학기 1차시험'
   * @param JSZipCtor    JSZip 생성자
   * @returns Promise<Uint8Array|Blob>
   */
  function buildHwpx(templateZip, pages, examTitle, JSZipCtor, outType) {
    return Promise.all([templateZip.file('Contents/header.xml').async('string'), templateZip.file('Contents/section0.xml').async('string')])
      .then(function (xs) {
        var header = xs[0], sectionT = xs[1];
        var secpr = /<hp:secPr [\s\S]*?<\/hp:secPr><hp:ctrl><hp:colPr [^>]*\/><\/hp:ctrl>/.exec(sectionT)[0];
        var headTag = /^(<\?xml[^>]*\?>)?<hs:sec [^>]*>/.exec(sectionT)[0];
        var st = new Styles(header);
        var paras = [];
        pages.forEach(function (pg, i) { paras = paras.concat(pageParas(st, pg.slot, pg.grade, pg.cls, pg.res, examTitle, i === 0 ? secpr : null)); });
        var out = new JSZipCtor();
        var NF = { createFolders: false };
        out.file('mimetype', 'application/hwp+zip', { compression: 'STORE', createFolders: false });   // 반드시 첫 항목·비압축
        var jobs = [];
        templateZip.forEach(function (path, f) {
          if (f.dir || path === 'mimetype' || path === 'Preview/PrvImage.png') return;
          if (path === 'Contents/header.xml') out.file(path, st.headerXml(), NF);
          else if (path === 'Contents/section0.xml') out.file(path, headTag + paras.join('') + '</hs:sec>', NF);
          else if (path === 'Preview/PrvText.txt') out.file(path, examTitle + ' 자리배치표', NF);
          else jobs.push(f.async('uint8array').then(function (b) { out.file(path, b, NF); }));
        });
        return Promise.all(jobs).then(function () {
          return out.generateAsync({ type: outType || 'uint8array', compression: 'DEFLATE', mimeType: 'application/hwp+zip' });
        });
      });
  }

  /* ================================================================ 보조 */
  function examTitle(ex) { return ex.year + '학년도 ' + ex.term + '학기 ' + ex.name; }
  function fileStem(ex) { return '자리배치표_' + ex.year + '_' + ex.term + '학기_' + ex.name; }

  return {
    COLORS: COLORS, COLOR_NONE: COLOR_NONE, NONE: NONE,
    norm: norm, disp: disp, parseTimetable: parseTimetable, buildRosters: buildRosters, rosterList: rosterList,
    arrange: arrange, defaultCaps: defaultCaps, checkClass: checkClass, checkSubjects: checkSubjects,
    buildHwpx: buildHwpx, examTitle: examTitle, fileStem: fileStem
  };
}));
