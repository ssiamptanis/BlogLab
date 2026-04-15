-- ABX PDF Builder — Supabase Schema
-- Run this in your Supabase SQL editor at supabase.com
-- Safe to re-run: uses IF NOT EXISTS / OR REPLACE / ON CONFLICT throughout

-- ── Folders ───────────────────────────────────────────────────────────────────

create table if not exists public.folders (
  id         uuid        primary key default gen_random_uuid(),
  user_id    uuid        not null references auth.users(id) on delete cascade,
  name       text        not null,
  created_at timestamptz not null default now()
);

alter table public.folders enable row level security;

do $$ begin
  if not exists (
    select 1 from pg_policies where tablename = 'folders' and policyname = 'Users manage own folders'
  ) then
    create policy "Users manage own folders"
      on public.folders for all
      using     (auth.uid() = user_id)
      with check (auth.uid() = user_id);
  end if;
end $$;

-- ── Templates ─────────────────────────────────────────────────────────────────

create table if not exists public.templates (
  id            uuid        primary key default gen_random_uuid(),
  user_id       uuid        not null references auth.users(id) on delete cascade,
  folder_id     uuid        references public.folders(id) on delete set null,
  name          text        not null default 'Untitled',
  status        text        not null default 'draft' check (status in ('draft', 'saved')),
  template_type text        check (template_type in ('insight-report', 'infographic')),
  doc           jsonb       not null default '{"filename":"untitled.pdf","docTitle":"","docAuthor":"","blocks":[]}',
  thumb         text,
  block_count   int         not null default 0,
  block_types   text[]      not null default '{}',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

alter table public.templates enable row level security;

do $$ begin
  if not exists (
    select 1 from pg_policies where tablename = 'templates' and policyname = 'Users manage own templates'
  ) then
    create policy "Users manage own templates"
      on public.templates for all
      using     (auth.uid() = user_id)
      with check (auth.uid() = user_id);
  end if;
end $$;

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists templates_updated_at on public.templates;
create trigger templates_updated_at
  before update on public.templates
  for each row execute procedure public.set_updated_at();

-- ── Feedback (shared — all authenticated users see all entries) ───────────────

create table if not exists public.feedback (
  id            uuid        primary key default gen_random_uuid(),
  user_id       text        not null,
  user_name     text,
  user_email    text,
  rating        integer     check (rating >= 1 and rating <= 5),
  feedback_text text,
  created_at    timestamptz not null default now()
);

-- RLS disabled: every logged-in user can read and write all feedback
alter table public.feedback disable row level security;

-- ── Storage bucket for uploaded images ────────────────────────────────────────

insert into storage.buckets (id, name, public)
values ('abx-images', 'abx-images', false)
on conflict do nothing;

do $$ begin
  if not exists (
    select 1 from pg_policies where tablename = 'objects' and policyname = 'Users upload own images'
  ) then
    create policy "Users upload own images"
      on storage.objects for insert
      with check (bucket_id = 'abx-images' and auth.uid()::text = (storage.foldername(name))[1]);
  end if;
end $$;

do $$ begin
  if not exists (
    select 1 from pg_policies where tablename = 'objects' and policyname = 'Users read own images'
  ) then
    create policy "Users read own images"
      on storage.objects for select
      using (bucket_id = 'abx-images' and auth.uid()::text = (storage.foldername(name))[1]);
  end if;
end $$;

do $$ begin
  if not exists (
    select 1 from pg_policies where tablename = 'objects' and policyname = 'Users delete own images'
  ) then
    create policy "Users delete own images"
      on storage.objects for delete
      using (bucket_id = 'abx-images' and auth.uid()::text = (storage.foldername(name))[1]);
  end if;
end $$;
