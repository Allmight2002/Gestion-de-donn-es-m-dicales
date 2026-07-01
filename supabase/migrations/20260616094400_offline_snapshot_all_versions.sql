-- =============================================================================
-- 20260616094400_offline_snapshot_all_versions.sql  (audit v10 §5.7)
-- L'instantane hors-ligne ne renvoyait que le dictionnaire de la version COURANTE du gabarit. Or
-- des patients/rencontres historiques peuvent porter d'ANCIENNES versions : hors-ligne, leurs
-- variables se retrouvaient sans libelle / mal affichees. On renvoie desormais un dictionnaire PAR
-- VERSION (`fieldsByVersion`) pour TOUTES les versions reellement presentes, et on ajoute la version
-- de gabarit sur chaque rencontre (le patient la portait deja). Migration ADDITIVE (redefinit la RPC).
-- =============================================================================
create or replace function public.download_base_snapshot(p_base_id uuid)
returns jsonb
language sql stable security invoker set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'base', (
      select jsonb_build_object('id', b.id, 'name', b.name, 'templateVersionId', b.current_template_version_id)
      from public.base b where b.id = p_base_id
    ),
    -- Dictionnaire de la version COURANTE (colonnes de la liste ; repli d'affichage).
    'fields', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', tf.id, 'fieldKey', tf.field_key, 'label', tf.label,
        'scope', tf.scope, 'type', tf.type, 'displayOrder', tf.display_order
      ) order by tf.display_order, tf.field_key)
      from public.template_field tf
      where tf.template_version_id = (select current_template_version_id from public.base where id = p_base_id)
    ), '[]'::jsonb),
    -- §5.7 : dictionnaire PAR VERSION, pour toutes les versions presentes (patients ET rencontres).
    'fieldsByVersion', coalesce((
      select jsonb_object_agg(v.tvid::text, v.fields)
      from (
        select tf.template_version_id as tvid,
               jsonb_agg(jsonb_build_object(
                 'id', tf.id, 'fieldKey', tf.field_key, 'label', tf.label,
                 'scope', tf.scope, 'type', tf.type, 'displayOrder', tf.display_order
               ) order by tf.display_order, tf.field_key) as fields
        from public.template_field tf
        where tf.template_version_id in (
          select p.template_version_id from public.patient p
            where p.base_id = p_base_id and p.deleted_at is null
          union
          select e.template_version_id from public.encounter e
            join public.patient p on p.id = e.patient_id
            where p.base_id = p_base_id and p.deleted_at is null and e.deleted_at is null
        )
        group by tf.template_version_id
      ) v
    ), '{}'::jsonb),
    'patients', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id, 'code', p.patient_code, 'templateVersionId', p.template_version_id,
        'data', p.data, 'validationStatus', p.validation_status,
        'encounters', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', e.id, 'encounterType', e.encounter_type, 'encounterDate', e.encounter_date,
            'validationStatus', e.validation_status, 'ageValue', e.age_value, 'ageUnit', e.age_unit,
            'data', e.data, 'updatedAt', e.updated_at, 'templateVersionId', e.template_version_id
          ) order by e.encounter_date)
          from public.encounter e where e.patient_id = p.id and e.deleted_at is null
        ), '[]'::jsonb)
      ) order by p.created_at)
      from public.patient p where p.base_id = p_base_id and p.deleted_at is null
    ), '[]'::jsonb)
  );
$$;
grant execute on function public.download_base_snapshot(uuid) to authenticated;
