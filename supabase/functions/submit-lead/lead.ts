// 현장로그 신청서 검증 · 스팸 판정 · 텔레그램 문구 (순수 함수만 모아 테스트 가능하게 분리)

export interface LeadInput {
  name: string;
  industry: string;
  region: string;
  contact: string;
  plan: string;
  page: string;
  agree: true;
}

export type LeadParseResult =
  | { ok: true; value: LeadInput }
  | { ok: false; field: string }
  | { ok: false; honeypot: true };

const PLAN_LABELS = ['라이트', '프로', '카톡 1:1 대행형', '초기 1:1 세팅', '미정'];

export function cleanText(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  const noCtrl = value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ');
  return noCtrl.replace(/\s+/g, ' ').trim().slice(0, max);
}

/** 휴대폰·유선 번호 형태만 받는다. (예: 010-1234-5678, 01012345678, 02-123-4567) */
export function isPhoneLike(value: string): boolean {
  return /^[0-9+\-\s().]{8,20}$/.test(value) && (value.match(/\d/g) || []).length >= 7;
}

export function parseLead(body: Record<string, unknown> | null): LeadParseResult {
  if (!body) return { ok: false, field: 'body' };

  // 허니팟: 사람에게는 보이지 않는 입력칸. 값이 차 있으면 봇으로 보고 조용히 성공 응답한다.
  if (cleanText(body.website, 40)) return { ok: false, honeypot: true };

  const name = cleanText(body.name, 60);
  if (name.length < 2) return { ok: false, field: 'name' };

  const industry = cleanText(body.industry, 40);
  if (!industry) return { ok: false, field: 'industry' };

  const contact = cleanText(body.contact, 20);
  if (!isPhoneLike(contact)) return { ok: false, field: 'contact' };

  const rawPlan = cleanText(body.plan, 20);
  const plan = PLAN_LABELS.includes(rawPlan) ? rawPlan : (rawPlan ? '미정' : '미정');

  if (body.agree !== true) return { ok: false, field: 'agree' };

  let page = cleanText(body.page, 200);
  if (page && !/^https?:\/\//i.test(page)) page = '';

  return {
    ok: true,
    value: {
      name,
      industry,
      region: cleanText(body.region, 60),
      contact,
      plan,
      page,
      agree: true,
    },
  };
}

export function escapeHtml(value: string): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function nowKst(): string {
  const parts = new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}`;
}

/** 텔레그램(HTML parse_mode) 알림 문구. 모든 값은 이스케이프한다. */
export function telegramText(lead: LeadInput, at: string): string {
  const lines = [
    '🛠 <b>현장로그 무료 체험 신청</b>',
    '',
    '상호명 : <b>' + escapeHtml(lead.name) + '</b>',
    '업종 : ' + escapeHtml(lead.industry || '-'),
    '활동 지역 : ' + escapeHtml(lead.region || '-'),
    '연락처 : ' + escapeHtml(lead.contact),
    '희망 요금제 : ' + escapeHtml(lead.plan || '미정'),
    '접수 시각 : ' + escapeHtml(at) + ' (KST)',
  ];
  if (lead.page) lines.push('유입 페이지 : ' + escapeHtml(lead.page));
  return lines.join('\n');
}

export interface SpamDecision {
  blocked: boolean;
  reason?: 'rate_limited' | 'hourly_cap';
}

/** 같은 IP의 최근 접수 건수로 스팸을 막는다. (중복 접수는 라우터에서 연락처로 따로 본다)
 *  통신사 NAT로 여러 사람이 같은 IP를 쓰므로 한도를 낮게 잡지 않는다(기본 10분 5건). */
export function decideSpam(recentByIp: number, hourlyTotal: number, opts?: { perIpLimit?: number; hourlyCap?: number }): SpamDecision {
  const perIpLimit = opts?.perIpLimit ?? 5;
  const hourlyCap = opts?.hourlyCap ?? 30;
  if (hourlyTotal >= hourlyCap) return { blocked: true, reason: 'hourly_cap' };
  if (recentByIp >= perIpLimit) return { blocked: true, reason: 'rate_limited' };
  return { blocked: false };
}
