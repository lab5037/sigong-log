# 현장로그 (FieldLog)

시공·청소 사장님을 위한 **네이버 블로그 후기 30초 완성** 모바일 웹앱.
현장 사진 3장이면 지역 키워드 제목·공정별 본문·비포/애프터 카드가 나옵니다.
자동 입력·자동 발행은 하지 않고, **원고와 이미지만** 만들어 드립니다.

- 라이브: https://ulyeol-lab.github.io/sigong-log/
- 빌드 도구 없이 `index.html` 하나로 동작하는 정적 사이트입니다.
  회원가입·로그인과 **무료 체험 3건 / 월 15건 서버 잠금**만 Supabase를 씁니다.

## 구성

| 파일 | 역할 |
| --- | --- |
| `index.html` | 랜딩(소개·비용 비교·실제 결과 예시·업종·요금·신청) + 작성 화면 + 결과 화면 + 로그인/한도 모달 |
| `styles.css` | 모바일 퍼스트(max 480px) 스타일 |
| `engine.js` | 원고 생성 엔진 (6개 업종 × 3말투 × 4채널, 제목·요약표·본문·해시태그·지역 키워드) |
| `assets/demo-before.jpg` 등 | 랜딩 예시·예시 체험에 쓰는 실제 현장 사진 3장 (810×1080, JPEG) |
| `canvas.js` | 비포/애프터 1080×1080 카드 합성, 예시 사진 생성 |
| `app.js` | 화면 로직, 사진 리사이즈, 로그인·체험 횟수, Gemini 사진 인식, 신청 폼·웹훅 |
| `supabase/schema.sql` | Supabase 테이블(profiles·generation_logs) + RLS + `consume_generation` RPC |
| `gas/sigong_notify_template.gs` | 신청 알림(텔레그램) 구글 앱스 스크립트 템플릿 |
| `tests/engine.test.mjs` | 엔진 테스트 (`node tests/engine.test.mjs`) |

## 회원가입 · 무료 체험 잠금 (Supabase)

- 프로젝트: `https://khivycnezspevendmdtx.supabase.co`
- 프론트엔드에는 **공개용(publishable) 키만** 들어 있습니다 (`app.js`의 `SUPABASE`).
  `sb_secret_...` / `service_role` 키와 개인 전화번호는 **저장소에 절대 넣지 마세요.**
- 처음 한 번만: Supabase Dashboard → **SQL Editor** → New query →
  `supabase/schema.sql` 전체 붙여넣고 Run. (여러 번 실행해도 안전합니다.)
- 동작
  - 이메일·비밀번호로 회원가입/로그인 (`supabase.auth`).
  - 가입하면 `profiles` 행이 `plan='trial', monthly_limit=3, used_count=0`으로 자동 생성됩니다.
  - 원고를 만들 때마다 브라우저가 `consume_generation(p_industry, p_channel, p_region)` RPC를 호출하고,
    **서버가 원자적으로 1건 차감한 뒤 `allowed=true`를 돌려줄 때만** 원고를 보여 줍니다.
  - 무료 체험 3건 소진 → `allowed=false, reason='trial_exhausted'` → 플랜 신청 안내 모달.
  - 라이트(월 15건) 소진 → `reason='monthly_limit'`, 다음 달 1일에 자동 초기화.
  - `pro` / `agency` 는 무제한(`limit=-1`), 이력만 `generation_logs`에 쌓입니다.
  - 요금제·횟수 컬럼은 `protect_profile_quota` 트리거로 막아 두어 브라우저에서 직접 바꿀 수 없습니다.
    (트리거는 SECURITY INVOKER라서, RPC 안에서는 통과하고 브라우저 직접 UPDATE에서만 되돌립니다.)
  - 로그인한 사용자의 업체 정보(상호·연락처·말투·마무리)는 `profiles`에도 저장돼 기기를 바꿔도 유지됩니다
    (localStorage와 병행).
- **이메일 인증**: Supabase Authentication → Sign In / Providers → Email 의
  `Confirm email` 이 켜져 있으면 가입 후 메일 확인 링크를 눌러야 로그인됩니다.
  "10초 회원가입" 흐름을 원하시면 이 옵션을 끄거나, 커스텀 SMTP(Resend 등)를 연결하세요.
  끄지 않은 상태의 기본 SMTP는 시간당 발송 한도가 낮아 실제 사장님 가입이 막힐 수 있습니다.
- 스키마를 아직 실행하지 않은 상태에서도 페이지는 깨지지 않고,
  로그인은 되지만 체험 횟수 집계만 건너뛰며 관리자 설정에 안내 문구가 표시됩니다.
- 요금제 수동 변경(관리자): SQL Editor에서
  `update public.profiles set plan='light', monthly_limit=15, used_count=0, period_start=date_trunc('month', now()) where email='...';`

## 발행 채널

| 채널 | 출력 형식 |
| --- | --- |
| 네이버 블로그(기본) | 지역 키워드 제목 3안 + 현장 요약표 + 공정별 본문(`[📸 사진 위치]`, 900~1,200자) + 해시태그 5개 + 지역 키워드 4개 |
| 당근 | 동네 이웃에게 말 거는 톤, 빠른 방문·A/S 강조, 현장 요약 4줄 + 300~500자 본문 + 채팅 문의 유도 |
| 인스타그램 | 후킹 첫 줄 + 짧은 줄바꿈 + 바뀐 포인트 3가지 + 저장·DM 유도 + 해시태그 5개 |
| 스레드 | 500자 이내 1인칭 구어체, 짧은 호흡, 꿀팁 한 줄 + 가벼운 마무리 (해시태그 0~1개) |

작성기와 결과 화면의 채널 칩으로 바로 전환하면 같은 현장 정보로 형식만 바뀌어 다시 나옵니다.

## 지원 업종 (티어 1)

1. 입주·이사청소
2. 시스템에어컨 청소 — 보양 → 완전분해(필터·그릴·드레인판·송풍팬) → 열교환기 고압세척·오염수 배출 → 살균·건조 → 조립·시운전 (대수·모델명 반영)
3. 줄눈·탄성코트
4. 누수·방수 — 탐지 → 보강 → 타일 복구 → 담수 테스트
5. 욕실·실리콘 시공
6. 방충망·단열필름·중문

## 선택 기능

### 1) Gemini 사진 인식 (키를 넣은 기기에서만)

- 사이트 하단 **관리자 설정 · 알림 · AI 키**에 Gemini API 키를 넣으면, 업로드한 시공 전·중·후 사진을
  브라우저에서 1024px JPEG base64로 줄여 `gemini-2.5-flash`에 보내고,
  사진에서 보이는 오염·시공 전후 상태를 본문과 사진 설명(`→ ...`)에 반영합니다.
  사진이 있는 상태에서 [후기 만들기]를 누르면 자동으로 한 번 다듬고,
  [AI로 문장 다듬기]로 다시 실행할 수 있습니다.
- 키는 `localStorage`에만 저장되며 서버로 가지 않습니다. 키가 없는 기기에서는 결과 화면의 AI 버튼이 보이지 않습니다.
- 키가 없거나 호출이 실패하면 **기본 원고 그대로** 남습니다(폴백).

### 2) 신청 알림 웹훅 (텔레그램)

- `app.js` 상단 `CONFIG.webhookUrl` 값은 현장로그 알림봇 GAS 웹앱의 배포 URL입니다(2026-11-19 연결).
  **봇 토큰·chat_id·개인 전화번호는 저장소에 넣지 마세요** — 토큰·chat_id는 Apps Script 스크립트 속성에만 둡니다.
- 연결 방법은 `gas/sigong_notify_template.gs` 상단 주석 참고:
  1. Apps Script에 템플릿 붙여넣기
  2. 스크립트 속성에 `TELEGRAM_TOKEN`, `TELEGRAM_CHAT_ID` 저장
  3. 웹 앱으로 배포(액세스: 모든 사용자)
  4. 배포 URL을 `CONFIG.webhookUrl`에 넣거나, 그 브라우저에서만
     `localStorage.setItem('fieldlog.webhook.v1', JSON.stringify('<배포 URL>'))`
- 웹훅이 없으면 신청서는 **복사용 문의 내용**만 만들어 화면에 보여줍니다.
- 사이트 하단 **관리자 설정**에서도 URL을 넣고 [테스트 알림 보내기]로 확인할 수 있습니다
  (그 브라우저의 localStorage에만 저장).

## 테스트

```bash
node --check engine.js && node --check canvas.js && node --check app.js
node tests/engine.test.mjs
```

## 개인정보

- 사진과 원고는 브라우저 안에서만 처리됩니다(서버 전송 없음, Gemini 사용 시 제외).
- 이메일·비밀번호는 Supabase 인증에 저장되고 비밀번호는 앱에서 볼 수 없습니다.
  체험 횟수·요금제·업체 정보만 `profiles`에 저장되며, 행 단위 보안(RLS)으로 본인 것만 읽고 씁니다.
- 업체 정보·말투·Gemini 키는 브라우저 `localStorage`에도 저장됩니다.
- 공개 저장소에는 어떤 비밀키·토큰·전화번호도 하드코딩하지 않습니다.
