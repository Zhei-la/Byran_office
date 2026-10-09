/* 계약서 전자서명
   - 관리자 > 계약서 : 계약 조건(기간·금액·횟수)을 적고 만들면 서명 링크(/c/긴주소)가 생김
   - 우리(을) 정보·서명은 관리자에서 한 번 등록 → 계약서마다 자동으로 들어감
   - 고객(갑)은 링크를 열어 업체 정보를 적고 손가락으로 서명 → 저장
   - 서명이 끝난 계약서는 같은 링크에서 보고 "PDF로 저장"할 수 있음
   저장: DATABASE_URL 이 있으면 PostgreSQL, 없으면 data/ 폴더 (개발용) */
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');

const clip = (v, n) => String(v == null ? '' : v).trim().slice(0, n);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sha = (x) => crypto.createHash('sha256').update(x).digest('hex');
const PHONE_RE = /^[0-9+\-\s().]{8,20}$/;
const TOKEN_RE = /^[A-Za-z0-9_-]{20,40}$/;
const OUR_DEFAULT = { name: '바이란미디어', ceo: '김가영', bizno: '880-26-02267', addr: '울산광역시 북구 호계9길 52-5, 102호', phone: '', bank: '', account: '', holder: '' };

/* ---------------- 계약서 내용 ---------------- */
const won = (n) => (n ? Number(n).toLocaleString('ko-KR') + '원' : '');
function ymd(s) { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || ''); return m ? `${m[1]}.${m[2]}.${m[3]}` : clip(s, 20); }
function withDay(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || ''); if (!m) return clip(s, 20);
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return `${ymd(s)} (${'일월화수목금토'[d.getUTCDay()]})`;
}
/* 계약서 종류: 스레드 운영 대행 · 블로그 운영 대행 · 제작(홈페이지 / 홈페이지형 블로그) */
const KINDS = {
  threads: { doc: '스레드 운영 대행 계약서', svc: '스레드 계정 운영 대행', role: '대행사', acc: '스레드 계정 아이디', accPh: '예: @byran_shop', pf: '제12조', pay: '입금이 확인되면 운영을 시작해요 (제6조).' },
  blog: { doc: '블로그 운영 대행 계약서', svc: '블로그 운영 대행', role: '대행사', acc: '블로그 주소', accPh: '예: blog.naver.com/byran', pf: '제12조', pay: '입금이 확인되면 운영을 시작해요 (제6조).' },
  web: { doc: '홈페이지 제작 계약서', svc: '홈페이지 제작', role: '제작사', acc: '', accPh: '', pf: '제10조', pay: '입금이 확인되면 작업을 시작해요 (제7조).' },
  blogHome: { doc: '홈페이지형 블로그 제작 계약서', svc: '홈페이지형 블로그 제작', role: '제작사', acc: '블로그 주소', accPh: '예: blog.naver.com/byran', pf: '제10조', pay: '입금이 확인되면 작업을 시작해요 (제7조).' },
};
// terms → 위 표의 한 줄 (web 은 product 로 홈페이지 / 홈페이지형 블로그를 나눔)
function kindOf(t) {
  const k = (t && t.kind) || 'threads';
  if (k === 'web') return { key: 'web', ...(t.product === 'blogHome' ? KINDS.blogHome : KINDS.web) };
  return { key: k, ...(KINDS[k] || KINDS.threads) };
}
const DEPOSIT = '착수금 50% · 완성 후 잔금 50%';
function cleanTerms(b) {
  b = b || {};
  const num = (v, max) => Math.max(0, Math.min(max, parseInt(String(v).replace(/[^\d]/g, ''), 10) || 0));
  const kind = b.kind === 'blog' || b.kind === 'web' ? b.kind : 'threads';
  const revRaw = Math.max(0, Math.min(10, parseInt(b.revisions, 10) || 0));
  return {
    kind, product: kind === 'web' ? (b.product === 'blogHome' ? 'blogHome' : 'website') : '',
    due: kind === 'web' ? clip(b.due, 10) : '', scope: kind === 'web' ? clip(b.scope, 300) : '',
    adminPage: kind === 'web' && b.adminPage === true,
    extraFee: kind === 'web' ? (b.extraFee === undefined || b.extraFee === '' || b.extraFee === null ? 10000 : num(b.extraFee, 1e8)) : 0,
    charLimit: kind === 'blog' ? num(b.charLimit, 20000) : 0, images: kind === 'blog' ? num(b.images, 100) : 0,
    client: clip(b.client, 100), account: clip(b.account, 60).replace(/^@+/, ''),
    start: clip(b.start, 10), end: clip(b.end, 10), months: num(b.months, 60),
    testStart: clip(b.testStart, 10), testEnd: clip(b.testEnd, 10),
    priceList: num(b.priceList, 1e10), priceTotal: num(b.priceTotal, 1e10),
    vat: b.vat === '포함' ? '포함' : '별도',
    postsMonthly: num(b.postsMonthly, 1000), postsTotal: num(b.postsTotal, 100000), postsBonus: num(b.postsBonus, 100000),
    payment: (kind === 'web' && b.payment === DEPOSIT) ? DEPOSIT : (clip(b.payment, 80) || '일시불 선결제'), firstReport: kind === 'threads' ? clip(b.firstReport, 10) : '',
    revisions: revRaw || (kind === 'web' ? 3 : 2),
    portfolioRequired: b.portfolioRequired === true, // 이벤트가: 포트폴리오 활용 동의가 할인 조건
  };
}
function cleanOur(b) {
  b = b || {};
  return { name: clip(b.name, 100), ceo: clip(b.ceo, 50), bizno: clip(b.bizno, 20), addr: clip(b.addr, 200), phone: clip(b.phone, 40),
    bank: clip(b.bank, 30), account: clip(b.account, 40), holder: clip(b.holder, 40) };
}

// 계약서 본문 (만들 때 한 번 정해서 저장 — 나중에 문구를 바꿔도 이미 보낸 계약서는 그대로)
function buildBody(t, our) {
  const k = (t && t.kind) || 'threads';
  if (k === 'blog') return buildBlog(t, our);
  if (k === 'web') return buildWeb(t, our);
  return buildThreads(t, our);
}
const H = (x) => ({ t: 'h', x }), P = (x) => ({ t: 'p', x }), OL = (...items) => ({ t: 'ol', items: items.filter(Boolean) });
// 정상가·할인·총액 줄 (공통)
function priceRows(t, rows) {
  if (t.priceList && t.priceList > t.priceTotal) {
    rows.push(['정상가', `${won(t.priceList)}${t.kind !== 'web' && t.months ? ` (${t.months}개월)` : ''}`]);
    rows.push(['할인 금액', won(t.priceList - t.priceTotal)]);
  }
  rows.push(['총 계약금액', `${won(t.priceTotal)} (부가세 ${t.vat})`]);
}
// 발행 횟수 줄 (스레드·블로그 공통) → 기본 발행 횟수 반환
function postRows(t, rows) {
  const base = t.postsTotal || (t.postsMonthly * (t.months || 1));
  const bonus = t.postsBonus || 0;
  if (bonus) {
    rows.push(['발행 횟수', `총 ${base + bonus}회 (기본 ${base}회 + 서비스 ${bonus}회) · 월 ${t.postsMonthly}회 기준`]);
    rows.push(['서비스 횟수', `${bonus}회 · 기본 ${base}회를 모두 발행한 뒤부터 차감하며 환불 대상이 아님`]);
  } else {
    rows.push(['발행 횟수', `월 ${t.postsMonthly}회, 계약 기간 총 ${base}회`]);
  }
  return base;
}
function accRow(our) {
  return our.account ? ['입금 계좌', `${our.bank ? our.bank + ' ' : ''}${our.account}${our.holder ? ` (예금주 ${our.holder})` : ''}`] : null;
}
function buildThreads(t, our) {
  const rows = [
    ['서비스', '스레드 계정 운영 대행 (인스타그램 운영은 포함하지 않음)'],
    ['대상 계정', t.account ? '@' + t.account : '갑이 서명할 때 입력'],
    ['계약 기간', `${ymd(t.start)} ~ ${ymd(t.end)}${t.months ? ` (${t.months}개월)` : ''}`],
  ];
  if (t.testStart || t.testEnd) rows.push(['테스트 기간', `${ymd(t.testStart)} ~ ${ymd(t.testEnd)}`]);
  if (t.priceList && t.priceList > t.priceTotal) {
    rows.push(['정상가', `${won(t.priceList)}${t.months ? ` (${t.months}개월)` : ''}`]);
    rows.push(['할인 금액', won(t.priceList - t.priceTotal)]);
  }
  rows.push(['총 계약금액', `${won(t.priceTotal)} (부가세 ${t.vat})`]);
  // 기본 발행 횟수(환불 기준) + 서비스 횟수(덤, 환불 대상 아님)
  const base = t.postsTotal || (t.postsMonthly * (t.months || 1));
  const bonus = t.postsBonus || 0;
  if (bonus) {
    rows.push(['발행 횟수', `총 ${base + bonus}회 (기본 ${base}회 + 서비스 ${bonus}회) · 월 ${t.postsMonthly}회 기준`]);
    rows.push(['서비스 횟수', `${bonus}회 · 기본 ${base}회를 모두 발행한 뒤부터 차감하며 환불 대상이 아님`]);
  } else {
    rows.push(['발행 횟수', `월 ${t.postsMonthly}회, 계약 기간 총 ${base}회`]);
  }
  if (base) rows.push(['1회 금액', `${won(Math.round(t.priceTotal / base))} (총 계약금액 ÷ 기본 발행 ${base}회, 환불 계산 기준)`]);
  rows.push(['결제 방식', t.payment]);
  if (t.portfolioRequired) rows.push(['할인 조건', '포트폴리오 활용 동의 (제12조)']);
  if (our.account) rows.push(['입금 계좌', `${our.bank ? our.bank + ' ' : ''}${our.account}${our.holder ? ` (예금주 ${our.holder})` : ''}`]);
  if (t.firstReport) rows.push(['첫 주간 보고', withDay(t.firstReport)]);
  return [
    P(`${t.client || '아래 서명란의 업체'}(이하 "갑")와 ${our.name}(이하 "을")는 갑의 스레드 계정 운영 대행에 관하여 다음과 같이 계약을 맺는다.`),
    H('제1조 목적'),
    P('이 계약은 을이 갑의 스레드(Threads) 계정을 운영 대행하는 데 필요한 업무 범위, 대금, 권리와 의무를 정하는 것을 목적으로 한다.'),
    H('제2조 계약 정보'),
    { t: 'table', rows },
    H('제3조 업무 범위'),
    P('을이 맡는 업무는 다음과 같다.'),
    OL('글 기획과 작성, 발행', '프로필 소개글과 고정글 정리', '주간 보고서와 월간 리포트 제공'),
    P('다음은 따로 합의하지 않으면 포함하지 않는다: 인스타그램 운영, 유료 광고비, 사진·영상 촬영, DM과 문의 응대.'),
    P(`콘텐츠 수정은 발행 전 글 한 건당 ${t.revisions}회까지 포함한다. 처음 협의한 운영 방향과 다른 전면 재작성이나 반복되는 추가 수정은 따로 협의한다.`),
    H('제4조 발행 일정'),
    OL('을은 제2조에서 정한 월 발행 횟수를 기준으로 운영하며, 발행 날짜와 하루 발행 횟수는 콘텐츠와 계정 상황에 따라 조정할 수 있다. 특정 날짜의 발행 횟수는 보장하지 않는다.',
      '갑은 직접 글을 올릴 수 있으며, 글 사이 간격은 3시간 이상을 권장한다.',
      '갑이 요청하면 첫 1주일은 글을 갑에게 먼저 보여주고 확인을 받은 뒤 발행한다.',
      '갑이 올리고 싶은 사진이나 소식은 그때그때 을에게 보내고, 을은 발행 일정에 반영한다.'),
    H('제5조 보고'),
    OL('을은 매주 화요일 지난주 조회수, 반응, 팔로워 변화와 다음 주 방향을 담은 주간 보고서를 보낸다.', '을은 한 달이 끝날 때마다 월간 리포트를 보낸다.'),
    H('제6조 대금 지급'),
    OL('갑은 제2조의 총 계약금액을 을이 알려준 계좌로 제2조의 결제 방식에 따라 미리 입금한다.',
      '을은 계약서 서명과 대금 입금이 모두 확인된 뒤 업무를 시작한다.',
      '갑이 요청하면 을은 세금계산서나 현금영수증 같은 증빙 서류를 발행한다.'),
    H('제7조 갑의 협조'),
    OL('갑은 제품·서비스 정보, 사진, 가격, 이벤트 소식처럼 글에 필요한 자료를 을에게 제공한다.',
      '갑은 피해야 할 표현과 꼭 넣어야 할 내용을 계약 초기에 을에게 알린다.',
      '갑의 자료 제공이나 콘텐츠 확인이 늦어져 예정된 발행이 어려운 경우, 이는 을의 발행 누락으로 보지 않는다. 이 경우 발행 일정이나 계약 기간은 서로 협의해 조정한다.'),
    H('제8조 계정 정보와 보안'),
    OL('갑은 운영에 필요한 계정 접근 권한이나 로그인 정보를 을에게 제공한다. 전달 방법은 을이 따로 안내하며, 비밀번호를 전달할 때는 계약 기간에만 쓸 비밀번호로 바꿔 주는 것을 권장한다.',
      '2단계 인증 등으로 로그인 승인이 필요하면 갑은 이에 협조한다.',
      '을은 계정 정보를 이 계약의 업무에만 쓰고, 따로 저장하거나 제3자에게 알리지 않는다.',
      '스레드는 인스타그램 계정으로 로그인되지만, 을은 갑의 인스타그램 게시물과 설정을 건드리지 않는다.',
      '계약이 끝나면 갑은 비밀번호를 다시 바꾸고, 을은 가지고 있던 계정 정보를 지운다.'),
    H('제9조 성과'),
    OL('을은 계약 기간 동안 성실하게 업무를 수행하되, 팔로워, 조회수, 문의, 매출 같은 결과를 보장하지 않는다.',
      '게시물별 조회수와 노출량은 플랫폼 알고리즘과 이용자 반응에 따라 달라지며, 특정 게시물의 조회수나 노출량도 보장하지 않는다.',
      '기대한 성과가 나오지 않았다는 사유만으로는 환불을 요구할 수 없다. 단, 을이 제2조의 발행 횟수를 지키지 못한 경우는 제14조를 따른다.'),
    H('제10조 광고 표현'),
    OL('갑이 제공한 제품·서비스 정보(성분, 효능, 가격, 인증, 후기 등)가 사실인지에 대한 책임은 갑에게 있다.',
      '을은 업종별 광고 규정에 어긋날 수 있는 표현을 피하도록 노력하고, 문제가 될 수 있는 표현은 발행 전에 갑에게 알린다.',
      '갑이 제공하거나 직접 요청한 사실관계, 효능, 인증, 후기, 가격 등의 정보로 생긴 문제는 갑이 책임진다. 다만 을의 고의나 과실로 생긴 문제는 그렇지 않다.',
      '고객 얼굴, 후기 캡처, 타인의 사진은 갑이 사용 동의를 받은 것만 제공한다.'),
    H('제11조 플랫폼 정책'),
    OL('을은 스레드(Meta)의 이용 정책을 지키며 업무를 수행한다.',
      '플랫폼의 정책·노출 방식 변경, 오류, 계정 제한·정지처럼 을의 고의나 중대한 과실이 없는 사유로 생긴 손해는 을이 책임지지 않는다.',
      '위와 같은 사유로 업무가 멈추면 갑과 을은 남은 기간과 발행 횟수를 협의해 조정한다.'),
    H('제12조 게시물 권리와 포트폴리오'),
    OL('을이 작성해 갑의 계정에 발행한 글의 권리는 대금을 모두 지급한 때부터 갑에게 있다. 계약이 끝나도 갑은 그 글을 계속 쓸 수 있다.',
      '갑이 제공한 사진·자료의 권리는 갑에게 있으며, 을은 이 계약의 업무에만 쓴다.',
      t.portfolioRequired
        ? '이 계약은 갑이 포트폴리오 활용에 동의하는 조건으로 할인된 금액이 적용된 계약이다. 갑은 을이 운영 결과(캡처 화면, 수치)를 을의 포트폴리오에 쓰는 것에 동의하며, 이때 계정 이름과 개인정보는 가린다.'
        : '을은 갑이 동의한 경우에만 운영 결과(캡처 화면, 수치)를 을의 포트폴리오에 쓸 수 있고, 이때 계정 이름과 개인정보는 가린다.'),
    { t: 'consent' },
    H('제13조 비밀 유지'),
    P('갑과 을은 계약을 하며 알게 된 상대방의 계정 정보, 매출, 고객 정보, 계약 금액을 상대방 동의 없이 제3자에게 알리지 않는다. 이 의무는 계약이 끝난 뒤에도 유지된다.'),
    H('제14조 중도 해지와 환불'),
    OL('업무를 시작하기 전에 갑이 해지하면 을은 받은 금액을 전액 돌려준다.',
      '업무를 시작한 뒤 갑의 사정으로 해지하면, 을은 해지를 알린 날까지 발행하지 않은 기본 발행 횟수만큼(총 계약금액 ÷ 기본 발행 횟수 × 남은 기본 발행 횟수) 돌려준다.',
      '발행 횟수는 기본 발행 횟수부터 차감하고, 서비스 횟수는 기본 발행 횟수를 모두 발행한 뒤부터 차감한다. 서비스 횟수는 무료로 더 드리는 횟수라 환불 계산에 넣지 않는다.',
      '을의 사정으로 업무를 계속할 수 없으면, 을은 제2항과 같은 방법으로 남은 기본 발행 횟수만큼 돌려준다.',
      '한쪽이 계약을 어기고 상대방이 고쳐 달라고 알린 뒤 7일 안에 고치지 않으면, 상대방은 계약을 해지할 수 있다.',
      '환불은 해지를 알린 날부터 7일 안에 갑의 계좌로 한다.'),
    H('제15조 재계약'),
    P('갑과 을은 계약이 끝나기 일주일 전까지 재계약 여부를 협의한다. 따로 합의하지 않으면 계약은 자동으로 연장되지 않고 종료일에 끝난다.'),
    H('제16조 손해배상'),
    P('갑과 을은 고의나 과실로 상대방에게 손해를 주면 그 손해를 배상한다. 단, 을의 고의나 중대한 과실이 아닌 경우 을의 배상 책임은 갑이 이 계약으로 지급한 금액을 넘지 않는다.'),
    H('제17조 분쟁 해결과 기타'),
    OL('이 계약에 없는 내용이나 해석이 다른 내용은 갑과 을이 협의해 정한다.',
      '협의로 해결되지 않는 분쟁은 민사소송법에 따른 관할 법원에서 해결한다.',
      '카카오톡 등으로 안내한 내용과 이 계약서가 다르면 이 계약서를 따른다. 계약 내용을 바꿀 때는 갑과 을이 글로(카카오톡 포함) 합의한다.'),
    H('서명'),
    P('이 계약을 증명하기 위해 갑과 을은 아래에 전자서명하고, 서명이 끝난 계약서를 각자 저장해 보관한다.'),
  ];
}

/* ---------- 블로그 운영 대행 ---------- */
function buildBlog(t, our) {
  const rows = [
    ['서비스', '블로그 운영 대행 (네이버 블로그 기준)'],
    ['대상 블로그', t.account || '갑이 서명할 때 입력'],
    ['계약 기간', `${ymd(t.start)} ~ ${ymd(t.end)}${t.months ? ` (${t.months}개월)` : ''}`],
  ];
  priceRows(t, rows);
  const base = postRows(t, rows);
  if (t.charLimit || t.images) rows.push(['글 분량', [t.charLimit ? `1편 ${t.charLimit.toLocaleString('ko-KR')}자 이내` : '', t.images ? `이미지 ${t.images}장 이상` : ''].filter(Boolean).join(' · ')]);
  if (base) rows.push(['1회 금액', `${won(Math.round(t.priceTotal / base))} (총 계약금액 ÷ 기본 발행 ${base}회, 환불 계산 기준)`]);
  rows.push(['결제 방식', t.payment]);
  if (t.portfolioRequired) rows.push(['할인 조건', '포트폴리오 활용 동의 (제12조)']);
  const ar = accRow(our); if (ar) rows.push(ar);
  return [
    P(`${t.client || '아래 서명란의 업체'}(이하 "갑")와 ${our.name}(이하 "을")는 갑의 블로그 운영 대행에 관하여 다음과 같이 계약을 맺는다.`),
    H('제1조 목적'),
    P('이 계약은 을이 갑의 블로그를 운영 대행하는 데 필요한 업무 범위, 대금, 권리와 의무를 정하는 것을 목적으로 한다.'),
    H('제2조 계약 정보'),
    { t: 'table', rows },
    H('제3조 업무 범위'),
    P('을이 맡는 업무는 다음과 같다.'),
    OL('업종과 지역에 맞는 검색 키워드 기획과 글 주제 선정', '원고 작성과 이미지 구성', '글 발행과 발행 목록 정리', '월간 리포트 제공'),
    P('다음은 따로 합의하지 않으면 포함하지 않는다: 유료 광고비, 사진·영상 촬영, 체험단·기자단 모집, 댓글·이웃 관리와 문의 응대, 블로그 디자인(홈페이지형 블로그 제작은 따로 계약).'),
    P(`원고 수정은 발행 전 글 한 건당 ${t.revisions}회까지 포함한다. 처음 협의한 운영 방향과 다른 전면 재작성이나 반복되는 추가 수정은 따로 협의한다.`),
    H('제4조 발행 일정'),
    OL('을은 제2조의 월 발행 횟수를 한 달 동안 고르게 나눠 발행하며, 발행 날짜와 시간은 키워드와 블로그 상황에 따라 조정할 수 있다. 특정 날짜의 발행은 보장하지 않는다.',
      '갑이 요청하면 첫 1주일은 원고를 갑에게 먼저 보여주고 확인을 받은 뒤 발행한다.',
      '갑은 직접 글을 올릴 수 있으며, 을이 발행하는 글과 같은 날 몰리지 않도록 미리 알려 주는 것을 권장한다.',
      '갑이 알리고 싶은 사진이나 소식은 그때그때 을에게 보내고, 을은 발행 일정에 반영한다.'),
    H('제5조 보고'),
    OL('을은 한 달이 끝날 때마다 발행한 글 목록과 조회수·유입 경로 같은 통계를 담은 월간 리포트를 보낸다.', '갑이 요청하면 을은 발행 현황을 수시로 알려준다.'),
    H('제6조 대금 지급'),
    OL('갑은 제2조의 총 계약금액을 을이 알려준 계좌로 제2조의 결제 방식에 따라 미리 입금한다.',
      '을은 계약서 서명과 대금 입금이 모두 확인된 뒤 업무를 시작한다.',
      '갑이 요청하면 을은 세금계산서나 현금영수증 같은 증빙 서류를 발행한다.'),
    H('제7조 갑의 협조'),
    OL('갑은 매장·상품 사진, 가격, 영업시간, 이벤트 소식처럼 글에 필요한 자료를 을에게 제공한다.',
      '갑은 피해야 할 표현과 꼭 넣어야 할 내용을 계약 초기에 을에게 알린다.',
      '갑의 자료 제공이나 원고 확인이 늦어져 예정된 발행이 어려운 경우, 이는 을의 발행 누락으로 보지 않는다. 이 경우 발행 일정이나 계약 기간은 서로 협의해 조정한다.'),
    H('제8조 계정 정보와 보안'),
    OL('갑은 블로그 운영에 필요한 로그인 정보를 을에게 제공한다. 전달 방법은 을이 따로 안내하며, 비밀번호를 전달할 때는 계약 기간에만 쓸 비밀번호로 바꿔 주는 것을 권장한다.',
      '새 기기 로그인 확인이나 2단계 인증이 필요하면 갑은 이에 협조한다.',
      '을은 계정 정보를 블로그 운영에만 쓰고, 메일·카페·결제 같은 다른 서비스와 갑의 개인 정보는 건드리지 않는다. 계정 정보를 따로 저장하거나 제3자에게 알리지 않는다.',
      '계약이 끝나면 갑은 비밀번호를 다시 바꾸고, 을은 가지고 있던 계정 정보를 지운다.'),
    H('제9조 성과'),
    OL('을은 계약 기간 동안 성실하게 업무를 수행하되, 방문자 수, 검색 순위(상위 노출), 문의, 매출 같은 결과를 보장하지 않는다.',
      '검색 노출과 순위는 검색 정책과 다른 글과의 경쟁에 따라 달라지며, 특정 키워드의 노출이나 순위도 보장하지 않는다.',
      '기대한 성과가 나오지 않았다는 사유만으로는 환불을 요구할 수 없다. 단, 을이 제2조의 발행 횟수를 지키지 못한 경우는 제14조를 따른다.'),
    H('제10조 광고 표현'),
    OL('갑이 제공한 제품·서비스 정보(성분, 효능, 가격, 인증, 후기 등)가 사실인지에 대한 책임은 갑에게 있다.',
      '을은 업종별 광고 규정에 어긋날 수 있는 표현을 피하도록 노력하고, 문제가 될 수 있는 표현은 발행 전에 갑에게 알린다.',
      '갑이 제공하거나 직접 요청한 사실관계, 효능, 인증, 후기, 가격 등의 정보로 생긴 문제는 갑이 책임진다. 다만 을의 고의나 과실로 생긴 문제는 그렇지 않다.',
      '고객 얼굴, 후기 캡처, 타인의 사진은 갑이 사용 동의를 받은 것만 제공한다.'),
    H('제11조 플랫폼 정책'),
    OL('을은 블로그 서비스(네이버 등)의 운영 정책을 지키며 업무를 수행한다.',
      '검색 정책·노출 방식 변경, 글 누락, 블로그 제한·정지처럼 을의 고의나 중대한 과실이 없는 사유로 생긴 손해는 을이 책임지지 않는다.',
      '위와 같은 사유로 업무가 멈추면 갑과 을은 남은 기간과 발행 횟수를 협의해 조정한다.'),
    H('제12조 게시물 권리와 포트폴리오'),
    OL('을이 작성해 갑의 블로그에 발행한 글의 권리는 대금을 모두 지급한 때부터 갑에게 있다. 계약이 끝나도 갑은 그 글을 계속 쓸 수 있다.',
      '갑이 제공한 사진·자료의 권리는 갑에게 있으며, 을은 이 계약의 업무에만 쓴다. 을이 따로 넣는 이미지는 상업적으로 쓸 수 있는 것만 쓴다.',
      t.portfolioRequired
        ? '이 계약은 갑이 포트폴리오 활용에 동의하는 조건으로 할인된 금액이 적용된 계약이다. 갑은 을이 운영 결과(캡처 화면, 수치)를 을의 포트폴리오에 쓰는 것에 동의하며, 이때 블로그 이름과 개인정보는 가린다.'
        : '을은 갑이 동의한 경우에만 운영 결과(캡처 화면, 수치)를 을의 포트폴리오에 쓸 수 있고, 이때 블로그 이름과 개인정보는 가린다.'),
    { t: 'consent' },
    H('제13조 비밀 유지'),
    P('갑과 을은 계약을 하며 알게 된 상대방의 계정 정보, 매출, 고객 정보, 계약 금액을 상대방 동의 없이 제3자에게 알리지 않는다. 이 의무는 계약이 끝난 뒤에도 유지된다.'),
    H('제14조 중도 해지와 환불'),
    OL('업무를 시작하기 전에 갑이 해지하면 을은 받은 금액을 전액 돌려준다.',
      '업무를 시작한 뒤 갑의 사정으로 해지하면, 을은 해지를 알린 날까지 발행하지 않은 기본 발행 횟수만큼(총 계약금액 ÷ 기본 발행 횟수 × 남은 기본 발행 횟수) 돌려준다.',
      t.postsBonus ? '발행 횟수는 기본 발행 횟수부터 차감하고, 서비스 횟수는 기본 발행 횟수를 모두 발행한 뒤부터 차감한다. 서비스 횟수는 무료로 더 드리는 횟수라 환불 계산에 넣지 않는다.' : '',
      '을의 사정으로 업무를 계속할 수 없으면, 을은 제2항과 같은 방법으로 남은 기본 발행 횟수만큼 돌려준다.',
      '한쪽이 계약을 어기고 상대방이 고쳐 달라고 알린 뒤 7일 안에 고치지 않으면, 상대방은 계약을 해지할 수 있다.',
      '환불은 해지를 알린 날부터 7일 안에 갑의 계좌로 한다.'),
    H('제15조 재계약'),
    P('갑과 을은 계약이 끝나기 일주일 전까지 재계약 여부를 협의한다. 따로 합의하지 않으면 계약은 자동으로 연장되지 않고 종료일에 끝난다.'),
    H('제16조 손해배상'),
    P('갑과 을은 고의나 과실로 상대방에게 손해를 주면 그 손해를 배상한다. 단, 을의 고의나 중대한 과실이 아닌 경우 을의 배상 책임은 갑이 이 계약으로 지급한 금액을 넘지 않는다.'),
    H('제17조 분쟁 해결과 기타'),
    OL('이 계약에 없는 내용이나 해석이 다른 내용은 갑과 을이 협의해 정한다.',
      '협의로 해결되지 않는 분쟁은 민사소송법에 따른 관할 법원에서 해결한다.',
      '카카오톡 등으로 안내한 내용과 이 계약서가 다르면 이 계약서를 따른다. 계약 내용을 바꿀 때는 갑과 을이 글로(카카오톡 포함) 합의한다.'),
    H('서명'),
    P('이 계약을 증명하기 위해 갑과 을은 아래에 전자서명하고, 서명이 끝난 계약서를 각자 저장해 보관한다.'),
  ];
}

/* ---------- 제작: 홈페이지 / 홈페이지형 블로그 ---------- */
function buildWeb(t, our) {
  const bh = t.product === 'blogHome';
  const label = bh ? '홈페이지형 블로그 제작' : '홈페이지 제작';
  const deposit = t.payment === DEPOSIT;
  const rows = [
    ['서비스', label],
    ['제작 범위', t.scope || (bh ? '블로그 대문 이미지 · 메뉴 카드 · 상담 버튼 (PC 대문 디자인, 모바일 프로필 확인)' : '업체 소개 · 서비스 안내 · 문의 구성의 반응형 홈페이지 (PC·모바일)')],
  ];
  if (bh) rows.push(['대상 블로그', t.account || '갑이 서명할 때 입력']);
  else if (t.account) rows.push(['홈페이지 주소', t.account]);
  rows.push(['작업 시작', t.start ? withDay(t.start) : '입금과 자료 전달이 끝난 날']);
  rows.push(['완성 예정일', t.due ? withDay(t.due) : '자료를 받은 뒤 협의해 정함']);
  if (!bh && t.adminPage) rows.push(['관리자 페이지', '포함 (갑이 문구·사진을 직접 고칠 수 있는 화면)']);
  priceRows(t, rows);
  rows.push(['결제 방식', t.payment]);
  if (deposit) { const half = Math.round(t.priceTotal / 2); rows.push(['착수금 / 잔금', `착수금 ${won(half)} (서명 후) / 잔금 ${won(t.priceTotal - half)} (완성 확인 후)`]); }
  rows.push(['수정', `완성 후 ${t.revisions}회까지 무료 · 이후 1회 ${won(t.extraFee) || '0원'}`]);
  if (t.portfolioRequired) rows.push(['할인 조건', '포트폴리오 활용 동의 (제10조)']);
  const ar = accRow(our); if (ar) rows.push(ar);
  return [
    P(`${t.client || '아래 서명란의 업체'}(이하 "갑")와 ${our.name}(이하 "을")는 갑의 ${label}에 관하여 다음과 같이 계약을 맺는다.`),
    H('제1조 목적'),
    P(`이 계약은 을이 갑의 ${label} 작업을 하는 데 필요한 작업 범위, 대금, 권리와 의무를 정하는 것을 목적으로 한다.`),
    H('제2조 계약 정보'),
    { t: 'table', rows },
    H('제3조 제작 범위'),
    P('을이 맡는 작업은 다음과 같다.'),
    bh
      ? OL('업체명·한 줄 소개·대표 사진을 넣은 대문 이미지', '서비스·가격·오시는 길 같은 메뉴 카드', '전화·카카오톡 상담 버튼 배치', 'PC 대문 디자인과 모바일 프로필·대표 이미지 확인')
      : OL('업체 소개, 서비스·가격 안내, 문의 방법을 담은 화면 구성과 디자인', '카카오톡·전화 문의 버튼 연결', 'PC·태블릿·휴대폰 화면에 맞춘 반응형 제작', t.adminPage ? '갑이 문구와 사진을 직접 고칠 수 있는 관리자 페이지' : ''),
    P('다음은 따로 합의하지 않으면 포함하지 않는다: 사진·영상 촬영, 로고 새로 만들기, 글 작성과 운영 대행, 유료 광고, 결제·예약·회원가입처럼 제2조에 없는 기능. 추가 작업은 따로 견적을 내고 합의한 뒤 진행한다.'),
    bh ? P('네이버 앱(모바일)에서는 PC와 메뉴 배치나 보이는 모습이 다를 수 있으며, 이는 네이버 화면 구조 때문이라 수정 대상이 아니다.') : null,
    H('제4조 진행 순서와 일정'),
    OL('작업은 상담 → 자료 전달 → 시안 확인 → 수정 → 완성 순서로 진행한다.',
      `을은 계약서 서명과 ${deposit ? '착수금' : '대금'} 입금, 갑의 자료 전달이 끝난 뒤 작업을 시작한다.`,
      '완성 예정일은 갑의 자료 제공과 의견 회신이 제때 이뤄지는 것을 전제로 한다. 자료나 확인이 늦어진 만큼 완성 예정일도 늦춰지며, 이는 을의 지연으로 보지 않는다.',
      '을의 사정으로 완성이 늦어지면 을은 미리 갑에게 알리고 새 일정을 협의한다.'),
    H('제5조 수정'),
    OL('제작하는 동안에는 갑과 을이 의견을 주고받으며 시안을 고친다. 이 과정의 수정은 아래 횟수에 넣지 않는다.',
      `완성 후 수정은 ${t.revisions}회까지 무료이며, 횟수는 갑이 완성을 확인한 날부터 센다.`,
      '한 번에 모아서 요청한 수정 사항을 1회로 센다. 문구·사진 교체, 색·글자 크기 조정, 버튼 연결 변경 같은 부분 수정이 여기에 해당한다.',
      `무료 수정 횟수를 넘긴 수정은 1회당 ${won(t.extraFee) || '0원'}을 받는다.`,
      '처음 정한 구성이나 디자인 방향을 통째로 바꾸는 재작업, 새 페이지·기능 추가는 수정이 아니라 추가 작업으로 따로 협의한다.',
      !bh && t.adminPage ? '갑이 관리자 페이지로 직접 고친 내용은 수정 횟수에 넣지 않는다.' : ''),
    H('제6조 완성과 확인'),
    OL('을이 완성을 알리면 갑은 7일 안에 결과물을 확인하고 의견을 준다.',
      '7일 동안 의견이 없거나 갑이 결과물을 공개해 쓰기 시작하면 완성을 확인한 것으로 본다.',
      bh ? '' : '완성 후 30일 안에 을의 작업 오류로 생긴 문제(화면 깨짐, 버튼 연결 오류 등)는 수정 횟수와 관계없이 무료로 고친다.'),
    H('제7조 대금 지급'),
    OL(deposit
        ? '갑은 계약서 서명 후 착수금(총 계약금액의 50%)을 을이 알려준 계좌로 입금하고, 잔금은 완성을 확인한 날부터 7일 안에 입금한다.'
        : '갑은 제2조의 총 계약금액을 을이 알려준 계좌로 미리 입금한다.',
      `을은 계약서 서명과 ${deposit ? '착수금' : '대금'} 입금이 모두 확인된 뒤 작업을 시작한다.`,
      '갑이 요청하면 을은 세금계산서나 현금영수증 같은 증빙 서류를 발행한다.'),
    H('제8조 갑의 협조'),
    OL('갑은 업체명, 소개 문구, 연락처, 사진, 참고하고 싶은 사이트처럼 제작에 필요한 자료를 을에게 제공한다.',
      '갑이 제공하는 사진·글·로고는 갑이 쓸 권리를 가진 것이어야 한다.',
      bh ? '갑은 블로그에 디자인을 적용하는 데 필요한 로그인 정보나 협조를 제공한다. 비밀번호는 작업 기간에만 쓸 비밀번호로 바꿔 주는 것을 권장하며, 을은 작업이 끝나면 계정 정보를 지운다.' : ''),
    bh ? H('제9조 블로그 적용') : H('제9조 도메인과 서버'),
    bh
      ? OL('을은 확정된 디자인을 갑의 블로그에 적용하거나, 갑이 직접 적용할 수 있도록 이미지 파일과 적용 방법을 전달한다.',
          '블로그 서비스의 편집 기능이나 정책이 바뀌어 보이는 모습이 달라진 경우 이는 을의 책임이 아니며, 다시 맞추는 작업은 따로 협의한다.')
      : OL('도메인(홈페이지 주소)은 갑의 명의로 사는 것을 원칙으로 하며, 도메인 구입·연장 비용은 갑이 부담한다.',
          '홈페이지를 올려 두는 서버(호스팅) 이용 요금은 따로 합의하지 않으면 갑이 부담한다. 을은 도메인 연결과 서버 배포를 돕는다.',
          '서버·도메인 업체의 장애나 정책 변경, 요금 미납으로 생긴 문제는 을이 책임지지 않는다.',
          '완성 후 내용 추가, 기능 변경, 계속되는 관리는 제5조의 수정 범위를 넘으면 따로 협의한다.'),
    H('제10조 결과물 권리와 포트폴리오'),
    OL('완성된 디자인과 결과물은 대금을 모두 지급한 때부터 갑이 자유롭게 쓸 수 있다.',
      '을이 작업 전부터 가지고 있던 코드·디자인 틀·제작 방법의 권리는 을에게 남으며, 을은 이를 다른 작업에도 쓸 수 있다. 단, 갑의 업체명·사진·문구는 쓰지 않는다.',
      '을은 상업적으로 쓸 수 있는 글꼴과 이미지를 사용한다.',
      t.portfolioRequired
        ? '이 계약은 갑이 포트폴리오 활용에 동의하는 조건으로 할인된 금액이 적용된 계약이다. 갑은 을이 결과물(화면 캡처, 주소)을 을의 포트폴리오에 쓰는 것에 동의하며, 이때 개인정보는 가린다.'
        : '을은 갑이 동의한 경우에만 결과물(화면 캡처, 주소)을 을의 포트폴리오에 쓸 수 있고, 이때 개인정보는 가린다.'),
    { t: 'consent' },
    H('제11조 성과'),
    OL('을은 성실하게 제작하되, 방문자 수, 검색 노출, 문의, 매출 같은 결과를 보장하지 않는다.',
      '기대한 성과가 나오지 않았다는 사유만으로는 환불을 요구할 수 없다.'),
    H('제12조 광고 표현'),
    OL('갑이 제공한 업체·제품·서비스 정보(효능, 가격, 인증, 후기 등)가 사실인지에 대한 책임은 갑에게 있다.',
      '을은 업종별 광고 규정에 어긋날 수 있는 표현을 피하도록 노력하고, 문제가 될 수 있는 표현은 공개 전에 갑에게 알린다.',
      '갑이 제공하거나 직접 요청한 내용으로 생긴 문제는 갑이 책임진다. 다만 을의 고의나 과실로 생긴 문제는 그렇지 않다.'),
    H('제13조 비밀 유지'),
    P('갑과 을은 계약을 하며 알게 된 상대방의 계정 정보, 매출, 고객 정보, 계약 금액을 상대방 동의 없이 제3자에게 알리지 않는다. 이 의무는 계약이 끝난 뒤에도 유지된다.'),
    H('제14조 중도 해지와 환불'),
    OL('작업을 시작하기 전에 갑이 해지하면 을은 받은 금액을 전액 돌려준다.',
      '작업을 시작한 뒤 첫 시안을 보여주기 전에 갑의 사정으로 해지하면, 을은 받은 금액에서 총 계약금액의 30%를 뺀 나머지를 돌려준다.',
      '첫 시안을 보여준 뒤 갑의 사정으로 해지하면 이미 받은 금액은 돌려주지 않으며, 갑은 아직 내지 않은 잔금을 내지 않아도 된다. 이때 작업 중인 결과물은 갑에게 넘기지 않는다.',
      '을의 사정으로 완성하지 못하면 을은 받은 금액을 전액 돌려준다.',
      '한쪽이 계약을 어기고 상대방이 고쳐 달라고 알린 뒤 7일 안에 고치지 않으면, 상대방은 계약을 해지할 수 있다.',
      '환불은 해지를 알린 날부터 7일 안에 갑의 계좌로 한다.'),
    H('제15조 손해배상'),
    P('갑과 을은 고의나 과실로 상대방에게 손해를 주면 그 손해를 배상한다. 단, 을의 고의나 중대한 과실이 아닌 경우 을의 배상 책임은 갑이 이 계약으로 지급한 금액을 넘지 않는다.'),
    H('제16조 분쟁 해결과 기타'),
    OL('이 계약에 없는 내용이나 해석이 다른 내용은 갑과 을이 협의해 정한다.',
      '협의로 해결되지 않는 분쟁은 민사소송법에 따른 관할 법원에서 해결한다.',
      '카카오톡 등으로 안내한 내용과 이 계약서가 다르면 이 계약서를 따른다. 계약 내용을 바꿀 때는 갑과 을이 글로(카카오톡 포함) 합의한다.'),
    H('서명'),
    P('이 계약을 증명하기 위해 갑과 을은 아래에 전자서명하고, 서명이 끝난 계약서를 각자 저장해 보관한다.'),
  ].filter(Boolean);
}

/* ---------------- 저장소 ---------------- */
function makePgStore(query) {
  const row = (r) => r && ({
    id: String(r.id), token: r.token, terms: r.terms || {}, body: r.body || [], our: r.our || {}, hasOurSig: !!r.has_our_sig,
    status: r.status, signer: r.signer || null, signedAt: r.signed_at ? r.signed_at.toISOString() : null,
    signedIp: r.signed_ip || '', docHash: r.doc_hash || '', viewedAt: r.viewed_at ? r.viewed_at.toISOString() : null,
    createdAt: r.created_at.toISOString(),
  });
  const COLS = `id, token, terms, body, our, (our_sig IS NOT NULL) AS has_our_sig, status, signer, signed_at, signed_ip, doc_hash, viewed_at, created_at`;
  return {
    async init() {
      await query(`CREATE TABLE IF NOT EXISTS ct_contracts (
        id         SERIAL PRIMARY KEY,
        token      VARCHAR(40) UNIQUE NOT NULL,
        terms      JSONB NOT NULL,
        body       JSONB NOT NULL,
        our        JSONB NOT NULL,
        our_sig    BYTEA,
        status     VARCHAR(12) NOT NULL DEFAULT 'sent',
        signer     JSONB,
        client_sig BYTEA,
        signed_at  TIMESTAMPTZ,
        signed_ip  VARCHAR(64),
        signed_ua  TEXT,
        doc_hash   VARCHAR(64),
        viewed_at  TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);
      await query(`CREATE TABLE IF NOT EXISTS ct_settings (
        key        VARCHAR(40) PRIMARY KEY,
        val        JSONB,
        bin        BYTEA,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);
    },
    async getSetting(key) {
      const { rows } = await query(`SELECT val, bin FROM ct_settings WHERE key = $1`, [key]);
      return rows[0] ? { val: rows[0].val, bin: rows[0].bin } : null;
    },
    async setSetting(key, val, bin) {
      await query(`INSERT INTO ct_settings (key, val, bin) VALUES ($1, $2, $3)
        ON CONFLICT (key) DO UPDATE SET val = EXCLUDED.val, bin = EXCLUDED.bin, updated_at = now()`, [key, val == null ? null : JSON.stringify(val), bin || null]);
    },
    async list() { const { rows } = await query(`SELECT ${COLS} FROM ct_contracts ORDER BY created_at DESC LIMIT 300`); return rows.map(row); },
    async byToken(token) { const { rows } = await query(`SELECT ${COLS} FROM ct_contracts WHERE token = $1`, [token]); return row(rows[0]); },
    async create(c) {
      const { rows } = await query(`INSERT INTO ct_contracts (token, terms, body, our, our_sig) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [c.token, JSON.stringify(c.terms), JSON.stringify(c.body), JSON.stringify(c.our), c.ourSig || null]);
      return String(rows[0].id);
    },
    async remove(id) { const r = await query(`DELETE FROM ct_contracts WHERE id = $1`, [id]); return r.rowCount > 0; },
    async updateTerms(id, terms, body) {
      const r = await query(`UPDATE ct_contracts SET terms = $2, body = $3 WHERE id = $1 AND status = 'sent'`, [id, JSON.stringify(terms), JSON.stringify(body)]);
      return r.rowCount > 0;
    },
    async markViewed(token) { await query(`UPDATE ct_contracts SET viewed_at = now() WHERE token = $1 AND viewed_at IS NULL`, [token]); },
    async sign(token, s) {
      const r = await query(`UPDATE ct_contracts SET status = 'signed', signer = $2, client_sig = $3, signed_at = $4, signed_ip = $5, signed_ua = $6, doc_hash = $7,
        our = $8, body = $9, our_sig = $10, terms = $11 WHERE token = $1 AND status = 'sent'`,
        [token, JSON.stringify(s.signer), s.sig, s.signedAt, s.ip, s.ua, s.hash, JSON.stringify(s.our), JSON.stringify(s.body), s.ourSig || null, JSON.stringify(s.terms)]);
      return r.rowCount > 0;
    },
    async sig(token, who) {
      const { rows } = await query(`SELECT ${who === 'our' ? 'our_sig' : 'client_sig'} AS b FROM ct_contracts WHERE token = $1`, [token]);
      return rows[0] && rows[0].b;
    },
  };
}

function makeFileStore(dir) {
  const file = path.join(dir, 'contracts.json');
  const read = () => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return { items: [], settings: {} }; } };
  const write = (d) => { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(file, JSON.stringify(d, null, 2)); };
  const b64 = (b) => (b ? Buffer.from(b).toString('base64') : null);
  const unb = (s) => (s ? Buffer.from(s, 'base64') : null);
  const pub = (c) => c && ({ ...c, ourSig: undefined, clientSig: undefined, hasOurSig: !!c.ourSig });
  return {
    async init() {},
    async getSetting(key) { const s = read().settings[key]; return s ? { val: s.val, bin: unb(s.bin) } : null; },
    async setSetting(key, val, bin) { const d = read(); d.settings[key] = { val, bin: b64(bin) }; write(d); },
    async list() { return read().items.slice().reverse().map(pub); },
    async byToken(token) { return pub(read().items.find((c) => c.token === token)); },
    async create(c) {
      const d = read(); const id = String(d.items.reduce((m, x) => Math.max(m, +x.id), 0) + 1);
      d.items.push({ id, token: c.token, terms: c.terms, body: c.body, our: c.our, ourSig: b64(c.ourSig), status: 'sent', signer: null, signedAt: null, signedIp: '', docHash: '', viewedAt: null, createdAt: new Date().toISOString() });
      write(d); return id;
    },
    async updateTerms(id, terms, body) { const d = read(); const c = d.items.find((x) => x.id === String(id)); if (!c || c.status !== 'sent') return false; c.terms = terms; c.body = body; write(d); return true; },
    async remove(id) { const d = read(); const n = d.items.length; d.items = d.items.filter((x) => x.id !== String(id)); write(d); return d.items.length !== n; },
    async markViewed(token) { const d = read(); const c = d.items.find((x) => x.token === token); if (c && !c.viewedAt) { c.viewedAt = new Date().toISOString(); write(d); } },
    async sign(token, s) {
      const d = read(); const c = d.items.find((x) => x.token === token); if (!c || c.status !== 'sent') return false;
      Object.assign(c, { status: 'signed', signer: s.signer, clientSig: b64(s.sig), signedAt: s.signedAt.toISOString(), signedIp: s.ip, docHash: s.hash, our: s.our, body: s.body, ourSig: b64(s.ourSig), terms: s.terms });
      write(d); return true;
    },
    async sig(token, who) { const c = read().items.find((x) => x.token === token); return c && unb(who === 'our' ? c.ourSig : c.clientSig); },
  };
}

/* ---------------- 서명 이미지 확인 ---------------- */
function pngFromDataUrl(s, maxBytes) {
  const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(String(s || ''));
  if (!m) return null;
  const buf = Buffer.from(m[1], 'base64');
  if (buf.length < 100 || buf.length > maxBytes) return null;
  if (!(buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47)) return null;
  return buf;
}

/* ---------------- 계약서 페이지 HTML ---------------- */
// 한국 시간 2026.10.08 13:05
function kst(iso) {
  if (!iso) return '';
  const d = new Date(new Date(iso).getTime() + 9 * 3600 * 1000), z = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}.${z(d.getUTCMonth() + 1)}.${z(d.getUTCDate())} ${z(d.getUTCHours())}:${z(d.getUTCMinutes())}`;
}
function bodyHtml(c) {
  let html = '';
  let inSec = false;
  for (const b of c.body) {
    if (b.t === 'h') { html += `${inSec ? '</section>' : ''}<section class="ct-sec"><h2>${esc(b.x)}</h2>`; inSec = true; continue; }
    if (b.t === 'p') html += `<p>${esc(b.x)}</p>`;
    else if (b.t === 'ol') html += `<ol>${b.items.map((x) => `<li>${esc(x)}</li>`).join('')}</ol>`;
    else if (b.t === 'table') {
      const acc = c.our && c.our.account ? c.our.account.replace(/[^0-9-]/g, '') : '';
      const copyBtn = (k) => (k === '입금 계좌' && acc ? ` <button type="button" class="ct-copy" data-copy="${esc(acc)}">계좌번호 복사</button>` : '');
      html += `<table class="ct-table"><tbody>${b.rows.map((r) => `<tr><th scope="row">${esc(r[0])}</th><td>${esc(r[1])}${copyBtn(r[0])}</td></tr>`).join('')}</tbody></table>`;
    }
    else if (b.t === 'consent') {
      const v = c.signer ? (c.signer.consent === 'yes' ? '동의' : '동의하지 않음') : (c.terms.portfolioRequired ? '동의 필수 (할인 조건)' : '서명할 때 갑이 선택');
      html += `<p class="ct-consent">포트폴리오 활용 동의: <b>${esc(v)}</b></p>`;
    }
  }
  return html + (inSec ? '</section>' : '');
}
function partyTable(c, token) {
  const s = c.signer || {}; const o = c.our || {};
  const cell = (v) => (v ? esc(v) : '<span class="ct-blank">서명할 때 입력</span>');
  const rows = [['상호', s.name || c.terms.client, o.name], ['대표자', s.ceo, o.ceo], ['사업자등록번호', s.bizno || (c.signer ? '-' : ''), o.bizno || '-'],
    ['주소', s.addr, o.addr], ['연락처', s.phone, o.phone || '-']];
  const sigImg = (who, has) => (has ? `<img class="ct-sig" src="/c/${esc(token)}/sig/${who}.png" alt="${who === 'our' ? '을' : '갑'} 서명">` : '<span class="ct-blank">서명 전</span>');
  return `<table class="ct-party"><thead><tr><th scope="col">구분</th><th scope="col">갑 (고객)</th><th scope="col">을 (${kindOf(c.terms).role})</th></tr></thead><tbody>
${rows.map((r) => `<tr><th scope="row">${r[0]}</th><td>${cell(r[1])}</td><td>${esc(r[2] || '-')}</td></tr>`).join('\n')}
<tr class="ct-sigrow"><th scope="row">서명</th><td>${sigImg('client', c.status === 'signed')}</td><td>${sigImg('our', c.hasOurSig)}</td></tr>
</tbody></table>`;
}
// 서명 후 입금 안내 (총 계약금액 + 계좌)
function payBox(c) {
  const o = c.our || {};
  if (!o.account) return '';
  const acc = `${o.bank ? o.bank + ' ' : ''}${o.account}`;
  return `<div class="ct-pay"><p class="ct-pay-h">입금 안내</p>
${c.terms.payment === DEPOSIT
  ? `<p class="ct-pay-amt">착수금 ${esc(won(Math.round(c.terms.priceTotal / 2)))} <small>(총 ${esc(won(c.terms.priceTotal))} · 부가세 ${esc(c.terms.vat)} · 잔금은 완성 확인 후)</small></p>`
  : `<p class="ct-pay-amt">총 ${esc(won(c.terms.priceTotal))} <small>(부가세 ${esc(c.terms.vat)})</small></p>`}
<p class="ct-pay-acc"><b>${esc(acc)}</b>${o.holder ? ` · 예금주 ${esc(o.holder)}` : ''}</p>
<button type="button" class="btn btn-outline btn-sm" data-copy="${esc(o.account.replace(/[^0-9-]/g, ''))}">계좌번호 복사</button>
<p class="ct-tip">${esc(kindOf(c.terms).pay)}</p></div>`;
}
function renderPage(tpl, c, { token, admin, ua = '' }) {
  const signed = c.status === 'signed';
  const K = kindOf(c.terms);
  const title = `${K.doc} | 바이란 마케팅`;
  let foot = '';
  if (signed) {
    const pdfUrl = `/c/${esc(token)}/contract.pdf`;
    const pageUrl = `https://byranmk.com/c/${token}`;
    let inapp = '';
    if (/KAKAOTALK/i.test(ua)) {
      inapp = `<p class="ct-tip">카카오톡 안에서는 파일 저장이 안 될 수 있어요. 안 되면 아래 버튼으로 크롬·삼성인터넷에서 열어주세요.</p>
<div class="ct-actions"><a class="btn btn-outline" href="kakaotalk://web/openExternal?url=${encodeURIComponent(pageUrl)}">다른 브라우저로 열기</a></div>`;
    } else if (/Instagram|Barcelona|FBAN|FBAV|NAVER\(inapp|Line\//i.test(ua)) {
      inapp = '<p class="ct-tip">앱 안 브라우저에서는 파일 저장이 안 될 수 있어요. 안 되면 오른쪽 위 메뉴(⋯)에서 <b>다른 브라우저로 열기</b>를 눌러주세요.</p>';
    }
    foot = `<div class="ct-done"><p class="ct-done-h">서명이 끝난 계약서예요</p>
<p>전자서명 일시 ${esc(kst(c.signedAt))} (한국 시간) · 문서 확인번호 ${esc(hashLabel(c.docHash))}</p>
${payBox(c)}<div class="ct-actions"><a class="btn btn-ink" href="${pdfUrl}" download>PDF 파일 받기</a><button type="button" class="btn btn-outline" id="ctPrint">인쇄</button></div>
${inapp}</div>`;
  } else if (admin) {
    foot = `<div class="ct-admin-note"><p><b>관리자 화면이에요.</b> 고객이 이 주소를 열면 이 자리에 업체 정보 입력 칸과 서명 칸이 나와요. 여기서는 서명하지 않아요.</p></div>`;
  } else {
    foot = `<form class="ct-form" id="ctForm" novalidate data-token="${esc(token)}">
<h2>갑(고객) 정보와 서명</h2>
<p class="ct-form-lead">아래 칸을 채우고 서명해 주세요. 서명하면 계약서가 저장되고 PDF로 받을 수 있어요.</p>
<div class="ct-grid">
<div class="field"><label for="ctName">상호 *</label><input id="ctName" name="name" maxlength="100" required value="${esc(c.terms.client)}"></div>
${c.terms.account || !K.acc ? '' : `<div class="field"><label for="ctAcc">${esc(K.acc)} *</label><input id="ctAcc" name="account" maxlength="60" required placeholder="${esc(K.accPh)}" data-msg="${esc(K.acc)}를 적어주세요." autocapitalize="off" autocomplete="off"></div>`}
<div class="field"><label for="ctCeo">대표자 성함 *</label><input id="ctCeo" name="ceo" maxlength="50" required autocomplete="name"></div>
<div class="field"><label for="ctBiz">사업자등록번호 (없으면 비워두세요)</label><input id="ctBiz" name="bizno" maxlength="20" inputmode="numeric"></div>
<div class="field"><label for="ctPhone">연락처 *</label><input id="ctPhone" name="phone" maxlength="40" required inputmode="tel" autocomplete="tel"></div>
<div class="field wide"><label for="ctAddr">주소 *</label><input id="ctAddr" name="addr" maxlength="200" required autocomplete="street-address"></div>
</div>
${c.terms.portfolioRequired
  ? `<div class="ct-req"><p class="ct-req-h">포트폴리오 활용 동의 (${K.pf}) *</p><p class="ct-tip">이 계약은 포트폴리오 활용에 동의하는 조건으로 할인된 금액이에요. ${K.key === 'web' ? '결과물을 소개할 때 개인정보는 가려요.' : '운영 결과를 소개할 때 계정 이름과 개인정보는 가려요.'}</p><label class="ct-agree"><input type="checkbox" name="consent" value="yes"> 포트폴리오 활용에 동의합니다</label></div>`
  : `<fieldset class="ct-radio"><legend>포트폴리오 활용 동의 (${K.pf}) *</legend>
<label><input type="radio" name="consent" value="yes"> 동의</label><label><input type="radio" name="consent" value="no"> 동의하지 않음</label></fieldset>`}
<div class="ct-pad-wrap"><div class="ct-pad-head"><span>서명 *</span><button type="button" class="btn btn-outline btn-sm" id="ctClear">다시 쓰기</button></div>
<canvas class="ct-pad" id="ctPad" aria-label="서명하는 칸. 손가락이나 마우스로 서명하세요"></canvas><p class="ct-tip">손가락이나 마우스로 칸 안에 서명해 주세요.</p></div>
<label class="ct-agree"><input type="checkbox" id="ctAgree"> 계약서 내용을 모두 읽었고 이 내용으로 계약하는 데 동의합니다</label>
<button type="submit" class="btn btn-ink ct-submit">서명하고 계약하기</button>
<p class="status" id="ctStatus" role="status"></p>
</form>`;
  }
  const vars = {
    TITLE: esc(title), DOC: esc(K.doc), CLIENT: esc(c.terms.client), CREATED: esc(kst(c.createdAt).slice(0, 10)),
    BODY: bodyHtml(c), PARTY: partyTable(c, token), FOOT: foot, STATE: signed ? 'signed' : 'sent',
  };
  return tpl.replace(/\{\{([A-Z0-9_]+)\}\}/g, (m, k) => (k in vars ? vars[k] : m));
}


/* ---------------- PDF 파일 (서버에서 바로 만듦 — 카톡 안 브라우저처럼 인쇄가 안 되는 곳에서도 받을 수 있게) ---------------- */
const hashLabel = (h) => (h || '').slice(0, 16).toUpperCase().replace(/(.{4})(?=.)/g, '$1-');
function buildPdf(c, sigs, fontDir) {
  const PDFDocument = require('pdfkit');
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margins: { top: 54, bottom: 54, left: 52, right: 52 }, info: { Title: `${kindOf(c.terms).doc} - ${c.terms.client}`, Author: c.our.name || '바이란미디어' } });
    const out = []; doc.on('data', (d) => out.push(d)); doc.on('end', () => resolve(Buffer.concat(out))); doc.on('error', reject);
    doc.registerFont('R', path.join(fontDir, 'NanumGothic-Regular.ttf'));
    doc.registerFont('B', path.join(fontDir, 'NanumGothic-Bold.ttf'));
    const L = doc.page.margins.left, W = doc.page.width - L - doc.page.margins.right;
    const bottom = () => doc.page.height - doc.page.margins.bottom;
    const room = (h) => { if (doc.y + h > bottom()) doc.addPage(); };
    const para = (txt, o = {}) => { doc.font(o.bold ? 'B' : 'R').fontSize(o.size || 10).fillColor(o.color || '#1b1d1b'); room(doc.heightOfString(txt, { width: o.width || W, lineGap: 3 })); doc.text(txt, o.x || L, doc.y, { width: o.width || W, lineGap: 3, align: o.align || 'left' }); };

    // 제목
    doc.font('B').fontSize(9).fillColor('#8a6d45').text('전자계약서', L, doc.y, { width: W, align: 'center', characterSpacing: 1 });
    doc.moveDown(0.7);
    doc.font('B').fontSize(20).fillColor('#141614').text(kindOf(c.terms).doc, { width: W, align: 'center' });
    doc.moveDown(0.3);
    doc.font('R').fontSize(9.5).fillColor('#666').text(`${c.terms.client} · 작성일 ${kst(c.createdAt).slice(0, 10)}`, { width: W, align: 'center' });
    doc.moveDown(0.8);
    doc.moveTo(L, doc.y).lineTo(L + W, doc.y).lineWidth(1.5).strokeColor('#141614').stroke();
    doc.moveDown(1);

    // 표 그리기 (행마다 높이 계산, 페이지 넘김)
    function table(rows, cols, opt = {}) {
      const pad = 6;
      rows.forEach((r, ri) => {
        const isHead = opt.head && ri === 0;
        const hs = r.map((cell, ci) => (cell && cell.img ? (opt.imgH || 56) : doc.font(ci === 0 || isHead ? 'B' : 'R').fontSize(9.5).heightOfString(String(cell == null ? '' : cell), { width: cols[ci] - pad * 2, lineGap: 2 })));
        const h = Math.max(...hs) + pad * 2;
        room(h);
        let x = L; const y = doc.y;
        r.forEach((cell, ci) => {
          const w = cols[ci];
          if (ci === 0 || isHead) doc.rect(x, y, w, h).fillColor('#f2f1ec').fill();
          doc.rect(x, y, w, h).lineWidth(0.6).strokeColor('#c9cac0').stroke();
          if (cell && cell.img) {
            try { doc.image(cell.img, x + pad, y + pad, { fit: [w - pad * 2, h - pad * 2], align: 'center', valign: 'center' }); } catch (e) { /* 이미지 오류 무시 */ }
          } else {
            doc.font(ci === 0 || isHead ? 'B' : 'R').fontSize(9.5).fillColor(cell && cell.muted ? '#999' : '#1b1d1b')
              .text(String(cell && cell.muted ? cell.muted : (cell == null ? '' : cell)), x + pad, y + pad, { width: w - pad * 2, lineGap: 2, align: isHead ? 'center' : 'left' });
          }
          x += w;
        });
        doc.x = L; doc.y = y + h;
      });
      doc.moveDown(0.6);
    }

    for (const b of c.body) {
      if (b.t === 'h') { doc.moveDown(0.5); room(40); para(b.x, { bold: true, size: 11.5 }); doc.moveDown(0.25); }
      else if (b.t === 'p') { para(b.x); doc.moveDown(0.3); }
      else if (b.t === 'ol') {
        b.items.forEach((it, i) => {
          doc.font('R').fontSize(10);
          const h = doc.heightOfString(it, { width: W - 18, lineGap: 3 }); room(h);
          const y = doc.y;
          doc.fillColor('#1b1d1b').text(`${i + 1}.`, L, y, { width: 18 });
          doc.text(it, L + 18, y, { width: W - 18, lineGap: 3 });
          doc.moveDown(0.2);
        });
        doc.moveDown(0.2);
      } else if (b.t === 'table') { doc.moveDown(0.2); table(b.rows, [W * 0.26, W * 0.74]); }
      else if (b.t === 'consent') {
        const v = c.signer ? (c.signer.consent === 'yes' ? '동의' : '동의하지 않음') : (c.terms.portfolioRequired ? '동의 필수 (할인 조건)' : '서명할 때 갑이 선택');
        para(`포트폴리오 활용 동의: ${v}`, { bold: true }); doc.moveDown(0.3);
      }
    }

    // 서명 표
    const s = c.signer || {}, o = c.our || {}, pending = { muted: '서명 전' };
    const rows = [['구분', '갑 (고객)', `을 (${kindOf(c.terms).role})`], ['상호', s.name || c.terms.client, o.name || '-'], ['대표자', s.ceo || pending, o.ceo || '-'],
      ['사업자등록번호', c.signer ? (s.bizno || '-') : pending, o.bizno || '-'], ['주소', s.addr || pending, o.addr || '-'], ['연락처', s.phone || pending, o.phone || '-'],
      ['서명', sigs.client ? { img: sigs.client } : pending, sigs.our ? { img: sigs.our } : { muted: '-' }]];
    doc.moveDown(0.3);
    table(rows, [W * 0.2, W * 0.4, W * 0.4], { head: true, imgH: 60 });
    room(40);
    if (c.status === 'signed') {
      para(`전자서명 일시 ${kst(c.signedAt)} (한국 시간) · 문서 확인번호 ${hashLabel(c.docHash)}`, { size: 8.5, color: '#555' });
    } else {
      para('아직 갑(고객)의 서명이 끝나지 않은 계약서예요.', { size: 8.5, color: '#9a3b25' });
    }
    doc.end();
  });
}

/* ---------------- 라우트 ---------------- */
function checkTerms(t) {
  if (!t.priceTotal) return '총 계약금액을 적어주세요.';
  if (t.kind === 'web') return '';
  if (!t.start || !t.end) return '계약 기간을 적어주세요.';
  if (!t.postsMonthly) return '월 발행 횟수를 적어주세요.';
  return '';
}

module.exports = function makeContracts({ query, requireAdmin, isAdmin, assetVer, prod, root }) {
  const store = query ? makePgStore(query) : makeFileStore(path.join(root, 'data'));
  const tplFile = path.join(root, 'views', 'contract.html');
  let tplCache = null;
  const tpl = () => { if (tplCache && prod) return tplCache; tplCache = fs.readFileSync(tplFile, 'utf8').replace(/\{\{VER\}\}/g, assetVer); return tplCache; };
  const fail = (res, code, error) => res.status(code).json({ ok: false, error });
  const signTries = new Map();
  const tooMany = (ip) => { const now = Date.now(); const l = (signTries.get(ip) || []).filter((t) => now - t < 10 * 60 * 1000); l.push(now); signTries.set(ip, l); return l.length > 12; };
  const getOur = async () => { const s = await store.getSetting('our'); return { ...OUR_DEFAULT, ...((s && s.val) || {}) }; };
  const getOurSig = async () => { const s = await store.getSetting('our_sig'); return s && s.bin; };

  // 서명 전 계약서는 지금 등록된 우리(을) 정보·계좌·서명과 최신 문구로 보여줌 (서명하는 순간 그대로 고정)
  async function view(token) {
    const c = await store.byToken(token);
    if (!c || c.status !== 'sent') return c;
    const our = await getOur(); const ourSig = await getOurSig();
    return { ...c, our, body: buildBody(c.terms, our), hasOurSig: !!ourSig || c.hasOurSig, ourSigNow: ourSig };
  }
  async function ourSigOf(c, token) { return (c && c.ourSigNow) || store.sig(token, 'our'); }

  function routes(app) {
    // 고객이 여는 계약서 페이지
    app.get('/c/:token', async (req, res, next) => {
      const token = req.params.token;
      if (!TOKEN_RE.test(token)) return next();
      try {
        const c = await view(token);
        if (!c) return next();
        const admin = isAdmin(req);
        // 카톡·스레드 등 링크 미리보기 봇은 '고객이 열어봄'으로 세지 않음
        const bot = /bot|crawl|spider|scrap|facebookexternalhit|preview|slurp|whatsapp|telegram|discord|yeti|daum|kakao-?talk-?scrap/i.test(req.get('user-agent') || '');
        if (!admin && !bot) store.markViewed(token).catch(() => {});
        res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex, nofollow' });
        res.type('html').send(renderPage(tpl(), c, { token, admin, ua: req.get('user-agent') || '' }));
      } catch (e) { console.error('[ct page]', e.message); next(); }
    });
    app.get('/c/:token/contract.pdf', async (req, res, next) => {
      const token = req.params.token;
      if (!TOKEN_RE.test(token)) return next();
      try {
        const c = await view(token);
        if (!c) return next();
        const sigs = { our: await ourSigOf(c, token), client: c.status === 'signed' ? await store.sig(token, 'client') : null };
        const buf = await buildPdf(c, sigs, path.join(root, 'fonts'));
        const name = `${kindOf(c.terms).doc.replace(/\s+/g, '')}_${(c.terms.client || '').replace(/[\\/:*?"<>|\s]+/g, '_')}.pdf`;
        res.set({ 'Content-Type': 'application/pdf', 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex',
          'Content-Disposition': `${req.query.view ? 'inline' : 'attachment'}; filename="contract.pdf"; filename*=UTF-8''${encodeURIComponent(name)}` });
        res.send(buf);
      } catch (e) { console.error('[ct pdf]', e.message); res.status(500).type('text').send('PDF를 만들지 못했어요. 잠시 후 다시 시도해 주세요.'); }
    });
    app.get('/c/:token/sig/:who(our|client).png', async (req, res, next) => {
      if (!TOKEN_RE.test(req.params.token)) return next();
      try {
        let b;
        if (req.params.who === 'our') { const c = await view(req.params.token); if (!c) return next(); b = await ourSigOf(c, req.params.token); }
        else b = await store.sig(req.params.token, 'client');
        if (!b) return next();
        res.set({ 'Content-Type': 'image/png', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' }).send(b);
      } catch (e) { console.error('[ct sig]', e.message); res.status(500).end(); }
    });
    // 고객 서명
    app.post('/api/c/:token/sign', express.json({ limit: '600kb' }), async (req, res) => {
      const token = req.params.token;
      if (!TOKEN_RE.test(token)) return fail(res, 404, '계약서를 찾지 못했어요.');
      if (tooMany(req.ip)) return fail(res, 429, '잠시 후 다시 시도해 주세요.');
      const b = req.body || {};
      const signer = { name: clip(b.name, 100), ceo: clip(b.ceo, 50), bizno: clip(b.bizno, 20), addr: clip(b.addr, 200), phone: clip(b.phone, 40), consent: b.consent === 'yes' ? 'yes' : b.consent === 'no' ? 'no' : '' };
      if (!signer.name || !signer.ceo || !signer.addr || !signer.phone) return fail(res, 400, '별표(*) 칸을 모두 채워주세요.');
      if (!PHONE_RE.test(signer.phone)) return fail(res, 400, '연락처를 확인해 주세요.');
      if (!signer.consent) return fail(res, 400, '포트폴리오 활용 동의 여부를 골라주세요.');
      if (b.agree !== true) return fail(res, 400, '계약 내용 동의에 체크해 주세요.');
      const sig = pngFromDataUrl(b.sig, 400 * 1024);
      if (!sig) return fail(res, 400, '서명을 다시 해주세요.');
      try {
        const c = await view(token);
        if (!c) return fail(res, 404, '계약서를 찾지 못했어요.');
        if (c.status !== 'sent') return fail(res, 409, '이미 서명이 끝난 계약서예요. 새로고침해 주세요.');
        if (c.terms.portfolioRequired && signer.consent !== 'yes') return fail(res, 400, '이 계약은 할인 조건이라 포트폴리오 활용 동의가 필요해요.');
        const signedAt = new Date();
        const ourSig = await ourSigOf(c, token);
        // 비워둔 상호·계정은 고객이 적은 값으로 채워서 계약서 확정
        const acc = clip(b.account, 60).replace(/^@+/, '').trim();
        const K = kindOf(c.terms);
        if (K.acc && !c.terms.account && !acc) return fail(res, 400, `${K.acc}를 적어주세요.`);
        const terms = { ...c.terms, client: c.terms.client || signer.name, account: c.terms.account || acc };
        c.terms = terms; c.body = buildBody(terms, c.our);
        const hash = sha(JSON.stringify({ terms: c.terms, body: c.body, our: c.our, ourSig: ourSig ? sha(ourSig) : '', signer, sig: sha(sig), signedAt: signedAt.toISOString() }));
        const ok = await store.sign(token, { signer, sig, signedAt, ip: req.ip, ua: clip(req.get('user-agent'), 300), hash, our: c.our, body: c.body, ourSig, terms: c.terms });
        if (!ok) return fail(res, 409, '이미 서명이 끝난 계약서예요. 새로고침해 주세요.');
        console.log(`[ct] 서명 완료 · ${c.terms.client}`);
        res.json({ ok: true });
      } catch (e) { console.error('[ct sign]', e.message); fail(res, 500, '저장하지 못했어요. 잠시 후 다시 시도해 주세요.'); }
    });

    // 관리자
    app.get('/api/admin/contracts', requireAdmin, async (req, res) => {
      try {
        const host = req.get('host');
        const items = (await store.list()).map((c) => ({
          id: c.id, url: `${req.protocol}://${host}/c/${c.token}`, terms: c.terms, status: c.status, signer: c.signer, hasOurSig: c.hasOurSig,
          createdAt: c.createdAt, viewedAt: c.viewedAt, signedAt: c.signedAt, signedIp: c.signedIp,
        }));
        res.json({ ok: true, items, our: await getOur(), hasOurSig: !!(await getOurSig()) });
      } catch (e) { console.error('[ct list]', e.message); fail(res, 500, '목록을 불러오지 못했어요.'); }
    });
    app.post('/api/admin/contracts', requireAdmin, express.json({ limit: '20kb' }), async (req, res) => {
      const t = cleanTerms(req.body);
      const bad = checkTerms(t); if (bad) return fail(res, 400, bad);
      try {
        const our = await getOur();
        const token = crypto.randomBytes(18).toString('base64url');
        const id = await store.create({ token, terms: t, body: buildBody(t, our), our, ourSig: await getOurSig() });
        res.json({ ok: true, id, url: `${req.protocol}://${req.get("host")}/c/${token}` });
      } catch (e) { console.error('[ct create]', e.message); fail(res, 500, '계약서를 만들지 못했어요.'); }
    });
    app.put('/api/admin/contracts/:id(\\d+)', requireAdmin, express.json({ limit: '20kb' }), async (req, res) => {
      const t = cleanTerms(req.body);
      const bad = checkTerms(t); if (bad) return fail(res, 400, bad);
      try {
        const ok = await store.updateTerms(req.params.id, t, buildBody(t, await getOur()));
        return ok ? res.json({ ok: true }) : fail(res, 409, '이미 서명이 끝났거나 없는 계약서예요.');
      } catch (e) { console.error('[ct edit]', e.message); fail(res, 500, '저장하지 못했어요.'); }
    });
    app.delete('/api/admin/contracts/:id(\\d+)', requireAdmin, async (req, res) => {
      try { const ok = await store.remove(req.params.id); res.status(ok ? 200 : 404).json({ ok }); }
      catch (e) { console.error('[ct delete]', e.message); fail(res, 500, '삭제하지 못했어요.'); }
    });
    // 우리(을) 정보·서명
    app.put('/api/admin/contracts/our', requireAdmin, express.json({ limit: '600kb' }), async (req, res) => {
      const our = cleanOur(req.body);
      if (!our.name || !our.ceo) return fail(res, 400, '상호와 대표자를 적어주세요.');
      try {
        await store.setSetting('our', our);
        if (req.body.sig) {
          const sig = pngFromDataUrl(req.body.sig, 500 * 1024);
          if (!sig) return fail(res, 400, '서명 이미지를 다시 넣어주세요.');
          await store.setSetting('our_sig', null, sig);
        }
        res.json({ ok: true });
      } catch (e) { console.error('[ct our]', e.message); fail(res, 500, '저장하지 못했어요.'); }
    });
    app.get('/api/admin/contracts/our-sig.png', requireAdmin, async (req, res) => {
      const b = await getOurSig().catch(() => null);
      if (!b) return res.status(404).end();
      res.set({ 'Content-Type': 'image/png', 'Cache-Control': 'private, no-store' }).send(b);
    });
  }

  return { init: () => store.init(), routes };
};
