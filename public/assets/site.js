
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
    btns.forEach(function (b) {
      b.addEventListener('click', function () {
        btns.forEach(function (x) { x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); });
        if (price) price.textContent = b.dataset.price;
        if (unit) unit.textContent = b.dataset.unit;
        if (sub) sub.textContent = b.dataset.sub;
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
    tabs.forEach(function (b) {
      b.addEventListener('click', function () {
        tabs.forEach(function (x) { x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); });
        var f = b.dataset.filter;
        document.querySelectorAll('[data-cat]').forEach(function (c) {
          c.hidden = !(f === 'all' || c.dataset.cat === f);
        });
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

    var map = { diagnosis: 'svc-diag', blog: 'svc-blog', threads: 'svc-threads', bloghome: 'svc-bloghome', website: 'svc-website' };
    // 주소 끝(#blog 등)에 맞춰 문의 서비스를 미리 선택하고, 서비스 문의면 작성 칸으로 이동
    function applyHash(scroll) {
      var hash = (location.hash || '').replace('#', '');
      var el = map[hash] && document.getElementById(map[hash]);
      if (!el) return;
      el.checked = true;
      if (scroll && hash !== 'diagnosis') {
        var card = form.closest('.form-card') || form;
        var go = function () { card.scrollIntoView({ block: 'start' }); };
        if (document.readyState === 'complete') go();
        else window.addEventListener('load', function () { setTimeout(go, 0); }, { once: true });
      }
    }
    applyHash(true);
    window.addEventListener('hashchange', function () { applyHash(true); });

    function val(id) { var e = document.getElementById(id); return e ? e.value.trim() : ''; }
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
        services: Array.prototype.slice.call(form.querySelectorAll('input[name="svc"]:checked')).map(function (i) { return i.value; }),
        link: val('inqLink'),
        message: val('inqMsg'),
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
      data.status = 'new';
      data.memo = '';
      data.createdAt = new Date().toISOString();

      btn.disabled = true;
      say('문의를 보내는 중이에요…');
      saveInquiry(data).then(function () {
        form.reset();
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
