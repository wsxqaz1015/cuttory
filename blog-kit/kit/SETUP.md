# 컷토리 블로그 키트 설치

Claude Code에 설치를 맡기는 걸 추천해요. 안내 페이지의 설치 요청문을 붙여 넣으면 아래 과정을 대신 진행해요.

## 필요한 것

- Mac 또는 Windows 10/11
- Claude Code (Claude Pro 이상)
- Google Chrome
- Node.js 20 이상
- uv (얼굴 모자이크에 사용. 처음 실행할 때 필요한 부품을 알아서 받아요)

## 순서

1. 이 폴더에서 `npm install` (Windows는 `npm.cmd install`)
2. `config.json`의 `blogId`에 네이버 아이디를 넣어요. 블로그 주소가 `https://blog.naver.com/abc123`이면 `abc123`.
3. `node scripts/naver.mjs check` 로 Chrome과 설정을 확인해요.
4. `posts/my-shop/` 폴더에 사진·영상을 넣고, `memo.txt`에 실제 경험을 한두 줄 적어요.
5. 처음 한 번은 `node scripts/naver.mjs login` 으로 전용 Chrome을 열고 네이버에 직접 로그인해요.

## 알아 둘 것

- `profiles/` 폴더에 네이버 로그인 정보가 남아요. 이 폴더는 다른 사람에게 보내거나 올리지 마세요.
- 얼굴 모자이크는 얼굴을 놓칠 수 있어요. 결과 사진을 꼭 직접 확인하세요. 영상 속 얼굴은 가리지 않아요.
- Windows에서는 HEIC 사진을 자동 변환하지 못해요. 휴대폰에서 JPG로 보내거나 미리 변환해 주세요.
- 네이버 편집기 화면이 바뀌면 입력이 멈출 수 있어요. 그럴 땐 `logs/` 캡처를 Claude Code에 보여 주세요.
