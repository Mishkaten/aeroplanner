-- AeroPlanner test workspace. Run once in the Supabase SQL editor (or apply as a migration).
-- One shared workspace row, shared by everyone who can sign in. Last save wins.

create table if not exists public.workspace (
  id         text primary key,
  data       jsonb       not null,
  updated_at timestamptz not null default now(),
  updated_by text
);

-- Automatic backups: about every 10 minutes of editing, the previous version is kept (latest 60).
create table if not exists public.workspace_history (
  id       bigint generated always as identity primary key,
  saved_at timestamptz not null default now(),
  saved_by text,
  data     jsonb       not null
);

create or replace function public.workspace_touch() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  if not exists (select 1 from public.workspace_history where saved_at > now() - interval '10 minutes') then
    insert into public.workspace_history (saved_by, data) values (old.updated_by, old.data);
    delete from public.workspace_history
      where id not in (select id from public.workspace_history order by id desc limit 60);
  end if;
  return new;
end $$;

drop trigger if exists workspace_touch on public.workspace;
create trigger workspace_touch before update on public.workspace
  for each row execute function public.workspace_touch();

-- Only signed-in users can read or write. There is no public access.
alter table public.workspace enable row level security;
alter table public.workspace_history enable row level security;

drop policy if exists "team read" on public.workspace;
drop policy if exists "team insert" on public.workspace;
drop policy if exists "team update" on public.workspace;
create policy "team read"   on public.workspace for select to authenticated using (true);
create policy "team insert" on public.workspace for insert to authenticated with check (true);
create policy "team update" on public.workspace for update to authenticated using (true) with check (true);

drop policy if exists "team read history" on public.workspace_history;
drop policy if exists "team insert history" on public.workspace_history;
create policy "team read history"   on public.workspace_history for select to authenticated using (true);
create policy "team insert history" on public.workspace_history for insert to authenticated with check (true);
