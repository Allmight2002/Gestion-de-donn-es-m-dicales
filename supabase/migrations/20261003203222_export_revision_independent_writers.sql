-- Les compteurs communs serialisaient les transactions d'une meme base,
-- y compris celles qui modifient des lignes independantes (CI §14.1.11).
-- Migration additive : conserve les compteurs anterieurs sous writer_id=0.
-- Chaque backend PostgreSQL est sequentiel et possede un PID distinct des autres
-- backends actifs. Ses compteurs n'entrent donc pas en conflit avec un autre writer.
-- La reutilisation ulterieure d'un PID continue le compteur existant, sans reset.
-- Le jeton additionne les compteurs dans un seul snapshot MVCC : il reste monotone
-- a chaque commit, sans attente sur les transactions ouvertes et sans changement de format.
-- Aucune ligne clinique n'est reecrite. Restaurer aussi la colonne/cle composite.
-- Ne pas supprimer des compteurs de backends termines pendant que les exports sont ouverts.

alter table export_consistency.revision
  add column writer_id integer not null default 0 check (writer_id >= 0);
alter table export_consistency.revision drop constraint revision_pkey;
alter table export_consistency.revision add primary key (resource, writer_id);

create or replace function export_consistency.track_sources()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_relation text;
  v_query text;
  v_keys text[] := '{}';
  v_part text[];
  v_key text;
begin
  if TG_OP = 'TRUNCATE' then
    v_keys := array['epoch'];
  else
    foreach v_relation in array case TG_OP
      when 'INSERT' then array['export_new_rows']
      when 'DELETE' then array['export_old_rows']
      else array['export_old_rows', 'export_new_rows'] end
    loop
      v_query := case TG_TABLE_NAME
        when 'base' then 'select ''base:'' || r.id::text as resource from %I r'
        when 'patient' then 'select ''base:'' || r.base_id::text as resource from %I r'
        when 'cohort' then 'select ''base:'' || r.base_id::text as resource from %I r'
        when 'encounter' then
          'select ''base:'' || p.base_id::text as resource from %I r join public.patient p on p.id = r.patient_id'
        when 'cohort_member' then
          'select ''base:'' || c.base_id::text as resource from %I r join public.cohort c on c.id = r.cohort_id'
        when 'cohort_encounter_member' then
          'select ''base:'' || c.base_id::text as resource from %I r join public.cohort c on c.id = r.cohort_id'
        when 'record_field_provenance' then
          'select ''base:'' || p.base_id::text as resource from %I r
             left join public.encounter e on r.record_kind = ''encounter'' and e.id = r.record_id
             join public.patient p on p.id = case when r.record_kind = ''patient'' then r.record_id else e.patient_id end'
        when 'profiles' then
          'select ''actors'' as resource where exists (select 1 from %I)'
        else
          'select ''catalog'' as resource where exists (select 1 from %I)'
      end;
      execute 'select array_agg(distinct resource) from (' || format(v_query, v_relation) || ') s'
        into v_part;
      v_keys := v_keys || coalesce(v_part, '{}');
    end loop;
  end if;

  -- Ordre stable pour les instructions affectant plusieurs bases.
  for v_key in select distinct k from unnest(v_keys) k where k is not null order by k
  loop
    insert into export_consistency.revision as r(resource, writer_id, revision) values(v_key, pg_backend_pid(), 1)
      on conflict(resource, writer_id) do update set revision = r.revision + 1;
  end loop;
  -- Suppression en cascade : si le parent n'est plus visible dans une table de
  -- transition enfant, son propre trigger a deja invalide la base/le catalogue.
  return null;
end $$;

create or replace function public.export_source_revision(p_cohort_id uuid)
returns text language sql stable security invoker set search_path = '' as $$
  select 'v1:' || c.base_id::text || ':' ||
    coalesce((select sum(revision)::text from export_consistency.revision where resource = 'base:' || c.base_id::text), '0') || ':' ||
    coalesce((select sum(revision)::text from export_consistency.revision where resource = 'catalog'), '0') || ':' ||
    coalesce((select sum(revision)::text from export_consistency.revision where resource = 'actors'), '0') || ':' ||
    coalesce((select sum(revision)::text from export_consistency.revision where resource = 'epoch'), '0')
  from public.cohort c join public.base b on b.id = c.base_id
  where c.id = p_cohort_id;
$$;

notify pgrst, 'reload schema';
