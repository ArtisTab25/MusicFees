-- MusicFees 1.0: carpetas y etiquetas en la biblioteca, y versiones guardadas en la nube.
--
-- · mf_songs.folder / mf_songs.tags: los organiza el dueño (las reglas de 003 ya limitan quién edita).
-- · mf_versions: copias de una canción con fecha y nombre. Solo las ve y borra su dueño.
--   Se guardan las versiones con nombre siempre y, de las automáticas, solo las 20 más recientes.

alter table public.mf_songs add column if not exists folder text;
alter table public.mf_songs add column if not exists tags text[] not null default '{}';
alter table public.mf_songs drop constraint if exists mf_songs_folder_len;
alter table public.mf_songs add constraint mf_songs_folder_len check (folder is null or length(folder) <= 80);

create table if not exists public.mf_versions (
  id uuid primary key default gen_random_uuid(),
  song_id uuid not null references public.mf_songs (id) on delete cascade,
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text not null default '',
  label text not null default '',
  auto boolean not null default false,
  data text not null check (length(data) <= 8000000),
  created_at timestamptz not null default now()
);
create index if not exists mf_versions_song_idx on public.mf_versions (song_id, created_at desc);
create index if not exists mf_versions_owner_idx on public.mf_versions (owner_id);
alter table public.mf_versions enable row level security;

drop policy if exists "mis versiones: ver" on public.mf_versions;
drop policy if exists "mis versiones: crear" on public.mf_versions;
drop policy if exists "mis versiones: borrar" on public.mf_versions;
create policy "mis versiones: ver" on public.mf_versions for select to authenticated using (owner_id = (select auth.uid()));
create policy "mis versiones: crear" on public.mf_versions for insert to authenticated
  with check (owner_id = (select auth.uid()) and exists (select 1 from public.mf_songs s where s.id = song_id and s.owner_id = (select auth.uid())));
create policy "mis versiones: borrar" on public.mf_versions for delete to authenticated using (owner_id = (select auth.uid()));
revoke all on public.mf_versions from anon;
grant select, insert, delete on public.mf_versions to authenticated;

-- Solo las 20 automáticas más recientes de cada canción.
create or replace function public.mf_trim_versions()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.auto then
    delete from mf_versions where id in (
      select id from mf_versions where song_id = new.song_id and auto order by created_at desc offset 20
    );
  end if;
  return null;
end $$;
revoke all on function public.mf_trim_versions() from public, anon, authenticated;
drop trigger if exists mf_versions_trim on public.mf_versions;
create trigger mf_versions_trim after insert on public.mf_versions for each row execute function public.mf_trim_versions();
