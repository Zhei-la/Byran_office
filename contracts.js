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
function cleanTerms(b) {
  b = b || {};
  const num = (v, max) => Math.max(0, Math.min(max, parseInt(String(v).replace(/[^\d]/g, ''), 10) || 0));
  return {
    client: clip(b.client, 100), account: clip(b.account, 60).replace(/^@+/, ''),
    start: clip(b.start, 10), end: clip(b.end, 10), months: num(b.months, 60),
    testStart: clip(b.testStart, 10), testEnd: clip(b.testEnd, 10),
    priceList: num(b.priceList, 1e10), priceTotal: num(b.priceTotal, 1e10), priceRef: num(b.priceRef, 1e9),
    vat: b.vat === '포함' ? '포함' : '별도',
    postsMonthly: num(b.postsMonthly, 1000), postsTotal: num(b.postsTotal, 100000),
    payment: clip(b.payment, 80) || '일시불 선결제', firstReport: clip(b.firstReport, 10),
    revisions: Math.max(0, Math.min(10, parseInt(b.revisions, 10) || 0)) || 2,
  };
}
function cleanOur(b) {
  b = b || {};
  return { name: clip(b.name, 100), ceo: clip(b.ceo, 50), bizno: clip(b.bizno, 20), addr: clip(b.addr, 200), phone: clip(b.phone, 40),
    bank: clip(b.bank, 30), account: clip(b.account, 40), holder: clip(b.holder, 40) };
}

// 계약서 본문 (만들 때 한 번 정해서 저장 — 나중에 문구를 바꿔도 이미 보낸 계약서는 그대로)
function buildBody(t, our) {
  const H = (x) => ({ t: 'h', x }), P = (x) => ({ t: 'p', x }), OL = (...items) => ({ t: 'ol', items });
  const rows = [
    ['서비스', '스레드 계정 운영 대행 (인스타그램 운영은 포함하지 않음)'],
    ['대상 계정', t.account ? '@' + t.account : '갑이 서명할 때 입력'],
    ['계약 기간', `${ymd(t.start)} ~ ${ymd(t.end)}${t.months ? ` (${t.months}개월)` : ''}`],
  ];
  if (t.testStart || t.testEnd) rows.push(['테스트 기간', `${ymd(t.testStart)} ~ ${ymd(t.testEnd)}`]);
  // 예전 계약서(정상 이용금액·계약 적용금액)도 그대로 읽히게
  const ref = t.priceRef || t.priceRegular || 0;
  if (t.priceList && t.priceList > t.priceTotal) {
    rows.push(['정상가', `${won(t.priceList)}${t.months ? ` (${t.months}개월)` : ''}`]);
    rows.push(['할인 금액', won(t.priceList - t.priceTotal)]);
  }
  rows.push(['총 계약금액', `${won(t.priceTotal)} (부가세 ${t.vat})`]);
  if (t.months > 1) rows.push(['월 금액', `월 ${won(Math.round(t.priceTotal / t.months))} (총 계약금액 ÷ 개월 수)`]);
  if (ref) rows.push(['중도 해지 정산 기준', `월 ${won(ref)} (1개월 금액)`]);
  rows.push(['발행 횟수', `월 ${t.postsMonthly}회${t.postsTotal ? `, 계약 기간 총 ${t.postsTotal}회` : ''}`]);
  rows.push(['결제 방식', t.payment]);
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
      '을은 갑이 동의한 경우에만 운영 결과(캡처 화면, 수치)를 을의 포트폴리오에 쓸 수 있고, 이때 계정 이름과 개인정보는 가린다.'),
    { t: 'consent' },
    H('제13조 비밀 유지'),
    P('갑과 을은 계약을 하며 알게 된 상대방의 계정 정보, 매출, 고객 정보, 계약 금액을 상대방 동의 없이 제3자에게 알리지 않는다. 이 의무는 계약이 끝난 뒤에도 유지된다.'),
    H('제14조 중도 해지와 환불'),
    OL('업무를 시작하기 전에 갑이 해지하면 을은 받은 금액을 전액 돌려준다.',
      `업무를 시작한 뒤 갑의 사정으로 해지하면, 이용이 끝난 기간(해지를 알린 날이 속한 달 포함)의 금액을 ${(t.priceRef || t.priceRegular) ? '제2조의 중도 해지 정산 기준(월 금액)으로' : '총 계약금액을 개월 수로 나눈 월 금액으로'} 계산해 총 계약금액에서 빼고 나머지를 돌려준다. 계산한 금액이 총 계약금액 이상이면 돌려줄 금액은 없다.`,
      '을의 사정으로 업무를 계속할 수 없으면, 을은 발행하지 못한 횟수만큼(총 계약금액 ÷ 총 발행 횟수 × 남은 횟수) 돌려준다.',
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
      const v = c.signer ? (c.signer.consent === 'yes' ? '동의' : '동의하지 않음') : '서명할 때 갑이 선택';
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
  return `<table class="ct-party"><thead><tr><th scope="col">구분</th><th scope="col">갑 (고객)</th><th scope="col">을 (대행사)</th></tr></thead><tbody>
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
<p class="ct-pay-amt">총 ${esc(won(c.terms.priceTotal))} <small>(부가세 ${esc(c.terms.vat)})</small></p>
<p class="ct-pay-acc"><b>${esc(acc)}</b>${o.holder ? ` · 예금주 ${esc(o.holder)}` : ''}</p>
<button type="button" class="btn btn-outline btn-sm" data-copy="${esc(o.account.replace(/[^0-9-]/g, ''))}">계좌번호 복사</button>
<p class="ct-tip">입금이 확인되면 운영을 시작해요 (제6조).</p></div>`;
}
function renderPage(tpl, c, { token, admin, ua = '' }) {
  const signed = c.status === 'signed';
  const title = '스레드 운영 대행 계약서 | 바이란 마케팅';
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
${c.terms.account ? '' : '<div class="field"><label for="ctAcc">스레드 계정 아이디 *</label><input id="ctAcc" name="account" maxlength="60" required placeholder="예: @byran_shop" autocapitalize="off" autocomplete="off"></div>'}
<div class="field"><label for="ctCeo">대표자 성함 *</label><input id="ctCeo" name="ceo" maxlength="50" required autocomplete="name"></div>
<div class="field"><label for="ctBiz">사업자등록번호 (없으면 비워두세요)</label><input id="ctBiz" name="bizno" maxlength="20" inputmode="numeric"></div>
<div class="field"><label for="ctPhone">연락처 *</label><input id="ctPhone" name="phone" maxlength="40" required inputmode="tel" autocomplete="tel"></div>
<div class="field wide"><label for="ctAddr">주소 *</label><input id="ctAddr" name="addr" maxlength="200" required autocomplete="street-address"></div>
</div>
<fieldset class="ct-radio"><legend>포트폴리오 활용 동의 (제12조) *</legend>
<label><input type="radio" name="consent" value="yes"> 동의</label><label><input type="radio" name="consent" value="no"> 동의하지 않음</label></fieldset>
<div class="ct-pad-wrap"><div class="ct-pad-head"><span>서명 *</span><button type="button" class="btn btn-outline btn-sm" id="ctClear">다시 쓰기</button></div>
<canvas class="ct-pad" id="ctPad" aria-label="서명하는 칸. 손가락이나 마우스로 서명하세요"></canvas><p class="ct-tip">손가락이나 마우스로 칸 안에 서명해 주세요.</p></div>
<label class="ct-agree"><input type="checkbox" id="ctAgree"> 계약서 내용을 모두 읽었고 이 내용으로 계약하는 데 동의합니다</label>
<button type="submit" class="btn btn-ink ct-submit">서명하고 계약하기</button>
<p class="status" id="ctStatus" role="status"></p>
</form>`;
  }
  const vars = {
    TITLE: esc(title), CLIENT: esc(c.terms.client), CREATED: esc(kst(c.createdAt).slice(0, 10)),
    BODY: bodyHtml(c), PARTY: partyTable(c, token), FOOT: foot, STATE: signed ? 'signed' : 'sent',
  };
  return tpl.replace(/\{\{([A-Z0-9_]+)\}\}/g, (m, k) => (k in vars ? vars[k] : m));
}


/* ---------------- PDF 파일 (서버에서 바로 만듦 — 카톡 안 브라우저처럼 인쇄가 안 되는 곳에서도 받을 수 있게) ---------------- */
const hashLabel = (h) => (h || '').slice(0, 16).toUpperCase().replace(/(.{4})(?=.)/g, '$1-');
function buildPdf(c, sigs, fontDir) {
  const PDFDocument = require('pdfkit');
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margins: { top: 54, bottom: 54, left: 52, right: 52 }, info: { Title: `스레드 운영 대행 계약서 - ${c.terms.client}`, Author: c.our.name || '바이란미디어' } });
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
    doc.font('B').fontSize(20).fillColor('#141614').text('스레드 운영 대행 계약서', { width: W, align: 'center' });
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
        const v = c.signer ? (c.signer.consent === 'yes' ? '동의' : '동의하지 않음') : '서명할 때 갑이 선택';
        para(`포트폴리오 활용 동의: ${v}`, { bold: true }); doc.moveDown(0.3);
      }
    }

    // 서명 표
    const s = c.signer || {}, o = c.our || {}, pending = { muted: '서명 전' };
    const rows = [['구분', '갑 (고객)', '을 (대행사)'], ['상호', s.name || c.terms.client, o.name || '-'], ['대표자', s.ceo || pending, o.ceo || '-'],
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
        const name = `스레드운영대행계약서_${(c.terms.client || '').replace(/[\\/:*?"<>|\s]+/g, '_')}.pdf`;
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
        const signedAt = new Date();
        const ourSig = await ourSigOf(c, token);
        // 비워둔 상호·계정은 고객이 적은 값으로 채워서 계약서 확정
        const acc = clip(b.account, 60).replace(/^@+/, '').trim();
        if (!c.terms.account && !acc) return fail(res, 400, '스레드 계정 아이디를 적어주세요.');
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
      if (!t.start || !t.end) return fail(res, 400, '계약 기간을 적어주세요.');
      if (!t.priceTotal) return fail(res, 400, '총 계약금액을 적어주세요.');
      if (!t.postsMonthly) return fail(res, 400, '월 발행 횟수를 적어주세요.');
      try {
        const our = await getOur();
        const token = crypto.randomBytes(18).toString('base64url');
        const id = await store.create({ token, terms: t, body: buildBody(t, our), our, ourSig: await getOurSig() });
        res.json({ ok: true, id, url: `${req.protocol}://${req.get("host")}/c/${token}` });
      } catch (e) { console.error('[ct create]', e.message); fail(res, 500, '계약서를 만들지 못했어요.'); }
    });
    app.put('/api/admin/contracts/:id(\\d+)', requireAdmin, express.json({ limit: '20kb' }), async (req, res) => {
      const t = cleanTerms(req.body);
      if (!t.start || !t.end) return fail(res, 400, '계약 기간을 적어주세요.');
      if (!t.priceTotal) return fail(res, 400, '총 계약금액을 적어주세요.');
      if (!t.postsMonthly) return fail(res, 400, '월 발행 횟수를 적어주세요.');
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
