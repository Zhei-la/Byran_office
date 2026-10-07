/* 바이란 마케팅 — 관리자 (문의함 · 방문 통계 · 포트폴리오 글쓰기 · 계약서 전자서명)
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
    if (pfBox) pfBox.hidden = v !== 'pf';
    if (ctBox) ctBox.hidden = v !== 'ct';
    if (v === 'ct' && !ctLoaded) { ctLoaded = true; ctList(); }
    if (v === 'stats') loadStats();
    if (v === 'pf' && !pfLoaded) { pfLoaded = true; pfList(); }
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
    if (inClaude) { views[1].hidden = true; if (views[2]) views[2].hidden = true; if (views[3]) views[3].hidden = true; }
    setInterval(function () { if (stView === 'stats' && !app.hidden && document.visibilityState === 'visible') loadStats(); }, 60000);
  }

  /* ---------- 포트폴리오 사례 글쓰기 (실제 서버에서만) ----------
     글 = 서비스 · 제목 · 핵심 결과 · 한 줄 설명 · 업종 · 기간 · 계정 주소 + 본문(사진·설명 글을 원하는 순서로)
     첫 번째 사진이 목록 카드 사진이 된다. 사진은 올리기 전에 휴대폰·PC에서 줄여서(긴 쪽 최대 2600px) 보낸다. */
  var pfBox = document.getElementById('admPf');
  var pfLoaded = false, pfItems = [];
  var PF_CATS = [['threads', '스레드 운영 대행'], ['blog', '블로그 운영 대행'], ['bloghome', '홈페이지형 블로그'], ['website', '홈페이지 제작']];
  function pfCat(k) { for (var i = 0; i < PF_CATS.length; i++) if (PF_CATS[i][0] === k) return PF_CATS[i][1]; return k; }
  function pfCover(p) { var b = (p.blocks || []).filter(function (x) { return x.type === 'img' && x.img; })[0]; return b ? '/media/pf/' + b.img : ''; }
  function button(text, cls) { var b = el('button', cls || 'btn btn-outline btn-sm', text); b.type = 'button'; return b; }

  function pfList(flash) {
    pfBox.textContent = ''; pfBox.appendChild(el('p', 'adm-none', '포트폴리오 글을 불러오는 중이에요…'));
    return api('GET', '/api/admin/portfolio').then(function (j) { pfItems = j.items || []; pfRenderList(flash); })
      .catch(function (e) { if (e && e.message === 'auth') return; pfBox.textContent = ''; pfBox.appendChild(el('p', 'adm-none', '포트폴리오 글을 불러오지 못했어요. 새로고침해 주세요.')); });
  }

  function pfRenderList(flash) {
    pfBox.textContent = '';
    var bar = el('div', 'pfa-bar');
    var add = button('+ 새 사례 글 쓰기', 'btn btn-ink'); add.addEventListener('click', function () { pfEdit(null); });
    var see = el('a', 'btn btn-outline btn-sm', '홈페이지 포트폴리오 보기'); see.href = '/portfolio.html'; see.target = '_blank'; see.rel = 'noopener';
    bar.appendChild(add); bar.appendChild(see);
    pfBox.appendChild(bar);
    if (flash) pfBox.appendChild(el('p', 'pfa-flash', flash));
    if (!pfItems.length) {
      pfBox.appendChild(el('p', 'adm-none', '아직 쓴 사례 글이 없어요. "새 사례 글 쓰기"를 눌러 첫 글을 써보세요. 공개로 저장하면 포트폴리오 페이지의 해당 서비스 탭 맨 위에 카드로 나타나요.'));
      return;
    }
    var list = el('div', 'pfa-list');
    pfItems.forEach(function (p) {
      var row = el('article', 'pfa-row');
      var th = el('div', 'pfa-th'); var cv = pfCover(p);
      if (cv) { var im = el('img'); im.src = cv; im.alt = ''; im.loading = 'lazy'; th.appendChild(im); } else th.appendChild(el('span', null, '사진 없음'));
      row.appendChild(th);
      var info = el('div', 'pfa-info');
      var top = el('div', 'adm-top');
      top.appendChild(el('span', 'stpill ' + (p.published ? 'stpill-contacted' : 'stpill-done'), p.published ? '공개' : '비공개'));
      top.appendChild(el('span', 'adm-date', pfCat(p.category) + ' · ' + fmtDate(p.updatedAt)));
      info.appendChild(top);
      info.appendChild(el('h3', null, p.title));
      if (p.highlight) info.appendChild(el('p', 'pfa-hl', p.highlight));
      var n = (p.blocks || []).filter(function (b) { return b.type === 'img'; }).length;
      info.appendChild(el('p', 'pfa-sub', '사진 ' + n + '장 · 설명 글 ' + ((p.blocks || []).length - n) + '개' + (p.sort ? ' · 순서 ' + p.sort : '')));
      row.appendChild(info);
      var act = el('div', 'pfa-act');
      var ed = button('수정', 'btn btn-ink btn-sm'); ed.addEventListener('click', function () { pfEdit(p); });
      var vw = el('a', 'btn btn-outline btn-sm', p.published ? '페이지 보기' : '미리보기'); vw.href = '/portfolio/' + p.id; vw.target = '_blank'; vw.rel = 'noopener';
      var del = button('삭제', 'btn btn-outline btn-sm adm-del');
      del.addEventListener('click', function () {
        if (!del.dataset.armed) {
          del.dataset.armed = '1'; del.textContent = '한 번 더 누르면 삭제';
          setTimeout(function () { if (del.isConnected) { delete del.dataset.armed; del.textContent = '삭제'; } }, 4000);
          return;
        }
        del.disabled = true;
        api('DELETE', '/api/admin/portfolio/' + p.id).then(function () { pfList('글을 삭제했어요.'); }, function () { del.disabled = false; del.textContent = '삭제하지 못했어요'; });
      });
      act.appendChild(ed); act.appendChild(vw); act.appendChild(del);
      row.appendChild(act);
      list.appendChild(row);
    });
    pfBox.appendChild(list);
  }

  // 사진 줄이기: 긴 쪽이 너무 크면 줄여서 JPG로 (폰 캡처 화면은 글씨가 읽히게 가로 최대 1200px)
  function pfShrink(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file), im = new Image();
      im.onload = function () {
        var w = im.naturalWidth, h = im.naturalHeight, s = Math.min(1, 1200 / w, 2600 / h);
        var c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w * s)); c.height = Math.max(1, Math.round(h * s));
        var x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(im, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        c.toBlob(function (b) { b ? resolve(b) : reject(new Error('shrink')); }, 'image/jpeg', 0.86);
      };
      im.onerror = function () { URL.revokeObjectURL(url); reject(new Error('shrink')); };
      im.src = url;
    }).catch(function () {
      if (/^image\/(jpeg|png|webp)$/.test(file.type) && file.size < 6 * 1024 * 1024) return file;
      throw new Error('이 사진은 올릴 수 없어요. 캡처 화면이나 JPG 사진으로 올려주세요.');
    });
  }
  function pfUpload(blob) {
    return fetch('/api/admin/portfolio/images', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': blob.type || 'image/jpeg' }, body: blob })
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (j) {
          if (r.status === 401) { showLogin('로그인이 끝났어요. 다시 로그인해 주세요.'); throw new Error('auth'); }
          if (r.status === 413) throw new Error('사진이 너무 커요.');
          if (!r.ok || !j.ok) throw new Error(j.error || '사진을 올리지 못했어요.');
          return j;
        });
      });
  }

  function pfEdit(src) {
    var d = src ? JSON.parse(JSON.stringify(src)) : { category: 'threads', title: '', highlight: '', summary: '', industry: '', period: '', link: '', blocks: [], published: false, sort: 0 };
    d.blocks = d.blocks || [];
    var dirty = false;
    pfBox.textContent = '';
    var f = el('form', 'pfa-form'); f.noValidate = true;
    f.addEventListener('input', function () { dirty = true; });

    var head = el('div', 'pfa-head');
    head.appendChild(el('h2', null, src ? '사례 글 수정' : '새 사례 글'));
    var back = button('목록으로');
    back.addEventListener('click', function () {
      if (dirty && !back.dataset.armed) { back.dataset.armed = '1'; back.textContent = '저장 안 하고 나가기'; return; }
      pfRenderList();
    });
    head.appendChild(back);
    f.appendChild(head);

    var uid = 0;
    function field(label, input, hint, wide) {
      var w = el('div', 'pfa-field' + (wide ? ' wide' : '')); input.id = 'pfa-' + (++uid);
      var l = el('label', null, label); l.setAttribute('for', input.id);
      w.appendChild(l); w.appendChild(input); if (hint) w.appendChild(el('p', 'pfa-hint', hint));
      return w;
    }
    function input(key, ph, max, type) {
      var i = el('input'); i.type = type || 'text'; i.value = d[key] || ''; i.placeholder = ph || ''; if (max) i.maxLength = max;
      i.addEventListener('input', function () { d[key] = i.value; }); return i;
    }
    var grid = el('div', 'pfa-grid');
    var cat = el('select'); PF_CATS.forEach(function (c) { var o = el('option', null, c[1]); o.value = c[0]; if (c[0] === d.category) o.selected = true; cat.appendChild(o); });
    cat.addEventListener('change', function () { d.category = cat.value; });
    grid.appendChild(field('서비스', cat, '포트폴리오 페이지에서 이 탭에 나와요.'));
    grid.appendChild(field('제목 *', input('title', '예: 부천 상동 포차 스레드 첫 달 운영', 200), null));
    grid.appendChild(field('핵심 결과', input('highlight', '예: 팔로워 20명 → 234명 (4일)', 120), '카드와 페이지 맨 위에 굵게 보여요.'));
    grid.appendChild(field('업종', input('industry', '예: 인테리어 · 부산', 80)));
    grid.appendChild(field('진행 기간', input('period', '예: 2026.10.1 ~ 진행 중', 80)));
    grid.appendChild(field('계정·사이트 주소 (선택)', input('link', 'https://www.threads.com/@...', 300, 'url'), '적으면 페이지 아래에 "운영 계정 보기" 버튼이 생겨요.'));
    var sum = el('textarea'); sum.rows = 3; sum.maxLength = 400; sum.value = d.summary || ''; sum.placeholder = '예: 시작 4일 만에 견적 비교 글 하나로 문의 5건이 들어온 인테리어 계정이에요.';
    sum.addEventListener('input', function () { d.summary = sum.value; });
    grid.appendChild(field('한 줄 설명', sum, '카드 아래와 페이지 제목 밑에 보여요.', true));
    f.appendChild(grid);

    // 본문 블록
    var bh = el('div', 'pfa-bhead');
    bh.appendChild(el('h3', null, '본문 · 사진과 설명'));
    bh.appendChild(el('p', 'pfa-hint', '위에서부터 순서대로 보여요. 첫 번째 사진이 목록 카드 사진이 돼요. 사진마다 아래에 짧은 설명을 붙일 수 있어요.'));
    f.appendChild(bh);
    var bx = el('div', 'pfa-blocks'); f.appendChild(bx);

    function firstImg() { for (var i = 0; i < d.blocks.length; i++) if (d.blocks[i].type === 'img') return i; return -1; }
    function move(i, dir) { var j = i + dir; if (j < 0 || j >= d.blocks.length) return; var t = d.blocks[i]; d.blocks[i] = d.blocks[j]; d.blocks[j] = t; dirty = true; renderBlocks(); }
    function renderBlocks() {
      bx.textContent = '';
      if (!d.blocks.length) bx.appendChild(el('p', 'pfa-empty', '아래 버튼으로 사진이나 설명 글을 추가하세요.'));
      var fi = firstImg();
      d.blocks.forEach(function (b, i) {
        var card = el('div', 'pfa-blk pfa-blk-' + b.type);
        var tools = el('div', 'pfa-tools');
        tools.appendChild(el('span', 'pfa-tag', b.type === 'img' ? (i === fi ? '사진 · 대표 사진' : '사진') : '설명 글'));
        var up = button('↑', 'pfa-ic'); up.setAttribute('aria-label', '위로'); up.disabled = i === 0; up.addEventListener('click', function () { move(i, -1); });
        var dn = button('↓', 'pfa-ic'); dn.setAttribute('aria-label', '아래로'); dn.disabled = i === d.blocks.length - 1; dn.addEventListener('click', function () { move(i, 1); });
        var rm = button('삭제', 'pfa-ic pfa-rm'); rm.addEventListener('click', function () { d.blocks.splice(i, 1); dirty = true; renderBlocks(); });
        tools.appendChild(up); tools.appendChild(dn); tools.appendChild(rm);
        card.appendChild(tools);
        if (b.type === 'img') {
          var pic = el('div', 'pfa-pic');
          if (b.error) pic.appendChild(el('p', 'pfa-err', b.error));
          else if (!b.img) pic.appendChild(el('p', 'pfa-up', '사진 올리는 중…'));
          else { var im = el('img'); im.src = '/media/pf/' + b.img; im.alt = ''; pic.appendChild(im); }
          card.appendChild(pic);
          var cap = el('input'); cap.type = 'text'; cap.maxLength = 400; cap.value = b.caption || ''; cap.placeholder = '사진 설명 (예: 10/4 인사이트 · 팔로워 210명)';
          cap.setAttribute('aria-label', '사진 설명');
          cap.addEventListener('input', function () { b.caption = cap.value; });
          card.appendChild(cap);
        } else {
          var ta = el('textarea'); ta.rows = 5; ta.maxLength = 4000; ta.value = b.text || ''; ta.placeholder = '설명을 적어주세요. 빈 줄을 한 줄 넣으면 문단이 나뉘어요.';
          ta.setAttribute('aria-label', '설명 글');
          ta.addEventListener('input', function () { b.text = ta.value; });
          card.appendChild(ta);
        }
        bx.appendChild(card);
      });
    }
    renderBlocks();

    var adds = el('div', 'pfa-adds');
    var fileLbl = el('label', 'btn btn-outline btn-sm pfa-file', '+ 사진 추가');
    var file = el('input'); file.type = 'file'; file.accept = 'image/*'; file.multiple = true; file.className = 'pfa-file-in';
    fileLbl.appendChild(file);
    file.addEventListener('change', function () {
      var files = Array.prototype.slice.call(file.files || []); file.value = '';
      files.forEach(function (fl) {
        var b = { type: 'img', img: 0, caption: '' };
        d.blocks.push(b); dirty = true;
        pfShrink(fl).then(pfUpload).then(function (j) { b.img = +j.id; renderBlocks(); })
          .catch(function (e) { if (e && e.message === 'auth') return; b.error = (e && e.message) || '사진을 올리지 못했어요.'; renderBlocks(); });
      });
      renderBlocks();
    });
    var addText = button('+ 설명 글 추가');
    addText.addEventListener('click', function () {
      d.blocks.push({ type: 'text', text: '' }); dirty = true; renderBlocks();
      var tas = bx.querySelectorAll('textarea'); if (tas.length) tas[tas.length - 1].focus();
    });
    adds.appendChild(fileLbl); adds.appendChild(addText);
    f.appendChild(adds);

    // 공개 · 순서 · 저장
    var foot = el('div', 'pfa-foot');
    var pubW = el('label', 'pfa-check'); var pub = el('input'); pub.type = 'checkbox'; pub.checked = !!d.published;
    pub.addEventListener('change', function () { d.published = pub.checked; dirty = true; });
    pubW.appendChild(pub); pubW.appendChild(el('span', null, '홈페이지에 공개'));
    foot.appendChild(pubW);
    var sortI = el('input'); sortI.type = 'number'; sortI.value = d.sort || 0; sortI.step = '1';
    sortI.addEventListener('input', function () { d.sort = parseInt(sortI.value, 10) || 0; });
    var sortW = field('순서', sortI, '숫자가 클수록 위에 나와요. 같으면 최신 글이 위.'); sortW.className += ' pfa-sort';
    foot.appendChild(sortW);
    var saveB = el('button', 'btn btn-ink', '저장'); saveB.type = 'submit';
    var st = el('p', 'adm-msg');
    var acts = el('div', 'pfa-save'); acts.appendChild(saveB); acts.appendChild(st);
    foot.appendChild(acts);
    f.appendChild(foot);

    f.addEventListener('submit', function (e) {
      e.preventDefault();
      if (!String(d.title || '').trim()) { st.textContent = '제목을 적어주세요.'; return; }
      if (d.blocks.some(function (b) { return b.type === 'img' && !b.img && !b.error; })) { st.textContent = '사진이 다 올라갈 때까지 잠깐만 기다려 주세요.'; return; }
      var body = {
        category: d.category, title: d.title, highlight: d.highlight, summary: d.summary, industry: d.industry,
        period: d.period, link: d.link, published: !!d.published, sort: d.sort || 0,
        blocks: d.blocks.filter(function (b) { return b.type === 'text' ? String(b.text || '').trim() : b.img; })
          .map(function (b) { return b.type === 'img' ? { type: 'img', img: b.img, caption: b.caption || '' } : { type: 'text', text: b.text }; })
      };
      if (d.link && !/^https?:\/\//i.test(d.link)) { st.textContent = '주소는 https:// 로 시작하게 적어주세요.'; return; }
      saveB.disabled = true; st.textContent = '저장하는 중…';
      (src ? api('PUT', '/api/admin/portfolio/' + src.id, body) : api('POST', '/api/admin/portfolio', body)).then(function () {
        pfList(d.published ? '저장했어요. 홈페이지 포트폴리오에 바로 보여요.' : '비공개로 저장했어요. 목록에서 "미리보기"로 확인할 수 있어요.');
      }, function (err) {
        saveB.disabled = false; if (err && err.message === 'auth') return;
        st.textContent = (err && err.message && err.message !== 'error') ? err.message : '저장하지 못했어요. 잠시 후 다시 시도해 주세요.';
      });
    });

    pfBox.appendChild(f);
    window.scrollTo(0, pfBox.getBoundingClientRect().top + window.pageYOffset - 90);
  }


  /* ---------- 계약서 전자서명 (실제 서버에서만) ----------
     계약 조건을 적어 만들면 서명 링크가 생기고, 고객이 링크에서 업체 정보·서명을 하면 저장된다.
     우리(을) 정보·서명은 "우리 정보·서명"에서 한 번 등록 → 새 계약서마다 자동으로 들어간다. */
  var ctBox = document.getElementById('admCt');
  var ctLoaded = false, ctData = { items: [], our: {}, hasOurSig: false };
  function copyText(t, btn, label) {
    (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(function () { btn.textContent = '복사했어요'; }, function () { window.prompt('길게 눌러 복사하세요', t); })
      .then(function () { setTimeout(function () { if (btn.isConnected) btn.textContent = label; }, 1800); });
  }
  function ctMsg(url, total) {
    var o = ctData.our || {};
    var acc = o.account ? '\n\n입금 계좌\n' + (o.bank ? o.bank + ' ' : '') + o.account + (o.holder ? ' (예금주 ' + o.holder + ')' : '') + (total ? '\n입금 금액 ' + Number(total).toLocaleString('ko-KR') + '원' : '') : '';
    return '계약서 보내드려요\n아래 링크 열어서 내용 확인하시고 맨 아래에 업체 정보 적고 서명해 주시면 돼요\n서명하시면 계약서를 PDF로 저장하실 수 있어요\n' + url + acc;
  }
  function accOnly() { var o = ctData.our || {}; return o.account ? o.account.replace(/[^0-9-]/g, '') : ''; }
  function won(n) { return n ? Number(n).toLocaleString('ko-KR') + '원' : '-'; }
  function ctList(flash, created) {
    ctBox.textContent = ''; ctBox.appendChild(el('p', 'adm-none', '계약서를 불러오는 중이에요…'));
    return api('GET', '/api/admin/contracts').then(function (j) { ctData = j; ctRender(flash, created); })
      .catch(function (e) { if (e && e.message === 'auth') return; ctBox.textContent = ''; ctBox.appendChild(el('p', 'adm-none', '계약서를 불러오지 못했어요. 새로고침해 주세요.')); });
  }
  function ctRender(flash, created) {
    ctBox.textContent = '';
    var bar = el('div', 'pfa-bar');
    var add = button('+ 새 계약서', 'btn btn-ink'); add.addEventListener('click', function () { ctNew(); });
    var our = button('우리 정보·서명'); our.addEventListener('click', ctOur);
    bar.appendChild(add); bar.appendChild(our); ctBox.appendChild(bar);
    if (!ctData.hasOurSig) {
      var w = el('div', 'ct-warn');
      w.appendChild(el('p', null, '우리(을) 서명이 아직 없어요. 한 번 등록해 두면 새 계약서마다 자동으로 들어가요.'));
      var go = button('서명 등록하기', 'btn btn-ink btn-sm'); go.addEventListener('click', ctOur); w.appendChild(go);
      ctBox.appendChild(w);
    }
    if (flash) ctBox.appendChild(el('p', 'pfa-flash', flash));
    if (created) {
      var box = el('div', 'ct-made');
      box.appendChild(el('h3', null, '서명 링크가 만들어졌어요'));
      box.appendChild(el('p', 'pfa-hint', '아래 문구를 복사해서 고객 카톡으로 보내주세요. 고객이 서명하면 이 목록에 "서명 완료"로 바뀌어요.'));
      var ci = (ctData.items || []).filter(function (x) { return x.url === created; })[0], ctot = ci && ci.terms ? ci.terms.priceTotal : 0;
      var pre = el('pre', 'ct-pre', ctMsg(created, ctot)); box.appendChild(pre);
      var acts = el('div', 'pfa-adds');
      var cm = button('카톡 문구 복사', 'btn btn-ink btn-sm'); cm.addEventListener('click', function () { copyText(ctMsg(created, ctot), cm, '카톡 문구 복사'); });
      var cl = button('링크만 복사'); cl.addEventListener('click', function () { copyText(created, cl, '링크만 복사'); });
      var op = el('a', 'btn btn-outline btn-sm', '계약서 열어보기'); op.href = created; op.target = '_blank'; op.rel = 'noopener';
      acts.appendChild(cm); acts.appendChild(cl);
      if (accOnly()) { var ca = button('계좌번호만 복사'); ca.addEventListener('click', function () { copyText(accOnly(), ca, '계좌번호만 복사'); }); acts.appendChild(ca); }
      acts.appendChild(op); box.appendChild(acts);
      ctBox.appendChild(box);
    }
    var items = ctData.items || [];
    if (!items.length) { ctBox.appendChild(el('p', 'adm-none', '아직 만든 계약서가 없어요. "새 계약서"를 눌러 계약 조건을 적으면 고객에게 보낼 서명 링크가 생겨요.')); return; }
    var list = el('div', 'pfa-list');
    items.forEach(function (c) {
      var t = c.terms || {}, signed = c.status === 'signed';
      var row = el('article', 'pfa-row ct-row');
      var info = el('div', 'pfa-info');
      var top = el('div', 'adm-top');
      top.appendChild(el('span', 'stpill ' + (signed ? 'stpill-contacted' : 'stpill-new'), signed ? '서명 완료' : '서명 대기'));
      top.appendChild(el('span', 'adm-date', '만든 날 ' + fmtDate(c.createdAt)));
      info.appendChild(top);
      info.appendChild(el('h3', null, (t.client || '상호 고객 입력') + ' · ' + (t.account ? '@' + t.account : '계정 고객 입력')));
      info.appendChild(el('p', 'pfa-sub', (t.start || '') + ' ~ ' + (t.end || '') + ' · 총 ' + won(t.priceTotal) + ' (부가세 ' + (t.vat || '') + ') · 월 ' + (t.postsMonthly || 0) + '회'));
      if (signed) {
        var sg = c.signer || {};
        info.appendChild(el('p', 'pfa-hl', '서명 ' + fmtDate(c.signedAt) + ' · ' + (sg.ceo || '') + ' · ' + (sg.phone || '') + ' · 포트폴리오 ' + (sg.consent === 'yes' ? '동의' : '미동의')));
      } else {
        info.appendChild(el('p', 'pfa-sub', c.viewedAt ? '고객이 열어봄 ' + fmtDate(c.viewedAt) : '고객이 아직 안 열어봤어요'));
      }
      row.appendChild(info);
      var act = el('div', 'pfa-act');
      var op = el('a', 'btn btn-ink btn-sm', signed ? '계약서 보기' : '열어보기'); op.href = c.url; op.target = '_blank'; op.rel = 'noopener';
      act.appendChild(op);
      if (signed) { var pdf = el('a', 'btn btn-outline btn-sm', 'PDF 받기'); pdf.href = c.url + '/contract.pdf'; act.appendChild(pdf); }
      if (!signed) { var edb = button('수정'); edb.addEventListener('click', function () { ctNew(c); }); act.appendChild(edb); }
      if (!signed) {
        var cm = button('카톡 문구 복사'); cm.addEventListener('click', function () { copyText(ctMsg(c.url, t.priceTotal), cm, '카톡 문구 복사'); });
        act.appendChild(cm);
      }
      var cl = button('링크 복사'); cl.addEventListener('click', function () { copyText(c.url, cl, '링크 복사'); });
      act.appendChild(cl);
      if (accOnly()) { var cac = button('계좌번호 복사'); cac.addEventListener('click', function () { copyText(accOnly(), cac, '계좌번호 복사'); }); act.appendChild(cac); }
      var del = button('삭제', 'btn btn-outline btn-sm adm-del');
      del.addEventListener('click', function () {
        if (!del.dataset.armed) {
          del.dataset.armed = '1'; del.textContent = signed ? '서명된 계약서예요 · 한 번 더 누르면 삭제' : '한 번 더 누르면 삭제';
          setTimeout(function () { if (del.isConnected) { delete del.dataset.armed; del.textContent = '삭제'; } }, 4000);
          return;
        }
        del.disabled = true;
        api('DELETE', '/api/admin/contracts/' + c.id).then(function () { ctList('계약서를 삭제했어요. 보냈던 링크도 더 이상 열리지 않아요.'); }, function () { del.disabled = false; del.textContent = '삭제하지 못했어요'; });
      });
      act.appendChild(del);
      row.appendChild(act);
      list.appendChild(row);
    });
    ctBox.appendChild(list);
  }

  function ctHead(title) {
    var head = el('div', 'pfa-head'); head.appendChild(el('h2', null, title));
    var back = button('목록으로'); back.addEventListener('click', function () { ctRender(); }); head.appendChild(back);
    return head;
  }
  function ctField(label, inp, hint, wide) {
    var w = el('div', 'pfa-field' + (wide ? ' wide' : '')); inp.id = 'ct-' + Math.random().toString(36).slice(2, 8);
    var l = el('label', null, label); l.setAttribute('for', inp.id);
    w.appendChild(l); w.appendChild(inp); if (hint) w.appendChild(el('p', 'pfa-hint', hint)); return w;
  }
  function ctInput(type, val, ph) { var i = el('input'); i.type = type || 'text'; if (val != null) i.value = val; if (ph) i.placeholder = ph; return i; }
  function ctSelect(opts, val) { var s = el('select'); opts.forEach(function (o) { var x = el('option', null, o); x.value = o; if (o === val) x.selected = true; s.appendChild(x); }); return s; }
  function iso(d) { return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  function parseD(s) { var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || ''); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; }
  function digits(s) { return parseInt(String(s || '').replace(/[^\d]/g, ''), 10) || 0; }

  function ctNew(src) {
    var T = (src && src.terms) || null; // 수정이면 기존 조건
    ctBox.textContent = '';
    var f = el('form', 'pfa-form'); f.noValidate = true;
    f.appendChild(ctHead(T ? '계약서 수정 (서명 전)' : '새 계약서'));
    f.appendChild(el('p', 'pfa-hint', T ? '고객이 서명하기 전이라 고칠 수 있어요. 저장하면 보냈던 링크에도 바로 반영돼요.' : '기간·금액·시작일만 정하면 돼요. 고객 상호와 스레드 계정은 모르면 비워두세요. 고객이 계약서 링크에서 직접 적어요(필수 입력). 우리(을) 정보와 서명은 자동으로 들어가요.'));
    var askPre = null, askCp = null;
    if (!T) {
      // 기간을 아직 모를 때: 고객에게 먼저 물어보는 문구 (시작일은 아래 시작일 칸 기준)
      var ask = el('div', 'ct-made ct-ask');
      ask.appendChild(el('h3', null, '기간을 아직 모를 때 · 고객에게 먼저 물어보기'));
      askPre = el('pre', 'ct-pre'); ask.appendChild(askPre);
      askCp = button('문구 복사', 'btn btn-ink btn-sm'); ask.appendChild(askCp);
      f.appendChild(ask);
    }
    // 요금제: 고르면 기간·횟수·금액이 한 번에 채워짐
    // list = 정상가(그 기간 원래 금액), total = 실제 받는 금액 (중도 해지는 총 계약금액 ÷ 개월 수로 정산)
    var PLAN = {
      'ev-1': ['이벤트 · 1개월 · 10만 원 · 총 20회', 20, 1, 200000, 100000, 0],
      'ev-2': ['이벤트 · 2개월 · 20만 원 · 총 50회 (서비스 10회)', 20, 2, 360000, 200000, 10],
      'ev-3': ['이벤트 · 3개월 · 25만 원 · 총 90회 (서비스 30회)', 20, 3, 530000, 250000, 30],
      '20-1': ['월 20회 · 1개월 · 20만 원', 20, 1, 200000, 200000, 0],
      '20-2': ['월 20회 · 2개월 · 36만 원', 20, 2, 400000, 360000, 0],
      '20-3': ['월 20회 · 3개월 · 53만 원', 20, 3, 600000, 530000, 0],
      '35-1': ['월 35회 · 1개월 · 28만 원', 35, 1, 280000, 280000, 0],
      '35-2': ['월 35회 · 2개월 · 52만 원', 35, 2, 560000, 520000, 0],
      '35-3': ['월 35회 · 3개월 · 77만 원', 35, 3, 840000, 770000, 0]
    };
    var planSel = el('select'); var o0 = el('option', null, T ? '바꿀 때만 고르기' : '직접 입력'); o0.value = ''; planSel.appendChild(o0);
    Object.keys(PLAN).forEach(function (k) { var x = el('option', null, PLAN[k][0]); x.value = k; planSel.appendChild(x); });
    var pg = el('div', 'pfa-grid'); pg.appendChild(ctField('요금제', planSel, '고르면 기간·횟수·금액이 자동으로 채워져요. 이벤트가처럼 다르게 받을 땐 총 계약금액만 고치면 돼요.', true)); f.appendChild(pg);
    var g = el('div', 'pfa-grid');
    var v = function (k, d) { return T && T[k] != null && T[k] !== 0 && T[k] !== '' ? String(T[k]) : (d == null ? '' : String(d)); };
    var client = ctInput('text', v('client'), '예: 행컵 안산한양대점'); client.maxLength = 100;
    var account = ctInput('text', v('account'), '예: hangcup_ansan (@ 없이)'); account.maxLength = 60;
    var nm0 = new Date();
    var start = ctInput('date', v('start', iso(new Date(nm0.getFullYear(), nm0.getMonth() + 1, 1))));
    var months = ctInput('number', v('months', 1)); months.min = 1; months.max = 60;
    var end = ctInput('date', v('end'));
    var tS = ctInput('date', v('testStart')), tE = ctInput('date', v('testEnd'));
    var pList = ctInput('text', v('priceList'), '예: 530000'); pList.inputMode = 'numeric';
    var pTot = ctInput('text', v('priceTotal'), '예: 250000'); pTot.inputMode = 'numeric';
    var vat = ctSelect(['별도', '포함'], (T && T.vat) || '별도');
    var poM = ctInput('number', v('postsMonthly', 20)); poM.min = 1;
    var poT = ctInput('number', v('postsTotal')); poT.placeholder = '자동 계산';
    var poB = ctInput('number', v('postsBonus', 0)); poB.min = 0;
    var pay = ctSelect(['일시불 선결제', '매월 선결제'], (T && T.payment) || '일시불 선결제');
    var rep = ctInput('date', v('firstReport'));
    var rev = ctInput('number', v('revisions', 2)); rev.min = 1; rev.max = 10;
    g.appendChild(ctField('고객 상호', client, '모르면 비워두기 → 고객이 직접 입력'));
    g.appendChild(ctField('스레드 계정', account, '모르면 비워두기 → 고객이 직접 입력'));
    g.appendChild(ctField('시작일 *', start));
    g.appendChild(ctField('개월 수 *', months, '시작일과 개월 수를 넣으면 종료일이 자동으로 채워져요.'));
    g.appendChild(ctField('종료일 *', end));
    g.appendChild(ctField('첫 주간 보고일', rep, '시작하고 첫 화요일로 자동으로 채워져요.'));
    g.appendChild(ctField('테스트 기간 시작 (없으면 비워두기)', tS));
    g.appendChild(ctField('테스트 기간 종료', tE));
    g.appendChild(ctField('총 계약금액 * (실제로 받는 금액)', pTot));
    g.appendChild(ctField('정상가 (이 기간 원래 금액)', pList, '총 계약금액보다 크면 계약서에 "정상가 → 할인 금액"이 같이 나와요. 할인이 없으면 비워두세요.'));
    g.appendChild(ctField('부가세', vat));
    g.appendChild(ctField('월 발행 횟수 *', poM));
    g.appendChild(ctField('기본 발행 횟수 (환불 기준)', poT, '월 발행 횟수 × 개월 수로 자동 계산돼요.'));
    g.appendChild(ctField('서비스 횟수 (덤)', poB, '이벤트로 더 드리는 횟수예요. 기본 횟수를 다 쓴 뒤부터 차감하고 환불 계산에는 안 들어가요.'));
    g.appendChild(ctField('결제 방식', pay));
    g.appendChild(ctField('수정 횟수 (글 한 건당)', rev));
    f.appendChild(g);
    var poTouched = !!(T && T.postsTotal);
    poT.addEventListener('input', function () { poTouched = true; });
    function auto() {
      var n = Math.max(1, digits(months.value)), sd = parseD(start.value);
      if (sd) {
        var e = new Date(sd.getFullYear(), sd.getMonth() + n, sd.getDate() - 1); end.value = iso(e);
        var r = new Date(sd.getFullYear(), sd.getMonth(), sd.getDate() + 6); while (r.getDay() !== 2) r.setDate(r.getDate() + 1); rep.value = iso(r);
      }
      if (!poTouched && digits(poM.value)) poT.value = String(digits(poM.value) * n);
    }
    [start, months, poM].forEach(function (x) { x.addEventListener('input', auto); x.addEventListener('change', auto); });
    if (askPre) {
      var askText = function () {
        var sd = parseD(start.value);
        var when = sd ? (sd.getMonth() + 1) + '월 ' + sd.getDate() + '일' : '11월';
        return '계정 대행 운영은 ' + when + '부터 시작됩니다\n\n진행 기간 선택 해주세요! (1개월 10만 원 / 2개월 20만 원 / 3개월 25만 원) - \n\n상호랑 계정 같은 나머지 정보는 계약서 링크에서 직접 적으시면 됩니다 :)';
      };
      var updAsk = function () { askPre.textContent = askText(); };
      start.addEventListener('input', updAsk); start.addEventListener('change', updAsk);
      askCp.addEventListener('click', function () { copyText(askText(), askCp, '문구 복사'); });
      updAsk();
    }
    if (!T) auto();
    planSel.addEventListener('change', function () {
      var p = PLAN[planSel.value]; if (!p) return;
      poM.value = String(p[1]); months.value = String(p[2]);
      pList.value = p[3] > p[4] ? String(p[3]) : ''; pTot.value = String(p[4]); poB.value = String(p[5] || 0);
      poTouched = false; auto();
    });
    var foot = el('div', 'pfa-save ct-save');
    var sv = el('button', 'btn btn-ink', T ? '수정 저장' : '계약서 만들고 링크 받기'); sv.type = 'submit';
    var st = el('p', 'adm-msg'); foot.appendChild(sv); foot.appendChild(st); f.appendChild(foot);
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      var body = { client: client.value, account: account.value, start: start.value, end: end.value, months: digits(months.value),
        testStart: tS.value, testEnd: tE.value, priceList: digits(pList.value), priceTotal: digits(pTot.value),
        vat: vat.value, postsMonthly: digits(poM.value), postsTotal: digits(poT.value), postsBonus: digits(poB.value), payment: pay.value, firstReport: rep.value, revisions: digits(rev.value) || 2 };
      sv.disabled = true; st.textContent = '저장하는 중…';
      (T ? api('PUT', '/api/admin/contracts/' + src.id, body) : api('POST', '/api/admin/contracts', body)).then(function (j) {
        if (T) ctList('계약서를 수정했어요. 보냈던 링크에도 바로 반영돼요.'); else ctList(null, j.url);
      }, function (err) {
        sv.disabled = false; if (err && err.message === 'auth') return;
        st.textContent = (err && err.message && err.message !== 'error') ? err.message : '저장하지 못했어요. 잠시 후 다시 시도해 주세요.';
      });
    });
    ctBox.appendChild(f);
    window.scrollTo(0, ctBox.getBoundingClientRect().top + window.pageYOffset - 90);
  }

  function ctOur() {
    ctBox.textContent = '';
    var o = ctData.our || {};
    var f = el('form', 'pfa-form'); f.noValidate = true;
    f.appendChild(ctHead('우리(을) 정보·서명'));
    f.appendChild(el('p', 'pfa-hint', '여기 적은 정보·계좌·서명이 계약서의 을(대행사) 칸에 들어가요. 아직 서명 전인 계약서에도 바로 반영되고, 고객이 서명을 끝낸 계약서는 그대로 유지돼요.'));
    var g = el('div', 'pfa-grid');
    var nm = ctInput('text', o.name), ceo = ctInput('text', o.ceo), bz = ctInput('text', o.bizno), ph = ctInput('text', o.phone, '예: 010-0000-0000'), ad = ctInput('text', o.addr);
    g.appendChild(ctField('상호 *', nm)); g.appendChild(ctField('대표자 *', ceo)); g.appendChild(ctField('사업자등록번호', bz)); g.appendChild(ctField('연락처', ph));
    g.appendChild(ctField('주소', ad, null, true));
    var bk = ctInput('text', o.bank, '예: 국민은행'), acn = ctInput('text', o.account, '예: 123456-01-123456'), hd = ctInput('text', o.holder, '예: 김가영(바이란미디어)');
    acn.inputMode = 'numeric';
    g.appendChild(ctField('입금 은행', bk)); g.appendChild(ctField('계좌번호', acn, '적으면 계약서 제2조와 서명 끝난 화면에 입금 계좌로 나와요.'));
    g.appendChild(ctField('예금주', hd));
    f.appendChild(g);
    var sw = el('div', 'ct-pad-wrap');
    var sh = el('div', 'ct-pad-head'); sh.appendChild(el('span', null, '서명'));
    var clr = button('다시 쓰기'); sh.appendChild(clr); sw.appendChild(sh);
    if (ctData.hasOurSig) {
      var curW = el('div', 'ct-cur'); curW.appendChild(el('span', 'pfa-hint', '지금 등록된 서명'));
      var ci = el('img'); ci.src = '/api/admin/contracts/our-sig.png?t=' + Date.now(); ci.alt = '지금 등록된 서명'; curW.appendChild(ci); sw.appendChild(curW);
    }
    var cv = el('canvas', 'ct-pad'); sw.appendChild(cv);
    sw.appendChild(el('p', 'pfa-hint', ctData.hasOurSig ? '바꾸고 싶을 때만 칸 안에 새로 서명하세요. 비워두면 지금 서명을 그대로 써요.' : '손가락이나 마우스로 칸 안에 서명하세요.'));
    var upL = el('label', 'btn btn-outline btn-sm pfa-file', '도장·서명 사진으로 넣기');
    var up = el('input'); up.type = 'file'; up.accept = 'image/*'; up.className = 'pfa-file-in'; upL.appendChild(up);
    var upPrev = el('img', 'ct-upprev'); upPrev.hidden = true;
    sw.appendChild(upL); sw.appendChild(upPrev);
    f.appendChild(sw);
    var foot = el('div', 'pfa-save ct-save');
    var sv = el('button', 'btn btn-ink', '저장'); sv.type = 'submit'; var st = el('p', 'adm-msg');
    foot.appendChild(sv); foot.appendChild(st); f.appendChild(foot);
    ctBox.appendChild(f);
    var pad = window.ByranPad ? window.ByranPad(cv) : null;
    var upData = '';
    clr.addEventListener('click', function () { if (pad) pad.clear(); upData = ''; upPrev.hidden = true; });
    up.addEventListener('change', function () {
      var file = up.files && up.files[0]; up.value = ''; if (!file) return;
      var url = URL.createObjectURL(file), im = new Image();
      im.onload = function () {
        var s = Math.min(1, 600 / im.naturalWidth, 300 / im.naturalHeight);
        var c = document.createElement('canvas'); c.width = Math.round(im.naturalWidth * s); c.height = Math.round(im.naturalHeight * s);
        c.getContext('2d').drawImage(im, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
        upData = c.toDataURL('image/png'); upPrev.src = upData; upPrev.hidden = false; if (pad) pad.clear();
      };
      im.onerror = function () { URL.revokeObjectURL(url); st.textContent = '이 사진은 넣을 수 없어요. JPG나 PNG로 넣어주세요.'; };
      im.src = url;
    });
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      var body = { name: nm.value, ceo: ceo.value, bizno: bz.value, phone: ph.value, addr: ad.value, bank: bk.value, account: acn.value, holder: hd.value };
      if (upData) body.sig = upData; else if (pad && !pad.isEmpty()) body.sig = pad.toPng();
      if (!ctData.hasOurSig && !body.sig) { st.textContent = '서명을 해주세요.'; return; }
      sv.disabled = true; st.textContent = '저장하는 중…';
      api('PUT', '/api/admin/contracts/our', body).then(function () { ctList('우리 정보와 서명을 저장했어요. 서명 전인 계약서에도 바로 반영돼요.'); }, function (err) {
        sv.disabled = false; if (err && err.message === 'auth') return;
        st.textContent = (err && err.message && err.message !== 'error') ? err.message : '저장하지 못했어요.';
      });
    });
    window.scrollTo(0, ctBox.getBoundingClientRect().top + window.pageYOffset - 90);
  }


  if (inClaude) startClaude(); else startServer();
})();
