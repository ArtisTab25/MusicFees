-- MusicFees: cuentas con Supabase Auth (correo y contraseña, o Google) y biblioteca por usuario.
-- Reemplaza a 002_cuentas.sql, que nunca se aplicó (contraseñas propias en la base).
--
-- · Cada usuario de Supabase Auth tiene un perfil (mf_profiles) que se crea solo al registrarse.
-- · Solo los administradores (is_admin) crean, borran o cambian contraseñas de otras cuentas,
--   a través de la función de servidor mf-admin (usa la llave de servicio, nunca el navegador).
-- · Las canciones con dueño (owner_id) solo las ve y edita su dueño (RLS).
-- · Los enlaces del dúo siguen igual: quien tiene el id exacto la abre con mf_get_song.

create table if not exists public.mf_profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  display_name text,
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.mf_profiles enable row level security;
-- Cada quien ve su propio perfil; nadie puede cambiarse is_admin desde el navegador.
drop policy if exists "perfil propio" on public.mf_profiles;
create policy "perfil propio" on public.mf_profiles for select to authenticated using (id = (select auth.uid()));

create or replace function public.mf_handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into mf_profiles (id, email, display_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end $$;
revoke all on function public.mf_handle_new_user() from public, anon, authenticated;
drop trigger if exists mf_on_auth_user_created on auth.users;
create trigger mf_on_auth_user_created after insert on auth.users for each row execute function public.mf_handle_new_user();

-- Perfiles de las cuentas que ya existían y el primer administrador.
insert into public.mf_profiles (id, email, display_name)
select id, email, split_part(email, '@', 1) from auth.users on conflict (id) do nothing;
update public.mf_profiles set is_admin = true where lower(email) = 'axel@musicfees.app';

-- Canciones con dueño
alter table public.mf_songs add column if not exists owner_id uuid references auth.users (id) on delete set null;
create index if not exists mf_songs_owner_idx on public.mf_songs (owner_id, updated_at desc);

drop policy if exists "mis canciones: ver" on public.mf_songs;
drop policy if exists "mis canciones: crear" on public.mf_songs;
drop policy if exists "mis canciones: editar" on public.mf_songs;
drop policy if exists "mis canciones: borrar" on public.mf_songs;
create policy "mis canciones: ver" on public.mf_songs for select to authenticated using (owner_id = (select auth.uid()));
create policy "mis canciones: crear" on public.mf_songs for insert to authenticated with check (owner_id = (select auth.uid()));
create policy "mis canciones: editar" on public.mf_songs for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy "mis canciones: borrar" on public.mf_songs for delete to authenticated using (owner_id = (select auth.uid()));
revoke all on public.mf_songs from anon;
grant select, insert, update, delete on public.mf_songs to authenticated;

-- Crear por enlace: si quien la crea tiene sesión, la canción queda a su nombre.
create or replace function public.mf_create_song(p_title text, p_data text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if p_data is null or length(p_data) > 8000000 then
    raise exception 'La canción es demasiado grande';
  end if;
  insert into mf_songs (title, data, owner_id) values (left(coalesce(nullif(p_title, ''), 'Sin título'), 120), p_data, auth.uid())
  returning id into v_id;
  return v_id;
end $$;

-- Quedarse con una canción abierta por enlace que aún no tiene dueño.
create or replace function public.mf_claim_song(p_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Entra con tu cuenta primero.'; end if;
  update mf_songs set owner_id = auth.uid() where id = p_id and owner_id is null;
end $$;
revoke all on function public.mf_claim_song(uuid) from public, anon;
grant execute on function public.mf_claim_song(uuid) to authenticated;
