-- Solo si ya ejecutaste base_de_datos.sql de una versión anterior.
-- No borra ni modifica los diagnósticos existentes.
begin;
alter table public.farm_diagnostics drop constraint if exists payload_area;
alter table public.farm_diagnostics add constraint payload_area check (
  (payload->>'area')::numeric >= 0 and (payload->>'pasture')::numeric >= 0
  and ((payload->>'area')::numeric = 0 or
       (payload->>'pasture')::numeric <= (payload->>'area')::numeric)
);
commit;
