/* 포트폴리오 사례 글 (관리자에서 직접 작성)
   - 관리자 > 포트폴리오 에서 글 쓰기 · 사진 올리기 · 공개/비공개
   - /portfolio            : 서비스별 탭 안에 "고객 사례" 카드로 나타남 (assets/site.js)
   - /portfolio/숫자       : 사례 하나를 페이지로 보여줌 (사진 + 설명)
   - /media/pf/숫자        : 올린 사진
   저장: DATABASE_URL 이 있으면 PostgreSQL (사진도 DB에 저장 — Railway 재배포에도 안 사라짐),
         없으면 data/ 폴더 (개발용) */
const path = require('path');
const fs = require('fs');
const express = require('express');

const CATS = {
  threads: '스레드 운영 대행',
  blog: '블로그 운영 대행',
  bloghome: '홈페이지형 블로그',
  website: '홈페이지 제작',
};
const clip = (v, n) => String(v == null ? '' : v).trim().slice(0, n);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const isUrl = (s) => /^https?:\/\/[^\s<>"']+$/i.test(s || '');

function cleanBlocks(list) {
  if (!Array.isArray(list)) return [];
  return list.slice(0, 60).map((b) => {
    if (b && b.type === 'img' && Number.isInteger(+b.img) && +b.img > 0) {
      return { type: 'img', img: +b.img, caption: clip(b.caption, 400) };
    }
    if (b && b.type === 'text') {
      const text = clip(b.text, 4000);
      return text ? { type: 'text', text } : null;
    }
    return null;
  }).filter(Boolean);
}
function cleanPost(b) {
  b = b || {};
  return {
    category: CATS[b.category] ? b.category : 'threads',
    title: clip(b.title, 200),
    summary: clip(b.summary, 400),
    highlight: clip(b.highlight, 120),
    industry: clip(b.industry, 80),
    period: clip(b.period, 80),
    link: isUrl(clip(b.link, 300)) ? clip(b.link, 300) : '',
    blocks: cleanBlocks(b.blocks),
    published: b.published === true,
    sort: Math.max(-9999, Math.min(9999, parseInt(b.sort, 10) || 0)),
  };
}
const imgIds = (blocks) => blocks.filter((b) => b.type === 'img').map((b) => b.img);
const coverOf = (p) => { const i = (p.blocks || []).find((b) => b.type === 'img'); return i ? `/media/pf/${i.img}` : ''; };

// 사진 형식 확인 (앞부분 바이트로)
function sniff(buf) {
  if (!buf || buf.length < 12) return '';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return '';
}

/* ---------------- 저장소 ---------------- */
function makePgStore(query) {
  const row = (r) => r && ({
    id: String(r.id), category: r.category, title: r.title, summary: r.summary || '', highlight: r.highlight || '',
    industry: r.industry || '', period: r.period || '', link: r.link || '', blocks: r.blocks || [],
    published: r.published, sort: r.sort, createdAt: r.created_at.toISOString(), updatedAt: r.updated_at.toISOString(),
  });
  async function attach(id, ids) {
    await query(`UPDATE pf_images SET post_id = $1 WHERE id = ANY($2::int[]) AND (post_id IS NULL OR post_id = $1)`, [id, ids]);
    await query(`DELETE FROM pf_images WHERE post_id = $1 AND NOT (id = ANY($2::int[]))`, [id, ids]);
  }
  return {
    async init() {
      await query(`CREATE TABLE IF NOT EXISTS pf_posts (
        id         SERIAL PRIMARY KEY,
        category   VARCHAR(20)  NOT NULL,
        title      VARCHAR(200) NOT NULL,
        summary    TEXT,
        highlight  VARCHAR(120),
        industry   VARCHAR(80),
        period     VARCHAR(80),
        link       TEXT,
        blocks     JSONB   NOT NULL DEFAULT '[]',
        published  BOOLEAN NOT NULL DEFAULT false,
        sort       INT     NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);
      await query(`CREATE TABLE IF NOT EXISTS pf_images (
        id         SERIAL PRIMARY KEY,
        post_id    INT REFERENCES pf_posts(id) ON DELETE CASCADE,
        mime       VARCHAR(40) NOT NULL,
        data       BYTEA NOT NULL,
        size       INT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);
      await query(`CREATE INDEX IF NOT EXISTS idx_pf_images_post ON pf_images (post_id)`);
      await query(`DELETE FROM pf_images WHERE post_id IS NULL AND created_at < now() - interval '1 day'`);
    },
    async list(onlyPublished) {
      const { rows } = await query(`SELECT * FROM pf_posts ${onlyPublished ? 'WHERE published' : ''} ORDER BY sort DESC, created_at DESC LIMIT 300`);
      return rows.map(row);
    },
    async get(id) {
      const { rows } = await query(`SELECT * FROM pf_posts WHERE id = $1`, [id]);
      return row(rows[0]);
    },
    async create(p) {
      const { rows } = await query(
        `INSERT INTO pf_posts (category, title, summary, highlight, industry, period, link, blocks, published, sort)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
        [p.category, p.title, p.summary, p.highlight, p.industry, p.period, p.link, JSON.stringify(p.blocks), p.published, p.sort]);
      const id = rows[0].id;
      await attach(id, imgIds(p.blocks));
      return String(id);
    },
    async update(id, p) {
      const r = await query(
        `UPDATE pf_posts SET category=$1, title=$2, summary=$3, highlight=$4, industry=$5, period=$6, link=$7,
           blocks=$8, published=$9, sort=$10, updated_at=now() WHERE id=$11`,
        [p.category, p.title, p.summary, p.highlight, p.industry, p.period, p.link, JSON.stringify(p.blocks), p.published, p.sort, id]);
      if (!r.rowCount) return false;
      await attach(id, imgIds(p.blocks));
      return true;
    },
    async remove(id) {
      const r = await query(`DELETE FROM pf_posts WHERE id = $1`, [id]);
      return r.rowCount > 0;
    },
    async addImage(mime, buf) {
      await query(`DELETE FROM pf_images WHERE post_id IS NULL AND created_at < now() - interval '1 day'`);
      const { rows } = await query(`INSERT INTO pf_images (mime, data, size) VALUES ($1, $2, $3) RETURNING id`, [mime, buf, buf.length]);
      return String(rows[0].id);
    },
    async image(id) {
      const { rows } = await query(
        `SELECT i.mime, i.data, i.post_id, p.published FROM pf_images i LEFT JOIN pf_posts p ON p.id = i.post_id WHERE i.id = $1`, [id]);
      const r = rows[0];
      return r && { mime: r.mime, data: r.data, published: !!r.published };
    },
  };
}

function makeFileStore(dir) {
  const file = path.join(dir, 'portfolio.json');
  const imgDir = path.join(dir, 'pf-img');
  const read = () => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return { posts: [], images: [] }; } };
  const write = (d) => { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(file, JSON.stringify(d, null, 2)); };
  const nextId = (arr) => String(arr.reduce((m, x) => Math.max(m, +x.id), 0) + 1);
  function attach(d, id, ids) {
    d.images.forEach((im) => { if (ids.includes(+im.id) && (!im.postId || im.postId === id)) im.postId = id; });
    d.images = d.images.filter((im) => !(im.postId === id && !ids.includes(+im.id)));
  }
  const sorted = (posts) => posts.slice().sort((a, b) => (b.sort - a.sort) || b.createdAt.localeCompare(a.createdAt));
  return {
    async init() {},
    async list(onlyPublished) { return sorted(read().posts.filter((p) => !onlyPublished || p.published)); },
    async get(id) { return read().posts.find((p) => p.id === String(id)) || null; },
    async create(p) {
      const d = read(); const id = nextId(d.posts); const now = new Date().toISOString();
      d.posts.push({ id, ...p, createdAt: now, updatedAt: now }); attach(d, id, imgIds(p.blocks)); write(d); return id;
    },
    async update(id, p) {
      const d = read(); const cur = d.posts.find((x) => x.id === String(id)); if (!cur) return false;
      Object.assign(cur, p, { updatedAt: new Date().toISOString() }); attach(d, cur.id, imgIds(p.blocks)); write(d); return true;
    },
    async remove(id) {
      const d = read(); const n = d.posts.length; d.posts = d.posts.filter((x) => x.id !== String(id));
      d.images = d.images.filter((im) => im.postId !== String(id)); write(d); return d.posts.length !== n;
    },
    async addImage(mime, buf) {
      const d = read(); const id = nextId(d.images);
      fs.mkdirSync(imgDir, { recursive: true }); fs.writeFileSync(path.join(imgDir, id), buf);
      d.images.push({ id, mime, postId: null, createdAt: new Date().toISOString() }); write(d); return id;
    },
    async image(id) {
      const d = read(); const im = d.images.find((x) => x.id === String(id)); if (!im) return null;
      const p = im.postId && d.posts.find((x) => x.id === im.postId);
      try { return { mime: im.mime, data: fs.readFileSync(path.join(imgDir, im.id)), published: !!(p && p.published) }; } catch (e) { return null; }
    },
  };
}

/* ---------------- 사례 페이지 HTML ---------------- */
function textHtml(t) {
  return String(t).split(/\n{2,}/).map((para) => `<p>${esc(para).replace(/\n/g, '<br>')}</p>`).join('');
}
function renderPage(tpl, p, { host, draft }) {
  const cat = CATS[p.category] || '포트폴리오';
  const title = `${p.title} | ${cat} 포트폴리오 | 바이란 마케팅`;
  const desc = p.summary || `${cat} 사례 · 바이란 마케팅`;
  const url = `https://${host}/portfolio/${p.id}`;
  const cover = coverOf(p);
  const meta = [];
  if (p.highlight) meta.push(`<span class="pfd-hl">${esc(p.highlight)}</span>`);
  if (p.industry) meta.push(`<span class="chip"><b>업종</b> ${esc(p.industry)}</span>`);
  if (p.period) meta.push(`<span class="chip"><b>기간</b> ${esc(p.period)}</span>`);
  const body = (p.blocks || []).map((b) => {
    if (b.type === 'text') return `<div class="pfd-text">${textHtml(b.text)}</div>`;
    const src = `/media/pf/${b.img}`;
    const alt = b.caption || p.title;
    return `<figure class="pfd-fig"><a href="${src}" data-zoom aria-label="크게 보기"><img src="${src}" alt="${esc(alt)}" loading="lazy"></a>${b.caption ? `<figcaption>${esc(b.caption)}</figcaption>` : ''}</figure>`;
  }).join('\n');
  const link = p.link ? `<a class="btn btn-outline" href="${esc(p.link)}" target="_blank" rel="noopener nofollow">운영 계정·사이트 보기 <span class="arr" aria-hidden="true">↗</span></a>` : '';
  const vars = {
    TITLE: esc(title), DESC: esc(desc), URL: esc(url),
    OG_IMAGE: esc(cover ? `https://${host}${cover}` : `https://${host}/assets/og-image.jpg`),
    ROBOTS: draft ? '<meta name="robots" content="noindex,nofollow">' : '',
    DRAFT: draft ? '<p class="pfd-draft">비공개 글이에요. 관리자로 로그인한 브라우저에서만 보여요.</p>' : '',
    CAT: esc(cat), CAT_KEY: esc(p.category), H1: esc(p.title),
    LEAD: p.summary ? `<p class="lead">${esc(p.summary)}</p>` : '',
    META: meta.length ? `<div class="pfd-meta">${meta.join('')}</div>` : '',
    BODY: body || '<p class="pfd-empty">아직 내용이 없어요.</p>',
    LINK: link,
  };
  return tpl.replace(/\{\{([A-Z0-9_]+)\}\}/g, (m, k) => (k in vars ? vars[k] : m));
}

/* ---------------- 라우트 ---------------- */
module.exports = function makePortfolio({ query, requireAdmin, isAdmin, assetVer, prod, root }) {
  const store = query ? makePgStore(query) : makeFileStore(path.join(root, 'data'));
  const tplFile = path.join(root, 'views', 'portfolio-post.html');
  let tplCache = null;
  const tpl = () => {
    if (tplCache && prod) return tplCache;
    tplCache = fs.readFileSync(tplFile, 'utf8').replace(/\{\{VER\}\}/g, assetVer);
    return tplCache;
  };
  const fail = (res, code, error) => res.status(code).json({ ok: false, error });
  const pub = (p) => ({
    id: p.id, category: p.category, title: p.title, summary: p.summary, highlight: p.highlight,
    industry: p.industry, period: p.period, cover: coverOf(p), url: `/portfolio/${p.id}`,
  });

  function routes(app) {
    // 홈페이지 포트폴리오 목록 (공개 글만)
    app.get('/api/portfolio', async (req, res) => {
      try { res.set('Cache-Control', 'no-cache').json({ ok: true, items: (await store.list(true)).map(pub) }); }
      catch (e) { console.error('[pf list]', e.message); fail(res, 500, '목록을 불러오지 못했어요.'); }
    });

    // 사진
    app.get('/media/pf/:id(\\d+)', async (req, res, next) => {
      try {
        const im = await store.image(req.params.id);
        if (!im || (!im.published && !isAdmin(req))) return next();
        res.set('Content-Type', im.mime);
        res.set('Cache-Control', im.published ? 'public, max-age=31536000, immutable' : 'private, no-store');
        res.set('X-Content-Type-Options', 'nosniff');
        res.send(im.data);
      } catch (e) { console.error('[pf image]', e.message); res.status(500).end(); }
    });

    // 사례 페이지
    app.get('/portfolio/:id(\\d+)', async (req, res, next) => {
      try {
        const p = await store.get(req.params.id);
        const admin = isAdmin(req);
        if (!p || (!p.published && !admin)) return next();
        res.set('Cache-Control', 'no-cache').type('html').send(renderPage(tpl(), p, { host: req.get('host'), draft: !p.published }));
      } catch (e) { console.error('[pf page]', e.message); next(); }
    });

    // 관리자
    app.get('/api/admin/portfolio', requireAdmin, async (req, res) => {
      try { res.json({ ok: true, items: await store.list(false), cats: CATS }); }
      catch (e) { console.error('[pf admin list]', e.message); fail(res, 500, '목록을 불러오지 못했어요.'); }
    });
    const save = (create) => async (req, res) => {
      const p = cleanPost(req.body);
      if (!p.title) return fail(res, 400, '제목을 적어주세요.');
      try {
        if (create) return res.json({ ok: true, id: await store.create(p) });
        const ok = await store.update(req.params.id, p);
        return ok ? res.json({ ok: true, id: req.params.id }) : fail(res, 404, '글을 찾지 못했어요.');
      } catch (e) { console.error('[pf save]', e.message); fail(res, 500, '저장하지 못했어요.'); }
    };
    app.post('/api/admin/portfolio', requireAdmin, express.json({ limit: '300kb' }), save(true));
    app.put('/api/admin/portfolio/:id(\\d+)', requireAdmin, express.json({ limit: '300kb' }), save(false));
    app.delete('/api/admin/portfolio/:id(\\d+)', requireAdmin, async (req, res) => {
      try { const ok = await store.remove(req.params.id); res.status(ok ? 200 : 404).json({ ok }); }
      catch (e) { console.error('[pf delete]', e.message); fail(res, 500, '삭제하지 못했어요.'); }
    });
    app.post('/api/admin/portfolio/images', requireAdmin,
      express.raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: '6mb' }),
      async (req, res) => {
        const buf = Buffer.isBuffer(req.body) ? req.body : null;
        const mime = sniff(buf);
        if (!mime) return fail(res, 400, 'JPG, PNG, WEBP 사진만 올릴 수 있어요.');
        try { const id = await store.addImage(mime, buf); res.json({ ok: true, id, url: `/media/pf/${id}` }); }
        catch (e) { console.error('[pf upload]', e.message); fail(res, 500, '사진을 올리지 못했어요.'); }
      });
  }

  return { init: () => store.init(), routes, CATS };
};
