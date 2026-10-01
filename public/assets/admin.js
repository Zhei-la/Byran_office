/* 바이란 마케팅 — 문의함 (관리자)
   실제 홈페이지(byranmk.com): 서버 API + 비밀번호 로그인
   Claude 미리보기: 미리보기 저장소(db) */
(function () {
  var stateBox = document.getElementById('admState');
  var app = document.getElementById('admApp');
  var list = document.getElementById('admList');
  var empty = document.getElementById('admEmpty');
  var tabs = document.querySelectorAll('#admTabs [data-st]');
  var LABEL = { new: '신규', contacted: '연락함', done: '완료', spam: '스팸' };
  var filter = 'all';
  var rows = [];
  var db = null;

  function showState(html) { stateBox.innerHTML = html; stateBox.hidden = false; app.hidden = true; }

  var inClaude = !!(window.claude && typeof window.claude.use === 'function');
  var backend = null; // { update(id, patch), remove(id) }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function fmtDate(iso) {
    var d = new Date(iso);
    if (isNaN(d)) return '';
    return d.toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
  function update(id, patch, btn) {
    if (btn) btn.disabled = true;
    return backend.update(id, patch).catch(function () {
      alertRow(id, '저장하지 못했어요. 잠시 후 다시 시도해 주세요.');
    }).then(function () { if (btn) btn.disabled = false; });
  }
  function alertRow(id, msg) {
    var r = list.querySelector('[data-id="' + id + '"] .adm-msg');
    if (r) { r.textContent = msg; }
  }

  function render() {
    var counts = { all: rows.length, new: 0, contacted: 0, done: 0, spam: 0 };
    rows.forEach(function (r) { var s = r.data.status || 'new'; if (counts[s] != null) counts[s]++; });
    Object.keys(counts).forEach(function (k) {
      var c = document.querySelector('[data-count="' + k + '"]'); if (c) c.textContent = counts[k];
    });
    var shown = rows.filter(function (r) { return filter === 'all' || (r.data.status || 'new') === filter; });
    list.textContent = '';
    empty.hidden = rows.length > 0;
    if (rows.length && !shown.length) {
      list.appendChild(el('p', 'adm-none', LABEL[filter] + ' 상태인 문의가 없어요.'));
    }
    shown.forEach(function (r) {
      var q = r.data, st = q.status || 'new';
      var card = el('article', 'adm-card st-' + st); card.setAttribute('data-id', r.id);

      var who = el('div', 'adm-who');
      var top = el('div', 'adm-top');
      top.appendChild(el('span', 'stpill stpill-' + st, LABEL[st] || st));
      top.appendChild(el('span', 'adm-date', fmtDate(q.createdAt)));
      who.appendChild(top);
      who.appendChild(el('h3', null, q.name || '(이름 없음)'));
      if (q.phone) { var p = el('p', 'adm-contact'); p.appendChild(el('b', null, '연락처')); p.appendChild(el('span', 'sel', q.phone)); who.appendChild(p); }
      if (q.email) { var m = el('p', 'adm-contact'); m.appendChild(el('b', null, '이메일')); m.appendChild(el('span', 'sel', q.email)); who.appendChild(m); }

      var what = el('div', 'adm-what');
      var meta = el('div', 'adm-meta');
      if (q.business) meta.appendChild(el('span', 'chip-l chip', q.business));
      (q.services || []).forEach(function (s) { meta.appendChild(el('span', 'chip svc-chip', s)); });
      if (meta.childNodes.length) what.appendChild(meta);
      if (q.link) { var l = el('p', 'adm-link'); l.appendChild(el('b', null, '주소')); l.appendChild(el('span', 'sel', q.link)); what.appendChild(l); }
      if (q.estimate) { var es = el('div', 'adm-est'); es.appendChild(el('b', null, '선택한 구성')); es.appendChild(el('p', 'adm-body', q.estimate)); what.appendChild(es); }
      what.appendChild(el('p', 'adm-body', q.message || '문의 내용 없음'));

      var memoWrap = el('div', 'adm-memo');
      var mid = 'memo-' + r.id;
      var ml = el('label', null, '메모'); ml.setAttribute('for', mid);
      var ta = el('textarea'); ta.id = mid; ta.value = q.memo || ''; ta.placeholder = '예: 9/30 통화, 월 12회 플랜 안내';
      var save = el('button', 'btn btn-outline btn-sm', '메모 저장'); save.type = 'button';
      save.addEventListener('click', function () { update(r.id, { memo: ta.value.trim() }, save).then(function () { alertRow(r.id, '메모를 저장했어요.'); }); });
      memoWrap.appendChild(ml); memoWrap.appendChild(ta); memoWrap.appendChild(save);
      what.appendChild(memoWrap);

      var act = el('div', 'adm-actions');
      [['contacted', '연락함'], ['done', '완료'], ['new', '신규로'], ['spam', '스팸']].forEach(function (a) {
        if (a[0] === st) return;
        var b = el('button', a[0] === 'contacted' ? 'btn btn-ink btn-sm' : 'btn btn-outline btn-sm', a[1]); b.type = 'button';
        b.addEventListener('click', function () { update(r.id, { status: a[0] }, b); });
        act.appendChild(b);
      });
      var del = el('button', 'btn btn-outline btn-sm adm-del', '삭제'); del.type = 'button';
      del.addEventListener('click', function () {
        if (del.dataset.armed) {
          del.disabled = true;
          backend.remove(r.id).catch(function () { alertRow(r.id, '삭제하지 못했어요.'); del.disabled = false; });
        } else {
          del.dataset.armed = '1'; del.textContent = '한 번 더 누르면 삭제';
          setTimeout(function () { if (del.isConnected) { delete del.dataset.armed; del.textContent = '삭제'; } }, 4000);
        }
      });
      act.appendChild(del);
      act.appendChild(el('p', 'adm-msg'));

      card.appendChild(who); card.appendChild(what); card.appendChild(act);
      list.appendChild(card);
    });
  }

  tabs.forEach(function (b) {
    b.addEventListener('click', function () {
      filter = b.getAttribute('data-st');
      tabs.forEach(function (x) { x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); });
      render();
    });
  });

  function startClaude() {
    Promise.all([window.claude.use('user'), window.claude.use('db')]).then(function (res) {
      var user = res[0]; db = res[1];
      backend = {
        update: function (id, patch) { return db.collection('inquiries').doc(id).update(patch); },
        remove: function (id) { return db.collection('inquiries').doc(id).delete(); }
      };
      if (!db) { showState('<p>이 화면에서는 문의함을 열 수 없어요.</p>'); return; }
      var check = user ? Promise.all([user.isOwner(), user.canEdit()]) : Promise.resolve([false, false]);
      return check.then(function (r) {
        if (!r[0] && !r[1]) { showState('<p>문의함은 관리자만 볼 수 있어요.</p><p><a class="btn btn-ink" href="contact.html#inquiry">문의 남기러 가기 →</a></p>'); return; }
        stateBox.hidden = true; app.hidden = false;
        db.collection('inquiries').orderBy('createdAt', 'desc').limit(500).onSnapshot(function (snap) {
          rows = snap.docs.map(function (d) { return { id: d.id, data: d.data() || {} }; });
          render();
        }, function () {
          showState('<p>문의함을 불러오지 못했어요. 페이지를 새로고침해 주세요.</p>');
        });
      });
    }).catch(function () { showState('<p>문의함을 불러오지 못했어요. 페이지를 새로고침해 주세요.</p>'); });
  }

  /* ---------- 실제 서버 (byranmk.com) ---------- */
  function api(method, url, body) {
    return fetch(url, {
      method: method, credentials: 'same-origin',
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (r.status === 401) { showLogin('로그인이 끝났어요. 다시 로그인해 주세요.'); throw new Error('auth'); }
        if (!r.ok || !j.ok) throw new Error(j.error || 'error');
        return j;
      });
    });
  }
  function load() {
    return api('GET', '/api/admin/inquiries').then(function (j) {
      rows = j.items.map(function (q) { return { id: String(q.id), data: q }; });
      stateBox.hidden = true; app.hidden = false; render();
    });
  }
  function showLogin(msg) {
    stateBox.innerHTML = '';
    var f = el('form', 'adm-login');
    f.appendChild(el('h2', null, '관리자 로그인'));
    var lb = el('label', null, '비밀번호'); lb.setAttribute('for', 'admPw');
    var pw = el('input'); pw.type = 'password'; pw.id = 'admPw'; pw.autocomplete = 'current-password'; pw.required = true;
    var btn = el('button', 'btn btn-ink', '로그인'); btn.type = 'submit';
    var st = el('p', 'status error', msg || '');
    f.appendChild(lb); f.appendChild(pw); f.appendChild(btn); f.appendChild(st);
    f.addEventListener('submit', function (e) {
      e.preventDefault(); btn.disabled = true; st.textContent = '';
      fetch('/api/admin/login', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: pw.value }) })
        .then(function (r) { return r.json().catch(function () { return {}; }); })
        .then(function (j) {
          if (!j.ok) { st.textContent = j.error || '로그인하지 못했어요.'; btn.disabled = false; pw.select(); return; }
          load().catch(function () { st.textContent = '목록을 불러오지 못했어요.'; btn.disabled = false; });
        }, function () { st.textContent = '연결이 끊겼어요. 다시 시도해 주세요.'; btn.disabled = false; });
    });
    stateBox.appendChild(f); stateBox.hidden = false; app.hidden = true;
    pw.focus();
  }
  function startServer() {
    backend = {
      update: function (id, patch) { return api('PATCH', '/api/admin/inquiries/' + encodeURIComponent(id), patch).then(load); },
      remove: function (id) { return api('DELETE', '/api/admin/inquiries/' + encodeURIComponent(id)).then(load); }
    };
    var out = document.getElementById('admLogout');
    if (out) {
      out.hidden = false;
      out.addEventListener('click', function () { api('POST', '/api/admin/logout').then(function () { showLogin('로그아웃했어요.'); }); });
    }
    fetch('/api/admin/me', { credentials: 'same-origin' }).then(function (r) { return r.json(); }).then(function (j) {
      if (j.ok) return load(); showLogin();
    }).catch(function () { showState('<p>문의함을 불러오지 못했어요. 페이지를 새로고침해 주세요.</p>'); });
    // 새 문의가 들어오면 1분마다 자동으로 반영
    setInterval(function () { if (!app.hidden && document.visibilityState === 'visible') load().catch(function () {}); }, 60000);
  }


  /* ---------- 방문 통계 (실제 서버에서만) ---------- */
  var stView = 'inq', stRange = 'today', stTimer = null;
  var views = document.querySelectorAll('#admViews [data-view]');
  var inqBox = document.getElementById('admInq'), stBox = document.getElementById('admStats');
  function fmt(n) { return (n || 0).toLocaleString('ko-KR'); }
  function delta(cur, prev) {
    if (prev == null) return null;
    var d = (cur || 0) - (prev || 0);
    var e = el('span', 'st-delta ' + (d > 0 ? 'up' : d < 0 ? 'down' : 'same'));
    e.textContent = d > 0 ? '▲ ' + fmt(d) : d < 0 ? '▼ ' + fmt(-d) : '변화 없음';
    return e;
  }
  function card(label, val, prevVal, sub) {
    var c = el('div', 'st-card');
    c.appendChild(el('p', 'st-lbl', label));
    var row = el('div', 'st-val-row'); row.appendChild(el('b', 'st-val', fmt(val)));
    var dl = delta(val, prevVal); if (dl) row.appendChild(dl);
    c.appendChild(row);
    if (sub) c.appendChild(el('p', 'st-sub', sub));
    return c;
  }
  function renderStats(j) {
    var msg = document.getElementById('stMsg');
    if (!j.enabled) { msg.hidden = false; msg.textContent = '방문 통계는 데이터베이스가 연결된 실제 사이트에서만 보여요.'; return; }
    msg.hidden = true;
    var s = j.summary, p = s.prev || {};
    var hasPrev = !!s.prev;
    var cards = document.getElementById('stCards'); cards.textContent = '';
    cards.appendChild(card('방문한 사람 (기기 기준)', s.people, hasPrev ? p.people : null));
    cards.appendChild(card('총 방문 횟수', s.visits, hasPrev ? p.visits : null, '총 방문 인원 — 기기 기준 ' + fmt(s.people) + '명 · IP 기준 ' + fmt(s.ips) + '개'));
    cards.appendChild(card('화면 연 횟수', s.views, hasPrev ? p.views : null));
    var rate = s.people ? Math.round(s.inquiries / s.people * 1000) / 10 : 0;
    cards.appendChild(card('문의', s.inquiries, hasPrev ? p.inquiries : null, '방문 → 문의 ' + rate + '%'));

    var tb = document.querySelector('#stPlat tbody'); tb.textContent = '';
    if (!j.platforms.length) { var tr0 = el('tr'); var td0 = el('td', 'st-none', '아직 기록이 없어요.'); td0.colSpan = 4; tr0.appendChild(td0); tb.appendChild(tr0); }
    j.platforms.forEach(function (x) {
      var tr = el('tr'); [x.label, fmt(x.people), fmt(x.visits), fmt(x.inquiries)].forEach(function (v, i) { tr.appendChild(el(i ? 'td' : 'th', null, v)); });
      tb.appendChild(tr);
    });

    var days = j.daily.slice(0, 14).reverse();
    var max = Math.max(1, Math.max.apply(null, days.map(function (d) { return d.people; })));
    var bars = document.getElementById('stBars'); bars.textContent = '';
    days.forEach(function (d) {
      var b = el('div', 'st-bar');
      b.appendChild(el('span', 'st-bar-n', fmt(d.people)));
      var f = el('span', 'st-bar-f'); f.style.height = Math.round(d.people / max * 100) + '%'; b.appendChild(f);
      b.appendChild(el('span', 'st-bar-d', d.day.slice(5).replace('-', '/')));
      b.title = d.day + ' · 사람 ' + d.people + ' · 방문 ' + d.visits + ' · 화면 ' + d.views;
      bars.appendChild(b);
    });
    var dt = document.querySelector('#stDaily tbody'); dt.textContent = '';
    j.daily.forEach(function (d) {
      var tr = el('tr'); [d.day.replace(/-/g, '.'), fmt(d.people), fmt(d.visits), fmt(d.views), fmt(d.inquiries)].forEach(function (v, i) { tr.appendChild(el(i ? 'td' : 'th', null, v)); });
      dt.appendChild(tr);
    });
    if (j.ownerUrl) document.getElementById('stOwner').textContent = j.ownerUrl;
    document.getElementById('stUpd').textContent = new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }) + ' 기준';
  }
  function loadStats() {
    return api('GET', '/api/admin/stats?r=' + stRange).then(renderStats).catch(function (e) {
      if (e && e.message === 'auth') return;
      var msg = document.getElementById('stMsg'); msg.hidden = false; msg.textContent = '방문 통계를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.';
    });
  }
  function showView(v) {
    stView = v;
    views.forEach(function (x) { x.setAttribute('aria-pressed', x.getAttribute('data-view') === v ? 'true' : 'false'); });
    inqBox.hidden = v !== 'inq'; stBox.hidden = v !== 'stats';
    if (v === 'stats') loadStats();
  }
  if (views.length && stBox) {
    views.forEach(function (b) { b.addEventListener('click', function () { showView(b.getAttribute('data-view')); }); });
    document.querySelectorAll('#stRange [data-r]').forEach(function (b, _, all) {
      b.addEventListener('click', function () {
        stRange = b.getAttribute('data-r');
        all.forEach(function (x) { x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); });
        loadStats();
      });
    });
    var allBtn = document.getElementById('stAllBtn');
    allBtn.addEventListener('click', function () {
      var w = document.getElementById('stDailyWrap'); w.hidden = !w.hidden;
      allBtn.setAttribute('aria-expanded', w.hidden ? 'false' : 'true');
      allBtn.textContent = w.hidden ? '전체보기' : '접기';
    });
    document.getElementById('stOwnerCopy').addEventListener('click', function () {
      var t = document.getElementById('stOwner').textContent, btn = this;
      (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(function () { btn.textContent = '복사했어요'; }, function () { btn.textContent = '길게 눌러 복사'; })
        .then(function () { setTimeout(function () { btn.textContent = '주소 복사'; }, 1800); });
    });
    if (inClaude) { views[1].hidden = true; }
    setInterval(function () { if (stView === 'stats' && !app.hidden && document.visibilityState === 'visible') loadStats(); }, 60000);
  }

  if (inClaude) startClaude(); else startServer();
})();
