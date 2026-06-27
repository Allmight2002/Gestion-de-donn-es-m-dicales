-- =============================================================================
-- 20260616092100_cohort_eligibility.sql  (audit 2 §7)
-- Eligibilite cohortes : decouple le statut PATIENT du statut RENCONTRE. Une rencontre
-- `curated` ne doit PLUS etre exclue d'une cohorte de rencontres juste parce que les
-- DONNEES PERMANENTES du patient sont encore `draft`. Le patient doit toujours etre ACTIF
-- et correspondre aux filtres de PORTEE PATIENT (mais son statut de validation n'est pas
-- requis pour les RENCONTRES). La cohorte de PATIENTS, elle, continue d'exiger un patient
-- valide (validated_only). + RPC finalize_patient pour finaliser des donnees permanentes
-- saisies directement.
-- =============================================================================

create or replace function public.cohort_preview(p_base_id uuid, p_filter jsonb, p_validated_only boolean default true)
returns table (patient_count int, encounter_count int)
language sql stable security invoker set search_path = public, pg_temp as $$
  with parts as (
    select
      coalesce(jsonb_agg(c) filter (where c ->> 'scope' = 'patient'), '[]'::jsonb) as pv,
      coalesce(jsonb_agg(c) filter (where c ->> 'scope' = 'encounter'), '[]'::jsonb) as ev
    from jsonb_array_elements(coalesce(p_filter -> 'conditions', '[]'::jsonb)) c
  ),
  -- Cohorte de PATIENTS : patient actif + valide (si demande) + filtres patient (+ au moins
  -- une rencontre valide correspondante si des filtres rencontre existent).
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
  -- Patients eligibles pour la cohorte de RENCONTRES : actifs + filtres patient SEULEMENT
  -- (le statut de validation du patient n'est PAS requis).
  peo as (
    select p.id from public.patient p, parts
    where p.base_id = p_base_id and p.deleted_at is null
      and public.jsonb_matches(p.data, parts.pv)
  ),
  me as (
    select e.id from public.encounter e join public.patient p on p.id = e.patient_id, parts
    where p.base_id = p_base_id and p.deleted_at is null and e.deleted_at is null
      and (not p_validated_only or e.validation_status = 'curated')
      and p.id in (select id from peo)
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

  -- Cohorte de PATIENTS : patient valide (si demande).
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

  -- Cohorte de RENCONTRES : rencontre valide (si demande) sur un patient ACTIF correspondant
  -- aux filtres patient — SANS exiger que le patient soit lui-meme `curated`.
  insert into public.cohort_encounter_member (cohort_id, encounter_id)
  select v_cohort.id, e.id from public.encounter e join public.patient p on p.id = e.patient_id
  where p.base_id = p_base_id and p.deleted_at is null and e.deleted_at is null
    and (not p_validated_only or e.validation_status = 'curated')
    and public.jsonb_matches(p.data, pv)
    and public.jsonb_matches(e.data, ev);

  return v_cohort;
end $$;

grant execute on function public.create_cohort_snapshot(uuid, text, jsonb, boolean) to authenticated;

-- Finaliser les DONNEES PERMANENTES d'un patient saisi directement (draft -> curated). Le
-- trigger assert_curated_complete valide (bornes/types/cles/requis/regles) ; echoue si
-- incomplet. Reserve a can_edit_structured_data.
create or replace function public.finalize_patient(p_patient_id uuid)
returns public.patient language plpgsql security definer set search_path = public, pg_temp as $$
declare v_base uuid; res public.patient;
begin
  select base_id into v_base from public.patient where id = p_patient_id and deleted_at is null;
  if v_base is null then raise exception 'Patient introuvable'; end if;
  if not public.can_edit_structured_data(v_base) then raise exception 'Acces refuse'; end if;
  update public.patient set validation_status = 'curated', updated_at = now()
   where id = p_patient_id returning * into res;
  return res;
end $$;

grant execute on function public.finalize_patient(uuid) to authenticated;
