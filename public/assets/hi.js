/* 사람 확인 신호: 스크롤·터치·클릭·키보드 중 하나를 하거나 화면을 6초 넘게 보면 한 번만 알림 (봇은 대부분 안 함) */
(function () {
  var sent = false, t = null, evs = ['scroll', 'touchstart', 'pointerdown', 'mousemove', 'keydown', 'wheel'];
  function send() {
    if (sent) return; sent = true;
    evs.forEach(function (e) { window.removeEventListener(e, send, true); });
    if (t) clearTimeout(t);
    try {
      if (navigator.sendBeacon) navigator.sendBeacon('/v/hi', '');
      else fetch('/v/hi', { method: 'POST', credentials: 'same-origin', keepalive: true });
    } catch (e) {}
  }
  evs.forEach(function (e) { window.addEventListener(e, send, { capture: true, passive: true }); });
  function arm() { if (!sent && document.visibilityState === 'visible' && !t) t = setTimeout(send, 6000); }
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState !== 'visible' && t) { clearTimeout(t); t = null; } else arm();
  });
  arm();
})();
