-- Supabase/Postgres schema; migration realitycheck_app_tables is already applied.
create table if not exists public.ideas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 3 and 100),
  description text not null check (char_length(description) between 30 and 2500),
  audience text not null check (char_length(audience) between 3 and 250),
  stage text not null default 'Idea',
  budget text not null default 'Under $1k',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists ideas_user_updated_idx on public.ideas(user_id, updated_at desc);
alter table public.ideas enable row level security;
drop policy if exists "Users manage own ideas" on public.ideas;
create policy "Users manage own ideas" on public.ideas for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  idea_id uuid not null references public.ideas(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null check (status in ('running','complete','failed')),
  score integer check (score is null or score between 0 and 100),
  verdict text,
  data jsonb,
  created_at timestamptz not null default now()
);
create index if not exists reports_user_created_idx on public.reports(user_id, created_at desc);
alter table public.reports enable row level security;
drop policy if exists "Users manage own reports" on public.reports;
create policy "Users manage own reports" on public.reports for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Monthly, server-enforced starter limits (Jaipur/Asia-Kolkata month).
create table if not exists public.monthly_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  period text not null check (period ~ '^\d{4}-\d{2}$'),
  reports_used integer not null default 0 check (reports_used >= 0),
  advisor_used integer not null default 0 check (advisor_used >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, period)
);
alter table public.monthly_usage enable row level security;
drop policy if exists "Users can read their own monthly usage" on public.monthly_usage;
create policy "Users can read their own monthly usage" on public.monthly_usage for select to authenticated using (auth.uid() = user_id);
grant select on public.monthly_usage to authenticated;
create or replace function public.consume_monthly_usage(p_period text, p_kind text)
returns table(allowed boolean, used integer, limit_value integer)
language plpgsql security definer set search_path = public as $$
declare v_user uuid := auth.uid(); v_limit integer; v_used integer;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if p_period !~ '^\d{4}-\d{2}$' then raise exception 'Invalid usage period'; end if;
  if p_kind = 'report' then v_limit := 5; elsif p_kind = 'advisor' then v_limit := 20; else raise exception 'Invalid usage kind'; end if;
  insert into public.monthly_usage(user_id, period) values (v_user, p_period) on conflict (user_id, period) do nothing;
  if p_kind = 'report' then
    update public.monthly_usage set reports_used=reports_used+1, updated_at=now() where user_id=v_user and period=p_period and reports_used<v_limit returning reports_used into v_used;
  else
    update public.monthly_usage set advisor_used=advisor_used+1, updated_at=now() where user_id=v_user and period=p_period and advisor_used<v_limit returning advisor_used into v_used;
  end if;
  if found then return query select true, v_used, v_limit; return; end if;
  if p_kind='report' then select reports_used into v_used from public.monthly_usage where user_id=v_user and period=p_period;
  else select advisor_used into v_used from public.monthly_usage where user_id=v_user and period=p_period; end if;
  return query select false, coalesce(v_used,0), v_limit;
end; $$;
revoke all on function public.consume_monthly_usage(text,text) from public, anon;
grant execute on function public.consume_monthly_usage(text,text) to authenticated;
