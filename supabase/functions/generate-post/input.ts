// 현장로그 원고 생성 입력 검증 — 브라우저가 보낸 값은 전부 신뢰하지 않는다.
// 값 길이를 잘라 저장·생성에 쓰고, 업종/채널/말투는 화이트리스트만 통과시킨다.

import { CHANNELS, INDUSTRIES, STYLE_LABEL } from './engine.ts';

export interface GenerateInput {
  industryId: string;
  channel: string;
  place: string;
  detail: string;
  extra: string;
  price: string;
  pricePrivate: boolean;
  seed: number;
  business: { name: string; contact: string; style: string; closing: string };
  photos: { before: boolean; during: boolean; after: boolean };
  /** 사진 원본(긴 변 1024px JPEG base64). 다듬기용으로 서버에서만 Gemini로 넘긴다. */
  images: { before: string; during: string; after: string };
}

export type ParseResult =
  | { ok: true; value: GenerateInput }
  | { ok: false; field: string };

const INDUSTRY_IDS = INDUSTRIES.map((i) => i.id);
const CHANNEL_IDS = CHANNELS.map((c) => c.id);
const STYLE_IDS = Object.keys(STYLE_LABEL);

/** 제어문자 제거 + 공백 정리 + 길이 제한. HTML은 프론트에서 이스케이프해 그리므로 여기서는 글자만 다룬다. */
export function cleanText(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  const noCtrl = value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ');
  return noCtrl.replace(/\s+/g, ' ').trim().slice(0, max);
}

function asBool(value: unknown): boolean {
  return value === true || value === 'true' || value === 1;
}

function asObject(value: unknown): Record<string, unknown> {
  return (value && typeof value === 'object' && !Array.isArray(value)) ? value as Record<string, unknown> : {};
}

/** 사진 한 장 최대 크기(base64 글자). 긴 변 1024px JPEG는 보통 20만 자 안쪽이다. */
const IMAGE_MAX_CHARS = 800000;
const IMAGE_TOTAL_CHARS = 2000000;

/** data URL이면 prefix를 떼고, base64 글자만 남긴다. 규칙에 안 맞으면 빈 문자열(사진 없음). */
export function cleanImage(value: unknown, max = IMAGE_MAX_CHARS): string {
  if (typeof value !== 'string') return '';
  let raw = value.trim();
  const comma = raw.indexOf(',');
  if (/^data:image\/[a-z]+;base64,/i.test(raw) && comma > 0) raw = raw.slice(comma + 1);
  if (!raw || raw.length > max) return '';
  return /^[A-Za-z0-9+/=\r\n]+$/.test(raw) ? raw.replace(/[\r\n]/g, '') : '';
}

export function parseGenerateInput(body: Record<string, unknown> | null): ParseResult {
  if (!body) return { ok: false, field: 'body' };

  const industryId = cleanText(body.industryId, 24);
  if (!INDUSTRY_IDS.includes(industryId)) return { ok: false, field: 'industryId' };

  const channel = cleanText(body.channel, 16) || 'blog';
  if (!CHANNEL_IDS.includes(channel)) return { ok: false, field: 'channel' };

  const place = cleanText(body.place, 60);
  if (!place) return { ok: false, field: 'place' };

  const biz = asObject(body.business);
  const style = cleanText(biz.style, 12) || 'haeyo';
  if (!STYLE_IDS.includes(style)) return { ok: false, field: 'business.style' };

  const photosIn = asObject(body.photos);
  const imagesIn = asObject(body.images);
  const seedRaw = Number(body.seed);
  const seed = Number.isFinite(seedRaw) && seedRaw >= 0
    ? Math.floor(seedRaw) % 4294967296
    : (Date.now() >>> 0);

  // 사진은 앞에서부터 채우다가 전체 한도를 넘으면 뒤쪽을 버린다(요청 크기 폭주 방지).
  const images = { before: '', during: '', after: '' };
  let total = 0;
  for (const slot of ['before', 'during', 'after'] as const) {
    const img = cleanImage(imagesIn[slot]);
    if (!img) continue;
    const room = IMAGE_TOTAL_CHARS - total;
    if (room <= 1000) break;
    images[slot] = img.length > room ? '' : img;
    total += images[slot].length;
  }

  return {
    ok: true,
    value: {
      industryId,
      channel,
      place,
      detail: cleanText(body.detail, 200),
      extra: cleanText(body.extra, 60),
      price: cleanText(body.price, 40),
      pricePrivate: asBool(body.pricePrivate),
      seed,
      business: {
        name: cleanText(biz.name, 40),
        contact: cleanText(biz.contact, 30),
        style,
        closing: cleanText(biz.closing, 120),
      },
      photos: {
        before: asBool(photosIn.before) || !!images.before,
        during: asBool(photosIn.during) || !!images.during,
        after: asBool(photosIn.after) || !!images.after,
      },
      images,
    },
  };
}
