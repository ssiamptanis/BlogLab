-- GWI BlogLab — Supabase Schema
-- Run this in your Supabase SQL editor at supabase.com
-- Safe to re-run: uses IF NOT EXISTS / OR REPLACE / ON CONFLICT throughout

-- ── Folders ───────────────────────────────────────────────────────────────────
-- Private to each user. No one else can see or touch your folders.

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
-- Owners have full control over their own templates.
-- Any authenticated GWI user can READ saved (published) templates from others
-- — this powers the "Files across GWI" dashboard view.
-- Drafts are always private to their owner.

create table if not exists public.templates (
  id            uuid        primary key default gen_random_uuid(),
  user_id       uuid        not null references auth.users(id) on delete cascade,
  folder_id     uuid        references public.folders(id) on delete set null,
  name          text        not null default 'Untitled',
  status        text        not null default 'draft' check (status in ('draft', 'saved')),
  template_type text        check (template_type in ('blog-thumbnail', 'graph', 'insight-report', 'infographic')),
  doc           jsonb       not null default '{}',
  thumb         text,
  block_count   int         not null default 0,
  block_types   text[]      not null default '{}',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

alter table public.templates enable row level security;

-- Full access to own templates (read drafts + saved, write/delete)
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

-- Authenticated users can read other people's SAVED templates (Files across GWI)
-- Drafts from other users are never visible.
do $$ begin
  if not exists (
    select 1 from pg_policies where tablename = 'templates' and policyname = 'Authenticated users read saved templates'
  ) then
    create policy "Authenticated users read saved templates"
      on public.templates for select
      using (auth.uid() is not null and status = 'saved');
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

-- ── Feedback ──────────────────────────────────────────────────────────────────
-- All authenticated users can read all feedback (shared across GWI).
-- Users can only insert and delete their own entries.
-- Unauthenticated (anonymous) users have no access at all.

create table if not exists public.feedback (
  id            uuid        primary key default gen_random_uuid(),
  user_id       text        not null,
  user_name     text,
  user_email    text,
  rating        integer     check (rating >= 1 and rating <= 5),
  feedback_text text,
  created_at    timestamptz not null default now()
);

alter table public.feedback enable row level security;

-- Any authenticated user can read all feedback
do $$ begin
  if not exists (
    select 1 from pg_policies where tablename = 'feedback' and policyname = 'Authenticated users read all feedback'
  ) then
    create policy "Authenticated users read all feedback"
      on public.feedback for select
      using (auth.uid() is not null);
  end if;
end $$;

-- Authenticated users can submit their own feedback
do $$ begin
  if not exists (
    select 1 from pg_policies where tablename = 'feedback' and policyname = 'Authenticated users insert feedback'
  ) then
    create policy "Authenticated users insert feedback"
      on public.feedback for insert
      with check (auth.uid() is not null and user_id = auth.uid()::text);
  end if;
end $$;

-- Users can update their own feedback entries
do $$ begin
  if not exists (
    select 1 from pg_policies where tablename = 'feedback' and policyname = 'Users update own feedback'
  ) then
    create policy "Users update own feedback"
      on public.feedback for update
      using (user_id = auth.uid()::text)
      with check (user_id = auth.uid()::text);
  end if;
end $$;

-- Users can delete their own feedback entries
do $$ begin
  if not exists (
    select 1 from pg_policies where tablename = 'feedback' and policyname = 'Users delete own feedback'
  ) then
    create policy "Users delete own feedback"
      on public.feedback for delete
      using (user_id = auth.uid()::text);
  end if;
end $$;

-- ── Storage bucket for uploaded images ────────────────────────────────────────
-- Private bucket. Path conventions:
--   {user_id}/...           → user-uploaded images (checked by [1] = auth.uid())
--   thumbnails/{user_id}/…  → generated PNG thumbnails (checked by [2] = auth.uid())
--   shared/…                → cached Figma SVGs, readable by all authenticated users

insert into storage.buckets (id, name, public)
values ('abx-images', 'abx-images', false)
on conflict do nothing;

-- Users can upload to their own folder
do $$ begin
  if not exists (
    select 1 from pg_policies where tablename = 'objects' and policyname = 'Users upload own images'
  ) then
    create policy "Users upload own images"
      on storage.objects for insert
      with check (bucket_id = 'abx-images' and auth.uid()::text = (storage.foldername(name))[1]);
  end if;
end $$;

-- Users can read their own files
do $$ begin
  if not exists (
    select 1 from pg_policies where tablename = 'objects' and policyname = 'Users read own images'
  ) then
    create policy "Users read own images"
      on storage.objects for select
      using (bucket_id = 'abx-images' and auth.uid()::text = (storage.foldername(name))[1]);
  end if;
end $$;

-- All authenticated users can read shared assets (e.g. cached Figma SVGs)
do $$ begin
  if not exists (
    select 1 from pg_policies where tablename = 'objects' and policyname = 'Authenticated users read shared assets'
  ) then
    create policy "Authenticated users read shared assets"
      on storage.objects for select
      using (bucket_id = 'abx-images' and auth.uid() is not null and (storage.foldername(name))[1] = 'shared');
  end if;
end $$;

-- Users can delete their own files
do $$ begin
  if not exists (
    select 1 from pg_policies where tablename = 'objects' and policyname = 'Users delete own images'
  ) then
    create policy "Users delete own images"
      on storage.objects for delete
      using (bucket_id = 'abx-images' and auth.uid()::text = (storage.foldername(name))[1]);
  end if;
end $$;

-- ── Thumbnail storage (thumbnails/{user_id}/{uuid}.png) ───────────────────────
-- Upload: authenticated user can only write to their own thumbnails subfolder
do $$ begin
  if not exists (
    select 1 from pg_policies where tablename = 'objects' and policyname = 'Users upload own thumbnails'
  ) then
    create policy "Users upload own thumbnails"
      on storage.objects for insert
      with check (
        bucket_id = 'abx-images'
        and auth.uid() is not null
        and (storage.foldername(name))[1] = 'thumbnails'
        and (storage.foldername(name))[2] = auth.uid()::text
      );
  end if;
end $$;

-- Read: any authenticated user can read thumbnails (needed for Files across GWI)
do $$ begin
  if not exists (
    select 1 from pg_policies where tablename = 'objects' and policyname = 'Authenticated users read thumbnails'
  ) then
    create policy "Authenticated users read thumbnails"
      on storage.objects for select
      using (
        bucket_id = 'abx-images'
        and auth.uid() is not null
        and (storage.foldername(name))[1] = 'thumbnails'
      );
  end if;
end $$;

-- Delete: users can only delete their own thumbnails
do $$ begin
  if not exists (
    select 1 from pg_policies where tablename = 'objects' and policyname = 'Users delete own thumbnails'
  ) then
    create policy "Users delete own thumbnails"
      on storage.objects for delete
      using (
        bucket_id = 'abx-images'
        and auth.uid() is not null
        and (storage.foldername(name))[1] = 'thumbnails'
        and (storage.foldername(name))[2] = auth.uid()::text
      );
  end if;
end $$;
