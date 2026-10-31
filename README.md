# 컷토리 카드뉴스

글, 링크, 문서(PDF·Word·TXT), 영상을 넣으면 인스타그램 카드뉴스를 만들어 주는 웹앱이에요.

- `index.html`, `config.js`, `fonts/`: GitHub Pages로 올라가는 화면
- `poses.html`, `poses.js`: 캐릭터 포즈 만들기. 캐릭터 그림 한 장을 올리면 고른 포즈로 다시 그려 줘요. 포즈 목록은 `poses.js`에서 고쳐요. 주소 뒤에 `?demo`를 붙이면 크레딧 없이 흐름만 보는 체험 모드로 열려요.
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
