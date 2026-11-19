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
  const seedRaw = Number(body.seed);
  const seed = Number.isFinite(seedRaw) && seedRaw >= 0
    ? Math.floor(seedRaw) % 4294967296
    : (Date.now() >>> 0);

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
        before: asBool(photosIn.before),
        during: asBool(photosIn.during),
        after: asBool(photosIn.after),
      },
    },
  };
}
