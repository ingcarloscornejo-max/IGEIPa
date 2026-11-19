-- GEI Panamá v2.12: ejecutar UNA VEZ en SQL Editor del proyecto existente.
-- Permite varios análisis de la misma finca en el mismo año, en fechas distintas.
-- No borra ni reescribe diagnósticos, usuarios, factores ni permisos.
-- No modifica tablas de BioMarket. Puede ejecutarse de nuevo sin duplicar objetos.
begin;

-- Comprobar posibles fechas repetidas de versiones anteriores sin inventar
-- fechas, borrar registros ni decidir qué observación debe conservarse.
do $$
declare
  repeated_analysis text;
begin
  select lower(trim(code)) || ' / ' || btrim(payload->>'visit')
    into repeated_analysis
    from public.farm_diagnostics
    where nullif(btrim(payload->>'visit'), '') is not null
    group by lower(trim(code)), btrim(payload->>'visit')
    having count(*) > 1
    limit 1;
  if repeated_analysis is not null then
    raise exception 'Hay análisis antiguos con la misma finca y fecha: %. Revisa las fechas originales antes de actualizar; no se ha borrado ningún dato.', repeated_analysis;
  end if;
end;
$$;

-- Crear primero la nueva regla; si hay fechas duplicadas, la transacción
-- falla sin quitar la protección anterior ni alterar los registros.
create unique index if not exists one_farm_per_date
  on public.farm_diagnostics(lower(trim(code)), (nullif(btrim(payload->>'visit'), '')))
  where nullif(btrim(payload->>'visit'), '') is not null;

drop index if exists public.one_farm_per_year;

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
