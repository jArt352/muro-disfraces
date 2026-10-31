-- setup.sql: pégalo completo en Supabase > SQL Editor > Run
-- Se puede ejecutar más de una vez sin romper nada.

-- 1. La tabla: la "libreta" donde se anotan los participantes.
--    Los CHECK son las primeras reglas del portero: nombres de 2 a 30 letras.
create table if not exists participantes (
  id uuid primary key default gen_random_uuid(),
  nombre text not null check (char_length(trim(nombre)) between 2 and 30),
  disfraz text not null check (char_length(trim(disfraz)) between 2 and 30),
  foto_url text check (foto_url is null or foto_url like 'https://%'),
  votos int not null default 0,
  creado_en timestamptz not null default now()
);

-- 2. Registro de votos: un solo voto por dispositivo.
create table if not exists registro_votos (
  dispositivo text primary key check (char_length(dispositivo) between 8 and 64),
  participante_id uuid not null references participantes(id) on delete cascade,
  creado_en timestamptz not null default now()
);

-- 3. SEGURIDAD (RLS): sin una regla que lo permita, NADIE puede hacer nada.
alter table participantes enable row level security;
alter table registro_votos enable row level security;

drop policy if exists "todos pueden ver" on participantes;
create policy "todos pueden ver" on participantes
  for select to anon using (true);

drop policy if exists "todos pueden registrarse" on participantes;
create policy "todos pueden registrarse" on participantes
  for insert to anon with check (votos = 0);

-- No hay reglas de update ni delete: nadie puede editar votos ni borrar desde la página.
-- registro_votos no tiene reglas: solo la función votar() puede escribir ahí.

-- 4. Votar pasa por una función del servidor que aplica las reglas.
create or replace function votar(p_id uuid, p_dispositivo text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into registro_votos (dispositivo, participante_id) values (p_dispositivo, p_id);
  update participantes set votos = votos + 1 where id = p_id;
exception
  when unique_violation then raise exception 'Ya votaste';
  when foreign_key_violation then raise exception 'Ese disfraz no existe';
  when check_violation then raise exception 'Dispositivo no válido';
end;
$$;

revoke all on function votar(uuid, text) from public;
grant execute on function votar(uuid, text) to anon;

-- 5. ARCHIVOS: el casillero de fotos (máximo 2 MB, solo imágenes).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('disfraces', 'disfraces', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = true, file_size_limit = 2097152, allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

drop policy if exists "subir fotos de disfraces" on storage.objects;
create policy "subir fotos de disfraces" on storage.objects
  for insert to anon with check (bucket_id = 'disfraces');

drop policy if exists "ver fotos de disfraces" on storage.objects;
create policy "ver fotos de disfraces" on storage.objects
  for select to anon using (bucket_id = 'disfraces');

-- 6. TIEMPO REAL: avisa a las pantallas cuando cambia la tabla.
do $$
begin
  alter publication supabase_realtime add table participantes;
exception when duplicate_object then null;
end;
$$;

-- Para limpiar el muro (solo tú, desde el SQL Editor):
-- delete from participantes;
