/* 방문자 세기 (바이란 라운지 방식)
   - 기기(쿠키 bv) 1대 = 1명, 같은 기기라도 30분 넘게 쉬었다가 오면 방문 +1
   - 화면(HTML 200)을 열 때마다 화면 연 횟수 +1
   - 봇(User-Agent)·사람 확인 신호가 없는 기기·운영자 기기는 관리 통계에서 뺀다
   - 날짜는 한국 시간 자정 기준
   PostgreSQL(DATABASE_URL)이 있을 때만 동작하고, 없으면 조용히 건너뛴다. */
const crypto = require('crypto');

const DAY = `(now() AT TIME ZONE 'Asia/Seoul')::date`;
const VCOOKIE = 'bv';
const VID_RE = /^[a-f0-9]{16,40}$/;
// 안 세는 주소 (관리·API·방문 신호·파일)
const SKIP_PATH = /^\/(admin|api\/|v\/|healthz|favicon|manifest|robots|sitemap|assets\/)|\.(?!html$)[a-z0-9]{2,5}$/i;
// 봇: 이름을 밝히는 것 + 브라우저인 척하는 흔한 가짜
const BOT = /bot|crawl|spider|slurp|preview|scrap|facebookexternalhit|kakaotalk-scrap|daumoa|yeti|curl|wget|python|go-http|java\/|headless|lighthouse|monitor|uptime|axios|node-fetch|checker|scanner|leads|httpclient|okhttp|libwww|compatible;|iPhone OS 13_2_3|Chrome\/[1-9]\d\.|Firefox\/[1-8]\d\.|PhantomJS|Puppeteer|Playwright|Selenium/i;

const SOURCES = {
  threads: '🧵 스레드', instagram: '📸 인스타그램', facebook: '📘 페이스북', kakaotalk: '💬 카카오톡',
  naver: '🟢 네이버', google: '🔎 구글', youtube: '▶️ 유튜브', daum: '🔵 다음', x: '✖️ X(트위터)',
  tiktok: '🎵 틱톡', band: '🟩 밴드', line: '🟢 라인', direct: '🔗 직접 들어옴 · 즐겨찾기', other: '🌐 기타 사이트',
};
const SRC_WORDS = [
  ['threads', /threads/], ['instagram', /insta|ig\b/], ['facebook', /facebook|\bfb\b/], ['kakaotalk', /kakao|카톡/],
  ['naver', /naver|블로그|blog/], ['google', /google/], ['youtube', /youtube|yt\b/], ['daum', /daum/],
  ['x', /twitter|^x$/], ['tiktok', /tiktok/], ['band', /band/], ['line', /^line/],
];

function readCookie(req, name) {
  const m = String(req.headers.cookie || '').match(new RegExp('(?:^|;\\s*)' + name + '=([^;]+)'));
  return m ? decodeURIComponent(m[1]) : '';
}
function refHost(req) {
  try {
    const h = new URL(req.get('referer') || '').host.replace(/^(www|m)\./, '').toLowerCase();
    const own = String(req.get('host') || '').replace(/^www\./, '').toLowerCase();
    return h && h !== own ? h.slice(0, 120) : null;
  } catch (e) { return null; }
}
function sourceOf(req, host) {
  // 1) 링크에 붙인 표시: ?from=threads, ?utm_source=instagram
  const tag = String((req.query && (req.query.from || req.query.utm_source || req.query.ref)) || '').toLowerCase().slice(0, 30);
  if (tag) { const hit = SRC_WORDS.find((w) => w[1].test(tag)); return hit ? hit[0] : 'other'; }
  // 2) 앱 안 브라우저
  const ua = req.get('user-agent') || '';
  if (/Barcelona|Threads/i.test(ua)) return 'threads';
  if (/Instagram/i.test(ua)) return 'instagram';
  if (/FBAN|FBAV|FB_IAB|FBIOS/i.test(ua)) return 'facebook';
  if (/KAKAOTALK/i.test(ua)) return 'kakaotalk';
  if (/NAVER\(inapp|NAVER\//i.test(ua)) return 'naver';
  if (/DaumApps/i.test(ua)) return 'daum';
  if (/\bBAND\//i.test(ua)) return 'band';
  if (/\bLine\//i.test(ua)) return 'line';
  if (/musical_ly|TikTok|BytedanceWebview/i.test(ua)) return 'tiktok';
  // 3) 들어오기 전 주소
  const h = host || '';
  if (!h) return 'direct';
  if (/threads\.(net|com)$/.test(h)) return 'threads';
  if (/instagram\.com$/.test(h)) return 'instagram';
  if (/(facebook\.com|fb\.me)$/.test(h)) return 'facebook';
  if (/kakao/.test(h)) return 'kakaotalk';
  if (/naver\./.test(h)) return 'naver';
  if (/(^|\.)google\./.test(h)) return 'google';
  if (/(youtube\.com|youtu\.be)$/.test(h)) return 'youtube';
  if (/daum\.net$/.test(h)) return 'daum';
  if (/(^|\.)(t\.co|x\.com|twitter\.com)$/.test(h)) return 'x';
  if (/tiktok\.com$/.test(h)) return 'tiktok';
  if (/band\.us$/.test(h)) return 'band';
  return 'other';
}
// Railway 프록시 뒤: X-Real-IP → X-Forwarded-For 첫 번째 → req.ip
function clientIp(req) {
  const real = String(req.get('x-real-ip') || '').trim();
  if (real) return real.slice(0, 64);
  const xff = String(req.get('x-forwarded-for') || '').split(',')[0].trim();
  return (xff || String(req.ip || '')).replace(/^::ffff:/, '').slice(0, 64) || null;
}

/**
 * @param {object} o
 * @param {(sql:string, params?:any[]) => Promise<{rows:any[], rowCount:number}>} [o.query]  없으면 방문 세기 끔
 * @param {(req) => boolean} o.isOwner  운영자(관리자 로그인) 여부
 * @param {string} o.secret  운영자 전용 주소를 만들 비밀값
 * @param {boolean} o.secure 쿠키 secure
 */
module.exports = function makeVisits(o) {
  const q = o.query;
  const enabled = !!q;
  const setVid = (res, vid) => res.cookie(VCOOKIE, vid, { maxAge: 1000 * 60 * 60 * 24 * 400, httpOnly: true, sameSite: 'lax', secure: !!o.secure });

  async function init() {
    if (!enabled) return;
    await q(`CREATE TABLE IF NOT EXISTS site_visits (
      day        DATE        NOT NULL,
      vid        VARCHAR(40) NOT NULL,
      views      INT         NOT NULL DEFAULT 1,
      visits     INT         NOT NULL DEFAULT 1,
      first_path VARCHAR(200),
      ref_host   VARCHAR(120),
      source     VARCHAR(20),
      ip         VARCHAR(64),
      human      BOOLEAN     NOT NULL DEFAULT false,
      last_at    TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (day, vid)
    )`);
    await q(`CREATE INDEX IF NOT EXISTS idx_site_visits_day ON site_visits (day)`);
    await q(`CREATE TABLE IF NOT EXISTS site_owner_devices (
      vid        VARCHAR(40) PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
    await q(`CREATE OR REPLACE VIEW site_visits_x AS
      SELECT v.* FROM site_visits v
       WHERE v.human AND NOT EXISTS (SELECT 1 FROM site_owner_devices o WHERE o.vid = v.vid)`);
  }

  function vidOf(req, res) {
    let vid = readCookie(req, VCOOKIE);
    if (!VID_RE.test(vid)) { vid = crypto.randomBytes(12).toString('hex'); setVid(res, vid); }
    return vid;
  }
  function markOwnerVid(vid) {
    return q(`INSERT INTO site_owner_devices (vid) VALUES ($1) ON CONFLICT (vid) DO NOTHING`, [vid]);
  }

  /* 1) 화면 열 때마다 기록 */
  function track(req, res, next) {
    if (!enabled || req.method !== 'GET' || SKIP_PATH.test(req.path)) return next();
    const ua = req.get('user-agent') || '';
    if (!ua || BOT.test(ua)) return next();
    const vid = vidOf(req, res);
    req.vid = vid;
    if (o.isOwner(req)) markOwnerVid(vid).catch(() => {});
    const ref = refHost(req);
    const src = sourceOf(req, ref);
    res.on('finish', () => {
      if (res.statusCode >= 400) return;
      if (!/text\/html/.test(String(res.get('content-type') || ''))) return;
      q(`INSERT INTO site_visits (day, vid, first_path, ref_host, ip, last_at, source)
         VALUES (${DAY}, $1, $2, $3, $4, now(), $5)
         ON CONFLICT (day, vid) DO UPDATE SET
           views   = site_visits.views + 1,
           visits  = site_visits.visits + CASE WHEN site_visits.last_at IS NULL OR now() - site_visits.last_at > interval '30 minutes' THEN 1 ELSE 0 END,
           last_at = now(),
           ip      = COALESCE(site_visits.ip, EXCLUDED.ip)`,
        [vid, req.path.slice(0, 200), ref, clientIp(req), src]
      ).catch((e) => console.error('[방문 기록]', e.message));
    });
    next();
  }

  /* 2) 사람 확인 신호 (POST /v/hi) */
  function hi(req, res) {
    res.status(204).end();
    if (!enabled) return;
    const ua = req.get('user-agent') || '';
    const vid = readCookie(req, VCOOKIE);
    if (!ua || BOT.test(ua) || !VID_RE.test(vid)) return;
    const mark = () => q(`UPDATE site_visits SET human = true WHERE day = ${DAY} AND vid = $1`, [vid]).then((r) => r.rowCount);
    mark().then((n) => { if (!n) setTimeout(() => mark().catch(() => {}), 3000); }).catch(() => {});
  }

  /* 3) 운영자 전용 주소 (GET /v/me/:key) — 카톡·스레드 앱 안 브라우저에서 한 번 열면 통계에서 빠짐 */
  const ownerKey = () => crypto.createHmac('sha256', String(o.secret || 'change-me')).update('owner-device').digest('hex').slice(0, 20);
  function markOwner(req, res) {
    if (!enabled || req.params.key !== ownerKey()) return res.redirect('/');
    const vid = vidOf(req, res);
    markOwnerVid(vid)
      .then(() => res.type('html').set('Cache-Control', 'no-store').send('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>운영자 기기</title><p style="font:16px sans-serif;padding:40px;text-align:center;line-height:1.7">✅ 이 브라우저는 운영자 기기로 기억돼요.<br>방문 통계에서 빠져요.<br><br><a href="/">홈으로</a></p>'))
      .catch(() => res.redirect('/'));
  }

  /* 4) 숫자 꺼내기 */
  function range(r, prev = false, col = 'day') {
    if (r === 'all') return prev ? null : 'true';
    if (r === '7d') return prev ? `${col} BETWEEN ${DAY} - 13 AND ${DAY} - 7` : `${col} >= ${DAY} - 6`;
    return prev ? `${col} = ${DAY} - 1` : `${col} = ${DAY}`;
  }
  const IQ_DAY = `(created_at AT TIME ZONE 'Asia/Seoul')::date`;
  async function summary(r) {
    const one = async (prev) => {
      const cond = range(r, prev);
      if (!cond) return null;
      const [{ rows: [v] }, { rows: [i] }] = await Promise.all([
        q(`SELECT count(DISTINCT vid)::int AS people, count(DISTINCT ip)::int AS ips,
                  COALESCE(sum(visits),0)::int AS visits, COALESCE(sum(views),0)::int AS views
             FROM site_visits_x WHERE ${cond}`),
        q(`SELECT count(*)::int AS n FROM inquiries WHERE status <> 'spam' AND ${range(r, prev, IQ_DAY)}`),
      ]);
      return { ...v, inquiries: i.n };
    };
    const [cur, prev] = await Promise.all([one(false), one(true)]);
    return { ...cur, prev };
  }
  async function daily(days) {
    const { rows } = await q(
      `WITH d AS (SELECT generate_series(${DAY} - ($1::int - 1), ${DAY}, interval '1 day')::date AS day)
       SELECT d.day::text AS day,
              (SELECT count(DISTINCT vid) FROM site_visits_x v WHERE v.day = d.day)::int AS people,
              (SELECT COALESCE(sum(visits),0) FROM site_visits_x v WHERE v.day = d.day)::int AS visits,
              (SELECT COALESCE(sum(views),0)  FROM site_visits_x v WHERE v.day = d.day)::int AS views,
              (SELECT count(*) FROM inquiries i WHERE i.status <> 'spam' AND (i.created_at AT TIME ZONE 'Asia/Seoul')::date = d.day)::int AS inquiries
         FROM d ORDER BY d.day DESC`, [days]);
    return rows;
  }
  async function platforms(r) {
    const { rows } = await q(
      `WITH v AS (SELECT COALESCE(source,'direct') AS src, vid, visits, day FROM site_visits_x WHERE ${range(r)}),
            agg AS (SELECT src, count(DISTINCT vid)::int AS people, COALESCE(sum(visits),0)::int AS visits FROM v GROUP BY src),
            iq AS (SELECT v.src, count(DISTINCT i.id)::int AS n FROM inquiries i
                     JOIN v ON v.vid = i.vid AND v.day = (i.created_at AT TIME ZONE 'Asia/Seoul')::date
                    WHERE i.status <> 'spam' GROUP BY v.src)
       SELECT agg.src, agg.people, agg.visits, COALESCE(iq.n,0)::int AS inquiries
         FROM agg LEFT JOIN iq USING (src) ORDER BY people DESC, visits DESC`);
    return rows.map((x) => ({ ...x, label: SOURCES[x.src] || x.src }));
  }
  async function stats(r) {
    if (!enabled) return { enabled: false };
    if (!['today', '7d', 'all'].includes(r)) r = 'today';
    const [s, p, d] = await Promise.all([summary(r), platforms(r), daily(90)]);
    return { enabled: true, range: r, summary: s, platforms: p, daily: d };
  }

  // 관리자 로그인한 브라우저도 운영자 기기로 기억
  function ownerFromReq(req) {
    if (!enabled) return;
    const vid = readCookie(req, VCOOKIE);
    if (VID_RE.test(vid)) markOwnerVid(vid).catch(() => {});
  }
  const vidFromReq = (req) => { const v = readCookie(req, VCOOKIE); return VID_RE.test(v) ? v : null; };

  return { enabled, init, track, hi, markOwner, ownerKey, ownerFromReq, vidFromReq, stats };
};
