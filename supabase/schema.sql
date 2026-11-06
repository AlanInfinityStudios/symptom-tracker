-- Symptom Tracker database.
-- Paste this whole file into Supabase: SQL Editor, New query, Run. It is safe to run again.
--
-- Privacy: nothing here identifies the child. A diary is just a random id. The child's name
-- and date of birth are kept on each phone and only added to the PDF when it is made.
-- Each carer only has a short label (for example "Dad"), plus the email they sign in with.

create extension if not exists pgcrypto;

-- A diary is one person being tracked.
create table if not exists public.diaries (
  id uuid primary key default gen_random_uuid(),
  template text not null default 'events-v1',
  created_by uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- Who can read and write a diary.
create table if not exists public.diary_members (
  diary_id uuid not null references public.diaries(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  label text not null check (char_length(label) between 1 and 40),
  role text not null default 'carer' check (role in ('owner','carer')),
  joined_at timestamptz not null default now(),
  primary key (diary_id, user_id)
);

-- One-use invite codes for adding a partner or grandparent.
create table if not exists public.diary_invites (
  code text primary key,
  diary_id uuid not null references public.diaries(id) on delete cascade,
  created_by uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days',
  used_by uuid references auth.users(id) on delete set null,
  used_at timestamptz
);

-- Every diary entry. The id is made on the phone so an entry saved offline is never duplicated.
create table if not exists public.entries (
  id uuid primary key,
  diary_id uuid not null references public.diaries(id) on delete cascade,
  kind text not null check (kind in ('event','bedwetting','daynote')),
  occurred_at timestamptz not null,
  data jsonb not null default '{}'::jsonb,
  deleted boolean not null default false,
  created_by uuid not null default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_by uuid default auth.uid() references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);
create index if not exists entries_diary_time on public.entries (diary_id, occurred_at);
create index if not exists entries_diary_updated on public.entries (diary_id, updated_at);

-- Helper used by the access rules.
create or replace function public.is_member(d uuid) returns boolean
language sql stable security definer set search_path = public, extensions as $$
  select exists (select 1 from public.diary_members m where m.diary_id = d and m.user_id = auth.uid());
$$;

alter table public.diaries enable row level security;
alter table public.diary_members enable row level security;
alter table public.diary_invites enable row level security;
alter table public.entries enable row level security;

drop policy if exists "members read diaries" on public.diaries;
create policy "members read diaries" on public.diaries for select to authenticated using (public.is_member(id));

drop policy if exists "members read members" on public.diary_members;
create policy "members read members" on public.diary_members for select to authenticated using (public.is_member(diary_id));
drop policy if exists "change own label" on public.diary_members;
create policy "change own label" on public.diary_members for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "members read invites" on public.diary_invites;
create policy "members read invites" on public.diary_invites for select to authenticated using (public.is_member(diary_id));

drop policy if exists "members read entries" on public.entries;
create policy "members read entries" on public.entries for select to authenticated using (public.is_member(diary_id));
drop policy if exists "members add entries" on public.entries;
create policy "members add entries" on public.entries for insert to authenticated
  with check (public.is_member(diary_id) and created_by = auth.uid());
drop policy if exists "members edit entries" on public.entries;
create policy "members edit entries" on public.entries for update to authenticated
  using (public.is_member(diary_id)) with check (public.is_member(diary_id));
-- No delete policy: deleting marks an entry as deleted so the other phone hears about it.

-- Keep the "last changed" fields honest.
create or replace function public.entries_touch() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  if tg_op = 'UPDATE' then
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    new.diary_id := old.diary_id;
  end if;
  return new;
end $$;
drop trigger if exists entries_touch on public.entries;
create trigger entries_touch before insert or update on public.entries
  for each row execute function public.entries_touch();

-- Start a new diary and become its owner.
create or replace function public.create_diary(my_label text) returns uuid
language plpgsql security definer set search_path = public, extensions as $$
declare d uuid;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  insert into diaries (created_by) values (auth.uid()) returning id into d;
  insert into diary_members (diary_id, user_id, label, role) values (d, auth.uid(), coalesce(nullif(trim(my_label),''),'Carer'), 'owner');
  return d;
end $$;

-- Make an invite code for a diary you belong to.
create or replace function public.create_invite(d uuid) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare c text;
begin
  if not is_member(d) then raise exception 'Not a member of this diary'; end if;
  c := upper(substr(translate(encode(gen_random_bytes(12), 'base64'), '+/=0O1Il', ''), 1, 8));
  insert into diary_invites (code, diary_id) values (c, d);
  return c;
end $$;

-- Join a diary with an invite code.
create or replace function public.join_diary(invite_code text, my_label text) returns uuid
language plpgsql security definer set search_path = public, extensions as $$
declare inv diary_invites;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  select * into inv from diary_invites where code = upper(trim(invite_code)) for update;
  if inv.code is null then raise exception 'That invite code was not found'; end if;
  if inv.used_at is not null and inv.used_by <> auth.uid() then raise exception 'That invite code has already been used'; end if;
  if inv.expires_at < now() then raise exception 'That invite code has expired'; end if;
  insert into diary_members (diary_id, user_id, label) values (inv.diary_id, auth.uid(), coalesce(nullif(trim(my_label),''),'Carer'))
    on conflict (diary_id, user_id) do update set label = excluded.label;
  update diary_invites set used_by = auth.uid(), used_at = now() where code = inv.code;
  return inv.diary_id;
end $$;

-- Leave a diary (the owner deletes it instead).
create or replace function public.delete_diary(d uuid) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  if not exists (select 1 from diary_members where diary_id = d and user_id = auth.uid() and role = 'owner') then
    raise exception 'Only the person who set up the diary can delete it';
  end if;
  delete from diaries where id = d;
end $$;

revoke all on function public.create_diary(text) from public, anon;
revoke all on function public.create_invite(uuid) from public, anon;
revoke all on function public.join_diary(text, text) from public, anon;
revoke all on function public.delete_diary(uuid) from public, anon;
grant execute on function public.create_diary(text) to authenticated;
grant execute on function public.create_invite(uuid) to authenticated;
grant execute on function public.join_diary(text, text) to authenticated;
grant execute on function public.delete_diary(uuid) to authenticated;

-- Live updates between phones.
do $$ begin
  alter publication supabase_realtime add table public.entries;
exception when duplicate_object then null; end $$;
