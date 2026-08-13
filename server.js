// 바이란미디어 AI 오피스 - 정적 서버
// Railway가 이 파일을 실행합니다 (npm start -> node server.js)
const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// 정적 파일 서빙 (public 폴더)
app.use(express.static(path.join(__dirname, 'public')));

// 헬스체크 (Railway가 앱이 살아있는지 확인)
app.get('/health', (_req, res) => res.json({ ok: true, ts: Date.now() }));

// --- 여기가 나중에 노션과 연결되는 자리입니다 ---
// 2단계에서 이 엔드포인트가 노션 DB를 읽어 실제 작업 상태를 내려줍니다.
app.get('/api/state', (_req, res) => {
  res.json({ source: 'mock', note: '노션 연동 시 이 응답이 실제 데이터로 바뀝니다.' });
});

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`바이란미디어 AI 오피스 실행 중 → 포트 ${PORT}`);
});
