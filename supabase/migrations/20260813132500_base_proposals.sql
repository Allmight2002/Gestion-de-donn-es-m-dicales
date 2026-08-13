-- =============================================================================
-- 20260813132500_base_proposals.sql (L12)
-- Propositions hors liste : lecture transverse reservee au medecin proprietaire.
-- Aucun statut ni ecriture : la decision de promotion reste dans l'editeur de
-- variables, et les propositions conservent leur trace dans les fiches source.
-- =============================================================================

create or replace function public.base_proposals(
  p_base_id uuid,
  p_limit int default 50,
  p_offset int default 0
)
returns jsonb
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare
  v_result jsonb;
begin
  if auth.uid() is null then
    raise exception 'Authentification requise';
  end if;
  if not public.is_base_owner(p_base_id) then
    raise exception 'Reserve au proprietaire de la base';
  end if;

  with params as (
    select greatest(1, least(coalesce(p_limit, 50), 200))::int as lim,
           greatest(0, coalesce(p_offset, 0))::int as off
  ),
  proposal_fields as (
    select
      source.template_version_id,
      source.field_key,
      source.label,
      source.scope,
      companion.field_key as proposal_field_key
    from public.template_field source
    join public.template_field companion
      on companion.template_version_id = source.template_version_id
     and companion.field_key = source.field_key || '_autre'
     and companion.type = 'text'
     and companion.scope = source.scope
    where source.type in ('select', 'multiselect', 'terminology')
  ),
  all_items as materialized (
    select
      pf.field_key,
      pf.label,
      pf.scope,
      p.data ->> pf.proposal_field_key as proposal_value,
      p.id as patient_id,
      p.patient_code,
      null::uuid as encounter_id,
      null::text as encounter_type,
      null::date as encounter_date
    from public.patient p
    join proposal_fields pf
      on pf.template_version_id = p.template_version_id
     and pf.scope = 'patient'
    where p.base_id = p_base_id
      and p.deleted_at is null
      -- assert_data_valid impose une chaine aux champs text ; les JSON invalides
      -- ne sont pas presentes comme des propositions metier.
      and jsonb_typeof(p.data -> pf.proposal_field_key) = 'string'
      and btrim(p.data ->> pf.proposal_field_key) <> ''

    union all

    select
      pf.field_key,
      pf.label,
      pf.scope,
      e.data ->> pf.proposal_field_key,
      p.id,
      p.patient_code,
      e.id,
      e.encounter_type,
      e.encounter_date
    from public.encounter e
    join public.patient p on p.id = e.patient_id
    join proposal_fields pf
      on pf.template_version_id = e.template_version_id
     and pf.scope = 'encounter'
    where p.base_id = p_base_id
      and p.deleted_at is null
      and e.deleted_at is null
      and jsonb_typeof(e.data -> pf.proposal_field_key) = 'string'
      and btrim(e.data ->> pf.proposal_field_key) <> ''
  ),
  numbered_items as (
    select
      all_items.*,
      count(*) over (partition by scope, field_key)::int as variable_total
    from all_items
  ),
  page_items as (
    select numbered_items.*
    from numbered_items, params
    order by scope, label, field_key, patient_code, encounter_date nulls first,
             patient_id, encounter_id nulls first
    limit (select lim from params)
    offset (select off from params)
  )
  select jsonb_build_object(
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'fieldKey', field_key,
        'label', label,
        'scope', scope,
        'proposalValue', proposal_value,
        'patientId', patient_id,
        'patientCode', patient_code,
        'encounterId', encounter_id,
        'encounterType', encounter_type,
        'encounterDate', encounter_date,
        'variableTotal', variable_total
      ) order by scope, label, field_key, patient_code, encounter_date nulls first,
                 patient_id, encounter_id nulls first)
      from page_items
    ), '[]'::jsonb),
    'total', (select count(*)::int from all_items),
    'limit', (select lim from params),
    'offset', (select off from params),
    'hasMore', ((select off from params) + (select lim from params) < (select count(*) from all_items))
  ) into v_result;

  return v_result;
end $$;

revoke all on function public.base_proposals(uuid, int, int) from public, anon, authenticated;
grant execute on function public.base_proposals(uuid, int, int) to authenticated;
