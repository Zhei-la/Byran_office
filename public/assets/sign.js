/* 바이란 마케팅 — 계약서 서명
   window.ByranPad(canvas) : 손가락·마우스로 서명하는 칸 (관리자 화면에서도 같이 씀)
   계약서 페이지(/c/...) : 업체 정보 + 서명 → 저장, 서명 끝난 뒤 PDF로 저장·인쇄 */
(function () {
  function ByranPad(canvas) {
    var ctx = canvas.getContext('2d');
    var strokes = [], cur = null, ratio = 1;
    function size() {
      var r = canvas.getBoundingClientRect();
      ratio = Math.max(1, window.devicePixelRatio || 1);
      canvas.width = Math.max(1, Math.round(r.width * ratio));
      canvas.height = Math.max(1, Math.round(r.height * ratio));
      redraw();
    }
    function line(pts) {
      if (!pts.length) return;
      var w = canvas.width, h = canvas.height;
      ctx.beginPath();
      ctx.moveTo(pts[0][0] * w, pts[0][1] * h);
      if (pts.length === 1) { ctx.lineTo(pts[0][0] * w + 0.1, pts[0][1] * h + 0.1); }
      for (var i = 1; i < pts.length - 1; i++) {
        var mx = (pts[i][0] + pts[i + 1][0]) / 2 * w, my = (pts[i][1] + pts[i + 1][1]) / 2 * h;
        ctx.quadraticCurveTo(pts[i][0] * w, pts[i][1] * h, mx, my);
      }
      if (pts.length > 1) ctx.lineTo(pts[pts.length - 1][0] * w, pts[pts.length - 1][1] * h);
      ctx.stroke();
    }
    function style() { ctx.strokeStyle = '#141614'; ctx.lineWidth = 2.6 * ratio; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; }
    function redraw() { ctx.clearRect(0, 0, canvas.width, canvas.height); style(); strokes.forEach(line); }
    function pt(e) { var r = canvas.getBoundingClientRect(); return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height]; }
    canvas.addEventListener('pointerdown', function (e) {
      e.preventDefault(); canvas.setPointerCapture(e.pointerId);
      cur = [pt(e)]; strokes.push(cur); redraw();
    });
    canvas.addEventListener('pointermove', function (e) {
      if (!cur) return; e.preventDefault();
      cur.push(pt(e)); redraw();
    });
    function end() { cur = null; if (pad.onchange) pad.onchange(); }
    canvas.addEventListener('pointerup', end); canvas.addEventListener('pointercancel', end);
    canvas.style.touchAction = 'none';
    window.addEventListener('resize', size);
    var pad = {
      clear: function () { strokes = []; redraw(); if (pad.onchange) pad.onchange(); },
      isEmpty: function () { var n = 0; strokes.forEach(function (s) { n += s.length; }); return n < 6; },
      // 서명 부분만 잘라서 투명 배경 PNG (최대 가로 640px)
      toPng: function () {
        var minX = 1, minY = 1, maxX = 0, maxY = 0;
        strokes.forEach(function (s) { s.forEach(function (p) { minX = Math.min(minX, p[0]); minY = Math.min(minY, p[1]); maxX = Math.max(maxX, p[0]); maxY = Math.max(maxY, p[1]); }); });
        var r = canvas.getBoundingClientRect(), pad0 = 10;
        var bw = Math.max(20, (maxX - minX) * r.width + pad0 * 2), bh = Math.max(20, (maxY - minY) * r.height + pad0 * 2);
        var s = Math.min(2, 640 / bw);
        var c = document.createElement('canvas'); c.width = Math.round(bw * s); c.height = Math.round(bh * s);
        var x = c.getContext('2d');
        x.strokeStyle = '#141614'; x.lineWidth = 2.6 * s; x.lineCap = 'round'; x.lineJoin = 'round';
        strokes.forEach(function (st) {
          var P = st.map(function (p) { return [((p[0] - minX) * r.width + pad0) * s, ((p[1] - minY) * r.height + pad0) * s]; });
          x.beginPath(); x.moveTo(P[0][0], P[0][1]);
          if (P.length === 1) x.lineTo(P[0][0] + 0.1, P[0][1] + 0.1);
          for (var i = 1; i < P.length - 1; i++) x.quadraticCurveTo(P[i][0], P[i][1], (P[i][0] + P[i + 1][0]) / 2, (P[i][1] + P[i + 1][1]) / 2);
          if (P.length > 1) x.lineTo(P[P.length - 1][0], P[P.length - 1][1]);
          x.stroke();
        });
        return c.toDataURL('image/png');
      },
      resize: size,
      onchange: null
    };
    size();
    return pad;
  }
  window.ByranPad = ByranPad;

  // 서명 끝난 계약서: PDF로 저장 · 인쇄
  var pr = document.getElementById('ctPrint');
  if (pr) pr.addEventListener('click', function () { window.print(); });
  // 계좌번호 복사 (계약서 표, 입금 안내)
  document.querySelectorAll('[data-copy]').forEach(function (btn) {
    var label = btn.textContent;
    btn.addEventListener('click', function () {
      var t = btn.getAttribute('data-copy');
      (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(function () { btn.textContent = '복사했어요'; }, function () { window.prompt('길게 눌러 복사하세요', t); })
        .then(function () { setTimeout(function () { btn.textContent = label; }, 1800); });
    });
  });

  // 고객 서명
  var form = document.getElementById('ctForm');
  if (!form) return;
  var canvas = document.getElementById('ctPad');
  var pad = ByranPad(canvas);
  var st = document.getElementById('ctStatus');
  document.getElementById('ctClear').addEventListener('click', function () { pad.clear(); });
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    st.className = 'status'; st.textContent = '';
    function bad(msg, focusEl) { st.className = 'status error'; st.textContent = msg; if (focusEl) focusEl.focus(); }
    var v = function (n) { return (form.elements[n].value || '').trim(); };
    var need = [['name', '상호를 적어주세요.'], ['ceo', '대표자 성함을 적어주세요.'], ['phone', '연락처를 적어주세요.'], ['addr', '주소를 적어주세요.']];
    for (var i = 0; i < need.length; i++) if (!v(need[i][0])) return bad(need[i][1], form.elements[need[i][0]]);
    if (form.elements.account && !v('account')) return bad('스레드 계정 아이디를 적어주세요.', form.elements.account);
    var consent = form.querySelector('input[name="consent"]:checked');
    if (!consent) return bad('포트폴리오 활용 동의 여부를 골라주세요.');
    if (pad.isEmpty()) return bad('서명 칸에 서명해 주세요.', canvas);
    var agree = document.getElementById('ctAgree');
    if (!agree.checked) return bad('계약 내용 동의에 체크해 주세요.', agree);
    var btn = form.querySelector('.ct-submit'); btn.disabled = true; st.textContent = '저장하는 중…';
    fetch('/api/c/' + encodeURIComponent(form.getAttribute('data-token')) + '/sign', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
      body: JSON.stringify({ account: form.elements.account ? v('account') : '', name: v('name'), ceo: v('ceo'), bizno: v('bizno'), phone: v('phone'), addr: v('addr'), consent: consent.value, agree: true, sig: pad.toPng() })
    }).then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { r: r, j: j }; }); })
      .then(function (x) {
        if (x.j.ok) { st.textContent = '서명했어요. 계약서를 다시 불러올게요…'; window.location.reload(); return; }
        btn.disabled = false; bad(x.j.error || '저장하지 못했어요. 잠시 후 다시 시도해 주세요.');
      }, function () { btn.disabled = false; bad('연결이 끊겼어요. 다시 시도해 주세요.'); });
  });
})();
