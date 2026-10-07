-- =============================================================================
-- 20261007120000_occurrence_context_withdrawal.sql
-- L74b : effacement déclaré, atomique, des valeurs d'occurrences que la fiche patient
-- masque (docs/l74-contexte-patient-occurrences.md, D4, §12).
--
-- Une variable permanente peut commander l'affichage d'une variable de groupe (L74a).
-- Décocher ce pilote masque la variable dans les occurrences du patient, alors que
-- leurs valeurs sont dans d'autres lignes. Cette migration ÉTEND le retrait L72e
-- (20260924090000) au lieu de le dupliquer :
--
-- 1. `patient_context_erasures` : pour chaque occurrence vivante qui n'est PAS retirée
--    avec son bloc, les variables renseignées, masquées avec la nouvelle fiche et
--    visibles avec l'ancienne (point fixe de `visibility_hidden_fields` sur
--    `occurrence_evaluation_data`, cascade comprise). Seules comptent les variables
--    atteignables depuis un pilote permanent (`context_driven_field_keys`) : un
--    masquage purement interne à l'occurrence garde la tolérance d'avant.
-- 2. Même déclencheur `trg_patient_group_withdrawal`, mêmes surcharges
--    `update_patient(…, p_withdrawn_occurrences)` et
--    `update_patient_compatible(…, p_withdrawn_occurrences)` : AUCUNE nouvelle
--    signature. La déclaration accepte, à côté des entrées `{sectionKey, occurrences}`
--    de L72e, des entrées `{sectionKey, clearedFields: [{id, recordRevision,
--    fieldKeys}]}`. Retrait de bloc et effacement tiennent dans la même déclaration et
--    la même transaction ; la comparaison avec le calcul serveur reste EXACTE.
-- 3. Application après les suppressions douces : journal `field_change_log` AVANT
--    l'effacement (ancienne valeur, nouvelle nulle, source `visibility_withdrawal`,
--    motif engendré qui nomme la variable pilote par son LIBELLÉ), puis retrait des
--    clés de `encounter.data`. Une occurrence que ses propres contrôles d'écriture
--    refusent arrête tout avec un code qui la nomme. Seul le contrôle d'obligation de
--    la version HISTORIQUE est levé pour un effacement seul (section 5) : sans cela,
--    une occurrence validée née dans une version qui exigeait la variable rendrait la
--    fiche patient impossible à corriger (une donnée validée ne repasse pas en brouillon).
-- 4. `guard_base_version_group_withdrawal` : un changement de version qui provoquerait
--    des effacements est refusé, avec des comptes seulement.
--
-- Aucun message, motif ou détail ne contient de valeur clinique : identifiants,
-- révisions, clés et libellés de structure seulement.
--
-- Retour arrière : réappliquer le corps de 20261006120000 pour `assert_curated_complete`,
-- les corps de 20260924090000 pour
-- `guard_patient_group_withdrawal`, `guard_base_version_group_withdrawal`,
-- `patient_group_withdrawal_prepare` et `patient_group_withdrawal_commit`, puis
-- supprimer `patient_context_erasures`, `context_driven_field_keys` et
-- `patient_context_erasure_reason`. La contrainte de source peut rester (surensemble).
-- Les valeurs déjà effacées restent tracées dans `field_change_log` ; aucune
-- restauration automatique n'est prévue (§8).
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. Source de journal dédiée (même procédé que 20261005010000)
-- -----------------------------------------------------------------------------
-- Surensemble de la liste précédente : aucune ligne existante ne peut la violer.
alter table public.field_change_log drop constraint if exists field_change_log_source_check;
alter table public.field_change_log
  add constraint field_change_log_source_check
  check (source in ('direct_entry', 'curation_validation', 'curation_finalization',
                    'manual_correction', 'import', 'option_key_repair',
                    'field_deletion', 'option_retirement', 'visibility_withdrawal'))
  not valid;
alter table public.field_change_log validate constraint field_change_log_source_check;

-- -----------------------------------------------------------------------------
-- 2. Calcul des effacements
-- -----------------------------------------------------------------------------

-- Variables qu'un pilote permanent peut masquer dans cette version : cibles des règles
-- d'affichage dont le pilote est de portée `patient`, puis, par cascade, cibles des
-- règles pilotées par l'une d'elles. Une version sans règle de contexte rend un
-- ensemble vide : rien n'est calculé ensuite, et le comportement d'avant L74 reste
-- exact (toute version antérieure à L74a est dans ce cas, la règle y étant refusée).
create or replace function public.context_driven_field_keys(p_version uuid)
returns text[]
language sql stable set search_path = public, pg_temp as $$
  with recursive edge(driver, target) as (
    select vr.rule -> 'if' ->> 'field', vr.rule -> 'then' ->> 'field'
      from public.validation_rule vr
     where vr.template_version_id = p_version
       and (vr.rule -> 'then' ->> 'operator') = 'visible'
       and nullif(vr.rule -> 'if' ->> 'field', '') is not null
       and nullif(vr.rule -> 'then' ->> 'field', '') is not null
    union all
    select vr.rule -> 'if' ->> 'field', sf.field_key
      from public.validation_rule vr
      cross join lateral public.template_section_field_keys(p_version, vr.rule -> 'then' ->> 'section') sf
     where vr.template_version_id = p_version
       and (vr.rule -> 'then' ->> 'operator') = 'visible'
       and nullif(vr.rule -> 'if' ->> 'field', '') is not null
       and nullif(vr.rule -> 'then' ->> 'field', '') is null
       and nullif(vr.rule -> 'then' ->> 'section', '') is not null
  ),
  reach(key) as (
    select e.target
      from edge e
      join public.template_field tf
        on tf.template_version_id = p_version and tf.field_key = e.driver and tf.scope = 'patient'
    union
    select e.target from edge e join reach r on r.key = e.driver
  )
  select coalesce(array_agg(key order by key), '{}'::text[]) from reach;
$$;
revoke all on function public.context_driven_field_keys(uuid) from public, anon, authenticated;

-- Effacements qu'impose le passage de (ancienne version, ancienne fiche) à (nouvelle
-- version, nouvelle fiche). Forme rendue, triée par groupe puis par identifiant :
--   [{"sectionKey": "g", "count": 2,
--     "clearedFields": [{"id": "<uuid>", "recordRevision": 3, "fieldKeys": ["k1", "k2"]}]}]
-- Une variable est effacée si elle est renseignée (clé présente, valeur non nulle),
-- masquée avec la nouvelle fiche et visible avec l'ancienne : une valeur déjà masquée
-- avant l'écriture n'est pas comptée, l'écriture ne la masque pas (même règle que D10
-- pour les blocs). Les groupes de `p_excluded` (retirés avec leur bloc) sont ignorés.
-- Rend des identifiants, des révisions et des clés, jamais une valeur.
create or replace function public.patient_context_erasures(
  p_patient_id uuid,
  p_old_version_id uuid,
  p_old_data jsonb,
  p_new_version_id uuid,
  p_new_data jsonb,
  p_excluded text[] default '{}'::text[]
) returns jsonb
language plpgsql stable set search_path = public, pg_temp as $$
declare
  v_reach text[] := public.context_driven_field_keys(p_new_version_id);
  v_occurrence record;
  v_new_hidden text[];
  v_old_hidden text[];
  v_keys text[];
  v_groups jsonb := '{}'::jsonb;
  v_result jsonb;
begin
  if cardinality(v_reach) = 0 then return '[]'::jsonb; end if;

  for v_occurrence in
    select e.id, e.record_revision, e.group_section_key, coalesce(e.data, '{}'::jsonb) as data
      from public.encounter e
     where e.patient_id = p_patient_id
       and e.group_section_key is not null
       and e.deleted_at is null
       and not (e.group_section_key = any(coalesce(p_excluded, '{}'::text[])))
     order by e.group_section_key, e.id
  loop
    -- Filtre bon marché : aucune valeur atteignable par le contexte, rien à évaluer.
    continue when not exists (
      select 1 from jsonb_each(v_occurrence.data) k
       where k.key = any(v_reach) and k.value <> 'null'::jsonb);

    v_new_hidden := coalesce(public.visibility_hidden_fields(p_new_version_id,
      public.occurrence_evaluation_data(p_new_version_id, p_new_data, v_occurrence.data)), '{}'::text[]);
    select array_agg(k.key order by k.key) into v_keys
      from jsonb_each(v_occurrence.data) k
     where k.key = any(v_reach) and k.key = any(v_new_hidden) and k.value <> 'null'::jsonb;
    continue when v_keys is null;

    v_old_hidden := coalesce(public.visibility_hidden_fields(p_old_version_id,
      public.occurrence_evaluation_data(p_old_version_id, p_old_data, v_occurrence.data)), '{}'::text[]);
    select array_agg(k order by k) into v_keys
      from unnest(v_keys) k where not (k = any(v_old_hidden));
    continue when v_keys is null;

    v_groups := jsonb_set(v_groups, array[v_occurrence.group_section_key],
      coalesce(v_groups -> v_occurrence.group_section_key, '[]'::jsonb)
        || jsonb_build_array(jsonb_build_object(
             'id', v_occurrence.id,
             'recordRevision', v_occurrence.record_revision,
             'fieldKeys', to_jsonb(v_keys))));
  end loop;

  select coalesce(jsonb_agg(jsonb_build_object(
           'sectionKey', g.key,
           'count', jsonb_array_length(g.value),
           'clearedFields', g.value) order by g.key), '[]'::jsonb)
    into v_result
    from jsonb_each(v_groups) g;
  return v_result;
end $$;
revoke all on function public.patient_context_erasures(uuid, uuid, jsonb, uuid, jsonb, text[])
  from public, anon, authenticated;

-- Motif engendré d'un effacement dans un groupe : il nomme, par leur LIBELLÉ, les
-- variables permanentes qui pilotent l'affichage d'une variable du groupe et dont la
-- valeur affichée a changé (une valeur masquée sur la fiche vaut absente). Jamais une
-- valeur clinique. Si aucun pilote n'est identifiable, le motif reste générique.
create or replace function public.patient_context_erasure_reason(
  p_version_id uuid,
  p_group_section_key text,
  p_old_data jsonb,
  p_new_data jsonb
) returns text
language plpgsql stable set search_path = public, pg_temp as $$
declare
  v_old jsonb := coalesce(p_old_data, '{}'::jsonb);
  v_new jsonb := coalesce(p_new_data, '{}'::jsonb);
  v_old_hidden text[] := coalesce(public.visibility_hidden_fields(p_version_id, v_old), '{}'::text[]);
  v_new_hidden text[] := coalesce(public.visibility_hidden_fields(p_version_id, v_new), '{}'::text[]);
  v_labels text;
begin
  select string_agg(d.label, ', ' order by d.label) into v_labels
    from (
      select distinct coalesce(nullif(btrim(driver.label), ''), driver.field_key) as label
        from public.validation_rule vr
        join public.template_field driver
          on driver.template_version_id = p_version_id
         and driver.field_key = vr.rule -> 'if' ->> 'field'
         and driver.scope = 'patient'
        join public.template_field target
          on target.template_version_id = p_version_id
         and target.field_key = vr.rule -> 'then' ->> 'field'
        join public.template_section s
          on s.template_version_id = p_version_id
         and s.section_key = p_group_section_key
         and (target.section_id = s.id or target.section = s.section_key)
       where vr.template_version_id = p_version_id
         and (vr.rule -> 'then' ->> 'operator') = 'visible'
         and (case when driver.field_key = any(v_old_hidden) then null else v_old -> driver.field_key end)
             is distinct from
             (case when driver.field_key = any(v_new_hidden) then null else v_new -> driver.field_key end)
    ) d;
  if v_labels is null then
    return 'Variable masquée par la fiche patient : valeur effacée avec l''enregistrement de la fiche';
  end if;
  return format('Variable masquée par « %s » : valeur effacée avec l''enregistrement de la fiche', v_labels);
end $$;
revoke all on function public.patient_context_erasure_reason(uuid, text, jsonb, jsonb)
  from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 3. Gardes : tout chemin non déclaré est refusé
-- -----------------------------------------------------------------------------

-- guard_patient_group_withdrawal : corps de 20260924090000. Les effacements s'ajoutent
-- au calcul ; le détail porte `clearedFields` quand il y en a (le détail d'un retrait
-- seul est inchangé). Import, curation, réparation des clés et brouillon de travail
-- passent par ce déclencheur sans être redéfinis : un effacement non déclaré y est
-- refusé, rien n'est écrit.
create or replace function public.guard_patient_group_withdrawal()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_version_id uuid;
  v_groups jsonb;
  v_cleared jsonb;
begin
  if new.data is not distinct from old.data or new.deleted_at is not null then return new; end if;
  if not exists (
    select 1 from public.encounter e
     where e.patient_id = new.id and e.group_section_key is not null and e.deleted_at is null
  ) then
    return new;
  end if;
  if current_setting('app.group_withdrawal_patient', true) = new.id::text then return new; end if;

  select b.current_template_version_id into v_version_id
    from public.base b where b.id = new.base_id for share;
  v_version_id := coalesce(v_version_id, new.template_version_id);
  v_groups := public.patient_group_withdrawals(new.id, v_version_id, old.data, v_version_id, new.data);
  v_cleared := public.patient_context_erasures(new.id, v_version_id, old.data, v_version_id, new.data,
    array(select g.value ->> 'sectionKey' from jsonb_array_elements(v_groups) g));
  if jsonb_array_length(v_groups) > 0 or jsonb_array_length(v_cleared) > 0 then
    perform public.group_withdrawal_error('GROUP_WITHDRAWAL_REQUIRED',
      jsonb_build_object('groups', v_groups)
        || case when jsonb_array_length(v_cleared) > 0
                then jsonb_build_object('clearedFields', v_cleared) else '{}'::jsonb end);
  end if;
  return new;
end $$;
revoke all on function public.guard_patient_group_withdrawal() from public, anon, authenticated;

-- guard_base_version_group_withdrawal : corps de 20260924090000. Un changement de
-- version ne se déclare pas fiche par fiche : il est refusé dès qu'il masquerait un
-- bloc OU effacerait une valeur d'occurrence. Comptes seulement ; les clés de détail
-- d'un refus de bloc seul sont inchangées.
create or replace function public.guard_base_version_group_withdrawal()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_patient record;
  v_groups jsonb;
  v_cleared jsonb;
  v_patients integer := 0;
  v_occurrences integer := 0;
  v_cleared_occurrences integer := 0;
  v_cleared_values integer := 0;
  v_keys text[] := '{}';
  v_cleared_keys text[] := '{}';
  v_group jsonb;
begin
  if new.current_template_version_id is not distinct from old.current_template_version_id
     or old.current_template_version_id is null
     or new.deleted_at is not null then
    return new;
  end if;

  for v_patient in
    select p.id, p.data
      from public.patient p
     where p.base_id = new.id
       and p.deleted_at is null
       and exists (
         select 1 from public.encounter e
          where e.patient_id = p.id and e.group_section_key is not null and e.deleted_at is null
       )
     order by p.id
  loop
    v_groups := public.patient_group_withdrawals(
      v_patient.id, old.current_template_version_id, v_patient.data,
      new.current_template_version_id, v_patient.data);
    v_cleared := public.patient_context_erasures(
      v_patient.id, old.current_template_version_id, v_patient.data,
      new.current_template_version_id, v_patient.data,
      array(select g.value ->> 'sectionKey' from jsonb_array_elements(v_groups) g));
    if jsonb_array_length(v_groups) > 0 or jsonb_array_length(v_cleared) > 0 then
      v_patients := v_patients + 1;
      for v_group in select value from jsonb_array_elements(v_groups) loop
        v_occurrences := v_occurrences + (v_group ->> 'count')::integer;
        if not (v_group ->> 'sectionKey') = any(v_keys) then
          v_keys := v_keys || (v_group ->> 'sectionKey');
        end if;
      end loop;
      for v_group in select value from jsonb_array_elements(v_cleared) loop
        v_cleared_occurrences := v_cleared_occurrences + (v_group ->> 'count')::integer;
        v_cleared_values := v_cleared_values + (
          select coalesce(sum(jsonb_array_length(c.value -> 'fieldKeys')), 0)::integer
            from jsonb_array_elements(v_group -> 'clearedFields') c);
        if not (v_group ->> 'sectionKey') = any(v_cleared_keys) then
          v_cleared_keys := v_cleared_keys || (v_group ->> 'sectionKey');
        end if;
      end loop;
    end if;
  end loop;

  if v_patients > 0 then
    perform public.group_withdrawal_error('GROUP_WITHDRAWAL_VERSION_REFUSED',
      jsonb_build_object('patients', v_patients, 'occurrences', v_occurrences,
        'sectionKeys', to_jsonb(v_keys))
      || case when v_cleared_occurrences > 0
              then jsonb_build_object('clearedOccurrences', v_cleared_occurrences,
                     'clearedValues', v_cleared_values,
                     'clearedSectionKeys', to_jsonb(v_cleared_keys))
              else '{}'::jsonb end);
  end if;
  return new;
end $$;
revoke all on function public.guard_base_version_group_withdrawal() from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 4. Déclaration : contrôle avant écriture, comparaison exacte et application après
-- -----------------------------------------------------------------------------

-- patient_group_withdrawal_prepare : corps de 20260924090000. Forme attendue, une
-- entrée par groupe, avec EXACTEMENT l'une des deux listes :
--   [{"sectionKey": "g1", "occurrences": [{"id": "<uuid>", "recordRevision": 3}]},
--    {"sectionKey": "g2", "clearedFields": [{"id": "<uuid>", "recordRevision": 2,
--                                            "fieldKeys": ["ao", "ao_detail"]}]}]
-- Une occurrence n'apparaît qu'une fois dans toute la déclaration. Permission et
-- verrous inchangés : fiche `for update` puis TOUTES les occurrences vivantes du
-- patient, qu'elles soient retirées, effacées ou non touchées. Rend la déclaration
-- normalisée : groupes triés par clé, occurrences par identifiant, clés triées.
create or replace function public.patient_group_withdrawal_prepare(
  p_patient_id uuid,
  p_declared jsonb
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_base_id uuid;
  v_group jsonb;
  v_item jsonb;
  v_list jsonb;
  v_keys text[] := '{}';
  v_ids uuid[] := '{}';
  v_field_keys text[];
  v_field_key jsonb;
  v_cleared boolean;
  v_normalized jsonb;
begin
  if p_declared is null or jsonb_typeof(p_declared) <> 'array' then
    perform public.group_withdrawal_error('GROUP_WITHDRAWAL_INVALID', '{}'::jsonb);
  end if;
  for v_group in select value from jsonb_array_elements(p_declared) loop
    if jsonb_typeof(v_group) <> 'object'
       or jsonb_typeof(v_group -> 'sectionKey') is distinct from 'string'
       or nullif(btrim(v_group ->> 'sectionKey'), '') is null
       or (v_group ->> 'sectionKey') = any(v_keys)
       or ((v_group ? 'occurrences') = (v_group ? 'clearedFields')) then
      perform public.group_withdrawal_error('GROUP_WITHDRAWAL_INVALID', '{}'::jsonb);
    end if;
    v_cleared := v_group ? 'clearedFields';
    v_list := case when v_cleared then v_group -> 'clearedFields' else v_group -> 'occurrences' end;
    if jsonb_typeof(v_list) is distinct from 'array' or jsonb_array_length(v_list) = 0 then
      perform public.group_withdrawal_error('GROUP_WITHDRAWAL_INVALID', '{}'::jsonb);
    end if;
    for v_item in select value from jsonb_array_elements(v_list) loop
      if jsonb_typeof(v_item) <> 'object'
         or jsonb_typeof(v_item -> 'id') is distinct from 'string'
         or (v_item ->> 'id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
         or jsonb_typeof(v_item -> 'recordRevision') is distinct from 'number'
         or (v_item ->> 'recordRevision') !~ '^[1-9][0-9]{0,17}$'
         or (v_item ->> 'id')::uuid = any(v_ids) then
        perform public.group_withdrawal_error('GROUP_WITHDRAWAL_INVALID', '{}'::jsonb);
      end if;
      if v_cleared then
        if jsonb_typeof(v_item -> 'fieldKeys') is distinct from 'array'
           or jsonb_array_length(v_item -> 'fieldKeys') = 0 then
          perform public.group_withdrawal_error('GROUP_WITHDRAWAL_INVALID', '{}'::jsonb);
        end if;
        v_field_keys := '{}';
        for v_field_key in select value from jsonb_array_elements(v_item -> 'fieldKeys') loop
          if jsonb_typeof(v_field_key) is distinct from 'string'
             or nullif(btrim(v_field_key #>> '{}'), '') is null
             or (v_field_key #>> '{}') = any(v_field_keys) then
            perform public.group_withdrawal_error('GROUP_WITHDRAWAL_INVALID', '{}'::jsonb);
          end if;
          v_field_keys := v_field_keys || (v_field_key #>> '{}');
        end loop;
      end if;
      v_ids := v_ids || (v_item ->> 'id')::uuid;
    end loop;
    v_keys := v_keys || (v_group ->> 'sectionKey');
  end loop;

  select base_id into v_base_id from public.patient
   where id = p_patient_id and deleted_at is null for update;
  -- Retirer une occurrence reste l'acte de `soft_delete_encounter`, en effacer une
  -- valeur celui d'une correction : même permission d'écriture structurée, contrôlée
  -- avant toute lecture des occurrences.
  if v_base_id is null or not public.can_edit_structured_data(v_base_id) then
    perform public.group_withdrawal_error('GROUP_WITHDRAWAL_FORBIDDEN', '{}'::jsonb);
  end if;

  perform 1 from public.encounter e
   where e.patient_id = p_patient_id and e.group_section_key is not null and e.deleted_at is null
   order by e.id
     for update;

  select coalesce(jsonb_agg(
           case when g.value ? 'clearedFields' then jsonb_build_object(
             'sectionKey', g.value ->> 'sectionKey',
             'clearedFields', (
               select jsonb_agg(jsonb_build_object(
                        'id', (c.value ->> 'id')::uuid,
                        'recordRevision', (c.value ->> 'recordRevision')::bigint,
                        'fieldKeys', (select jsonb_agg(k.value order by k.value)
                                        from jsonb_array_elements_text(c.value -> 'fieldKeys') k))
                      order by (c.value ->> 'id')::uuid)
                 from jsonb_array_elements(g.value -> 'clearedFields') c))
           else jsonb_build_object(
             'sectionKey', g.value ->> 'sectionKey',
             'occurrences', (
               select jsonb_agg(jsonb_build_object(
                        'id', (o.value ->> 'id')::uuid,
                        'recordRevision', (o.value ->> 'recordRevision')::bigint)
                      order by (o.value ->> 'id')::uuid)
                 from jsonb_array_elements(g.value -> 'occurrences') o))
           end
         order by g.value ->> 'sectionKey'), '[]'::jsonb)
    into v_normalized
    from jsonb_array_elements(p_declared) g;
  return v_normalized;
end $$;
revoke all on function public.patient_group_withdrawal_prepare(uuid, jsonb) from public, anon, authenticated;

-- patient_group_withdrawal_commit : corps de 20260924090000. Après l'écriture de la
-- fiche, retraits ET effacements doivent être EXACTEMENT ceux déclarés ; toute
-- divergence (occurrence ajoutée, corrigée ou supprimée, variable en plus ou en moins,
-- groupe en trop ou manquant) donne un conflit qui annule toute la transaction, fiche
-- comprise. Puis, dans cet ordre :
--   1. suppressions douces des occurrences retirées avec leur bloc (inchangé) ;
--   2. pour chaque occurrence à effacer : journal AVANT effacement (une ligne par
--      variable, source `visibility_withdrawal`), puis retrait des clés. L'écriture de
--      l'occurrence rejoue ses contrôles ; si l'un la refuse (occurrence ancienne ou
--      incohérente), l'enregistrement s'arrête avec `GROUP_WITHDRAWAL_OCCURRENCE_BLOCKED`
--      qui nomme le groupe et l'occurrence, sans relayer le message interne.
create or replace function public.patient_group_withdrawal_commit(
  p_patient_id uuid,
  p_old_data jsonb,
  p_declared jsonb
) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_patient public.patient;
  v_version_id uuid;
  v_actual jsonb;
  v_cleared jsonb;
  v_expected jsonb;
  v_group jsonb;
  v_item jsonb;
  v_key text;
  v_block_key text;
  v_label text;
  v_reason text;
  v_id uuid;
  v_fields text[];
begin
  select * into v_patient from public.patient where id = p_patient_id;
  select b.current_template_version_id into v_version_id
    from public.base b where b.id = v_patient.base_id for share;
  v_version_id := coalesce(v_version_id, v_patient.template_version_id);
  v_actual := public.patient_group_withdrawals(
    p_patient_id, v_version_id, p_old_data, v_version_id, v_patient.data);
  v_cleared := public.patient_context_erasures(
    p_patient_id, v_version_id, p_old_data, v_version_id, v_patient.data,
    array(select a.value ->> 'sectionKey' from jsonb_array_elements(v_actual) a));

  select coalesce(jsonb_agg(x.entry order by x.section_key), '[]'::jsonb) into v_expected
    from (
      select a.value ->> 'sectionKey' as section_key,
             jsonb_build_object('sectionKey', a.value ->> 'sectionKey',
                                'occurrences', a.value -> 'occurrences') as entry
        from jsonb_array_elements(v_actual) a
      union all
      select c.value ->> 'sectionKey',
             jsonb_build_object('sectionKey', c.value ->> 'sectionKey',
                                'clearedFields', c.value -> 'clearedFields')
        from jsonb_array_elements(v_cleared) c
    ) x;

  if v_expected is distinct from p_declared then
    perform public.group_withdrawal_error('GROUP_WITHDRAWAL_CONFLICT',
      jsonb_build_object('groups', v_actual)
        || case when jsonb_array_length(v_cleared) > 0
                then jsonb_build_object('clearedFields', v_cleared) else '{}'::jsonb end);
  end if;

  for v_group in select value from jsonb_array_elements(v_actual) loop
    v_key := v_group ->> 'sectionKey';
    v_block_key := v_group ->> 'blockKey';
    select nullif(btrim(s.label), '') into v_label
      from public.template_section s
     where s.template_version_id = v_version_id and s.section_key = v_block_key;
    v_reason := format('Retrait du bloc « %s » : occurrence supprimée avec l''enregistrement de la fiche',
      coalesce(v_label, v_block_key));
    for v_item in select value from jsonb_array_elements(v_group -> 'occurrences') loop
      v_id := (v_item ->> 'id')::uuid;
      update public.encounter
         set deleted_at = now(), deleted_by = auth.uid(), deletion_reason = v_reason
       where id = v_id and deleted_at is null;
      perform public.log_audit('encounter_deleted', 'encounter', v_id, v_patient.base_id,
        jsonb_build_object('justification_status', 'generated', 'reason', v_reason,
          'withdrawal', true, 'group_section_key', v_key, 'block_key', v_block_key));
    end loop;
  end loop;

  for v_group in select value from jsonb_array_elements(v_cleared) loop
    v_key := v_group ->> 'sectionKey';
    v_reason := public.patient_context_erasure_reason(v_version_id, v_key, p_old_data, v_patient.data);
    for v_item in select value from jsonb_array_elements(v_group -> 'clearedFields') loop
      v_id := (v_item ->> 'id')::uuid;
      v_fields := array(select jsonb_array_elements_text(v_item -> 'fieldKeys'));
      -- Journal AVANT effacement : l'ancienne valeur est lue sur la ligne verrouillée.
      insert into public.field_change_log
        (base_id, entity, entity_id, field_key, old_value, new_value, changed_by, reason, source)
      select v_patient.base_id, 'encounter', e.id, k.key, e.data -> k.key, null, auth.uid(),
             v_reason, 'visibility_withdrawal'
        from public.encounter e
        cross join lateral unnest(v_fields) as k(key)
       where e.id = v_id
       order by k.key;
      perform set_config('app.context_erasure_encounter', v_id::text, true);
      begin
        update public.encounter
           set data = data - v_fields
         where id = v_id and deleted_at is null;
      exception when raise_exception or check_violation or not_null_violation then
        perform public.group_withdrawal_error('GROUP_WITHDRAWAL_OCCURRENCE_BLOCKED',
          jsonb_build_object('sectionKey', v_key, 'id', v_id));
      end;
      perform set_config('app.context_erasure_encounter', '', true);
    end loop;
  end loop;
end $$;
revoke all on function public.patient_group_withdrawal_commit(uuid, jsonb, jsonb) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 5. Écriture d'un effacement : seul le contrôle d'obligation historique est levé
-- -----------------------------------------------------------------------------

-- assert_curated_complete : corps de 20261006120000 (L74a). Une seule différence : la
-- branche occurrence reconnaît l'effacement déclaré (réglage local à la transaction,
-- posé par `patient_group_withdrawal_commit` pour CETTE occurrence, et écriture qui
-- ne fait que retirer des clés) et ne rejoue pas alors `assert_required_complete` sur
-- la version historique. Valeurs masquées, valeurs connues, validation des valeurs et
-- règles bloquantes sont rejouées comme avant. Le réglage n'ouvre rien d'autre :
-- aucune fonction exposée ne permet à un compte de le poser, et une écriture qui
-- modifierait ou ajouterait une valeur, ou changerait le statut, n'est pas reconnue.
create or replace function public.assert_curated_complete()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_scope text := case when tg_table_name = 'patient' then 'patient' else 'encounter' end;
  v_base_id uuid;
  v_active_version uuid;
  v_historical_version uuid := new.template_version_id;
  v_patient_data jsonb;
  v_historical_eval jsonb := new.data;
  v_active_eval jsonb := new.data;
  v_old_eval jsonb;
  v_context_erasure boolean := false;
begin
  if v_scope = 'patient' then
    v_base_id := new.base_id;
  else
    v_base_id := public.base_of_patient(new.patient_id);
  end if;

  select b.current_template_version_id into v_active_version
    from public.base b
   where b.id = v_base_id and b.deleted_at is null;
  v_active_version := coalesce(v_active_version, v_historical_version);

  if tg_op = 'UPDATE' then v_old_eval := old.data; end if;
  -- `new.group_section_key` n'existe que sur une rencontre : test imbriqué.
  if v_scope = 'encounter' then
    if new.group_section_key is not null then
      if tg_op = 'UPDATE' and old.deleted_at is null and new.deleted_at is not null
         and new.data is not distinct from old.data
         and new.validation_status is not distinct from old.validation_status then
        return new;
      end if;
      -- L74b : effacement déclaré d'une valeur masquée par la fiche. Reconnu seulement si
      -- l'écriture RETIRE des clés sans rien changer d'autre (données restantes, statut).
      v_context_erasure := tg_op = 'UPDATE'
        and coalesce(current_setting('app.context_erasure_encounter', true) = new.id::text, false)
        and old.deleted_at is null and new.deleted_at is null
        and new.validation_status is not distinct from old.validation_status
        and jsonb_typeof(old.data) = 'object' and jsonb_typeof(new.data) = 'object'
        and new.data = old.data - array(
              select k from jsonb_object_keys(old.data) k where not (new.data ? k));
      v_context_erasure := coalesce(v_context_erasure, false);
      select p.data into v_patient_data
        from public.patient p where p.id = new.patient_id for share;
      v_historical_eval := public.occurrence_evaluation_data(v_historical_version, v_patient_data, new.data);
      v_active_eval := public.occurrence_evaluation_data(v_active_version, v_patient_data, new.data);
      if tg_op = 'UPDATE' then
        v_old_eval := public.occurrence_evaluation_data(v_active_version, v_patient_data, old.data);
      end if;
    end if;
  end if;

  if tg_op = 'INSERT' then
    -- Les controles historiques restent inchanges pour une nouvelle fiche et
    -- gardent les codes d'erreur attendus par les clients actuels.
    perform public.assert_block_hidden_values(v_historical_version, v_scope, v_historical_eval);
    perform public.assert_contains_any_hidden_values(v_historical_version, v_scope, v_historical_eval);
  else
    -- Une valeur historique masquee peut rester en place tant qu'elle n'est pas
    -- reecrite par le chemin de complement E3.
    perform public.form_record_assert_no_changed_hidden_values(
      v_active_version, v_scope, v_old_eval, v_active_eval
    );
  end if;

  perform public.form_record_assert_known_data(
    v_historical_version, v_active_version, v_scope, new.data
  );

  -- Les validations de valeur restent liees au statut clinique final. Les
  -- RPC de complement ont deja valide le patch et ne revalident pas une valeur
  -- historique absente de la definition active comme si elle etait nouvelle.
  if new.validation_status = 'curated' then
    perform public.assert_data_valid(v_historical_version, v_scope, new.data);
    if v_active_version is distinct from v_historical_version then
      perform public.assert_data_valid(v_active_version, v_scope, new.data);
    end if;
  end if;

  -- Les obligations de la fiche restent celles de sa revision historique.
  -- Les nouveaux requis sont exposes dans le contexte comme obligations
  -- courantes, sans transformer retrospectivement complete/curated en erreur.
  -- L74b : un effacement déclaré ne rejoue pas les obligations de la version
  -- historique. Une occurrence née dans une version qui exigeait la variable, sans
  -- règle de contexte, ne peut sinon jamais perdre une valeur que la version active
  -- masque ; validée, elle ne peut pas non plus repasser en brouillon : la fiche
  -- patient resterait impossible à corriger. Tous les autres contrôles restent.
  if new.validation_status <> 'draft' and not v_context_erasure then
    if v_scope = 'patient' then
      perform public.assert_required_complete(v_historical_version, 'patient', new.data);
    else
      perform public.assert_required_complete(
        v_historical_version, 'encounter', v_historical_eval, new.encounter_type, new.group_section_key
      );
    end if;
  end if;

  if new.validation_status = 'curated' then
    perform public.assert_validation_rules(
      v_historical_version, new.data,
      public.visibility_hidden_fields(v_historical_version, v_historical_eval)
    );
    -- Pour une fiche nee dans la definition active, le filet historique reste
    -- strict. Pour une fiche ancienne, une valeur masquee preexistante ne doit
    -- pas etre effacee pour rendre la nouvelle definition lisible.
    if v_active_version is not distinct from v_historical_version then
      perform public.assert_no_hidden_values(v_historical_version, v_scope, v_historical_eval);
    end if;
  end if;
  return new;
end
$$;
revoke all on function public.assert_curated_complete() from public, anon, authenticated;

notify pgrst, 'reload schema';
commit;
