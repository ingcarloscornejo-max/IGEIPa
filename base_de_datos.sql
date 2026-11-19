-- GEI Panamá v1 · ejecutar una vez en SQL Editor de Supabase.
-- No contiene contraseñas ni datos personales de productores.
begin;

create table public.gei_admins (
  user_id uuid primary key references auth.users(id) on delete cascade
);
alter table public.gei_admins enable row level security;
revoke all on public.gei_admins from anon, authenticated;
grant select on public.gei_admins to authenticated;
create policy "Cada usuario consulta su rol" on public.gei_admins
  for select to authenticated using (user_id = (select auth.uid()));
-- Los usuarios no pueden asignarse permisos: solo el SQL Editor administra esta tabla.

create table public.farm_diagnostics (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id),
  code text not null check (length(trim(code)) between 1 and 80),
  reference_year integer not null check (reference_year between 2000 and 2100),
  province text not null check (length(province) between 1 and 100),
  district text not null check (length(district) between 1 and 100),
  payload jsonb not null,
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payload_object check (jsonb_typeof(payload) = 'object'),
  constraint payload_required check (payload ?& array[
    'code','name','producer','province','district','year','area','pasture',
    'herd','land','inputs','parameters','animalFactors','version'
  ]),
  constraint matching_identity check (
    payload->>'code' = code and (payload->>'year')::integer = reference_year
    and payload->>'province' = province and payload->>'district' = district
  ),
  constraint payload_area check (
    (payload->>'area')::numeric >= 0 and (payload->>'pasture')::numeric >= 0
    and ((payload->>'area')::numeric = 0 or
         (payload->>'pasture')::numeric <= (payload->>'area')::numeric)
  ),
  constraint payload_size check (octet_length(payload::text) < 200000)
);
create unique index if not exists one_farm_per_date
  on public.farm_diagnostics(lower(trim(code)), (nullif(btrim(payload->>'visit'), '')))
  where nullif(btrim(payload->>'visit'), '') is not null;
create index diagnostics_territory on public.farm_diagnostics(reference_year, province, district);
create index diagnostics_owner on public.farm_diagnostics(owner_id);
create index diagnostics_updated on public.farm_diagnostics(updated_at desc, id);

create function public.gei_stamp_diagnostic() returns trigger
language plpgsql set search_path = '' as $$
begin
  if TG_OP = 'UPDATE' then
    if NEW.owner_id <> OLD.owner_id then
      raise exception 'No se puede cambiar el responsable original del registro';
    end if;
    NEW.created_at := OLD.created_at;
    NEW.revision := OLD.revision + 1;
  else
    NEW.created_at := now();
    NEW.revision := 1;
  end if;
  NEW.updated_at := now();
  return NEW;
end;
$$;
create trigger gei_stamp before insert or update on public.farm_diagnostics
  for each row execute function public.gei_stamp_diagnostic();

alter table public.farm_diagnostics enable row level security;
revoke all on public.farm_diagnostics from anon, authenticated;
grant select, insert, update, delete on public.farm_diagnostics to authenticated;

create policy "Consultar propios o administrador" on public.farm_diagnostics
  for select to authenticated using (
    owner_id = (select auth.uid())
    or exists (select 1 from public.gei_admins where user_id = (select auth.uid()))
  );
create policy "Crear propios" on public.farm_diagnostics
  for insert to authenticated with check (owner_id = (select auth.uid()));
create policy "Actualizar propios o administrador" on public.farm_diagnostics
  for update to authenticated using (
    owner_id = (select auth.uid())
    or exists (select 1 from public.gei_admins where user_id = (select auth.uid()))
  ) with check (
    owner_id = (select auth.uid())
    or exists (select 1 from public.gei_admins where user_id = (select auth.uid()))
  );
create policy "Eliminar propios o administrador" on public.farm_diagnostics
  for delete to authenticated using (
    owner_id = (select auth.uid())
    or exists (select 1 from public.gei_admins where user_id = (select auth.uid()))
  );

-- Fechas nuevas obligatorias y válidas. Los registros antiguos sin fecha
-- permanecen intactos y pueden conservar esa condición al editarlos.
create or replace function public.gei_check_analysis_date() returns trigger
language plpgsql set search_path = '' as $$
declare
  visit_text text;
  parsed_date date;
begin
  visit_text := nullif(btrim(NEW.payload->>'visit'), '');
  if visit_text is null then
    if TG_OP = 'INSERT' then
      raise exception 'Indica la fecha del análisis antes de guardar';
    elsif nullif(btrim(OLD.payload->>'visit'), '') is not null then
      raise exception 'No se puede quitar la fecha de un análisis registrado';
    end if;
    return NEW;
  end if;
  if visit_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    raise exception 'La fecha del análisis debe tener formato AAAA-MM-DD';
  end if;
  parsed_date := visit_text::date;
  if pg_catalog.to_char(parsed_date, 'YYYY-MM-DD') <> visit_text then
    raise exception 'La fecha del análisis no es válida';
  end if;
  return NEW;
end;
$$;
drop trigger if exists gei_analysis_date on public.farm_diagnostics;
create trigger gei_analysis_date before insert or update of payload
  on public.farm_diagnostics for each row
  execute function public.gei_check_analysis_date();

comment on table public.farm_diagnostics is
  'Un diagnóstico por código de finca y fecha. Se conservan análisis anteriores y factores. Consolidado por último análisis de cada finca. RLS obligatorio.';
commit;

-- DESPUÉS de crear tu cuenta en Authentication > Users, ejecuta aparte:
-- Sustituye el correo por el de tu cuenta. No publiques este correo en el HTML.
-- insert into public.gei_admins(user_id)
-- select id from auth.users where lower(email) = lower('TU_CORREO_AQUI')
-- on conflict do nothing;

-- Verificar quién tiene acceso al consolidado (solo desde SQL Editor):
-- select u.email from public.gei_admins a join auth.users u on u.id=a.user_id;
