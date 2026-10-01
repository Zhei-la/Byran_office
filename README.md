# 바이란 마케팅 홈페이지 (byranmk.com)

블로그 대행 · 스레드 대행 · 홈페이지형 블로그 제작 · 홈페이지 제작 안내 사이트.

## 구성
- `public/` — 홈페이지 8쪽 + 관리자 문의함(`/admin`) + 이미지·스타일·스크립트
- `server.js` — Express 서버
  - `POST /api/inquiry` : 문의하기 접수 (이름, 연락처/이메일, 업종, 서비스, 주소, 내용, 개인정보 동의)
  - `/admin` : 관리자 문의함 (비밀번호 로그인, 상태 신규/연락함/완료/스팸, 메모, 삭제)
  - `GET /healthz` : 상태 확인

## 환경변수 (Railway → Variables)
| 이름 | 내용 |
|---|---|
| `DATABASE_URL` | Railway PostgreSQL 연결 주소 (`${{Postgres.DATABASE_URL}}`) |
| `ADMIN_PASSWORD` | 관리자 문의함 비밀번호 |
| `SESSION_SECRET` | 로그인 쿠키 서명용 긴 무작위 문자열 |

`DATABASE_URL`이 없으면 `data/inquiries.json`에 저장합니다 (개발용 — Railway에서는 재배포 때 사라지므로 반드시 PostgreSQL 연결).

## 로컬 실행
```bash
npm install
ADMIN_PASSWORD=test SESSION_SECRET=dev npm start   # http://localhost:3000
```

## 수정할 곳
- 문구·가격: `public/*.html`
- 디자인: `public/assets/design.css` (기본 스타일은 `base.css`)
- 동작: `public/assets/site.js`, 관리자 문의함 `public/assets/admin.js`
- 사업자등록번호·통신판매업신고번호·주소: 각 페이지 하단 `<div class="biz">` (아직 미입력)

## 방문 통계 (visits.js)
- 기기(쿠키 `bv`) 1대 = 1명, 30분 넘게 쉬었다가 다시 오면 방문 +1, 화면(HTML)을 열 때마다 화면 연 횟수 +1
- 봇(User-Agent)과 사람 확인 신호(`assets/hi.js` → `POST /v/hi`, 스크롤·터치·6초 머묾)가 없는 기기는 통계에서 뺌
- 관리자로 로그인한 브라우저, 운영자 전용 주소(`/v/me/<키>`)를 연 브라우저는 통계에서 뺌
- 관리자 화면 `/admin` → '방문 통계' 탭: 당일 / 최근 7일 / 전체, 플랫폼별, 최근 14일 그래프
- 링크에 `?from=threads` 처럼 붙이면 플랫폼이 더 정확하게 잡힘
- DATABASE_URL(PostgreSQL)이 있을 때만 동작
