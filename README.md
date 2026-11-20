# 현장로그 (FieldLog)

시공·청소 사장님을 위한 **네이버 블로그 후기 30초 완성** 모바일 웹앱.
현장 사진 3장이면 지역 키워드 제목·공정별 본문·비포/애프터 카드가 나옵니다.
자동 입력·자동 발행은 하지 않고, **원고와 이미지만** 만들어 드립니다.

- 라이브: https://ulyeol-lab.github.io/sigong-log/
- 빌드 도구 없이 `index.html` 하나로 동작하는 정적 사이트입니다.
  회원가입·로그인, **무료 체험 3건 / 월 15건 서버 잠금**, **원고 생성**, **신청 접수**는 Supabase를 씁니다.
- 원고 생성기는 **서버(Supabase Edge Function `generate-post`)에만** 있습니다.
  브라우저에는 생성 코드가 배포되지 않고, 서버가 잔여 횟수를 차감한 뒤에만 원고를 돌려줍니다.

## 구성

| 파일 | 역할 |
| --- | --- |
| `index.html` | 랜딩(소개·비용 비교·실제 결과 예시·업종·요금·신청) + 작성 화면 + 결과 화면 + 로그인/한도 모달 |
| `styles.css` | 모바일 퍼스트(max 480px) 스타일 |
| `catalog.js` | 화면 표시용 업종·채널 이름, 빠른 태그 (원고 생성 로직 없음) |
| `demo-result.js` | 비로그인 [예시로 바로 체험하기]에 쓰는 **고정 예시 결과** (가상 데이터) |
| `engine.js` | 원고 엔진 원본 — **테스트와 서버 사본 동기화 기준**일 뿐, 페이지가 불러오지 않습니다 |
| `assets/demo-before.jpg` 등 | 랜딩 예시·예시 체험에 쓰는 실제 현장 사진 3장 (810×1080, JPEG) |
| `canvas.js` | 비포/애프터 1080×1080 카드 합성, 예시 사진 생성 |
| `app.js` | 화면 로직, 사진 리사이즈, 로그인, 서버 원고 요청(사진 함께 전송), 신청 폼 |
| `supabase/schema.sql` | Supabase 테이블(profiles·generation_logs·leads) + RLS + 횟수 차감 RPC |
| `supabase/functions/generate-post/` | **원고 생성 Edge Function** (engine.ts 서버 사본 + 입력 검증) |
| `supabase/functions/submit-lead/` | **신청 접수 Edge Function** (검증·스팸 방지 → leads 저장 → 텔레그램 알림) |
| `supabase/functions/_shared/http.ts` | CORS·JSON 응답 공통 도우미 |
| `gas/sigong_notify_template.gs` | 예전 GAS 알림 템플릿 (현재 미사용 · 참고용) |
| `tests/engine.test.mjs` | 엔진 테스트 (`node tests/engine.test.mjs`) |
| `tests/engine-parity.test.mjs` | `engine.js` ↔ `engine.ts` CORE 본문 일치 + 프론트에 생성기가 없는지 검사 |
| `tests/catalog.test.mjs` | `catalog.js`·`demo-result.js` 가 엔진 데이터와 일치하는지 검사 |
| `tests/edge-functions.test.ts` | Edge Function 검증·텔레그램 문구·스팸 판정 테스트 (`deno test`) |

## 회원가입 · 무료 체험 잠금 (Supabase)

- 프로젝트: `https://khivycnezspevendmdtx.supabase.co`
- 프론트엔드에는 **공개용(publishable) 키만** 들어 있습니다 (`app.js`의 `SUPABASE`).
  `sb_secret_...` / `service_role` 키와 개인 전화번호는 **저장소에 절대 넣지 마세요.**
- 처음 한 번만: Supabase Dashboard → **SQL Editor** → New query →
  `supabase/schema.sql` 전체 붙여넣고 Run. (여러 번 실행해도 안전합니다.)
- 동작
  - 이메일·비밀번호로 회원가입/로그인 (`supabase.auth`).
  - 가입하면 `profiles` 행이 `plan='trial', monthly_limit=3, used_count=0`으로 자동 생성됩니다.
  - **[후기 만들기]는 서버(Edge Function `generate-post`)를 거칩니다.** 함수가 JWT를 검증하고
    `consume_generation_for_user` RPC로 **원자적으로 1건 차감한 뒤 `allowed=true`일 때만** 원고 4채널을 만들어 돌려줍니다.
    브라우저 콘솔로 생성기를 부르는 우회 경로는 없습니다(생성 코드가 배포되지 않음).
  - 한 번 만들면 4채널이 함께 오므로 **채널 전환은 횟수를 더 쓰지 않습니다**(1건 = 현장 1곳).
  - 무료 체험 3건 소진 → HTTP 402 `reason='trial_exhausted'` → 플랜 신청 안내 모달.
  - 라이트(월 15건) 소진 → `reason='monthly_limit'`, 다음 달 1일에 자동 초기화.
  - `pro` / `agency` 는 무제한(`limit=-1`), 이력만 `generation_logs`에 쌓입니다.
  - 요금제·횟수 컬럼은 `protect_profile_quota` 트리거 + 컬럼 GRANT로 막아 두어 브라우저에서 직접 바꿀 수 없습니다.
  - `_consume_quota`(내부) / `consume_generation_for_user`(service_role 전용)는 실행 권한을 회수해 두어
    브라우저가 남의 user.id로 횟수를 건드릴 수 없습니다.
  - 로그인한 사용자의 업체 정보(상호·연락처·말투·마무리)는 `profiles`에도 저장돼 기기를 바꿔도 유지됩니다
    (localStorage와 병행).
- **이메일 인증**: Supabase Authentication → Sign In / Providers → Email 의
  `Confirm email` 이 켜져 있으면 가입 후 메일 확인 링크를 눌러야 로그인됩니다.
  "10초 회원가입" 흐름을 원하시면 이 옵션을 끄거나, 커스텀 SMTP(Resend 등)를 연결하세요.
  끄지 않은 상태의 기본 SMTP는 시간당 발송 한도가 낮아 실제 사장님 가입이 막힐 수 있습니다.
- 스키마를 아직 실행하지 않은 상태에서는 원고 생성이 `503 schema_not_installed`로 막힙니다(fail-closed).
  마이그레이션 없이 배포하면 사장님이 원고를 못 받으므로 **SQL 먼저, 함수 다음, 프론트 마지막** 순서로 올립니다.
- 요금제 수동 변경(관리자): SQL Editor에서
  `update public.profiles set plan='light', monthly_limit=15, used_count=0, period_start=date_trunc('month', now()) where email='...';`

## 발행 채널

| 채널 | 출력 형식 |
| --- | --- |
| 네이버 블로그(기본) | 지역 키워드 제목 3안(1·2안은 지역+업종 앞배치) + 현장 요약표 + 작업 전 상태·작업 순서·공정별 본문·달라진 점(`[사진 : 공정 · 시점]`, 1,500자 이상) + 해시태그 5개 + 지역 키워드 4개 |
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

### 1) AI 문장 다듬기 (서버 내장 · 키 입력 없음)

- Gemini 호출은 `generate-post` Edge Function이 서버에서 합니다. 키는 Supabase Secrets의
  `GEMINI_API_KEY` 하나뿐이고, 브라우저에는 어떤 키도 내려가지 않습니다(입력칸 없음).
- 사진을 올리면 브라우저에서 1024px JPEG base64로 줄여 원고 요청에 함께 보내고,
  서버가 사진을 그대로 Gemini에 넘겨 사진에서 보이는 오염·시공 전후 상태를 본문과
  사진 설명(`→ ...`)에 반영합니다. 사진이 없으면 문장만 다듬습니다.
- 다듬기는 4채널을 한 번에 처리하고, 1건 생성에 1회로만 차감합니다(채널 전환은 무료).
- 호출이 실패·시간 초과되거나 형식이 어긋나면 **규칙 기반 원고 그대로** 나갑니다(폴백).
- 서버 Secrets로 조정: `GEMINI_MODEL`(기본 `gemini-3.1-flash-lite` → `gemini-3.8-flash` 순서로 시도),
  `GEMINI_POLISH`=`always`(기본) | `photos`(사진이 있을 때만) | `off`(규칙 기반만).
- 서버는 받은 사진을 저장하지 않고 요청 처리 중에만 Gemini로 넘깁니다.

### 2) 네이버 상위 노출(SEO) — 제목 앞배치 · 본문 구성 · 체크리스트

- **입력**: 작성기 3번 칸은 `송파구 잠실 엘스`처럼 **구·동 + 단지명**을 함께 적게 안내합니다.
  단지명은 제목 뒤쪽과 요약표에 롱테일 키워드로 들어갑니다.
- **제목**: 3안 중 1·2안은 반드시 `지역 + 업종/세부증상`으로 시작합니다(네이버 검색어 앞배치).
  3안은 비용·소요시간 안내형입니다.
- **본문**: `현장 요약` → `작업 전 상태` → `작업 순서` → 공정별 설명+사진 자리 → `달라진 점` →
  왜 그렇게 하는지 한 단락 → `셀프로 확인할 포인트` → 견적 → 마무리 순서로, 사진 3장 기준 **1,500~1,750자**가 나옵니다.
  지역 키워드는 본문에 3~7회 자연스럽게 분산됩니다(도배 금지).
- **결과 화면 체크리스트**: 블로그 결과에서 방금 만든 원고를 그대로 세어 5항목을 카드로 보여 줍니다.
  ① 제목 1·2안 앞배치 ② 본문 분량(1,500~3,500자, 공백 포함) ③ `[사진 : ...]` 자리 4곳 이상
  ④ 지역 키워드 3~7회 ⑤ 해시태그 5개 이하. 비로그인 [예시로 바로 체험하기]에서도 같은 카드가 보입니다.
  본문을 [수정하기]로 고치면 목록과 점수를 다시 계산합니다.
- **AI 다듬기**: Gemini 프롬프트에 "첫 문단에서 지역·업종 키워드를 빼지 않는다, 3~7회 안에서 분산한다,
  `■` 소제목과 목록을 지우지 않는다, 1,500자 이상 유지"를 넣었습니다. 초안보다 20% 넘게 줄어든 결과는
  받지 않고 규칙 기반 원고를 그대로 씁니다(폴백).

### 3) 신청 접수 (Edge Function + leads 테이블)

- 신청서는 브라우저에서 `supabase.functions.invoke('submit-lead')`로 보냅니다.
  서버가 검증·스팸 방지 후 `public.leads`에 저장하고, 텔레그램으로 알림을 보냅니다.
- 공개 번들에서 **GAS 웹훅 URL을 걷어냈습니다.** 이제 신청 알림을 위조해 보낼 수 없고,
  `leads`는 RLS로 anon/authenticated 직접 조회·수정이 막혀 있습니다(service_role 전용).
- 텔레그램 설정은 서버 Secrets에만 둡니다: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`.
  값이 없으면 접수는 정상 저장되고 알림만 생闡니다(`notified:false`).
- 스팸 방지: 같은 연락처 5분 내 중복은 저장하지 않고 성공 응답, 같은 IP 10분 내 5건(`MAX_LEADS_PER_IP`),
  전체 시간당 30건(`MAX_LEADS_PER_HOUR`) 초과 시 429, 숨김 입력칸(허니팟) 채우면 조용히 무시.
  (통신사 NAT로 IP를 공유하는 경우가 많아 IP 한도는 넉넉히 두고, 중복·시간당 상한을 주 방어로 씁니다.)
- 접수된 신청 확인(SQL Editor):
  ```sql
  select created_at, name, industry, region, contact, plan, status
    from public.leads order by created_at desc limit 20;
  ```
- `gas/sigong_notify_template.gs`는 예전 방식(참고용)이며 더 이상 쓰지 않습니다.

## 배포 순서 (Edge Function)

원고 생성이 서버로 옮겨졌기 때문에 **순서를 지켜야** 라이브가 끊기지 않습니다.

1. **DB 먼저:** Dashboard → SQL Editor 에 `supabase/schema.sql` 전체를 붙여넣고 Run.
   (`leads` 테이블과 `consume_generation_for_user` 함수가 추가됩니다. 여러 번 실행해도 안전합니다.)
2. **Secrets:** Dashboard → Edge Functions → Secrets (또는 CLI)
   ```bash
   supabase secrets set TELEGRAM_BOT_TOKEN=... TELEGRAM_CHAT_ID=... \
     LEAD_IP_SALT=$(openssl rand -hex 16) ALLOWED_ORIGINS=https://ulyeol-lab.github.io
   ```
   `SUPABASE_URL`·`SUPABASE_ANON_KEY`·`SUPABASE_SERVICE_ROLE_KEY`는 Supabase가 함수에 자동으로 넣어 줍니다.
3. **함수 배포**
   ```bash
   supabase functions deploy generate-post                      # 로그인 사용자 JWT 필요(기본 JWT 검증)
   supabase functions deploy submit-lead --no-verify-jwt        # 공개 신청 폼(비로그인 허용)
   ```
   CLI 없이 하려면 Dashboard → Edge Functions → Deploy new function 에서
   `supabase/functions/<이름>/` 파일을 그대로 올리고, `submit-lead`만 JWT 검증 끔으로 둡니다.
4. **프론트 배포:** 마지막에 `index.html`·`app.js`·`catalog.js`·`demo-result.js`를 `main`에 푸시합니다.
   (함수가 올라가기 전에 프론트를 먼저 올리면 [후기 만들기]가 “원고를 만들지 못했어요”로 막힙니다 — fail-closed.)

## 테스트

```bash
node --check engine.js && node --check catalog.js && node --check demo-result.js && node --check canvas.js && node --check app.js
node tests/engine.test.mjs
node tests/engine-parity.test.mjs
node tests/catalog.test.mjs
deno test tests/edge-functions.test.ts
```

## 개인정보

- 원고 생성과 AI 다듬기는 서버(Supabase Edge Function)에서 처리합니다. 비포·애프터 카드는 브라우저에서
  사진을 합성해 만들고, AI 다듬기를 쓸 때만 사진(1024px JPEG)이 서버를 거쳐 Google Gemini로 전달됩니다.
  서버는 사진을 저장하지 않습니다.
- 이메일·비밀번호는 Supabase 인증에 저장되고 비밀번호는 앱에서 볼 수 없습니다.
  체험 횟수·요금제·업체 정보만 `profiles`에, 생성 이력은 `generation_logs`에 저장되며 행 단위 보안(RLS)으로 본인 것만 읽습니다.
- 신청서는 `leads`에 저장됩니다(상호명·업종·지역·연락처·요금제·유입 페이지·IP 해시).
  IP는 원문 대신 `LEAD_IP_SALT`로 해시해서만 보관합니다.
- 업체 정보·말투는 브라우저 `localStorage`에도 저장됩니다(API 키는 저장하지 않습니다).
- 공개 저장소·공개 번들에는 어떤 비밀키·토큰·전화번호도 넣지 않습니다.
