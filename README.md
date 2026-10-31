# 컷토리 카드뉴스

글, 링크, 문서(PDF·Word·TXT), 영상을 넣으면 인스타그램 카드뉴스를 만들어 주는 웹앱이에요.

- `index.html`, `config.js`, `fonts/`: GitHub Pages로 올라가는 화면
- `reels.html`: 컷토리 릴스 (영상 자막·컷 편집)
- `poses.html`, `poses.js`: 캐릭터 포즈 만들기. 캐릭터 그림 한 장을 올리면 고른 포즈로 다시 그려 줘요. 포즈 목록은 `poses.js`에서 고쳐요. 포즈 묶음의 '이모티콘'과 그림체 '이모티콘 낙서체'로 메신저 이모티콘 느낌을 내고, 결과의 ✨에서 글자·움직임을 넣어 360×360 GIF로 받아요. 주소 뒤에 `?demo`를 붙이면 크레딧 없이 흐름만 보는 체험 모드로 열려요.
- `worker/`: OpenAI 키를 숨겨 두고 AI 기능과 크레딧을 맡는 서버 (Cloudflare Workers)

## 서버 올리기 (Cloudflare 대시보드, 코드 실행 없이)

1. [dash.cloudflare.com](https://dash.cloudflare.com)에 가입하고 로그인해요.
2. **Workers & Pages → Create → Create Worker**. 이름은 `cuttory-api`로 하고 **Deploy**를 눌러요.
3. **Edit code**를 눌러 원래 코드를 모두 지우고, `worker/worker.js` 내용을 붙여 넣은 뒤 **Deploy**를 눌러요.
4. **Storage & Databases → KV → Create**에서 이름 `cuttory`로 저장소를 만들어요.
5. 만든 Worker의 **Settings → Bindings → Add → KV namespace**에서 변수 이름 `KV`, 저장소 `cuttory`를 골라 저장해요.
6. **Settings → Variables and Secrets → Add**에서 아래 값을 넣어요.
   - `OPENAI_API_KEY` (종류: Secret): OpenAI API 키
   - `ADMIN_KEY` (종류: Secret): 관리자 페이지용 비밀번호. 아무도 모르는 긴 글자로 정해요.
   - `ALLOWED_ORIGIN` (종류: Text): 사이트 주소, 예) `https://아이디.github.io`
7. Worker 주소(예: `https://cuttory-api.아이디.workers.dev`)를 열어 `{"ok":true,"ai":true,"kv":true}`가 보이면 끝이에요.
8. `config.js`의 `window.CUTTORY_API`에 그 주소를 넣어요.

## 관리자

사이트 주소 뒤에 `?admin`을 붙여 열고 `ADMIN_KEY`를 넣으면, 내 계정 페이지에서 혜택 코드를 만들고 받은 피드백을 볼 수 있어요.

## 크레딧

새 사용자는 100 크레딧으로 시작해요. 사용량은 `worker/worker.js` 맨 위 `COST`에서 바꿀 수 있어요.

| 기능 | 크레딧 |
|---|---|
| AI 카드 생성 | 10 |
| 영상으로 카드 생성 | 15 |
| AI 그림 (배경·인물 표지) | 20 |
| 말소리 받아 적기 | 10 |
| 링크 읽기 | 3 |
| 번역 | 5 |
| 제목 다시 뽑기 | 2 |
| 문구 다듬기 | 1 |
| 캐릭터 포즈 1장 | 15 |
| 캐릭터 턴어라운드 | 20 |

계정은 브라우저마다 하나씩 만들어지고, 같은 네트워크에서 하루 3개까지만 새로 만들 수 있어요.

## 업무 오피스 (`office.html`)

매일 아침 트렌드팀이 마케팅 리포트를 들고 출근하고, 제작팀이 카드뉴스·블로그·릴스·이모티콘·콘텐츠 비서·프리랜서 비서 도구를 하나씩 맡는 픽셀 사무실이에요. 제작팀 도구 주소는 `office.html`의 `PROD`에서 바꿔요. 리포트를 읽고 퀴즈를 풀고 스크랩하면 경험치가 쌓여 인턴에서 CMO까지 승진하고, 직급마다 사무실 가구가 늘어나요.

- `office.html`: 화면 전체 (기록은 브라우저 localStorage에 저장)
- `office/make-report.mjs`: 마케팅 뉴스(언론사 RSS·구글 뉴스)를 모아 AI로 리포트를 쓰는 스크립트
- `office/reports/<종류>/<날짜>.json`: 리포트 원본, `office/reports-data.js`: 화면이 읽는 묶음 파일
- `.github/workflows/office.yml`: 매일 아침 8:20(한국 시간)에 리포트를 써서 저장소에 올려요. 월요일엔 위클리, 1일엔 먼슬리, 분기 첫날엔 분기 리포트도 같이 써요.
- 저장소 **Settings → Secrets and variables → Actions**에 `OPENAI_API_KEY`를 넣으면 컷토리 서버 대신 OpenAI를 바로 불러 더 좋은 모델(기본 `gpt-5.4-mini`, 변수 `OFFICE_MODEL`로 변경)로 써요. 없으면 컷토리 서버의 `/api/ai`를 써요.
- 리포트를 다시 쓰려면 Actions → 트렌드 오피스 리포트 → Run workflow에서 종류·날짜와 `yes`를 넣어요.
- 리더보드는 서버의 `/api/office/board`, `/api/office/score`를 써요. `worker/worker.js`를 다시 붙여 넣고 Deploy해야 켜져요. 그 전에는 내 기록만 보여요.
- 주소 뒤에 `?at=2026-11-02T09:05`를 붙이면 그 시각의 사무실을 미리 볼 수 있어요 (기록은 남지 않아요).
