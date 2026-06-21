-- =============================================================================
-- 20260616091100_cohorts.sql  (v3.0)
-- Filtres + cohortes. matcher JSONB generique + effectifs + figement atomique.
-- v3.0 : option validated_only (§15.1) -> n'inclut que les enregistrements verifies.
-- Definition de filtre : { "conditions":[{ "scope","field","op","value","value2" }] }.
-- =============================================================================

create or replace function public.value_cmp(a text, b text) returns int
language plpgsql immutable as $$
declare na numeric; nb numeric;
begin
  if a is null or b is null then return null; end if;
  begin
    na := a::numeric; nb := b::numeric;
    return case when na < nb then -1 when na > nb then 1 else 0 end;
  exception when others then
    return case when a < b then -1 when a > b then 1 else 0 end;
  end;
end $$;

create or replace function public.jsonb_matches(p_data jsonb, p_conds jsonb) returns boolean
language plpgsql immutable as $$
declare c jsonb; v_field text; v_op text; a text; b text; c2 text; cm int;
begin
  if p_conds is null then return true; end if;
  for c in select * from jsonb_array_elements(p_conds) loop
    v_field := c ->> 'field'; v_op := c ->> 'op'; a := p_data ->> v_field; b := c ->> 'value';
    if v_op = 'eq' then
      if a is distinct from b then return false; end if;
    elsif v_op = 'neq' then
      if a is not distinct from b then return false; end if;
    elsif v_op = 'in' then
      if a is null or a not in (select jsonb_array_elements_text(c -> 'value')) then return false; end if;
    elsif v_op = 'between' then
      c2 := c ->> 'value2';
      if public.value_cmp(a, b) is null or public.value_cmp(a, b) < 0 or public.value_cmp(a, c2) > 0 then return false; end if;
    else
      cm := public.value_cmp(a, b);
      if cm is null then return false; end if;
      if v_op = 'gt'  and not (cm > 0)  then return false; end if;
      if v_op = 'gte' and not (cm >= 0) then return false; end if;
      if v_op = 'lt'  and not (cm < 0)  then return false; end if;
      if v_op = 'lte' and not (cm <= 0) then return false; end if;
    end if;
  end loop;
  return true;
end $$;

create or replace function public.cohort_preview(p_base_id uuid, p_filter jsonb, p_validated_only boolean default true)
returns table (patient_count int, encounter_count int)
language sql stable security invoker set search_path = public, pg_temp as $$
  with parts as (
    select
      coalesce(jsonb_agg(c) filter (where c ->> 'scope' = 'patient'), '[]'::jsonb) as pv,
      coalesce(jsonb_agg(c) filter (where c ->> 'scope' = 'encounter'), '[]'::jsonb) as ev
    from jsonb_array_elements(coalesce(p_filter -> 'conditions', '[]'::jsonb)) c
  ),
  mp as (
    select p.id from public.patient p, parts
    where p.base_id = p_base_id and p.deleted_at is null
      and (not p_validated_only or p.validation_status = 'curated')
      and public.jsonb_matches(p.data, parts.pv)
      and ( parts.ev = '[]'::jsonb
            or exists (select 1 from public.encounter e
                       where e.patient_id = p.id and e.deleted_at is null
                         and (not p_validated_only or e.validation_status = 'curated')
                         and public.jsonb_matches(e.data, parts.ev)) )
  ),
  me as (
    select e.id from public.encounter e join public.patient p on p.id = e.patient_id, parts
    where p.base_id = p_base_id and p.deleted_at is null and e.deleted_at is null
      and (not p_validated_only or e.validation_status = 'curated')
      and p.id in (select id from mp)
      and public.jsonb_matches(e.data, parts.ev)
  )
  select (select count(*) from mp)::int, (select count(*) from me)::int;
$$;

grant execute on function public.cohort_preview(uuid, jsonb, boolean) to authenticated;

create or replace function public.create_cohort_snapshot(
  p_base_id uuid, p_name text, p_filter jsonb, p_validated_only boolean default true
) returns public.cohort
language plpgsql security invoker set search_path = public, pg_temp as $$
declare v_cohort public.cohort; pv jsonb; ev jsonb;
begin
  select
    coalesce(jsonb_agg(c) filter (where c ->> 'scope' = 'patient'), '[]'::jsonb),
    coalesce(jsonb_agg(c) filter (where c ->> 'scope' = 'encounter'), '[]'::jsonb)
  into pv, ev
  from jsonb_array_elements(coalesce(p_filter -> 'conditions', '[]'::jsonb)) c;

  insert into public.cohort (base_id, name, filter_definition, cohort_type, snapshot_at, validated_only, created_by)
  values (p_base_id, p_name, coalesce(p_filter, '{}'::jsonb), 'snapshot', now(), p_validated_only, auth.uid())
  returning * into v_cohort;

  insert into public.cohort_member (cohort_id, patient_id)
  select v_cohort.id, p.id from public.patient p
  where p.base_id = p_base_id and p.deleted_at is null
    and (not p_validated_only or p.validation_status = 'curated')
    and public.jsonb_matches(p.data, pv)
    and ( ev = '[]'::jsonb
          or exists (select 1 from public.encounter e
                     where e.patient_id = p.id and e.deleted_at is null
                       and (not p_validated_only or e.validation_status = 'curated')
                       and public.jsonb_matches(e.data, ev)) );

  insert into public.cohort_encounter_member (cohort_id, encounter_id)
  select v_cohort.id, e.id from public.encounter e join public.patient p on p.id = e.patient_id
  where p.base_id = p_base_id and p.deleted_at is null and e.deleted_at is null
    and (not p_validated_only or e.validation_status = 'curated')
    and exists (select 1 from public.cohort_member cm where cm.cohort_id = v_cohort.id and cm.patient_id = p.id)
    and public.jsonb_matches(e.data, ev);

  return v_cohort;
end $$;

grant execute on function public.create_cohort_snapshot(uuid, text, jsonb, boolean) to authenticated;
