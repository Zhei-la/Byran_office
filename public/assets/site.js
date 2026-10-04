
(function () {
  // mobile nav
  var t = document.getElementById('navToggle'), n = document.getElementById('siteNav');
  if (t && n) {
    t.addEventListener('click', function () {
      var o = n.classList.toggle('open');
      t.setAttribute('aria-expanded', o ? 'true' : 'false'); t.setAttribute('aria-label', o ? '메뉴 닫기' : '메뉴 열기');
    });
  }

  // 기간 선택 (스레드 1개월 / 2개월)
  document.querySelectorAll('[data-period-card]').forEach(function (card) {
    var btns = card.querySelectorAll('[data-period]');
    // 버튼에도 data-price 등이 있으므로 버튼을 제외하고 표시 영역만 고른다
    var price = card.querySelector('[data-price]:not([data-period])');
    var unit = card.querySelector('[data-unit]:not([data-period])');
    var sub = card.querySelector('[data-sub]:not([data-period])');
    var was = card.querySelector('[data-was]:not([data-period])');
    btns.forEach(function (b) {
      b.addEventListener('click', function () {
        btns.forEach(function (x) { x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); });
        if (price) price.textContent = b.dataset.price;
        if (unit) unit.textContent = b.dataset.unit;
        if (sub) sub.textContent = b.dataset.sub;
        if (was) { was.textContent = b.dataset.was || ''; was.hidden = !b.dataset.was; }
      });
    });
  });

  function copyText(text) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        return navigator.clipboard.writeText(text).then(function () { return true; }, function () { return false; });
      }
    } catch (e) {}
    return Promise.resolve(false);
  }

  document.querySelectorAll('[data-copy]').forEach(function (b) {
    b.addEventListener('click', function () {
      var old = b.textContent;
      copyText(b.dataset.copy).then(function (ok) {
        b.textContent = ok ? '복사됨' : '길게 눌러 복사해 주세요';
        setTimeout(function () { b.textContent = old; }, 1800);
      });
    });
  });

  // 포트폴리오 필터
  var tabs = document.querySelectorAll('[data-filter]');
  if (tabs.length) {
    // 메인에서 portfolio.html#blog 처럼 들어오면 해당 서비스만 보여주기
    setTimeout(function () {
      var key = (location.hash || '').replace('#', '');
      var t = key && document.querySelector('[data-filter="' + key + '"]');
      if (t) t.click();
    }, 0);
    tabs.forEach(function (b) {
      b.addEventListener('click', function () {
        tabs.forEach(function (x) { x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); });
        var f = b.dataset.filter;
        document.querySelectorAll('[data-cat]').forEach(function (c) {
          c.hidden = c.dataset.cat !== f;
        });
        if (history.replaceState) history.replaceState(null, '', '#' + f);
      });
    });
  }

  // 통계 사진 크게 보기
  var zooms = document.querySelectorAll('[data-zoom]');
  if (zooms.length && typeof HTMLDialogElement === 'function') {
    var lb = document.createElement('dialog'); lb.className = 'lb';
    lb.innerHTML = '<button type="button" class="lb-x" aria-label="닫기">×</button><img alt=""><p class="lb-cap"></p>';
    document.body.appendChild(lb);
    var lbImg = lb.querySelector('img'), lbCap = lb.querySelector('.lb-cap');
    lb.querySelector('.lb-x').addEventListener('click', function () { lb.close(); });
    lb.addEventListener('click', function (e) { if (e.target === lb) lb.close(); });
    zooms.forEach(function (a) {
      a.addEventListener('click', function (e) {
        e.preventDefault();
        var im = a.querySelector('img');
        lbImg.src = a.getAttribute('href'); lbImg.alt = im ? im.alt : '';
        var card = a.closest('.pf-card'), h = card && card.querySelector('h3');
        lbCap.textContent = h ? h.textContent : '';
        lb.showModal();
      });
    });
  }

  // 문의 접수 → 관리자 문의함에 저장
  // 실제 사이트: 같은 서버의 /api/inquiry 로 보냄 (바이란 관리자 > 문의 탭에 쌓임)
  // Claude 미리보기: 미리보기 전용 저장소(db)에 저장, admin.html 에서 확인
  var INQUIRY_API = document.body.getAttribute('data-inquiry-api') || '/api/inquiry';
  var inClaude = !!(window.claude && typeof window.claude.use === 'function');

  function saveInquiry(data) {
    if (inClaude) {
      return window.claude.use('db').then(function (db) {
        if (!db) { var e = new Error('preview'); e.code = 'preview'; throw e; }
        return db.collection('inquiries').add(data).catch(function (err) {
          var e = new Error('preview'); e.code = (err && err.code) || 'preview'; throw e;
        });
      });
    }
    return fetch(INQUIRY_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(data)
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok || !j.ok) { var e = new Error(j.error || 'server'); e.server = j.error; throw e; }
        return j;
      });
    });
  }

  var form = document.getElementById('inqForm');
  if (form) {
    var status = document.getElementById('inqStatus');
    var btn = document.getElementById('inqSend');
    var done = document.getElementById('inqDone');
    var again = document.getElementById('inqAgain');
    var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
    var PHONE_RE = /^[0-9+\-\s().]{8,20}$/;


    /* ---------- 구성 선택 + 예상 비용 (문의하기 상단) ---------- */
    var quote = (function () {
      var opts = document.getElementById('qOpts');
      if (!opts) return null;
      var PRICE = { blog: { basic: 20, standard: 30 }, threads: { '20': { '1m': 15, '2m': 26 }, '50': { '1m': 22, '2m': 40 } }, bloghome: 10, website: 15, diag: 0 };
      var state = { blogPlan: 'basic', blogMonths: 1, threadsPlan: '1m', threadsCount: '20' };
      var linesEl = document.getElementById('qLines'), emptyEl = document.getElementById('qEmpty');
      var totalEl = document.getElementById('qTotal'), barTotal = document.getElementById('qBarTotal');
      var summary = document.getElementById('qSummary');
      function won(n) { return n > 0 ? n.toLocaleString('ko-KR') + '만 원' : '0원'; }
      function card(k) { return opts.querySelector('[data-q="' + k + '"]'); }
      function on(k) { var c = card(k); return !!(c && c.querySelector('input').checked); }
      function items() {
        var list = [];
        if (on('blog')) {
          var m = PRICE.blog[state.blogPlan];
          list.push({ name: '블로그 운영 대행', detail: (state.blogPlan === 'basic' ? '월 12회' : '월 20회') + ' · ' + state.blogMonths + '개월', price: m * state.blogMonths });
        }
        if (on('threads')) list.push({ name: '스레드 운영 대행', detail: '월 ' + state.threadsCount + '회 이상 · ' + (state.threadsPlan === '1m' ? '1개월' : '2개월'), price: PRICE.threads[state.threadsCount][state.threadsPlan] });
        if (on('bloghome')) list.push({ name: '홈페이지형 블로그 제작', detail: '1회 제작 · 완성 후 수정 3회', price: PRICE.bloghome });
        if (on('website')) list.push({ name: '홈페이지 제작', detail: '1회 제작 · 완성 후 수정 3회', price: PRICE.website });
        if (on('diag')) list.push({ name: '무료 채널 진단', detail: '블로그·스레드·홈페이지 점검', price: 0 });
        return list;
      }
      function li(it) {
        var e = document.createElement('li');
        var a = document.createElement('span'); a.className = 'q-l-name'; a.textContent = it.name;
        var d = document.createElement('small'); d.textContent = it.detail; a.appendChild(d);
        var b = document.createElement('span'); b.className = 'q-l-price'; b.textContent = it.price ? won(it.price) : '무료';
        e.appendChild(a); e.appendChild(b); return e;
      }
      function render() {
        var list = items(), total = list.reduce(function (t, x) { return t + x.price; }, 0);
        opts.querySelectorAll('.q-card').forEach(function (c) { c.classList.toggle('on', c.querySelector('input').checked); });
        linesEl.textContent = ''; list.forEach(function (it) { linesEl.appendChild(li(it)); });
        emptyEl.hidden = list.length > 0;
        totalEl.textContent = won(total); if (barTotal) barTotal.textContent = won(total);
        var sb = card('blog'); if (sb) sb.querySelector('output').textContent = state.blogMonths + '개월';
        if (summary) {
          summary.textContent = '';
          if (!list.length) {
            var p = document.createElement('p'); p.className = 'q-sum-empty'; p.textContent = '선택한 서비스가 없어요. 일반 문의로 접수돼요.'; summary.appendChild(p);
          } else {
            var ul = document.createElement('ul'); list.forEach(function (it) { ul.appendChild(li(it)); }); summary.appendChild(ul);
            var t = document.createElement('p'); t.className = 'q-sum-total'; t.innerHTML = '<span>예상 비용</span><b></b>'; t.querySelector('b').textContent = won(total); summary.appendChild(t);
          }
          var ed = document.createElement('a'); ed.className = 'q-edit'; ed.href = '#quote'; ed.textContent = list.length ? '구성 바꾸기' : '구성 고르기'; summary.appendChild(ed);
        }
        return { list: list, total: total };
      }
      opts.addEventListener('change', render);
      opts.addEventListener('click', function (e) {
        var b = e.target.closest('button'); if (!b) return;
        var c = b.closest('.q-card'), k = c.getAttribute('data-q');
        if (b.hasAttribute('data-plan')) {
          b.parentNode.querySelectorAll('button').forEach(function (x) { x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); });
          if (k === 'blog') state.blogPlan = b.getAttribute('data-plan'); else state.threadsPlan = b.getAttribute('data-plan');
        } else if (b.hasAttribute('data-count')) {
          b.parentNode.querySelectorAll('button').forEach(function (x) { x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); });
          state.threadsCount = b.getAttribute('data-count');
        } else if (b.hasAttribute('data-step')) {
          state.blogMonths = Math.min(12, Math.max(1, state.blogMonths + parseInt(b.getAttribute('data-step'), 10)));
        }
        render();
      });
      // 휴대폰: 서비스 고르는 동안 아래에 합계 막대 표시
      var bar = document.getElementById('qBar'), panel = document.getElementById('qPanel');
      if (bar && 'IntersectionObserver' in window) {
        var seeOpts = false, seePanel = false;
        var upd = function () { bar.hidden = !(seeOpts && !seePanel && window.innerWidth <= 900); };
        new IntersectionObserver(function (en) { seeOpts = en[0].isIntersecting; upd(); }).observe(opts);
        new IntersectionObserver(function (en) { seePanel = en[0].isIntersecting; upd(); }).observe(panel);
        window.addEventListener('resize', upd);
      }
      render();
      return {
        render: render,
        text: function () {
          var r = render(); if (!r.list.length) return '';
          return r.list.map(function (it) { return it.name + ' (' + it.detail + ') ' + (it.price ? won(it.price) : '무료'); }).join('\n') + '\n예상 비용 합계: ' + won(r.total);
        },
        reset: function () {
          opts.querySelectorAll('input[name="svc"]').forEach(function (i) { i.checked = false; });
          state.blogPlan = 'basic'; state.blogMonths = 1; state.threadsPlan = '1m'; state.threadsCount = '20';
          opts.querySelectorAll('.seg').forEach(function (g) { g.querySelectorAll('button').forEach(function (x, i) { x.setAttribute('aria-pressed', i === 0 ? 'true' : 'false'); }); });
          render();
        }
      };
    })();

    var map = { diagnosis: 'svc-diag', blog: 'svc-blog', threads: 'svc-threads', bloghome: 'svc-bloghome', website: 'svc-website' };
    // 주소 끝(#blog 등)에 맞춰 문의 서비스를 미리 선택하고, 서비스 문의면 작성 칸으로 이동
    function applyHash(scroll) {
      var hash = (location.hash || '').replace('#', '');
      var el = map[hash] && document.getElementById(map[hash]);
      if (!el) return;
      el.checked = true;
      if (quote) quote.render();
      if (scroll && hash !== 'diagnosis') {
        var card = document.getElementById('quote') || form.closest('.form-card') || form;
        var go = function () { card.scrollIntoView({ block: 'start' }); };
        if (document.readyState === 'complete') go();
        else window.addEventListener('load', function () { setTimeout(go, 0); }, { once: true });
      }
    }
    applyHash(true);
    window.addEventListener('hashchange', function () { applyHash(true); });

    function val(id) { var e = document.getElementById(id); return e ? e.value.trim() : ''; }

    // 주소 여러 개: 채널 종류를 고르고 주소를 적는 줄을 추가·삭제
    var linksBox = document.getElementById('inqLinks');
    var addLink = document.getElementById('inqAddLink');
    var MAX_LINKS = 5;
    var HINT = { '블로그': '예: blog.naver.com/아이디', '스레드': '예: threads.net/@아이디', '홈페이지': '예: 회사홈페이지.com', '인스타그램': '예: instagram.com/아이디', '기타': '주소를 적어주세요' };
    function rows() { return linksBox ? Array.prototype.slice.call(linksBox.querySelectorAll('.link-row')) : []; }
    function syncRows() {
      var list = rows();
      list.forEach(function (r) { r.querySelector('.link-del').hidden = list.length < 2; });
      if (addLink) addLink.hidden = list.length >= MAX_LINKS;
    }
    function wireRow(r) {
      var sel = r.querySelector('.link-type'), inp = r.querySelector('.link-url');
      sel.addEventListener('change', function () { inp.placeholder = HINT[sel.value] || ''; });
      r.querySelector('.link-del').addEventListener('click', function () { r.remove(); syncRows(); var f = rows()[0]; if (f) f.querySelector('.link-url').focus(); });
    }
    if (linksBox) {
      rows().forEach(wireRow);
      var seq = 1;
      addLink.addEventListener('click', function () {
        if (rows().length >= MAX_LINKS) return;
        seq += 1;
        var r = rows()[0].cloneNode(true);
        var sel = r.querySelector('.link-type'), inp = r.querySelector('.link-url');
        sel.id = 'inqLinkType' + seq; inp.id = 'inqLink' + seq; inp.value = '';
        var used = rows().map(function (x) { return x.querySelector('.link-type').value; });
        var next = ['블로그', '스레드', '홈페이지', '인스타그램', '기타'].filter(function (t) { return used.indexOf(t) < 0; })[0] || '기타';
        sel.value = next; inp.placeholder = HINT[next];
        linksBox.appendChild(r); wireRow(r); syncRows(); inp.focus();
      });
      syncRows();
    }
    function collectLinks() {
      return rows().map(function (r) {
        return { type: r.querySelector('.link-type').value, url: r.querySelector('.link-url').value.trim() };
      }).filter(function (l) { return l.url; });
    }
    function resetLinks() {
      rows().forEach(function (r, i) { if (i > 0) r.remove(); });
      var f = rows()[0]; if (f) { f.querySelector('.link-type').value = '블로그'; f.querySelector('.link-url').placeholder = HINT['블로그']; }
      syncRows();
    }
    function mark(ids) {
      form.querySelectorAll('.invalid').forEach(function (x) { x.classList.remove('invalid'); });
      ids.forEach(function (id) {
        var el = document.getElementById(id);
        if (el) (el.closest('.field') || el.closest('.consent') || el).classList.add('invalid');
      });
      if (ids[0]) { var f = document.getElementById(ids[0]); if (f) f.focus(); }
    }
    function say(msg, isError) {
      status.textContent = msg;
      status.classList.toggle('error', !!isError);
    }

    form.addEventListener('input', function (e) {
      var box = e.target.closest('.invalid'); if (box) box.classList.remove('invalid');
    });

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var data = {
        name: val('inqName'),
        phone: val('inqPhone'),
        email: val('inqEmail'),
        business: val('inqBiz'),
        services: Array.prototype.slice.call(document.querySelectorAll('input[name="svc"]:checked')).map(function (i) { return i.value; }),
        links: collectLinks(),
        message: val('inqMsg'),
        estimate: quote ? quote.text() : '',
        agree: document.getElementById('inqAgree').checked,
        website: val('inqWebsite'),
        source: 'marketing'
      };
      if (data.website) { form.hidden = true; done.hidden = false; return; }  // 자동 프로그램
      if (!data.name) { mark(['inqName']); return say('상호 또는 성함을 적어주세요.', true); }
      if (!data.phone && !data.email) { mark(['inqPhone', 'inqEmail']); return say('연락받으실 전화번호나 이메일 중 하나는 적어주세요.', true); }
      if (data.phone && !PHONE_RE.test(data.phone)) { mark(['inqPhone']); return say('전화번호를 확인해 주세요. 예: 010-1234-5678', true); }
      if (data.email && !EMAIL_RE.test(data.email)) { mark(['inqEmail']); return say('이메일 형식을 확인해 주세요.', true); }
      if (!data.agree) { mark(['inqAgree']); return say('개인정보 수집·이용에 동의해 주셔야 문의를 남길 수 있어요.', true); }
      mark([]);
      delete data.website;
      data.link = data.links.map(function (l) { return l.type + ': ' + l.url; }).join('\n');
      data.status = 'new';
      data.memo = '';
      data.createdAt = new Date().toISOString();

      btn.disabled = true;
      say('문의를 보내는 중이에요…');
      saveInquiry(data).then(function () {
        form.reset();
        resetLinks();
        if (quote) quote.reset();
        say('');
        form.hidden = true;
        done.hidden = false;
        done.scrollIntoView({ block: 'center' });
      }, function (err) {
        if (err && err.code) {
          say('미리보기 화면에서는 페이지 주인만 문의를 남길 수 있어요. 실제 홈페이지에서는 누구나 남길 수 있어요.', true);
        } else {
          say((err && err.server) || '문의를 보내지 못했어요. 잠시 후 다시 시도해 주세요.', true);
        }
      }).then(function () { btn.disabled = false; });
    });

    again.addEventListener('click', function () {
      done.hidden = true; form.hidden = false; say('');
      document.getElementById('inqName').focus();
    });
  }

  // 미리보기에서 페이지 주인에게만 관리자 링크 보이기
  if (inClaude) {
    window.claude.use('user').then(function (user) {
      if (!user) return;
      return user.isOwner().then(function (own) {
        if (!own) return;
        document.querySelectorAll('.copyright').forEach(function (c) {
          var a = document.createElement('a');
          a.href = 'admin.html'; a.textContent = '관리자 · 문의함'; a.className = 'admin-link';
          c.appendChild(a);
        });
      });
    }).catch(function () {});
  }
})();


document.addEventListener('keydown',e=>{if(e.key==='Escape'){document.getElementById('siteNav')?.classList.remove('open');document.getElementById('navToggle')?.setAttribute('aria-expanded','false');}});
