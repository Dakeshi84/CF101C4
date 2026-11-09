-- Бланк игрока «Денежный поток» — схема Supabase
-- Выполните целиком в Supabase: SQL Editor -> New query -> Run

create table if not exists public.games (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  title text not null default '',
  host uuid not null default auth.uid() references auth.users(id) on delete cascade,
  status text not null default 'open' check (status in ('open','finished')),
  created_at timestamptz not null default now()
);

create table if not exists public.game_players (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null default '',
  sheet jsonb not null default '{}'::jsonb,
  summary jsonb not null default '{}'::jsonb,
  finished boolean not null default false,
  updated_at timestamptz not null default now(),
  unique (game_id, user_id)
);

create index if not exists game_players_user_idx on public.game_players(user_id);
create index if not exists games_host_idx on public.games(host);

alter table public.games enable row level security;
alter table public.game_players enable row level security;

-- Вспомогательные функции (security definer — чтобы политики не зацикливались друг на друге)
create or replace function public.is_game_host(gid uuid) returns boolean
  language sql stable security definer set search_path = public as
  $$ select exists (select 1 from public.games g where g.id = gid and g.host = auth.uid()) $$;
create or replace function public.is_game_member(gid uuid) returns boolean
  language sql stable security definer set search_path = public as
  $$ select exists (select 1 from public.game_players p where p.game_id = gid and p.user_id = auth.uid()) $$;
create or replace function public.game_is_open(gid uuid) returns boolean
  language sql stable security definer set search_path = public as
  $$ select exists (select 1 from public.games g where g.id = gid and g.status = 'open') $$;
-- Поиск открытой игры по коду (список игр наружу не отдаётся)
create or replace function public.find_game(p_code text) returns table (id uuid, title text, code text, status text)
  language sql stable security definer set search_path = public as
  $$ select g.id, g.title, g.code, g.status from public.games g where g.code = upper(p_code) and g.status = 'open' $$;
revoke all on function public.find_game(text) from public, anon;
grant execute on function public.find_game(text) to authenticated;
grant execute on function public.is_game_host(uuid), public.is_game_member(uuid), public.game_is_open(uuid) to authenticated;

-- Игры: видит организатор и участники; найти чужую игру можно только по коду (find_game)
drop policy if exists games_select on public.games;
drop policy if exists games_insert on public.games;
drop policy if exists games_update on public.games;
drop policy if exists games_delete on public.games;
create policy games_select on public.games for select to authenticated using (host = auth.uid() or public.is_game_member(id));
create policy games_insert on public.games for insert to authenticated with check (host = auth.uid());
create policy games_update on public.games for update to authenticated using (host = auth.uid()) with check (host = auth.uid());
create policy games_delete on public.games for delete to authenticated using (host = auth.uid());

-- Бланки: игрок видит и меняет только свой; организатор видит все бланки своей игры; войти можно только в открытую игру
drop policy if exists gp_select on public.game_players;
drop policy if exists gp_insert on public.game_players;
drop policy if exists gp_update on public.game_players;
drop policy if exists gp_delete on public.game_players;
create policy gp_select on public.game_players for select to authenticated
  using (user_id = auth.uid() or public.is_game_host(game_id));
create policy gp_insert on public.game_players for insert to authenticated
  with check (user_id = auth.uid() and (public.is_game_host(game_id) or public.game_is_open(game_id)));
create policy gp_update on public.game_players for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy gp_delete on public.game_players for delete to authenticated
  using (user_id = auth.uid() or public.is_game_host(game_id));

-- ===== Обновление: профили, список профессий, имена в играх =====
-- (безопасно выполнять повторно)

alter table public.game_players add column if not exists full_name text not null default '';
alter table public.game_players add column if not exists nick text not null default '';

-- Профиль игрока: имя, никнейм, как показывать, WhatsApp, согласие на новости C4%
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  nick text not null default '',
  display text not null default 'name' check (display in ('name','nick')),
  phone text not null default '',
  news boolean not null default false,
  news_at timestamptz,
  pd_consent_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.profiles add column if not exists pd_consent_at timestamptz;
alter table public.profiles enable row level security;
drop policy if exists profiles_select on public.profiles;
drop policy if exists profiles_insert on public.profiles;
drop policy if exists profiles_update on public.profiles;
create policy profiles_select on public.profiles for select to authenticated using (id = auth.uid());
create policy profiles_insert on public.profiles for insert to authenticated with check (id = auth.uid());
create policy profiles_update on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
-- Рассылка: Table Editor -> profiles, фильтр news = true (вы видите все строки как владелец проекта)

-- Общий список профессий (наполняется автоматически, когда игроки заполняют карточки)
create table if not exists public.professions (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  data jsonb not null,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create unique index if not exists professions_title_uq on public.professions (lower(title));
alter table public.professions enable row level security;
drop policy if exists prof_select on public.professions;
drop policy if exists prof_insert on public.professions;
drop policy if exists prof_update on public.professions;
drop policy if exists prof_delete on public.professions;
create policy prof_select on public.professions for select to authenticated using (true);
create policy prof_insert on public.professions for insert to authenticated with check (created_by = auth.uid());
create policy prof_update on public.professions for update to authenticated using (created_by = auth.uid()) with check (created_by = auth.uid());
create policy prof_delete on public.professions for delete to authenticated using (created_by = auth.uid());
