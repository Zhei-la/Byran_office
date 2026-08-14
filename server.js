// 바이란미디어 AI 오피스 — 서버 (노션 연동)
const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const TOKEN = process.env.NOTION_TOKEN;
const DB = (process.env.NOTION_DB_ID || '').replace(/-/g, '');
const NV = '2022-06-28';

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function nheaders() {
  return { 'Authorization': 'Bearer ' + TOKEN, 'Notion-Version': NV, 'Content-Type': 'application/json' };
}
function txt(p) { return (p && p.rich_text ? p.rich_text.map(function (t) { return t.plain_text; }).join('') : ''); }
function sel(p) { return (p && p.select ? p.select.name : ''); }
function title(p) { return (p && p.title ? p.title.map(function (t) { return t.plain_text; }).join('') : ''); }
function chk(p) { return !!(p && p.checkbox); }

app.get('/health', function (_req, res) {
  res.json({ ok: true, notion: !!TOKEN && !!DB, ts: Date.now() });
});

// 노션 DB → 작업 목록
app.get('/api/state', async function (_req, res) {
  if (!TOKEN || !DB) return res.json({ tasks: [], connected: false });
  try {
    const r = await fetch('https://api.notion.com/v1/databases/' + DB + '/query', {
      method: 'POST', headers: nheaders(), body: JSON.stringify({ page_size: 100 })
    });
    const d = await r.json();
    if (!r.ok) return res.status(500).json({ error: d.message || 'notion query failed', tasks: [] });
    const tasks = (d.results || []).map(function (pg) {
      const P = pg.properties || {};
      return {
        id: pg.id,
        title: title(P['작업명']),
        team: sel(P['담당팀']),
        project: sel(P['프로젝트']),
        status: sel(P['상태']) || '요청',
        person: txt(P['담당자']),
        result: txt(P['결과물']),
        feedback: txt(P['피드백']),
        risky: chk(P['위험작업']),
        url: pg.url
      };
    });
    res.json({ tasks: tasks, connected: true });
  } catch (e) { res.status(500).json({ error: String(e), tasks: [] }); }
});

// 작업 시키기 → 노션에 '요청' 카드 생성
app.post('/api/task', async function (req, res) {
  if (!TOKEN || !DB) return res.status(400).json({ error: 'notion not configured' });
  const team = (req.body && req.body.team) || '';
  const project = (req.body && req.body.project) || '';
  const text = ((req.body && req.body.text) || '새 작업').slice(0, 200);
  try {
    const props = {
      '작업명': { title: [{ text: { content: text } }] },
      '상태': { select: { name: '요청' } },
      '지시내용': { rich_text: [{ text: { content: text } }] }
    };
    if (team) props['담당팀'] = { select: { name: team } };
    if (project) props['프로젝트'] = { select: { name: project } };
    const r = await fetch('https://api.notion.com/v1/pages', {
      method: 'POST', headers: nheaders(),
      body: JSON.stringify({ parent: { database_id: DB }, properties: props })
    });
    const d = await r.json();
    if (!r.ok) return res.status(500).json({ error: d.message || 'create failed' });
    res.json({ ok: true, id: d.id });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// 상태 변경 (승인=완료 / 반려=수정요청+피드백)
app.post('/api/status', async function (req, res) {
  if (!TOKEN || !DB) return res.status(400).json({ error: 'notion not configured' });
  const id = req.body && req.body.id;
  const status = req.body && req.body.status;
  const feedback = req.body && req.body.feedback;
  if (!id || !status) return res.status(400).json({ error: 'id and status required' });
  try {
    const props = { '상태': { select: { name: status } } };
    if (typeof feedback === 'string') props['피드백'] = { rich_text: [{ text: { content: feedback.slice(0, 400) } }] };
    const r = await fetch('https://api.notion.com/v1/pages/' + id.replace(/-/g, ''), {
      method: 'PATCH', headers: nheaders(), body: JSON.stringify({ properties: props })
    });
    const d = await r.json();
    if (!r.ok) return res.status(500).json({ error: d.message || 'update failed' });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

app.get('*', function (_req, res) { res.sendFile(path.join(__dirname, 'public', 'index.html')); });
app.listen(PORT, function () { console.log('바이란 오피스 실행 중 · 포트 ' + PORT + ' · 노션연결 ' + (!!TOKEN && !!DB)); });
