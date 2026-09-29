/* 바이란 마케팅 홈페이지 서버 (byranmk.com)
   - public/ 폴더의 홈페이지를 그대로 보여준다.
   - POST /api/inquiry : 문의하기 접수 → 데이터베이스에 저장
   - /admin           : 관리자 문의함 (ADMIN_PASSWORD 로 로그인)

   환경변수
   - DATABASE_URL    : Railway PostgreSQL 주소 (없으면 data/inquiries.json 에 저장 — 개발용)
   - ADMIN_PASSWORD  : 관리자 문의함 비밀번호
   - SESSION_SECRET  : 로그인 쿠키 서명용 임의 문자열 (길고 무작위로)
   - PORT            : Railway가 자동으로 넣어줌 */
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const helmet = require('helmet');

const PORT = process.env.PORT || 3000;
const PROD = process.env.NODE_ENV === 'production' || !!process.env.RAILWAY_ENVIRONMENT;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const COOKIE = 'byran_admin';
const SESSION_HOURS = 12;

const SERVICES = ['무료 채널 진단', '블로그 운영 대행', '스레드 운영 대행', '홈페이지형 블로그 제작', '홈페이지 제작'];
const STATUSES = ['new', 'contacted', 'done', 'spam'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE_RE = /^[0-9+\-\s().]{8,20}$/;
const clip = (v, n) => String(v == null ? '' : v).trim().slice(0, n);
const LINK_TYPES = ['블로그', '스레드', '홈페이지', '인스타그램', '기타'];
// 주소 여러 개 → "블로그: 주소" 줄바꿈으로 묶어 저장 (최대 5개)
function joinLinks(b) {
  if (Array.isArray(b.links)) {
    return b.links.slice(0, 5)
      .map((l) => ({ type: LINK_TYPES.includes(l && l.type) ? l.type : '기타', url: clip(l && l.url, 300) }))
      .filter((l) => l.url)
      .map((l) => `${l.type}: ${l.url}`)
      .join('\n');
  }
  return clip(b.link, 300);
}

/* ---------------- 저장소 ---------------- */
function makeStore() {
  if (process.env.DATABASE_URL) {
    const { Pool } = require('pg');
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: /localhost|127\.0\.0\.1|\.railway\.internal/.test(process.env.DATABASE_URL) ? false : { rejectUnauthorized: false },
    });
    const row = (r) => r && ({
      id: String(r.id), name: r.name, phone: r.phone, email: r.email, business: r.business,
      services: r.services || [], link: r.link, message: r.message, status: r.status,
      memo: r.memo || '', createdAt: r.created_at.toISOString(),
    });
    return {
      kind: 'postgres',
      async init() {
        await pool.query(`CREATE TABLE IF NOT EXISTS inquiries (
          id         SERIAL PRIMARY KEY,
          name       VARCHAR(100) NOT NULL,
          phone      VARCHAR(40),
          email      VARCHAR(255),
          business   VARCHAR(200),
          services   TEXT[] NOT NULL DEFAULT '{}',
          link       TEXT,
          message    TEXT,
          status     VARCHAR(20) NOT NULL DEFAULT 'new',
          memo       TEXT,
          ip         VARCHAR(64),
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_inquiries_created ON inquiries (created_at DESC)`);
        await pool.query(`ALTER TABLE inquiries ALTER COLUMN link TYPE TEXT`); // 주소 여러 개 저장
      },
      async recentCount(ip) {
        const { rows } = await pool.query(
          `SELECT count(*)::int AS n FROM inquiries WHERE ip = $1 AND created_at > now() - interval '10 minutes'`, [ip]);
        return rows[0].n;
      },
      async add(d) {
        await pool.query(
          `INSERT INTO inquiries (name, phone, email, business, services, link, message, ip)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [d.name, d.phone || null, d.email || null, d.business || null, d.services, d.link || null, d.message || null, d.ip]);
      },
      async list() {
        const { rows } = await pool.query(`SELECT * FROM inquiries ORDER BY created_at DESC LIMIT 500`);
        return rows.map(row);
      },
      async update(id, patch) {
        const sets = []; const vals = [];
        if (patch.status !== undefined) { vals.push(patch.status); sets.push(`status = $${vals.length}`); }
        if (patch.memo !== undefined) { vals.push(patch.memo); sets.push(`memo = $${vals.length}`); }
        if (!sets.length) return false;
        vals.push(parseInt(id, 10));
        const r = await pool.query(`UPDATE inquiries SET ${sets.join(', ')} WHERE id = $${vals.length}`, vals);
        return r.rowCount > 0;
      },
      async remove(id) {
        const r = await pool.query(`DELETE FROM inquiries WHERE id = $1`, [parseInt(id, 10)]);
        return r.rowCount > 0;
      },
    };
  }

  // 개발용: 파일 저장 (Railway에서는 반드시 DATABASE_URL 사용 — 파일은 재배포 때 사라짐)
  const file = path.join(__dirname, 'data', 'inquiries.json');
  const read = () => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return []; } };
  const write = (all) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(all, null, 2)); };
  return {
    kind: 'file',
    async init() {},
    async recentCount(ip) { const t = Date.now() - 10 * 60 * 1000; return read().filter((r) => r.ip === ip && Date.parse(r.createdAt) > t).length; },
    async add(d) { const all = read(); const id = String((all.reduce((m, r) => Math.max(m, +r.id), 0)) + 1); all.push({ id, ...d, status: 'new', memo: '', createdAt: new Date().toISOString() }); write(all); },
    async list() { return read().sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(({ ip, ...r }) => r); },
    async update(id, patch) { const all = read(); const r = all.find((x) => x.id === String(id)); if (!r) return false; Object.assign(r, patch); write(all); return true; },
    async remove(id) { const all = read(); const n = all.filter((x) => x.id !== String(id)); write(n); return n.length !== all.length; },
  };
}
const store = makeStore();

/* ---------------- 관리자 로그인 쿠키 ---------------- */
function sign(value) { return crypto.createHmac('sha256', SESSION_SECRET).update(value).digest('hex'); }
function makeToken() { const exp = String(Date.now() + SESSION_HOURS * 3600 * 1000); return `${exp}.${sign(exp)}`; }
function validToken(t) {
  if (!t || typeof t !== 'string') return false;
  const [exp, sig] = t.split('.');
  if (!exp || !sig || +exp < Date.now()) return false;
  const good = sign(exp);
  return sig.length === good.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good));
}
function readCookie(req, name) {
  const m = (req.headers.cookie || '').split(';').map((s) => s.trim()).find((s) => s.startsWith(name + '='));
  return m ? decodeURIComponent(m.slice(name.length + 1)) : '';
}
function setCookie(res, value, maxAgeSec) {
  res.setHeader('Set-Cookie', `${COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSec}${PROD ? '; Secure' : ''}`);
}
const isAdmin = (req) => validToken(readCookie(req, COOKIE));
function requireAdmin(req, res, next) {
  if (!isAdmin(req)) return res.status(401).json({ ok: false, error: '다시 로그인해 주세요.' });
  next();
}
function samePassword(input) {
  if (!ADMIN_PASSWORD) return false;
  const a = crypto.createHash('sha256').update(String(input || '')).digest();
  const b = crypto.createHash('sha256').update(ADMIN_PASSWORD).digest();
  return crypto.timingSafeEqual(a, b);
}
// 비밀번호 여러 번 틀리면 잠시 막기 (IP당 15분에 10번)
const loginTries = new Map();
function tooManyTries(ip) {
  const now = Date.now(); const list = (loginTries.get(ip) || []).filter((t) => now - t < 15 * 60 * 1000);
  loginTries.set(ip, list); return list.length >= 10;
}

/* ---------------- 앱 ---------------- */
const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      'default-src': ["'self'"],
      'script-src': ["'self'"],
      'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      'font-src': ["'self'", 'https://fonts.gstatic.com', 'data:'],
      'img-src': ["'self'", 'data:'],
      'connect-src': ["'self'"],
      'form-action': ["'self'"],
      'frame-ancestors': ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false,
}));

// www.byranmk.com → byranmk.com 으로 통일
app.use((req, res, next) => {
  const host = (req.headers.host || '').toLowerCase();
  if (host.startsWith('www.')) return res.redirect(301, `https://${host.slice(4)}${req.originalUrl}`);
  next();
});

app.get('/healthz', (req, res) => res.json({ ok: true, store: store.kind }));

/* 문의 접수 */
app.post('/api/inquiry', express.json({ limit: '20kb' }), async (req, res) => {
  const b = req.body || {};
  const fail = (code, error) => res.status(code).json({ ok: false, error });
  if (clip(b.website, 200)) return res.json({ ok: true }); // 자동 프로그램

  const d = {
    name: clip(b.name, 100), phone: clip(b.phone, 40), email: clip(b.email, 255),
    business: clip(b.business, 200), link: joinLinks(b), message: clip(b.message, 3000),
    services: (Array.isArray(b.services) ? b.services : []).map(String).filter((s) => SERVICES.includes(s)),
    ip: req.ip,
  };
  if (!d.name) return fail(400, '상호 또는 성함을 적어주세요.');
  if (!d.phone && !d.email) return fail(400, '연락받으실 전화번호나 이메일 중 하나는 적어주세요.');
  if (d.phone && !PHONE_RE.test(d.phone)) return fail(400, '전화번호를 확인해 주세요.');
  if (d.email && !EMAIL_RE.test(d.email)) return fail(400, '이메일 형식을 확인해 주세요.');
  if (b.agree !== true) return fail(400, '개인정보 수집·이용에 동의해 주셔야 문의를 남길 수 있어요.');

  try {
    if ((await store.recentCount(d.ip)) >= 5) return fail(429, '문의가 여러 건 접수됐어요. 잠시 후 다시 시도해 주세요.');
    await store.add(d);
    res.json({ ok: true });
  } catch (e) {
    console.error('[inquiry]', e.message);
    fail(500, '접수 중 문제가 생겼어요. 잠시 후 다시 시도해 주세요.');
  }
});

/* 관리자 */
app.post('/api/admin/login', express.json({ limit: '2kb' }), (req, res) => {
  if (!ADMIN_PASSWORD) return res.status(503).json({ ok: false, error: '관리자 비밀번호가 아직 설정되지 않았어요. (ADMIN_PASSWORD)' });
  if (tooManyTries(req.ip)) return res.status(429).json({ ok: false, error: '비밀번호를 여러 번 틀렸어요. 15분 뒤에 다시 시도해 주세요.' });
  if (!samePassword(req.body && req.body.password)) {
    loginTries.get(req.ip).push(Date.now());
    return res.status(401).json({ ok: false, error: '비밀번호가 맞지 않아요.' });
  }
  loginTries.delete(req.ip);
  setCookie(res, makeToken(), SESSION_HOURS * 3600);
  res.json({ ok: true });
});
app.post('/api/admin/logout', (req, res) => { setCookie(res, '', 0); res.json({ ok: true }); });
app.get('/api/admin/me', (req, res) => res.json({ ok: isAdmin(req) }));
app.get('/api/admin/inquiries', requireAdmin, async (req, res) => {
  try { res.json({ ok: true, items: await store.list() }); }
  catch (e) { console.error('[admin list]', e.message); res.status(500).json({ ok: false, error: '목록을 불러오지 못했어요.' }); }
});
app.patch('/api/admin/inquiries/:id', requireAdmin, express.json({ limit: '10kb' }), async (req, res) => {
  const patch = {};
  if (req.body.status !== undefined) {
    if (!STATUSES.includes(req.body.status)) return res.status(400).json({ ok: false, error: '상태 값이 올바르지 않아요.' });
    patch.status = req.body.status;
  }
  if (req.body.memo !== undefined) patch.memo = clip(req.body.memo, 2000);
  try {
    const ok = await store.update(req.params.id, patch);
    res.status(ok ? 200 : 404).json({ ok });
  } catch (e) { console.error('[admin update]', e.message); res.status(500).json({ ok: false, error: '저장하지 못했어요.' }); }
});
app.delete('/api/admin/inquiries/:id', requireAdmin, async (req, res) => {
  try { const ok = await store.remove(req.params.id); res.status(ok ? 200 : 404).json({ ok }); }
  catch (e) { console.error('[admin delete]', e.message); res.status(500).json({ ok: false, error: '삭제하지 못했어요.' }); }
});

/* 페이지 */
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.use(express.static(path.join(__dirname, 'public'), {
  extensions: ['html'],
  maxAge: PROD ? '1h' : 0,
  setHeaders(res, file) { if (file.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache'); },
}));
app.use((req, res) => res.status(404).sendFile(path.join(__dirname, 'public', 'index.html')));

store.init()
  .then(() => app.listen(PORT, () => console.log(`byranmk listening on ${PORT} (store: ${store.kind})`)))
  .catch((e) => { console.error('데이터베이스 준비 실패:', e.message); process.exit(1); });
