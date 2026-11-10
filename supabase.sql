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

-- ===== Сделки между игроками (займы): безопасно выполнять повторно =====
create table if not exists public.deals (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete cascade,
  lender uuid not null references auth.users(id) on delete cascade,
  borrower uuid not null references auth.users(id) on delete cascade,
  lender_name text not null default '',
  borrower_name text not null default '',
  amount numeric not null check (amount > 0),
  monthly numeric not null default 0 check (monthly >= 0),
  terms text not null default '',
  status text not null default 'proposed' check (status in ('proposed','active','rejected','cancelled','repay_proposed','repaid','forgiven')),
  created_by uuid not null default auth.uid() references auth.users(id) on delete cascade,
  repay_amount numeric,
  repay_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (lender <> borrower)
);
create index if not exists deals_game_idx on public.deals(game_id);
alter table public.deals enable row level security;

create or replace function public.is_player_in(gid uuid, uid uuid) returns boolean
  language sql stable security definer set search_path = public as
  $$ select exists (select 1 from public.game_players p where p.game_id = gid and p.user_id = uid) $$;
grant execute on function public.is_player_in(uuid, uuid) to authenticated;

-- Список игроков стола (только имя, которое игрок выбрал для показа) — для участников и организатора
create or replace function public.list_game_players(p_game uuid) returns table (user_id uuid, name text)
  language sql stable security definer set search_path = public as
  $$ select p.user_id, p.name from public.game_players p
     where p.game_id = p_game and (public.is_game_member(p_game) or public.is_game_host(p_game))
     order by p.name $$;
revoke all on function public.list_game_players(uuid) from public, anon;
grant execute on function public.list_game_players(uuid) to authenticated;

drop policy if exists deals_select on public.deals;
drop policy if exists deals_insert on public.deals;
drop policy if exists deals_update on public.deals;
create policy deals_select on public.deals for select to authenticated
  using (lender = auth.uid() or borrower = auth.uid() or public.is_game_host(game_id));
create policy deals_insert on public.deals for insert to authenticated
  with check (created_by = auth.uid() and status = 'proposed' and (lender = auth.uid() or borrower = auth.uid())
              and public.is_player_in(game_id, lender) and public.is_player_in(game_id, borrower) and public.game_is_open(game_id));
create policy deals_update on public.deals for update to authenticated
  using (lender = auth.uid() or borrower = auth.uid()) with check (lender = auth.uid() or borrower = auth.uid());

-- Проверка переходов: подтверждает всегда второй игрок, условия сделки менять нельзя
create or replace function public.deals_guard() returns trigger language plpgsql as $$
begin
  if new.game_id <> old.game_id or new.lender <> old.lender or new.borrower <> old.borrower
     or new.amount <> old.amount or new.monthly <> old.monthly or new.created_by <> old.created_by
     or new.terms <> old.terms then
    raise exception 'Условия сделки менять нельзя';
  end if;
  if new.status = old.status then return new; end if;
  if old.status in ('rejected','cancelled','repaid','forgiven') then raise exception 'Сделка уже закрыта'; end if;
  if old.status = 'proposed' then
    if new.status not in ('active','rejected','cancelled') then raise exception 'Недопустимое действие'; end if;
    if new.status = 'active' and auth.uid() = old.created_by then raise exception 'Сделку подтверждает второй игрок'; end if;
  elsif old.status = 'active' then
    if new.status not in ('repay_proposed','forgiven') then raise exception 'Недопустимое действие'; end if;
    if new.status = 'forgiven' and auth.uid() <> old.lender then raise exception 'Простить долг может только тот, кто дал деньги'; end if;
    if new.status = 'repay_proposed' then new.repay_by := auth.uid(); end if;
  elsif old.status = 'repay_proposed' then
    if new.status not in ('repaid','active') then raise exception 'Недопустимое действие'; end if;
    if new.status = 'repaid' and auth.uid() = old.repay_by then raise exception 'Возврат подтверждает второй игрок'; end if;
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists deals_guard on public.deals;
create trigger deals_guard before update on public.deals for each row execute function public.deals_guard();
