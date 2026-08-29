-- =============================================================================
-- 20260616093500_offline_snapshot_rpc.sql  (audit v9 P1 §8 — N+1 hors-ligne)
-- La preparation d'un instantane hors-ligne faisait « 1 requete patients + N requetes rencontres »
-- (une par patient). On fournit une RPC qui renvoie TOUT l'instantane ANALYTIQUE autorise en UN
-- seul appel : base + champs du gabarit + patients (chacun avec ses rencontres non supprimees).
--
-- SECURITE : la fonction est SECURITY INVOKER -> la RLS s'applique normalement (l'utilisateur ne
-- recoit QUE ce qu'il peut deja lire). Elle ne renvoie QUE l'analytique (aucune identite : ni
-- patient_identity, ni nom/date de naissance) -> meme garantie « analytique seulement » que le
-- cache hors-ligne. Migration ADDITIVE.
-- =============================================================================
create or replace function public.download_base_snapshot(p_base_id uuid)
returns jsonb
language sql stable security invoker set search_path = public, pg_temp as $$
  select jsonb_build_object(
    -- base : null si l'utilisateur n'y a pas acces (RLS) -> le client traite comme « introuvable ».
    'base', (
      select jsonb_build_object('id', b.id, 'name', b.name, 'templateVersionId', b.current_template_version_id)
      from public.base b where b.id = p_base_id
    ),
    'fields', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', tf.id, 'fieldKey', tf.field_key, 'label', tf.label,
        'scope', tf.scope, 'type', tf.type, 'displayOrder', tf.display_order
      ) order by tf.display_order, tf.field_key)
      from public.template_field tf
      where tf.template_version_id = (select current_template_version_id from public.base where id = p_base_id)
    ), '[]'::jsonb),
    'patients', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id, 'code', p.patient_code, 'templateVersionId', p.template_version_id,
        'data', p.data, 'validationStatus', p.validation_status,
        'encounters', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', e.id, 'encounterType', e.encounter_type, 'encounterDate', e.encounter_date,
            'validationStatus', e.validation_status, 'ageValue', e.age_value, 'ageUnit', e.age_unit,
            'data', e.data, 'updatedAt', e.updated_at
          ) order by e.encounter_date)
          from public.encounter e where e.patient_id = p.id and e.deleted_at is null
        ), '[]'::jsonb)
      ) order by p.created_at)
      from public.patient p where p.base_id = p_base_id and p.deleted_at is null
    ), '[]'::jsonb)
  );
$$;
grant execute on function public.download_base_snapshot(uuid) to authenticated;
