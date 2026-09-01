-- =============================================================================
-- 20260616097000_completeness_stats.sql  (feature B1 — completude par variable)
-- « Ou sont les trous ? » : part des dossiers ou chaque variable (version COURANTE du gabarit)
-- est renseignee. Champs patient -> rapportes aux patients ; champs rencontre -> rapportes aux
-- rencontres DES TYPES CONCERNES (encounter_types). Un CODE MANQUANT explicite (non_fait /
-- inconnu / non_applicable) compte comme RENSEIGNE : c'est une reponse documentee, pas un trou.
-- SECURITY INVOKER : RLS naturelle (sans acces -> series vides). Analytique pur. Additive.
-- =============================================================================
create or replace function public.base_completeness_stats(p_base_id uuid)
returns jsonb
language sql stable security invoker set search_path = public, pg_temp as $$
  with tv as (
    select current_template_version_id as id from public.base where id = p_base_id
  ),
  pat as (
    select p.data from public.patient p
    where p.base_id = p_base_id and p.deleted_at is null
  ),
  enc as (
    select e.encounter_type, e.data from public.encounter e
    join public.patient p on p.id = e.patient_id
    where p.base_id = p_base_id and p.deleted_at is null and e.deleted_at is null
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'fieldKey', f.field_key, 'label', f.label, 'scope', f.scope,
      'filled', f.filled, 'total', f.total
    ) order by case when f.total = 0 then 2 else f.filled::numeric / f.total end, f.label), '[]'::jsonb)
  from (
    select tf.field_key, tf.label, tf.scope,
      (case when tf.scope = 'patient'
        then (select count(*) from pat where nullif(pat.data ->> tf.field_key, '') is not null)
        else (select count(*) from enc
              where (tf.encounter_types is null or cardinality(tf.encounter_types) = 0 or enc.encounter_type = any(tf.encounter_types))
                and nullif(enc.data ->> tf.field_key, '') is not null)
      end)::int as filled,
      (case when tf.scope = 'patient'
        then (select count(*) from pat)
        else (select count(*) from enc
              where (tf.encounter_types is null or cardinality(tf.encounter_types) = 0 or enc.encounter_type = any(tf.encounter_types)))
      end)::int as total
    from public.template_field tf, tv
    where tf.template_version_id = tv.id
  ) f;
$$;
grant execute on function public.base_completeness_stats(uuid) to authenticated;
