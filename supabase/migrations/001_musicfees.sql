-- MusicFees: canciones en la nube.
-- Ejecuta este archivo una sola vez en Supabase → SQL Editor → New query → Run.
--
-- Modelo de acceso (versión 0.1, sin cuentas): quien tiene el enlace de una canción la puede
-- abrir y editar. La tabla no se puede leer ni listar directamente; todo pasa por funciones
-- que piden el id exacto (un UUID imposible de adivinar).

create extension if not exists pgcrypto;

create table if not exists public.mf_songs (
  id uuid primary key default gen_random_uuid(),
  title text not null default 'Sin título',
  data text not null,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.mf_songs enable row level security;
-- Sin políticas: el acceso directo a la tabla queda cerrado para anon y authenticated.

create or replace function public.mf_create_song(p_title text, p_data text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if p_data is null or length(p_data) > 8000000 then
    raise exception 'La canción es demasiado grande';
  end if;
  insert into mf_songs (title, data) values (left(coalesce(nullif(p_title, ''), 'Sin título'), 120), p_data)
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.mf_get_song(p_id uuid)
returns table (id uuid, title text, data text, version bigint, updated_at timestamptz)
language sql security definer set search_path = public as $$
  select s.id, s.title, s.data, s.version, s.updated_at from mf_songs s where s.id = p_id;
$$;

create or replace function public.mf_save_song(p_id uuid, p_title text, p_data text)
returns bigint
language plpgsql security definer set search_path = public as $$
declare v bigint;
begin
  if p_data is null or length(p_data) > 8000000 then
    raise exception 'La canción es demasiado grande';
  end if;
  update mf_songs
     set title = left(coalesce(nullif(p_title, ''), title), 120),
         data = p_data,
         version = version + 1,
         updated_at = now()
   where id = p_id
  returning version into v;
  return v;
end $$;

create or replace function public.mf_list_songs(p_ids uuid[])
returns table (id uuid, title text, updated_at timestamptz)
language sql security definer set search_path = public as $$
  select s.id, s.title, s.updated_at from mf_songs s where s.id = any (p_ids) order by s.updated_at desc;
$$;

revoke all on function public.mf_create_song(text, text) from public;
revoke all on function public.mf_get_song(uuid) from public;
revoke all on function public.mf_save_song(uuid, text, text) from public;
revoke all on function public.mf_list_songs(uuid[]) from public;
grant execute on function public.mf_create_song(text, text) to anon, authenticated;
grant execute on function public.mf_get_song(uuid) to anon, authenticated;
grant execute on function public.mf_save_song(uuid, text, text) to anon, authenticated;
grant execute on function public.mf_list_songs(uuid[]) to anon, authenticated;
