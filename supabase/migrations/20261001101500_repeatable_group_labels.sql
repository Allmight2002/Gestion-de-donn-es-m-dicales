-- Libelles d'un bloc repetable, choisis par l'auteur du formulaire.
--
-- A la saisie, un bloc repetable proposait toujours « Ajouter une occurrence », puis
-- « Occurrence 1 », « Nouvelle occurrence »... Deux libelles facultatifs le personnalisent :
--   * add_label  : le texte ENTIER du bouton d'ajout (« Ajouter une lesion », « Ajouter un
--                  suivi »). Une phrase complete, pour ne jamais deviner l'article ni l'accord ;
--   * item_label : le nom d'UN element (« Lesion », « Hospitalisation »), qui remplace
--                  « Occurrence » dans les titres (« Lesion 1 », « Nouvelle : Lesion »...).
-- Vides, l'ecran garde les libelles generiques : rien ne change pour l'existant.
--
-- Ce sont des libelles d'affichage, comme le nom du bloc : ils suivent ses regles d'ecriture
-- (RLS du gabarit, `guard_template_section_write` : modifiables tant que la version n'est ni
-- publiee ni archivee, y compris si elle porte deja des donnees). Ils ne touchent aucune donnee
-- saisie, aucune regle, aucun calcul.
--
-- Ils suivent la recopie d'une version (`copy_template_fields`) et la copie hors-ligne
-- (`download_base_snapshot`) : les deux fonctions sont reprises A L'IDENTIQUE de leurs dernieres
-- definitions (20260918191752 et 20260919110000), avec ces deux colonnes en plus. Leurs droits
-- sont conserves par `create or replace`.
-- Le transfert par fichier (export/import) les portera dans une migration suivante : la fonction
-- d'import est redefinie par une autre branche en cours, et la redefinir ici effacerait ce travail.

alter table public.template_section
  add column add_label text,
  add column item_label text,
  add constraint template_section_add_label_format
    check (add_label is null or (char_length(add_label) between 1 and 80 and add_label = btrim(add_label))),
  add constraint template_section_item_label_format
    check (item_label is null or (char_length(item_label) between 1 and 60 and item_label = btrim(item_label)));

create or replace function public.copy_template_fields(
  p_source_version_id  uuid,
  p_target_version_id  uuid,
  p_force_patient_scope boolean default false
) returns void
language plpgsql security invoker set search_path = public, pg_temp as $$
declare config jsonb;
begin
  select diagnosis_configuration into config from public.template_version where id = p_source_version_id for update;
  if p_force_patient_scope and exists (select 1 from jsonb_array_elements(config) c where c ->> 'scope' = 'encounter') then
    raise exception 'DIAGNOSIS_SCOPE_COPY_CONFLICT';
  end if;
  insert into public.template_section
    (template_version_id, section_key, label, display_order,
     source_template_version_id, source_section_key, is_repeatable, add_label, item_label)
  select p_target_version_id, ts.section_key, ts.label, ts.display_order,
         ts.source_template_version_id, ts.source_section_key, ts.is_repeatable, ts.add_label, ts.item_label
  from public.template_section ts
  where ts.template_version_id = p_source_version_id
  order by ts.display_order, ts.section_key
  on conflict (template_version_id, section_key) do nothing;

  -- Second pass: resolve the source parent by its stable key in the target version.
  update public.template_section target set parent_section_id = parent_target.id
  from public.template_section source
  join public.template_section parent_source on parent_source.id = source.parent_section_id
  join public.template_section parent_target on parent_target.template_version_id = p_target_version_id
    and parent_target.section_key = parent_source.section_key
  where source.template_version_id = p_source_version_id
    and target.template_version_id = p_target_version_id and target.section_key = source.section_key;

  -- UX-16 : les rubriques communes AVANT les variables, comme les sections, pour que le
  -- rattachement se resolve dans la foulee.
  insert into public.template_common_group
    (template_version_id, group_key, label, display_order, anchor_order, is_default)
  select p_target_version_id, g.group_key, g.label, g.display_order, g.anchor_order, g.is_default
  from public.template_common_group g
  where g.template_version_id = p_source_version_id
  order by g.display_order, g.group_key
  on conflict (template_version_id, group_key) do nothing;

  -- La recopie reconstruit les rattachements avec les identifiants de la CIBLE. Le marqueur
  -- interdit au trigger de prendre transitoirement le defaut source/cible avant cette passe.
  perform set_config('app.setting_common_layout', 'on', true);
  perform public.copy_template_field_rows(p_source_version_id, p_target_version_id, p_force_patient_scope, null);

  update public.template_field target set common_group_id = target_group.id
  from public.template_field source
  join public.template_common_group source_group on source_group.id = source.common_group_id
  join public.template_common_group target_group on target_group.template_version_id = p_target_version_id
    and target_group.group_key = source_group.group_key
  where source.template_version_id = p_source_version_id
    and target.template_version_id = p_target_version_id and target.field_key = source.field_key
    and target.section is null;

  update public.template_version set diagnosis_configuration = config where id = p_target_version_id;
end $$;

create or replace function public.download_base_snapshot(p_base_id uuid)
returns jsonb
language sql stable security invoker set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'base', (
      select jsonb_build_object('id', b.id, 'name', b.name, 'templateVersionId', b.current_template_version_id)
      from public.base b where b.id = p_base_id
    ),
    'fields', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', tf.id, 'fieldKey', tf.field_key, 'label', tf.label,
        'description', tf.description, 'defaultValue', tf.default_value,
        'scope', tf.scope, 'type', tf.type, 'isMultiple', tf.is_multiple,
        'displayOrder', tf.display_order,
        'section', tf.section, 'unit', tf.unit, 'allowedValues', tf.allowed_values,
        'allowedOptions', tf.allowed_options,
        'required', tf.required, 'minValue', tf.min_value, 'maxValue', tf.max_value,
        'allowMissingCodes', tf.allow_missing_codes, 'missingReasons', to_jsonb(tf.missing_reasons),
        'formula', tf.formula,
        'encounterTypes', to_jsonb(tf.encounter_types)
      ) order by tf.display_order, tf.field_key)
      from public.template_field tf
      where tf.template_version_id = (select current_template_version_id from public.base where id = p_base_id)
    ), '[]'::jsonb),
    'sections', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', ts.id, 'parentSectionKey', (select p.section_key from public.template_section p where p.id = ts.parent_section_id), 'sectionKey', ts.section_key, 'label', ts.label, 'displayOrder', ts.display_order,
        'isRepeatable', ts.is_repeatable, 'addLabel', ts.add_label, 'itemLabel', ts.item_label
      ) order by ts.display_order, ts.section_key)
      from public.template_section ts
      where ts.template_version_id = (select current_template_version_id from public.base where id = p_base_id)
    ), '[]'::jsonb),
    'sectionsByVersion', coalesce((
      select jsonb_object_agg(v.tvid::text, v.sections)
      from (
        select ts.template_version_id as tvid,
               jsonb_agg(jsonb_build_object(
                 'id', ts.id, 'parentSectionKey', (select p.section_key from public.template_section p where p.id = ts.parent_section_id), 'sectionKey', ts.section_key, 'label', ts.label,
                 'displayOrder', ts.display_order, 'isRepeatable', ts.is_repeatable,
                 'addLabel', ts.add_label, 'itemLabel', ts.item_label
               ) order by ts.display_order, ts.section_key) as sections
        from public.template_section ts
        where ts.template_version_id in (
          select b.current_template_version_id from public.base b
            where b.id = p_base_id and b.current_template_version_id is not null
          union
          select p.template_version_id from public.patient p
            where p.base_id = p_base_id and p.deleted_at is null
          union
          select e.template_version_id from public.encounter e
            join public.patient p on p.id = e.patient_id
            where p.base_id = p_base_id and p.deleted_at is null and e.deleted_at is null
        )
        group by ts.template_version_id
      ) v
    ), '{}'::jsonb),
    'fieldsByVersion', coalesce((
      select jsonb_object_agg(v.tvid::text, v.fields)
      from (
        select tf.template_version_id as tvid,
               jsonb_agg(jsonb_build_object(
                 'id', tf.id, 'fieldKey', tf.field_key, 'label', tf.label,
                 'description', tf.description, 'defaultValue', tf.default_value,
                 'scope', tf.scope, 'type', tf.type, 'isMultiple', tf.is_multiple,
                 'displayOrder', tf.display_order,
                 'section', tf.section, 'unit', tf.unit, 'allowedValues', tf.allowed_values,
                 'allowedOptions', tf.allowed_options,
                 'required', tf.required, 'minValue', tf.min_value, 'maxValue', tf.max_value,
                 'allowMissingCodes', tf.allow_missing_codes, 'missingReasons', to_jsonb(tf.missing_reasons),
                 'formula', tf.formula,
                 'encounterTypes', to_jsonb(tf.encounter_types)
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
    'diagnosisContextByVersion', coalesce((
      select jsonb_object_agg(v.id::text, public.get_diagnosis_context(v.id))
      from public.template_version v where v.id in (
        select b.current_template_version_id from public.base b where b.id = p_base_id
        union select p.template_version_id from public.patient p where p.base_id = p_base_id and p.deleted_at is null
        union select e.template_version_id from public.encounter e join public.patient p on p.id = e.patient_id
          where p.base_id = p_base_id and p.deleted_at is null and e.deleted_at is null
      )
    ), '{}'::jsonb),
    'rulesByVersion', coalesce((
      select jsonb_object_agg(v.tvid::text, v.rules)
      from (
        select vr.template_version_id as tvid,
               jsonb_agg(jsonb_build_object(
                 'id', vr.id, 'rule', vr.rule, 'message', vr.message, 'severity', vr.severity
               ) order by vr.id) as rules
        from public.validation_rule vr
        where vr.template_version_id in (
          select b.current_template_version_id from public.base b
            where b.id = p_base_id and b.current_template_version_id is not null
          union
          select p.template_version_id from public.patient p
            where p.base_id = p_base_id and p.deleted_at is null
          union
          select e.template_version_id from public.encounter e
            join public.patient p on p.id = e.patient_id
            where p.base_id = p_base_id and p.deleted_at is null and e.deleted_at is null
        )
        group by vr.template_version_id
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
            'data', e.data, 'updatedAt', e.updated_at, 'templateVersionId', e.template_version_id,
            'group_section_key', e.group_section_key
          ) order by e.encounter_date)
          from public.encounter e where e.patient_id = p.id and e.deleted_at is null
        ), '[]'::jsonb)
      ) order by p.created_at)
      from public.patient p where p.base_id = p_base_id and p.deleted_at is null
    ), '[]'::jsonb)
  );
$$;
