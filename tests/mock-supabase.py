"""현장로그 Edge Function 로컬 E2E용 Supabase 모의 서버 (테스트 전용).

실제 Supabase가 없어도 함수의 배선(인증 확인 · RPC · RLS 대신 service_role insert · 응답 코드)을
그대로 확인하기 위한 최소 구현입니다. 운영 코드에는 포함되지 않습니다.

    python3 tests/mock-supabase.py 8099

상태 제어(테스트에서만):
    POST /control/  {"allowed_mode":"trial_exhausted"} / {"fail_rpc":true}
                    {"lead_count":30,"dup":true}
    GET  /control/  → 현재 상태 JSON
"""
import json
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

STATE = {
    "rpc_calls": 0,
    "leads": [],
    "allowed_mode": "allow",   # allow | trial_exhausted | monthly_limit
    "fail_rpc": False,
    "lead_count": 0,           # count 응답 값(스팸 제한 확인용)
    "dup": False,              # 중복 접수 확인용
}


class H(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *a):
        sys.stderr.write("REQ %s %s\n" % (self.command, self.path))
        sys.stderr.flush()

    def _send(self, code, obj, extra=None):
        body = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _body(self):
        n = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(n) if n else b"{}"
        try:
            return json.loads(raw or b"{}")
        except json.JSONDecodeError:
            return {}

    def do_HEAD(self):
        if self.path.startswith("/rest/v1/leads"):
            return self._send(200, [], {"Content-Range": "0-0/%d" % STATE["lead_count"]})
        return self._send(200, {})

    def do_GET(self):
        p = self.path
        if p.startswith("/auth/v1/user"):
            auth = self.headers.get("Authorization", "")
            if "bad" in auth:
                return self._send(401, {"msg": "invalid JWT"})
            return self._send(200, {"id": "11111111-2222-3333-4444-555555555555", "email": "t@example.com"})
        if p.startswith("/rest/v1/leads"):
            rows = [{"id": "lead-dup"}] if STATE["dup"] else []
            return self._send(200, rows, {"Content-Range": "0-0/%d" % STATE["lead_count"]})
        if p.startswith("/control/"):
            return self._send(200, STATE)
        return self._send(404, {"msg": "not found " + p})

    def do_POST(self):
        p = self.path
        body = self._body()
        if p.startswith("/auth/v1/user"):
            return self._send(200, {"id": "11111111-2222-3333-4444-555555555555"})
        if p.startswith("/rest/v1/rpc/consume_generation_for_user"):
            STATE["rpc_calls"] += 1
            if STATE["fail_rpc"]:
                return self._send(404, {"code": "PGRST202", "message": "Could not find the function"})
            if not body.get("p_user_id"):
                return self._send(400, {"message": "bad"})
            mode = STATE["allowed_mode"]
            if mode == "trial_exhausted":
                return self._send(200, {"allowed": False, "reason": "trial_exhausted", "plan": "trial", "used": 3, "limit": 3})
            if mode == "monthly_limit":
                return self._send(200, {"allowed": False, "reason": "monthly_limit", "plan": "light", "used": 15, "limit": 15})
            return self._send(200, {"allowed": True, "plan": "trial", "used": STATE["rpc_calls"], "limit": 3})
        if p.startswith("/rest/v1/leads"):
            STATE["leads"].append(body)
            obj = {"id": "lead-0001"}
            if "pgrst.object" in self.headers.get("Accept", ""):
                return self._send(201, obj)
            return self._send(201, [obj])
        if p.startswith("/control/"):
            STATE.update(body)
            return self._send(200, STATE)
        return self._send(404, {"msg": "not found " + p})


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8099
    ThreadingHTTPServer(("127.0.0.1", port), H).serve_forever()
