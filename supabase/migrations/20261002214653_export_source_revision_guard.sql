-- Revision transactionnelle des sources des exports pagines. Aucun changement de donnees metier.
-- La table interne garde des compteurs, pas des copies de donnees cliniques.
create schema export_consistency;
revoke all on schema export_consistency from public, anon, authenticated, service_role;
grant usage on schema export_consistency to service_role;

create table export_consistency.revision (
  resource text primary key,
  revision bigint not null check (revision > 0)
);
alter table export_consistency.revision enable row level security;
revoke all on export_consistency.revision from public, anon, authenticated, service_role;
grant select on export_consistency.revision to service_role;

-- Un compteur par base pour les fiches, rencontres, cohortes et provenance.
-- Le catalogue et les noms d'acteurs sont partages : leur modification invalide
-- conservativement tous les exports en cours. Pas de verrou tenu par l'export.
-- Les tables de transition bornent le cout a une incrementation par ressource
-- et par instruction SQL, meme pour un import de milliers de lignes.
create function export_consistency.track_sources()
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
    insert into export_consistency.revision as r(resource, revision) values(v_key, 1)
      on conflict(resource) do update set revision = r.revision + 1;
  end loop;
  -- Suppression en cascade : si le parent n'est plus visible dans une table de
  -- transition enfant, son propre trigger a deja invalide la base/le catalogue.
  return null;
end $$;
revoke all on function export_consistency.track_sources() from public, anon, authenticated, service_role;

do $$
declare v_table text;
begin
  foreach v_table in array array[
    'base', 'patient', 'encounter', 'cohort', 'cohort_member', 'cohort_encounter_member',
    'record_field_provenance', 'profiles', 'template_version', 'template_field',
    'template_section', 'template_common_group', 'validation_rule'
  ] loop
    execute format('create trigger export_revision_insert after insert on public.%I
      referencing new table as export_new_rows for each statement
      execute function export_consistency.track_sources()', v_table);
    execute format('create trigger export_revision_update after update on public.%I
      referencing old table as export_old_rows new table as export_new_rows for each statement
      execute function export_consistency.track_sources()', v_table);
    execute format('create trigger export_revision_delete after delete on public.%I
      referencing old table as export_old_rows for each statement
      execute function export_consistency.track_sources()', v_table);
    execute format('create trigger export_revision_truncate after truncate on public.%I
      for each statement execute function export_consistency.track_sources()', v_table);
  end loop;
end $$;

-- Un seul snapshot MVCC pour le jeton et le rattachement de la cohorte.
-- SECURITY INVOKER, service_role uniquement, apres autorisation par l'Edge.
-- Les compteurs absents valent zero : pas de backfill, les anciennes bases
-- sont protegees des leur premiere modification apres cette migration.
create function public.export_source_revision(p_cohort_id uuid)
returns text language sql stable security invoker set search_path = '' as $$
  select 'v1:' || c.base_id::text || ':' ||
    coalesce((select revision::text from export_consistency.revision where resource = 'base:' || c.base_id::text), '0') || ':' ||
    coalesce((select revision::text from export_consistency.revision where resource = 'catalog'), '0') || ':' ||
    coalesce((select revision::text from export_consistency.revision where resource = 'actors'), '0') || ':' ||
    coalesce((select revision::text from export_consistency.revision where resource = 'epoch'), '0')
  from public.cohort c join public.base b on b.id = c.base_id
  where c.id = p_cohort_id;
$$;
revoke all on function public.export_source_revision(uuid) from public, anon, authenticated;
grant execute on function public.export_source_revision(uuid) to service_role;
notify pgrst, 'reload schema';
