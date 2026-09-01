-- =============================================================================
-- 20260616097100_completion_queue.sql  (feature B2 v1 — file de travail « a completer »)
-- Liste ACTIONNABLE des dossiers non finalises (patients + rencontres <> curated) avec leurs
-- champs REQUIS manquants — la completion devient un flux visible, plus une chasse individuelle.
-- Coherence §7.4 : chaque entite est evaluee contre SA version de gabarit (pas la courante) ;
-- un champ de rencontre limite a certains types n'est exige que pour ces types ; un CODE
-- MANQUANT explicite compte comme renseigne (meme convention que la completude B1).
-- SECURITY INVOKER : RLS naturelle (sans acces -> liste vide). Analytique pur. Additive.
-- =============================================================================
create or replace function public.base_completion_queue(p_base_id uuid, p_limit int default 200)
returns jsonb
language sql stable security invoker set search_path = public, pg_temp as $$
  with pat_items as (
    select
      jsonb_build_object(
        'kind', 'patient', 'patientId', p.id, 'code', p.patient_code, 'status', p.validation_status,
        'missing', coalesce((
          select jsonb_agg(tf.label order by tf.display_order, tf.field_key)
          from public.template_field tf
          where tf.template_version_id = p.template_version_id
            and tf.scope = 'patient' and tf.required
            and nullif(p.data ->> tf.field_key, '') is null
        ), '[]'::jsonb)
      ) as item,
      p.patient_code as code, 0 as rank, p.created_at
    from public.patient p
    where p.base_id = p_base_id and p.deleted_at is null and p.validation_status <> 'curated'
  ),
  enc_items as (
    select
      jsonb_build_object(
        'kind', 'encounter', 'patientId', p.id, 'encounterId', e.id, 'code', p.patient_code,
        'encounterType', e.encounter_type, 'encounterDate', e.encounter_date, 'status', e.validation_status,
        'missing', coalesce((
          select jsonb_agg(tf.label order by tf.display_order, tf.field_key)
          from public.template_field tf
          where tf.template_version_id = e.template_version_id
            and tf.scope = 'encounter' and tf.required
            and (tf.encounter_types is null or cardinality(tf.encounter_types) = 0 or e.encounter_type = any(tf.encounter_types))
            and nullif(e.data ->> tf.field_key, '') is null
        ), '[]'::jsonb)
      ) as item,
      p.patient_code as code, 1 as rank, e.created_at
    from public.encounter e
    join public.patient p on p.id = e.patient_id
    where p.base_id = p_base_id and p.deleted_at is null and e.deleted_at is null
      and e.validation_status <> 'curated'
  )
  select coalesce(jsonb_agg(x.item order by x.code, x.rank, x.created_at), '[]'::jsonb)
  from (
    select * from (select * from pat_items union all select * from enc_items) a
    order by a.code, a.rank, a.created_at
    limit greatest(1, least(coalesce(p_limit, 200), 500))
  ) x;
$$;
grant execute on function public.base_completion_queue(uuid, int) to authenticated;
