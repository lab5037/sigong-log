#!/usr/bin/env bash
# 현장로그 — Supabase DB(SQL) · Secrets · Edge Function 배포를 한 번에 실행하는 스크립트.
#
# 준비물
#   · Supabase Access Token (sbp_...)  https://supabase.com/dashboard/account/tokens
#   · Supabase CLI (v2 이상)  — 이 스크립트는 --use-api 로 번들해 Docker가 필요 없습니다.
#   · 텔레그램 알림을 쓰려면 TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID (저장소에 넣지 말 것)
#
# 사용 예 (프로젝트 루트에서)
#   SUPABASE_ACCESS_TOKEN=sbp_xxx \
#   TELEGRAM_BOT_TOKEN=123456:AAA... TELEGRAM_CHAT_ID=123456789 \
#   ./supabase/deploy.sh khivycnezspevendmdtx
#
# 순서: (1) schema.sql 적용 → (2) Secrets → (3) 함수 2개 배포 → (4) 무해한 스모크 테스트
# (1)은 RUN_SQL=0 으로 건너뛰고 Dashboard SQL Editor에서 직접 실행해도 됩니다.

set -euo pipefail

REF="${1:-khivycnezspevendmdtx}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
SB="${SUPABASE_BIN:-supabase}"
RUN_SQL="${RUN_SQL:-1}"

if [[ -z "${SUPABASE_ACCESS_TOKEN:-}" ]]; then
  echo "SUPABASE_ACCESS_TOKEN(sbp_...)이 필요합니다." >&2
  exit 1
fi
case "$SUPABASE_ACCESS_TOKEN" in
  sbp_*) ;;
  *) echo "Access Token 형식이 아닙니다 (sbp_... 로 시작해야 합니다)." >&2; exit 1 ;;
esac

echo "▶ 대상 프로젝트: $REF"

# ── 1) DB 스키마 ────────────────────────────────────────────────
if [[ "$RUN_SQL" == "1" ]]; then
  echo "▶ schema.sql 적용 (leads 테이블 + consume_generation_for_user)"
  if python3 - "$REF" <<'PY'
import json, os, sys, urllib.request
ref = sys.argv[1]
sql = open('supabase/schema.sql', encoding='utf-8').read()
req = urllib.request.Request(
    f'https://api.supabase.com/v1/projects/{ref}/database/query',
    data=json.dumps({'query': sql}).encode(),
    headers={'Authorization': 'Bearer ' + os.environ['SUPABASE_ACCESS_TOKEN'],
             'Content-Type': 'application/json'},
    method='POST')
try:
    with urllib.request.urlopen(req, timeout=120) as r:
        print('  SQL 결과:', r.status, r.read(200).decode(errors='replace'))
except Exception as e:
    body = getattr(e, 'read', lambda: b'')().decode(errors='replace')[:300]
    print('  SQL 자동 실행 실패:', e, body)
    sys.exit(1)
PY
  then
    echo "  ✓ 스키마 적용 완료"
  else
    echo "  ! 자동 적용에 실패했습니다. Dashboard → SQL Editor 에 supabase/schema.sql 을 붙여넣고 Run 해 주세요."
    echo "    https://supabase.com/dashboard/project/$REF/sql/new"
  fi
else
  echo "▶ schema.sql 자동 적용 건너뜀 (RUN_SQL=0) — SQL Editor에서 실행했는지 확인하세요."
fi

# ── 2) Secrets ─────────────────────────────────────────────────
SECRET_ARGS=()
[[ -n "${TELEGRAM_BOT_TOKEN:-}" ]] && SECRET_ARGS+=("TELEGRAM_BOT_TOKEN=$TELEGRAM_BOT_TOKEN")
[[ -n "${TELEGRAM_CHAT_ID:-}" ]] && SECRET_ARGS+=("TELEGRAM_CHAT_ID=$TELEGRAM_CHAT_ID")
[[ -n "${ALLOWED_ORIGINS:-}" ]] && SECRET_ARGS+=("ALLOWED_ORIGINS=$ALLOWED_ORIGINS")
if [[ ${#SECRET_ARGS[@]} -gt 0 ]]; then
  echo "▶ Secrets 설정: ${SECRET_ARGS[*]%%=*}"
  "$SB" secrets set --remote="$REF" --yes "${SECRET_ARGS[@]}" >/dev/null
  echo "  ✓ Secrets 설정 완료"
else
  echo "▶ Secrets 설정 건너뜀 — TELEGRAM_BOT_TOKEN·TELEGRAM_CHAT_ID 가 없으면 접수는 저장되고 알림만 생략됩니다."
fi
# IP 해시용 salt (없으면 SERVICE_ROLE 키를 salt로 씀 — 고정 salt를 권장)
if [[ -n "${LEAD_IP_SALT:-}" ]]; then
  "$SB" secrets set --remote="$REF" --yes "LEAD_IP_SALT=$LEAD_IP_SALT" >/dev/null
  echo "  ✓ LEAD_IP_SALT 설정 완료"
fi

# ── 3) Edge Function 배포 ───────────────────────────────────────
echo "▶ Edge Function 배포"
"$SB" functions deploy generate-post --remote="$REF" --use-api --yes
"$SB" functions deploy submit-lead --remote="$REF" --use-api --yes --no-verify-jwt
echo "  ✓ 배포 완료"

# ── 4) 스모크 테스트 (데이터를 쓰지 않는 요청만) ─────────────────
echo "▶ 스모크 테스트"
BASE="https://$REF.supabase.co/functions/v1"
CODE_GEN=$(curl -s -o /dev/null -w '%{http_code}' -m 20 -X POST "$BASE/generate-post" -H 'Content-Type: application/json' -d '{}' || true)
CODE_LEAD=$(curl -s -o /dev/null -w '%{http_code}' -m 20 -X POST "$BASE/submit-lead" -H 'Content-Type: application/json' -d '{}' || true)
echo "  generate-post (토큰 없음) → HTTP $CODE_GEN  (기대: 401)"
echo "  submit-lead  (빈 값)     → HTTP $CODE_LEAD  (기대: 400)"
if [[ "$CODE_GEN" == "401" && "$CODE_LEAD" == "400" ]]; then
  echo "  ✓ 두 함수 모두 응답합니다"
else
  echo "  ! 기대와 다른 응답입니다. 위 코드를 확인하세요."
fi

cat <<MSG

다음 단계
  1) 이 브랜치(feat/edge-functions-server-side)를 main에 머지하고 GitHub Pages 배포를 확인하세요.
  2) 라이브에서 로그인 → [후기 만들기]로 실제 원고가 나오는지, 신청서가 접수되는지 확인하세요.
  3) 필요 없어진 GAS 웹앱(현장로그-알림봇)은 배포를 보관처리(archive)해 두세요.
MSG
