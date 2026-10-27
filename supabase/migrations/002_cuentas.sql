-- MusicFees 0.4: cuentas y biblioteca.
-- Ejecuta este archivo una sola vez en Supabase → SQL Editor → New query → Run
-- (después de 001_musicfees.sql). Se puede volver a ejecutar sin perder datos.
--
-- Cuentas propias de MusicFees (usuario + contraseña), no las de Supabase Auth: así el
-- administrador crea cuentas como "USUARIO 1" sin correo. Las contraseñas se guardan con
-- bcrypt (pgcrypto). Todo pasa por funciones; las tablas no se pueden leer directamente.
--
-- Primer uso: la app pide crear la cuenta de administrador mientras no exista ninguna.

create extension if not exists pgcrypto;

create table if not exists public.mf_users (
  id uuid primary key default gen_random_uuid(),
  username text not null,
  pass_hash text not null,
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index if not exists mf_users_username_idx on public.mf_users (lower(username));

create table if not exists public.mf_sessions (
  token uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.mf_users (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '90 days'
);

alter table public.mf_songs add column if not exists owner uuid references public.mf_users (id) on delete set null;
create index if not exists mf_songs_owner_idx on public.mf_songs (owner, updated_at desc);

alter table public.mf_users enable row level security;
alter table public.mf_sessions enable row level security;

-- ---------- sesión ----------
create or replace function public.mf_session_user(p_token uuid)
returns uuid
language sql stable security definer set search_path = public as $$
  select s.user_id from mf_sessions s where s.token = p_token and s.expires_at > now();
$$;

create or replace function public.mf_need_setup()
returns boolean
language sql stable security definer set search_path = public as $$
  select not exists (select 1 from mf_users);
$$;

-- Solo funciona mientras no haya ninguna cuenta: crea el administrador y devuelve su sesión.
create or replace function public.mf_setup_admin(p_user text, p_pass text)
returns table (token uuid, username text, is_admin boolean)
language plpgsql security definer set search_path = public, extensions as $$
declare v_id uuid; v_tok uuid;
begin
  lock table mf_users in exclusive mode;
  if exists (select 1 from mf_users) then raise exception 'Ya existe un administrador'; end if;
  if length(trim(coalesce(p_user, ''))) < 1 or length(coalesce(p_pass, '')) < 4 then
    raise exception 'Escribe un usuario y una contraseña de al menos 4 caracteres';
  end if;
  insert into mf_users (username, pass_hash, is_admin) values (trim(p_user), crypt(p_pass, gen_salt('bf')), true) returning id into v_id;
  insert into mf_sessions (user_id) values (v_id) returning mf_sessions.token into v_tok;
  return query select v_tok, trim(p_user), true;
end $$;

create or replace function public.mf_login(p_user text, p_pass text)
returns table (token uuid, username text, is_admin boolean)
language plpgsql security definer set search_path = public, extensions as $$
declare u mf_users; v_tok uuid;
begin
  select * into u from mf_users where lower(mf_users.username) = lower(trim(p_user));
  if u.id is null or u.pass_hash <> crypt(coalesce(p_pass, ''), u.pass_hash) then
    perform pg_sleep(0.4); -- frena los intentos por fuerza bruta
    raise exception 'Usuario o contraseña incorrectos';
  end if;
  delete from mf_sessions where user_id = u.id and expires_at < now();
  insert into mf_sessions (user_id) values (u.id) returning mf_sessions.token into v_tok;
  return query select v_tok, u.username, u.is_admin;
end $$;

create or replace function public.mf_logout(p_token uuid)
returns void
language sql security definer set search_path = public as $$
  delete from mf_sessions where token = p_token;
$$;

-- ---------- administración (solo cuentas administradoras) ----------
create or replace function public.mf_admin_check(p_token uuid)
returns uuid
language plpgsql stable security definer set search_path = public as $$
declare v uuid;
begin
  select u.id into v from mf_users u join mf_sessions s on s.user_id = u.id
   where s.token = p_token and s.expires_at > now() and u.is_admin;
  if v is null then raise exception 'Solo el administrador puede hacer esto'; end if;
  return v;
end $$;

create or replace function public.mf_admin_users(p_token uuid)
returns table (id uuid, username text, is_admin boolean, created_at timestamptz, songs bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  perform mf_admin_check(p_token);
  return query select u.id, u.username, u.is_admin, u.created_at, (select count(*) from mf_songs s where s.owner = u.id)
    from mf_users u order by u.created_at;
end $$;

create or replace function public.mf_admin_create_user(p_token uuid, p_user text, p_pass text, p_admin boolean default false)
returns uuid
language plpgsql security definer set search_path = public, extensions as $$
declare v uuid;
begin
  perform mf_admin_check(p_token);
  if length(trim(coalesce(p_user, ''))) < 1 or length(coalesce(p_pass, '')) < 4 then
    raise exception 'Escribe un usuario y una contraseña de al menos 4 caracteres';
  end if;
  if exists (select 1 from mf_users where lower(username) = lower(trim(p_user))) then
    raise exception 'Ya existe una cuenta con ese usuario';
  end if;
  insert into mf_users (username, pass_hash, is_admin) values (trim(p_user), crypt(p_pass, gen_salt('bf')), coalesce(p_admin, false)) returning id into v;
  return v;
end $$;

create or replace function public.mf_admin_set_password(p_token uuid, p_id uuid, p_pass text)
returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform mf_admin_check(p_token);
  if length(coalesce(p_pass, '')) < 4 then raise exception 'La contraseña debe tener al menos 4 caracteres'; end if;
  update mf_users set pass_hash = crypt(p_pass, gen_salt('bf')) where id = p_id;
  delete from mf_sessions where user_id = p_id;
end $$;

-- Borra la cuenta; sus canciones quedan sin dueño (siguen abriendo por enlace).
create or replace function public.mf_admin_delete_user(p_token uuid, p_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare me uuid;
begin
  me := mf_admin_check(p_token);
  if me = p_id then raise exception 'No puedes borrar tu propia cuenta'; end if;
  delete from mf_users where id = p_id;
end $$;

-- ---------- biblioteca ----------
create or replace function public.mf_my_songs(p_token uuid)
returns table (id uuid, title text, updated_at timestamptz, size integer)
language plpgsql stable security definer set search_path = public as $$
declare v uuid := mf_session_user(p_token);
begin
  if v is null then raise exception 'Tu sesión terminó. Vuelve a entrar.'; end if;
  return query select s.id, s.title, s.updated_at, length(s.data) from mf_songs s where s.owner = v order by s.updated_at desc;
end $$;

create or replace function public.mf_create_my_song(p_token uuid, p_title text, p_data text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare v uuid := mf_session_user(p_token); v_id uuid;
begin
  if v is null then raise exception 'Tu sesión terminó. Vuelve a entrar.'; end if;
  if p_data is null or length(p_data) > 8000000 then raise exception 'La canción es demasiado grande'; end if;
  insert into mf_songs (title, data, owner) values (left(coalesce(nullif(p_title, ''), 'Sin título'), 120), p_data, v) returning id into v_id;
  return v_id;
end $$;

-- Guarda en tu biblioteca una canción que abriste por enlace (si no tiene dueño).
create or replace function public.mf_claim_song(p_token uuid, p_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare v uuid := mf_session_user(p_token);
begin
  if v is null then raise exception 'Tu sesión terminó. Vuelve a entrar.'; end if;
  update mf_songs set owner = v where id = p_id and owner is null;
end $$;

create or replace function public.mf_delete_my_song(p_token uuid, p_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare v uuid := mf_session_user(p_token);
begin
  if v is null then raise exception 'Tu sesión terminó. Vuelve a entrar.'; end if;
  delete from mf_songs where id = p_id and owner = v;
end $$;

-- ---------- permisos ----------
do $$
declare f text;
begin
  foreach f in array array[
    'mf_session_user(uuid)', 'mf_need_setup()', 'mf_setup_admin(text, text)', 'mf_login(text, text)', 'mf_logout(uuid)',
    'mf_admin_check(uuid)', 'mf_admin_users(uuid)', 'mf_admin_create_user(uuid, text, text, boolean)',
    'mf_admin_set_password(uuid, uuid, text)', 'mf_admin_delete_user(uuid, uuid)',
    'mf_my_songs(uuid)', 'mf_create_my_song(uuid, text, text)', 'mf_claim_song(uuid, uuid)', 'mf_delete_my_song(uuid, uuid)'
  ] loop
    execute format('revoke all on function public.%s from public', f);
    execute format('grant execute on function public.%s to anon, authenticated', f);
  end loop;
end $$;
