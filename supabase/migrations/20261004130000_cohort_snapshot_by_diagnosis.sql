-- Export par categorie diagnostique : population « patients ayant l'un de ces codes ».
--
-- `create_cohort_snapshot` combine ses conditions en ET et restreint les RENCONTRES a celles
-- qui correspondent ; `jsonb_matches` ne lit pas non plus toutes les formes d'un diagnostic
-- (liste multiple de chaines, terminologie unitaire). Le besoin ici est different :
--   * un patient est retenu des que l'un des codes figure dans SON diagnostic (portee
--     patient) OU dans le diagnostic de l'une de ses rencontres ;
--   * TOUTES les rencontres d'un patient retenu partent dans la cohorte, pas seulement
--     celle qui porte le code.
-- La variable diagnostic est celle que designe la configuration diagnostique (L55) de la
-- version de CHAQUE fiche : le client ne choisit pas la variable lue.
--
-- Migration additive : deux fonctions nouvelles, aucune table ni fonction existante modifiee.
-- Retour arriere : `drop function` des deux fonctions ; les cohortes deja figees restent
-- des cohortes ordinaires.

-- Vrai si la valeur porte l'un des codes, quelle que soit sa forme : code d'une liste
-- (chaine), liste multiple (tableau de chaines), terminologie ({code}) ou terminologie
-- multiple (tableau de {code}). Toute autre forme ne porte aucun code.
create function public.jsonb_has_any_code(p_value jsonb, p_codes text[])
returns boolean language sql immutable set search_path = public, pg_temp as $$
  select coalesce(case jsonb_typeof(p_value)
    when 'string' then (p_value #>> '{}') = any(p_codes)
    when 'object' then jsonb_typeof(p_value -> 'code') = 'string' and (p_value ->> 'code') = any(p_codes)
    when 'array' then exists (
      select 1 from jsonb_array_elements(p_value) el(v)
      where (jsonb_typeof(el.v) = 'string' and (el.v #>> '{}') = any(p_codes))
         or (jsonb_typeof(el.v) = 'object' and jsonb_typeof(el.v -> 'code') = 'string'
             and (el.v ->> 'code') = any(p_codes)))
    else false
  end, false)
$$;
revoke all on function public.jsonb_has_any_code(jsonb, text[]) from public, anon;
grant execute on function public.jsonb_has_any_code(jsonb, text[]) to authenticated;

create function public.create_cohort_snapshot_by_diagnosis(
  p_base_id uuid, p_name text, p_codes text[], p_validated_only boolean default false
) returns public.cohort
language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  v_cohort public.cohort;
  v_codes text[];
  v_patients uuid[];
  v_curated uuid[];
begin
  select coalesce(array_agg(distinct btrim(c) order by btrim(c)), '{}')
    into v_codes
    from unnest(coalesce(p_codes, '{}')) c
   where c is not null and btrim(c) <> '';
  if cardinality(v_codes) = 0 then
    raise exception 'COHORT_DIAGNOSIS_CODES_REQUIRED: au moins un code diagnostique est requis'
      using errcode = '22023';
  end if;

  insert into public.cohort (base_id, name, filter_definition, cohort_type, snapshot_at, validated_only, created_by)
  values (p_base_id, p_name,
          jsonb_build_object('conditions', '[]'::jsonb, 'diagnosisCodes', to_jsonb(v_codes)),
          'snapshot', now(), p_validated_only, auth.uid())
  returning * into v_cohort;

  -- Patients actifs portant l'un des codes. Comme dans `create_cohort_snapshot`, le statut
  -- du PATIENT ne decide que de la cohorte de patients, pas de celle des rencontres.
  select coalesce(array_agg(p.id), '{}'),
         coalesce(array_agg(p.id) filter (where p.validation_status = 'curated'), '{}')
    into v_patients, v_curated
    from public.patient p
   where p.base_id = p_base_id and p.deleted_at is null
     and (
       exists (
         select 1 from public.template_version v
           cross join lateral jsonb_array_elements(v.diagnosis_configuration) c
          where v.id = p.template_version_id and c ->> 'scope' = 'patient'
            and public.jsonb_has_any_code(p.data -> (c ->> 'diagnosisFieldKey'), v_codes))
       or exists (
         select 1 from public.encounter e
           join public.template_version v on v.id = e.template_version_id
           cross join lateral jsonb_array_elements(v.diagnosis_configuration) c
          where e.patient_id = p.id and e.deleted_at is null
            and (not p_validated_only or e.validation_status = 'curated')
            and c ->> 'scope' = 'encounter'
            and public.jsonb_has_any_code(e.data -> (c ->> 'diagnosisFieldKey'), v_codes))
     );

  insert into public.cohort_member (cohort_id, patient_id)
  select v_cohort.id, id from unnest(case when p_validated_only then v_curated else v_patients end) id;

  -- TOUTES les rencontres actives des patients retenus.
  insert into public.cohort_encounter_member (cohort_id, encounter_id)
  select v_cohort.id, e.id
    from public.encounter e
   where e.patient_id = any(v_patients) and e.deleted_at is null
     and (not p_validated_only or e.validation_status = 'curated');

  return v_cohort;
end $$;
revoke all on function public.create_cohort_snapshot_by_diagnosis(uuid, text, text[], boolean) from public, anon;
grant execute on function public.create_cohort_snapshot_by_diagnosis(uuid, text, text[], boolean) to authenticated;
