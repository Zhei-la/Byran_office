# 바이란미디어 AI 오피스 — 배포 안내

폰에서 URL로 볼 수 있는 "실시간 작업 현황판" 웹앱입니다.
GitHub에 올리고 Railway에 연결하면, 앞으로는 **코드가 바뀔 때마다 자동으로 배포**됩니다.

---

## 무엇이 들어있나
- `public/index.html` — 앱 화면 (오피스 뷰 + 작업 보드)
- `server.js` — 이 파일을 Railway가 실행해서 웹사이트로 띄웁니다
- `package.json` / `Procfile` — 실행 방법 설정
- `/api/state` — (지금은 목업) 나중에 노션과 연결되는 자리

---

## 한 번만 하면 되는 배포 순서

### 1) GitHub에 올리기
- github.com 에서 새 저장소(repository)를 하나 만든다. (예: `byran-office`)
- 이 폴더 전체를 그 저장소에 올린다(push).

### 2) Railway에 연결하기
- railway.app 접속 → **New Project → Deploy from GitHub repo**
- 방금 만든 저장소를 선택한다.
- Railway가 자동으로 `npm install` → `npm start` 를 실행하고 URL을 만들어 준다.
- **Settings → Networking → Generate Domain** 을 누르면 공개 주소(URL)가 나온다.

### 3) 폰에서 확인
- 그 URL을 폰 브라우저에서 열면 끝. 홈 화면에 추가해두면 앱처럼 쓸 수 있다.

> 이후에는 코드를 GitHub에 push할 때마다 Railway가 **자동으로 다시 배포**합니다.

---

## 다음 단계 (2단계 — 진짜 데이터 연결)
지금은 캐릭터가 자동으로 움직이는 데모입니다.
노션에 "직원 / 프로젝트 / 태스크 / 상태" DB를 만들고 `/api/state` 를 노션과 연결하면,
화면이 **실제 작업 상태**로 움직이게 됩니다.

---

## 로컬에서 미리 실행해보기 (선택)
```
npm install
npm start
```
브라우저에서 http://localhost:3000 접속.
