-- 현장로그(FieldLog) Supabase 스키마 + 서버 잠금(RLS & RPC)
-- Supabase Dashboard → SQL Editor → New query 에 붙여넣고 Run 하세요.
-- 여러 번 실행해도 안전합니다(create if not exists / create or replace / drop policy).
--
-- 프론트엔드에는 공개용 키(sb_publishable_...)만 들어갑니다.
-- sb_secret_... / service_role 키는 절대 저장소에 넣지 마세요.

create extension if not exists pgcrypto;

-- ── 1. 사용자 프로필 및 요금제/잔여 횟수 테이블 ─────────────────────────
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  plan text not null default 'trial' check (plan in ('trial', 'light', 'pro', 'agency')),
  monthly_limit integer not null default 3,
  used_count integer not null default 0,
  period_start timestamptz not null default date_trunc('month', now()),
  shop_name text default '',
  shop_contact text default '',
  tone text default 'haeyo',
  closing text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ── 2. 생성 이력 로그 테이블 ───────────────────────────────────────────
create table if not exists public.generation_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  industry text not null,
  channel text not null default 'blog',
  region_label text default '',
  created_at timestamptz not null default now()
);

create index if not exists generation_logs_user_idx on public.generation_logs (user_id, created_at desc);

alter table public.profiles enable row level security;
alter table public.generation_logs enable row level security;

-- 기존에 'friendly'로 만들어진 테이블도 있으므로 기본 말투를 맞춰 둔다.
alter table public.profiles alter column tone set default 'haeyo';

-- 본인 프로필 조회만 허용
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
  on public.profiles for select
  to authenticated
  using (auth.uid() = id);

-- 본인 업체 설정 수정만 허용 (요금제/횟수는 아래 트리거로 보호)
-- 행 생성(insert)은 아래 회원가입 트리거나 consume_generation RPC만 합니다.
drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
  on public.profiles for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- 본인 생성 이력 조회만 허용 (직접 insert 금지, RPC로만 기록)
drop policy if exists "logs_select_own" on public.generation_logs;
create policy "logs_select_own"
  on public.generation_logs for select
  to authenticated
  using (auth.uid() = user_id);

-- 클라이언트에서 plan / monthly_limit / used_count / period_start 임의 수정 차단.
-- SECURITY INVOKER(기본값)라서 current_user 가 '요청을 보낸 역할'이 된다.
--   · 브라우저(PostgREST) 직접 update  → current_user = authenticated  → 요금제/횟수 되돌림
--   · consume_generation RPC(SECURITY DEFINER) → current_user = 함수 소유자(postgres) → 통과
create or replace function public.protect_profile_quota()
returns trigger
language plpgsql
security invoker
as $$
begin
  if current_user in ('authenticated', 'anon') then
    new.email := old.email;
    new.plan := old.plan;
    new.monthly_limit := old.monthly_limit;
    new.used_count := old.used_count;
    new.period_start := old.period_start;
  end if;
  new.created_at := old.created_at;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_protect_profile_quota on public.profiles;
create trigger trg_protect_profile_quota
  before update on public.profiles
  for each row execute function public.protect_profile_quota();

-- 회원가입 시 자동으로 무료 체험(3건) 프로필 생성
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, plan, monthly_limit, used_count)
  values (new.id, new.email, 'trial', 3, 0)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── 3. 서버 측 원자적 횟수 차감 및 권한 확인 RPC ───────────────────────
-- 실제 차감 로직은 _consume_quota(사용자 id를 인자로 받는 내부 함수) 하나에만 둡니다.
--   · 브라우저(로그인 사용자)  → consume_generation()            : auth.uid() 사용
--   · Edge Function(서버)      → consume_generation_for_user()    : 검증된 user.id 사용
-- 두 입구가 같은 로직을 쓰므로 요금제 규칙이 갈라지지 않습니다.
-- _consume_quota 와 consume_generation_for_user 는 anon/authenticated 에서 실행 권한을 회수해
-- 브라우저가 남의 user.id 로 횟수를 건드릴 수 없습니다.
create or replace function public._consume_quota(
  p_uid uuid,
  p_industry text,
  p_channel text,
  p_region text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prof public.profiles%rowtype;
  v_month_start timestamptz := date_trunc('month', now());
begin
  if p_uid is null then
    return jsonb_build_object('allowed', false, 'reason', 'not_authenticated');
  end if;

  select * into v_prof from public.profiles where id = p_uid for update;
  if not found then
    insert into public.profiles (id, email, plan, monthly_limit, used_count)
    values (p_uid, null, 'trial', 3, 0)
    on conflict (id) do nothing;
    select * into v_prof from public.profiles where id = p_uid for update;
  end if;

  -- 유료 플랜(light)은 월이 바뀌면 사용량 자동 초기화
  if v_prof.plan <> 'trial' and v_prof.period_start < v_month_start then
    update public.profiles
      set used_count = 0,
          period_start = v_month_start,
          updated_at = now()
      where id = p_uid
      returning * into v_prof;
  end if;

  -- 무료 체험: 총 3건 제한
  if v_prof.plan = 'trial' and v_prof.used_count >= 3 then
    return jsonb_build_object(
      'allowed', false,
      'reason', 'trial_exhausted',
      'plan', v_prof.plan,
      'used', v_prof.used_count,
      'limit', 3
    );
  end if;

  -- 라이트: 월 15건 제한
  if v_prof.plan = 'light' and v_prof.used_count >= v_prof.monthly_limit then
    return jsonb_build_object(
      'allowed', false,
      'reason', 'monthly_limit',
      'plan', v_prof.plan,
      'used', v_prof.used_count,
      'limit', v_prof.monthly_limit
    );
  end if;

  -- 통과 시 1건 차감 및 이력 기록 (pro/agency는 무제한, 기록만)
  update public.profiles
    set used_count = used_count + 1,
        updated_at = now()
    where id = p_uid
    returning * into v_prof;

  insert into public.generation_logs (user_id, industry, channel, region_label)
  values (
    p_uid,
    left(coalesce(p_industry, ''), 80),
    left(coalesce(p_channel, 'blog'), 24),
    left(coalesce(p_region, ''), 120)
  );

  return jsonb_build_object(
    'allowed', true,
    'plan', v_prof.plan,
    'used', v_prof.used_count,
    'limit', case when v_prof.plan in ('pro', 'agency') then -1 else v_prof.monthly_limit end
  );
end;
$$;

-- 브라우저(로그인 사용자)가 부르는 입구. 본인 확인은 auth.uid() 로만 한다.
create or replace function public.consume_generation(
  p_industry text,
  p_channel text default 'blog',
  p_region text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  return public._consume_quota(auth.uid(), p_industry, p_channel, p_region);
end;
$$;

-- 서버(Edge Function)가 부르는 입구. user.id 는 auth.getUser()로 검증한 값만 넘어온다.
create or replace function public.consume_generation_for_user(
  p_user_id uuid,
  p_industry text,
  p_channel text default 'blog',
  p_region text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  return public._consume_quota(p_user_id, p_industry, p_channel, p_region);
end;
$$;

-- 익명 호출은 'not_authenticated'만 돌려주므로 프론트가 스키마 설치 여부를 확인하는 데 쓸 수 있다.
revoke all on function public._consume_quota(uuid, text, text, text) from public;
revoke all on function public._consume_quota(uuid, text, text, text) from anon;
revoke all on function public._consume_quota(uuid, text, text, text) from authenticated;
grant execute on function public._consume_quota(uuid, text, text, text) to service_role;

revoke all on function public.consume_generation(text, text, text) from public;
grant execute on function public.consume_generation(text, text, text) to anon, authenticated;

revoke all on function public.consume_generation_for_user(uuid, text, text, text) from public;
revoke all on function public.consume_generation_for_user(uuid, text, text, text) from anon;
revoke all on function public.consume_generation_for_user(uuid, text, text, text) from authenticated;
grant execute on function public.consume_generation_for_user(uuid, text, text, text) to service_role;

-- 브라우저는 '업체 정보 4개 컬럼'만 수정할 수 있다. 요금제·횟수·이메일은 컬럼 권한 자체를 주지 않는다.
revoke update on public.profiles from authenticated;
revoke update on public.profiles from anon;
grant update (shop_name, shop_contact, tone, closing) on public.profiles to authenticated;
grant select on public.profiles to authenticated;
grant select on public.generation_logs to authenticated;

-- ── 4. 요금제 수동 변경(관리자용, SQL Editor에서 실행) ─────────────────
-- update public.profiles set plan = 'light', monthly_limit = 15, used_count = 0,
--   period_start = date_trunc('month', now()) where email = '사장님@이메일';

-- ── 5. 신청서(leads) 테이블 — Edge Function(submit-lead)만 저장합니다 ─────
-- 공개 번들에 있던 GAS 웹훅 URL을 없애고, 신청은 이 테이블에만 쌓습니다.
-- RLS를 켜고 정책을 하나도 만들지 않습니다 → anon/authenticated 는 select/insert/update/delete 모두 불가.
-- 저장은 service_role(submit-lead Edge Function)만 하고, 조회·연락은 관리자(SQL Editor/대시보드)에서 합니다.
create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  industry text not null,
  region text not null default '',
  contact text not null,
  plan text not null default '미정',
  page text not null default '',
  source text not null default 'web',
  status text not null default 'new',
  ip_hash text not null default '',
  user_agent text not null default '',
  created_at timestamptz not null default now()
);

alter table public.leads enable row level security;

revoke all on public.leads from anon;
revoke all on public.leads from authenticated;
grant all on public.leads to service_role;

-- 길이·형식은 DB에서도 한 번 더 막는다. (Edge Function 검증을 우회한 직접 insert 대비)
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'leads_name_len') then
    alter table public.leads
      add constraint leads_name_len check (char_length(name) between 2 and 60),
      add constraint leads_industry_len check (char_length(industry) between 1 and 40),
      add constraint leads_region_len check (char_length(region) <= 60),
      add constraint leads_contact_len check (char_length(contact) between 8 and 20),
      add constraint leads_plan_len check (char_length(plan) <= 20),
      add constraint leads_page_len check (char_length(page) <= 300),
      add constraint leads_status_chk check (status in ('new', 'contacted', 'converted', 'spam'));
  end if;
end $$;

create index if not exists leads_created_idx on public.leads (created_at desc);
create index if not exists leads_contact_idx on public.leads (contact, created_at desc);
create index if not exists leads_ip_idx on public.leads (ip_hash, created_at desc);

-- 최근 신청 확인(관리자):
-- select created_at, name, industry, region, contact, plan, status
--   from public.leads order by created_at desc limit 20;
