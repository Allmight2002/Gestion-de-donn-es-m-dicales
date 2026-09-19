-- L66: repeatable root groups, no clinical data rewrite.
-- Forward recovery uses another additive migration preserving group identity.
begin;
alter table public.template_section add column is_repeatable boolean not null default false;
alter table public.template_section add constraint template_section_repeatable_root_only
  check (not is_repeatable or parent_section_id is null);
alter table public.encounter add column group_section_key text;
alter table public.encounter alter column encounter_date drop not null;
alter table public.encounter add constraint encounter_date_required_outside_groups
  check (encounter_date is not null or group_section_key is not null);
create index encounter_patient_group_idx on public.encounter(patient_id, group_section_key);


create or replace function public.guard_template_section_write()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_version uuid := coalesce(new.template_version_id, old.template_version_id);
begin
  -- The parent row is absent only during an explicit version/template cascade.
  perform 1 from public.template_version where id = v_version for update;
  if not found and tg_op = 'DELETE' then return old; end if;
  -- L58 : effacement de provenance par `on delete set null`. Rien d'autre ne bouge, la
  -- version cible n'est pas modifiee au sens du gel.
  if tg_op = 'UPDATE'
     and old.source_template_version_id is not null
     and new.source_template_version_id is null
     and not exists (select 1 from public.template_version where id = old.source_template_version_id)
     and (to_jsonb(new) - 'source_template_version_id')
         is not distinct from (to_jsonb(old) - 'source_template_version_id') then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.is_repeatable is distinct from old.is_repeatable
     and public.template_version_in_use(v_version) then
    raise exception 'Version deja utilisee : creez une nouvelle version';
  end if;
  if tg_op <> 'DELETE' then
    if new.is_repeatable and new.parent_section_id is not null then
      raise exception 'Un groupe répétable est un bloc racine';
    end if;
    if (new.is_repeatable and exists (
          select 1 from public.template_section where parent_section_id = new.id))
       or exists (select 1 from public.template_section
                  where id = new.parent_section_id and is_repeatable) then
      raise exception 'Un groupe répétable n''accepte pas de sous-section';
    end if;
    if new.is_repeatable and exists (
      select 1 from public.template_field f where f.template_version_id = v_version
        and (f.section_id = new.id or f.section = new.section_key) and f.scope <> 'encounter'
    ) then
      raise exception 'Un groupe répétable ne contient que des variables de rencontre';
    end if;
    -- L66 §6.5, sens inverse : un bloc deja cible d'une regle ne devient pas repetable,
    -- sinon la version porterait l'etat que §6.5 interdit d'atteindre par l'autre bord.
    if new.is_repeatable and exists (
      select 1 from public.validation_rule r where r.template_version_id = v_version
        and r.rule #>> '{then,section}' = new.section_key
    ) then
      raise exception 'Regle d''affichage : un groupe repetable ne peut pas etre la cible d''une regle';
    end if;
  end if;
  if auth.uid() is not null and public.template_version_locked(v_version) then
    raise exception 'Version publiee/archivee immuable : creez une nouvelle version du jeu de variables';
  end if;
  if tg_op = 'UPDATE' then
    if new.section_key is distinct from old.section_key then
      raise exception 'Le code interne d''une section ne se modifie pas : renommez son libelle.';
    end if;
    if new.template_version_id is distinct from old.template_version_id then
      raise exception 'Une section ne change pas de version de jeu de variables';
    end if;
    if new.parent_section_id is distinct from old.parent_section_id
       and public.template_version_in_use(v_version) then
      raise exception 'Version deja utilisee : creez une nouvelle version';
    end if;
  end if;
  if tg_op = 'DELETE' or (tg_op = 'UPDATE' and old.parent_section_id is null and new.parent_section_id is not null) then
    if exists (select 1 from public.validation_rule r where r.template_version_id = v_version
               and r.rule #>> '{then,section}' = old.section_key) then
      raise exception 'Bloc % cible d''une regle : retirez d''abord la regle.', old.section_key;
    end if;
  end if;
  if tg_op = 'DELETE' then
    if exists (select 1 from public.template_field where section_id = old.id) then
      raise exception 'Section non vide : deplacez d''abord ses variables.';
    end if;
    return old;
  end if;
  if new.parent_section_id is not null then
    if new.parent_section_id = new.id then raise exception 'Auto-parente interdite'; end if;
    if not exists (select 1 from public.template_section p where p.id = new.parent_section_id
                   and p.template_version_id = v_version and p.parent_section_id is null) then
      raise exception 'Le parent doit etre un bloc de la meme version';
    end if;
    if exists (select 1 from public.template_section where parent_section_id = new.id) then
      raise exception 'Un bloc portant des sous-sections ne peut devenir une sous-section';
    end if;
  end if;
  return new;
end $$;


-- AFTER sees the canonical section link; serialize with section toggles.
create function public.guard_repeatable_field()
returns trigger language plpgsql security invoker set search_path = public, pg_temp as $$
begin
  perform 1 from public.template_version where id = new.template_version_id for update;
  if new.scope <> 'encounter' and exists (
    select 1 from public.template_section s where s.template_version_id = new.template_version_id
      and s.is_repeatable and (s.id = new.section_id or s.section_key = new.section)
  ) then
    raise exception 'Un groupe répétable ne contient que des variables de rencontre';
  end if;
  return new;
end $$;
revoke all on function public.guard_repeatable_field() from public, anon, authenticated;
create trigger trg_repeatable_field after insert or update on public.template_field
  for each row execute function public.guard_repeatable_field();

-- Active occurrences only; restore and insert acquire the same patient lock.
create function public.guard_repeatable_encounter()
returns trigger language plpgsql security invoker set search_path = public, pg_temp as $$
declare v_section public.template_section;
begin
  if tg_op = 'UPDATE' and new.group_section_key is distinct from old.group_section_key then
    raise exception 'Le groupe d''une rencontre ne se modifie pas';
  end if;
  if new.group_section_key is null then return new; end if;
  select * into v_section from public.template_section
    where template_version_id = new.template_version_id and section_key = new.group_section_key;
  if not found then raise exception 'Groupe inconnu pour cette version'; end if;
  if v_section.parent_section_id is not null then
    raise exception 'Un groupe répétable est un bloc racine';
  end if;
  if not v_section.is_repeatable then
    raise exception 'Ce bloc n''est pas un groupe répétable';
  end if;
  if tg_op = 'UPDATE' and (new.patient_id is distinct from old.patient_id
      or new.template_version_id is distinct from old.template_version_id) then
    raise exception 'Le groupe d''une rencontre ne se modifie pas';
  end if;
  new.encounter_type := 'autre';
  if new.encounter_date is null then
    new.age_value := null;
    new.age_unit := null;
  end if;
  if new.deleted_at is null and (tg_op = 'INSERT' or old.deleted_at is not null) then
    perform 1 from public.patient where id = new.patient_id for update;
    if (select count(*) from public.encounter
         where patient_id = new.patient_id and group_section_key = new.group_section_key
           and deleted_at is null and id <> new.id) >= 50 then
      raise exception 'Nombre maximal d''occurrences atteint pour ce groupe';
    end if;
  end if;
  return new;
end $$;
revoke all on function public.guard_repeatable_encounter() from public, anon, authenticated;
create trigger trg_repeatable_encounter before insert or update on public.encounter
  for each row execute function public.guard_repeatable_encounter();


-- Replace signatures: no ambiguous default-argument overloads.
drop function public.assert_required_complete(uuid, text, jsonb, text);
drop function public.missing_required_fields(uuid, text, jsonb, text);
drop function public.create_encounter(uuid, text, date, text, jsonb, text);


create or replace function public.missing_required_fields(
  p_version uuid, p_scope text, p_data jsonb, p_encounter_type text default null, p_group_section_key text default null
)
returns setof text language plpgsql stable set search_path = public, pg_temp as $$
declare
  v_keys   text[];
  v_labels text[];
  v_hidden text[];
begin
  select array_agg(f.field_key order by f.display_order, f.field_key),
         array_agg(coalesce(f.label, f.field_key) order by f.display_order, f.field_key)
    into v_keys, v_labels
    from public.template_field f
   where f.template_version_id = p_version
     and f.scope = p_scope
     and f.required = true
     -- L35 : une variable calculee n'est jamais reclamee -- rien n'y est saisi.
     and f.formula is null
     and (p_scope <> 'encounter' or (
         (p_group_section_key is not null and exists (
           select 1 from public.template_section_field_keys(p_version, p_group_section_key) k
            where k.field_key = f.field_key
         ))
         or (p_group_section_key is null and not exists (
           select 1 from public.template_section s
           cross join lateral public.template_section_field_keys(p_version, s.section_key) k
           where s.template_version_id = p_version and s.is_repeatable and k.field_key = f.field_key
         ) and (p_encounter_type is null or (f.encounter_types is null or cardinality(f.encounter_types) = 0 or p_encounter_type = any(f.encounter_types))))
       ))
     and (
       p_data is null
       or not (p_data ? f.field_key)
       or (p_data -> f.field_key) is null
       or jsonb_typeof(p_data -> f.field_key) = 'null'
       or (jsonb_typeof(p_data -> f.field_key) = 'string' and ((p_data -> f.field_key) #>> '{}') = '')
     );

  if v_keys is null then return; end if;

  v_hidden := public.visibility_hidden_fields(p_version, p_data);
  return query
    select v_labels[i]
      from generate_subscripts(v_keys, 1) as i
     where not (v_keys[i] = any(v_hidden));
end $$;

create or replace function public.assert_required_complete(
  p_version uuid, p_scope text, p_data jsonb, p_encounter_type text default null, p_group_section_key text default null
)
returns void language plpgsql stable set search_path = public, pg_temp as $$
declare v_label text;
begin
  select m into v_label
    from public.missing_required_fields(p_version, p_scope, p_data, p_encounter_type, p_group_section_key) as m
   limit 1;
  if v_label is not null then
    raise exception 'Champ requis manquant : %', v_label;
  end if;
end $$;

create or replace function public.base_completeness_stats(p_base_id uuid, p_mode text default 'historical')
returns jsonb
language sql stable security invoker set search_path = public, pg_temp as $$
  with current_tv as (
    select current_template_version_id as id from public.base where id = p_base_id
  ),
  values_by_field as (
    -- Historique : chaque patient est evalue contre SA version de gabarit.
    select 'historical'::text as mode, tf.template_version_id, tv.version_number,
           tf.field_key, tf.label, tf.scope, p.data -> tf.field_key as value
      from public.patient p
      join public.template_field tf on tf.template_version_id = p.template_version_id and tf.scope = 'patient'
      join public.template_version tv on tv.id = tf.template_version_id
     where p_mode in ('historical', 'both')
       and p.base_id = p_base_id and p.deleted_at is null
       and tf.formula is null

    union all

    select 'historical'::text as mode, tf.template_version_id, tv.version_number,
           tf.field_key, tf.label, tf.scope, e.data -> tf.field_key as value
      from public.encounter e
      join public.patient p on p.id = e.patient_id
      join public.template_field tf on tf.template_version_id = e.template_version_id and tf.scope = 'encounter'
      join public.template_version tv on tv.id = tf.template_version_id
     where p_mode in ('historical', 'both')
       and p.base_id = p_base_id and p.deleted_at is null and e.deleted_at is null
       and tf.formula is null
       and (
         (e.group_section_key is not null and exists (
           select 1 from public.template_section_field_keys(tf.template_version_id, e.group_section_key) k
            where k.field_key = tf.field_key
         ))
         or (e.group_section_key is null and not exists (
           select 1 from public.template_section s
           cross join lateral public.template_section_field_keys(tf.template_version_id, s.section_key) k
           where s.template_version_id = tf.template_version_id and s.is_repeatable and k.field_key = tf.field_key
         ) and (tf.encounter_types is null or cardinality(tf.encounter_types) = 0 or e.encounter_type = any(tf.encounter_types)))
       )

    union all

    -- Courant : vue d'harmonisation volontaire, appliquee au gabarit courant de la base.
    select 'current'::text as mode, tf.template_version_id, tv.version_number,
           tf.field_key, tf.label, tf.scope, p.data -> tf.field_key as value
      from current_tv c
      join public.template_version tv on tv.id = c.id
      join public.template_field tf on tf.template_version_id = c.id and tf.scope = 'patient'
      join public.patient p on p.base_id = p_base_id and p.deleted_at is null
     where p_mode in ('current', 'both')
       and tf.formula is null

    union all

    select 'current'::text as mode, tf.template_version_id, tv.version_number,
           tf.field_key, tf.label, tf.scope, e.data -> tf.field_key as value
      from current_tv c
      join public.template_version tv on tv.id = c.id
      join public.template_field tf on tf.template_version_id = c.id and tf.scope = 'encounter'
      join public.patient p on p.base_id = p_base_id and p.deleted_at is null
      join public.encounter e on e.patient_id = p.id and e.deleted_at is null
     where p_mode in ('current', 'both')
       and tf.formula is null
       and (
         (e.group_section_key is not null and exists (
           select 1 from public.template_section_field_keys(tf.template_version_id, e.group_section_key) k
            where k.field_key = tf.field_key
         ))
         or (e.group_section_key is null and not exists (
           select 1 from public.template_section s
           cross join lateral public.template_section_field_keys(tf.template_version_id, s.section_key) k
           where s.template_version_id = tf.template_version_id and s.is_repeatable and k.field_key = tf.field_key
         ) and (tf.encounter_types is null or cardinality(tf.encounter_types) = 0 or e.encounter_type = any(tf.encounter_types)))
       )
  ),
  grouped as (
    select mode, template_version_id, version_number, field_key, label, scope,
           count(*)::int as total,
           count(*) filter (where public.rule_value_present(value))::int as observed,
           count(*) filter (where public.value_missing_code(value))::int as missing_coded
      from values_by_field
     group by mode, template_version_id, version_number, field_key, label, scope
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'mode', mode,
      'templateVersionId', template_version_id,
      'versionNumber', version_number,
      'fieldKey', field_key,
      'label', label,
      'scope', scope,
      'observed', observed,
      'missingCoded', missing_coded,
      'filled', observed + missing_coded,
      'total', total
    ) order by
      case mode when 'historical' then 0 else 1 end,
      case when total = 0 then 2 else (observed + missing_coded)::numeric / total end,
      label,
      version_number), '[]'::jsonb)
  from grouped;
$$;

create or replace function public.export_incomplete_records(p_cohort_id uuid)
returns table (record_kind text, record_id uuid)
language sql stable set search_path = public, pg_temp as $$
  select 'patient'::text, p.id
    from public.cohort_member cm
    join public.patient p on p.id = cm.patient_id
   where cm.cohort_id = p_cohort_id
     and p.deleted_at is null
     and exists (
       select 1 from public.missing_required_fields(p.template_version_id, 'patient', p.data)
     )
  union
  select 'encounter'::text, e.id
    from public.encounter e
   where e.deleted_at is null
     and (
       e.id in (
         select cem.encounter_id from public.cohort_encounter_member cem
          where cem.cohort_id = p_cohort_id
       )
       or e.patient_id in (
         select cm.patient_id from public.cohort_member cm where cm.cohort_id = p_cohort_id
       )
     )
     and exists (
       select 1 from public.missing_required_fields(
         e.template_version_id, 'encounter', e.data, e.encounter_type, e.group_section_key
       )
     );
$$;

create or replace function public.create_encounter(
  p_patient_id        uuid,
  p_encounter_type    text,
  p_encounter_date    date,
  p_validation_status text,
  p_data              jsonb,
  p_age_unit          text default 'years',
  p_group_section_key text default null
) returns public.encounter
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_base uuid; v_code text; v_tv uuid; v_dob date; v_age numeric; v_unit text; v_enc public.encounter;
  v_status text;
  v_section public.template_section;
begin
  select base_id, patient_code into v_base, v_code
  from public.patient where id = p_patient_id and deleted_at is null for update;
  if v_base is null then raise exception 'Patient introuvable'; end if;
  if not public.can_create_structured_data(v_base) then raise exception 'Acces refuse'; end if;

  v_status := coalesce(p_validation_status, 'draft');
  -- Promouvoir directement en 'curated' est un acte de curation, pas de saisie :
  -- reserve a can_edit_structured_data (le medecin).
  if v_status = 'curated' and not public.can_edit_structured_data(v_base) then
    raise exception 'Acces refuse';
  end if;

  select current_template_version_id into v_tv from public.base where id = v_base;

  if p_group_section_key is not null then
    select * into v_section from public.template_section
      where template_version_id = v_tv and section_key = p_group_section_key;
    if not found then raise exception 'Groupe inconnu pour cette version'; end if;
    if v_section.parent_section_id is not null then
      raise exception 'Un groupe répétable est un bloc racine';
    end if;
    if not v_section.is_repeatable then
      raise exception 'Ce bloc n''est pas un groupe répétable';
    end if;
    p_encounter_type := 'autre';
    if (select count(*) from public.encounter where patient_id = p_patient_id
        and group_section_key = p_group_section_key and deleted_at is null) >= 50 then
      raise exception 'Nombre maximal d''occurrences atteint pour ce groupe';
    end if;
  end if;

  -- Re-validation SERVEUR (§5.4/§5.5) : memes bornes/listes/type que le moteur React.
  perform public.assert_data_valid(v_tv, 'encounter', coalesce(p_data, '{}'::jsonb) - 'age_at_encounter');
  -- Regle A : completude exigee des la sortie du brouillon ('complete'), pour tous
  -- les comptes. Regle B : compte de mission -> exigee a chaque enregistrement.
  if v_status <> 'draft' or not public.can_edit_structured_data(v_base) then
    perform public.assert_required_complete(v_tv, 'encounter', coalesce(p_data, '{}'::jsonb) - 'age_at_encounter', p_encounter_type, p_group_section_key);
  end if;

  v_unit := coalesce(p_age_unit, 'years');
  select date_of_birth into v_dob
  from public.patient_identity where base_id = v_base and patient_code = v_code and deleted_at is null;
  v_age := public.compute_age(v_dob, p_encounter_date, v_unit);

  insert into public.encounter
    (patient_id, template_version_id, encounter_type, encounter_date, age_value, age_unit,
     data, collection_mode, validation_status, created_by, group_section_key)
  values
    (p_patient_id, v_tv, p_encounter_type, p_encounter_date, v_age, case when v_age is not null then v_unit else null end,
     coalesce(p_data, '{}'::jsonb) - 'age_at_encounter', 'direct', v_status, auth.uid(), p_group_section_key)
  returning * into v_enc;

  return v_enc;
end $$;

create or replace function public.update_encounter(
  p_encounter_id uuid,
  p_data jsonb,
  p_validation_status text,
  p_reason text,
  p_expected_updated_at timestamptz default null
)
returns public.encounter
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_enc public.encounter;
  v_base uuid;
  v_code text;
  v_dob date;
  v_age numeric;
  v_active_version uuid;
  v_old jsonb;
  v_new jsonb;
  v_key text;
  v_reason text := nullif(btrim(p_reason), '');
  v_justification_status text;
  v_operation_id uuid := gen_random_uuid();
begin
  select * into v_enc
    from public.encounter
   where id = p_encounter_id and deleted_at is null
   for update;
  if not found then raise exception 'Rencontre introuvable'; end if;

  select base_id, patient_code into v_base, v_code
    from public.patient where id = v_enc.patient_id;
  if not public.can_edit_structured_data(v_base) then
    if not (
      public.can_create_structured_data(v_base)
      and v_enc.created_by = auth.uid()
      and v_enc.validation_status = 'draft'
      and coalesce(p_validation_status, v_enc.validation_status) in ('draft', 'complete')
    ) then
      raise exception 'Acces refuse';
    end if;
  end if;
  v_justification_status := public.form_justification_status(v_base, v_reason);

  if p_expected_updated_at is not null
     and date_trunc('milliseconds', v_enc.updated_at)
       is distinct from date_trunc('milliseconds', p_expected_updated_at) then
    raise exception using
      errcode = 'P0001',
      message = 'CONFLIT_VERSION : la rencontre a ete modifiee entre-temps',
      detail = jsonb_build_object(
        'code', 'conflict_version', 'entity', 'encounter', 'action', 'refresh_required'
      )::text,
      hint = 'refresh_required';
  end if;

  select b.current_template_version_id into v_active_version
    from public.base b where b.id = v_base and b.deleted_at is null;
  v_active_version := coalesce(v_active_version, v_enc.template_version_id);
  v_old := coalesce(v_enc.data, '{}'::jsonb);
  v_new := public.form_record_merge_legacy_payload(
    v_enc.template_version_id, v_active_version, 'encounter', v_old,
    coalesce(p_data, '{}'::jsonb) - 'age_at_encounter'
  );

  perform public.assert_block_hidden_values(v_active_version, 'encounter', v_new);
  perform public.assert_contains_any_hidden_values(v_active_version, 'encounter', v_new);
  perform public.form_record_assert_known_data(
    v_enc.template_version_id, v_active_version, 'encounter', v_new
  );
  perform public.assert_data_valid(v_enc.template_version_id, 'encounter', v_new);
  if v_active_version is distinct from v_enc.template_version_id then
    perform public.assert_data_valid(v_active_version, 'encounter', v_new);
  end if;
  if coalesce(p_validation_status, v_enc.validation_status) <> 'draft'
     or not public.can_edit_structured_data(v_base) then
    perform public.assert_required_complete(
      v_enc.template_version_id, 'encounter', v_new, v_enc.encounter_type, v_enc.group_section_key
    );
  end if;

  select pi.date_of_birth into v_dob
    from public.patient_identity pi
   where pi.base_id = v_base
     and pi.patient_code = v_code
     and pi.deleted_at is null;
  v_age := public.compute_age(v_dob, v_enc.encounter_date, coalesce(v_enc.age_unit, 'years'));

  for v_key in
    select key from (
      select jsonb_object_keys(v_old) as key
      union
      select jsonb_object_keys(v_new) as key
    ) keys
  loop
    if (v_old -> v_key) is distinct from (v_new -> v_key) then
      insert into public.field_change_log
        (base_id, entity, entity_id, field_key, old_value, new_value,
         changed_by, reason, justification_status, source)
      values
        (v_base, 'encounter', p_encounter_id, v_key, v_old -> v_key,
         v_new -> v_key, auth.uid(), v_reason, v_justification_status,
         'manual_correction');
    end if;
  end loop;

  update public.encounter
     set data = v_new,
         validation_status = coalesce(p_validation_status, v_enc.validation_status),
         age_value = v_age,
         updated_at = clock_timestamp()
   where id = p_encounter_id
   returning * into v_enc;

  for v_key in
    select key from (
      select jsonb_object_keys(v_old) as key
      union
      select jsonb_object_keys(v_new) as key
    ) keys
  loop
    if (v_old -> v_key) is distinct from (v_new -> v_key) then
      insert into public.record_field_provenance
        (record_kind, record_id, field_key, origin, captured_by, definition_revision,
         operation_id, value_fingerprint)
      values
        ('encounter', p_encounter_id, v_key,
         case when exists (
           select 1 from public.template_field h
            where h.template_version_id = v_enc.template_version_id
              and h.scope = 'encounter' and h.field_key = v_key
         ) then 'correction' else 'completion' end,
         auth.uid(),
         case when exists (
           select 1 from public.template_field h
            where h.template_version_id = v_enc.template_version_id
              and h.scope = 'encounter' and h.field_key = v_key
         ) then v_enc.template_version_id else v_active_version end,
         v_operation_id,
         public.form_record_value_fingerprint(v_enc.data -> v_key));
    end if;
  end loop;
  return v_enc;
end
$$;

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
     source_template_version_id, source_section_key, is_repeatable)
  select p_target_version_id, ts.section_key, ts.label, ts.display_order,
         ts.source_template_version_id, ts.source_section_key, ts.is_repeatable
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


revoke all on function public.missing_required_fields(uuid,text,jsonb,text,text) from public, anon;
grant execute on function public.missing_required_fields(uuid,text,jsonb,text,text) to authenticated, service_role;
revoke all on function public.assert_required_complete(uuid,text,jsonb,text,text) from public, anon;
grant execute on function public.assert_required_complete(uuid,text,jsonb,text,text) to authenticated, service_role;
revoke all on function public.create_encounter(uuid,text,date,text,jsonb,text,text) from public, anon;
grant execute on function public.create_encounter(uuid,text,date,text,jsonb,text,text) to authenticated;
-- Relay the stored group through the existing E3 write guards.
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

  if tg_op = 'INSERT' then
    -- Les controles historiques restent inchanges pour une nouvelle fiche et
    -- gardent les codes d'erreur attendus par les clients actuels.
    perform public.assert_block_hidden_values(v_historical_version, v_scope, new.data);
    perform public.assert_contains_any_hidden_values(v_historical_version, v_scope, new.data);
  else
    -- Une valeur historique masquee peut rester en place tant qu'elle n'est pas
    -- reecrite par le chemin de complement E3.
    perform public.form_record_assert_no_changed_hidden_values(
      v_active_version, v_scope, old.data, new.data
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
  if new.validation_status <> 'draft' then
    if v_scope = 'patient' then
      perform public.assert_required_complete(v_historical_version, 'patient', new.data);
    else
      perform public.assert_required_complete(
        v_historical_version, 'encounter', new.data, new.encounter_type, new.group_section_key
      );
    end if;
  end if;

  if new.validation_status = 'curated' then
    perform public.assert_validation_rules(v_historical_version, new.data);
    -- Pour une fiche nee dans la definition active, le filet historique reste
    -- strict. Pour une fiche ancienne, une valeur masquee preexistante ne doit
    -- pas etre effacee pour rendre la nouvelle definition lisible.
    if v_active_version is not distinct from v_historical_version then
      perform public.assert_no_hidden_values(v_historical_version, v_scope, new.data);
    end if;
  end if;
  return new;
end
$$;

-- Relay the stored group through the existing E3 write guards.
create or replace function public.update_encounter_compatible(
  p_base_id uuid,
  p_encounter_id uuid,
  p_patch jsonb,
  p_validation_status text,
  p_reason text,
  p_expected_record_revision bigint,
  p_record_definition_revision uuid,
  p_operation_id uuid,
  p_context_fingerprint text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_base public.base;
  v_enc public.encounter;
  v_operation public.record_form_operation;
  v_active_version uuid;
  v_old jsonb;
  v_new jsonb;
  v_key text;
  v_code text;
  v_dob date;
  v_age numeric;
  v_reason text := nullif(btrim(p_reason), '');
  v_justification_status text;
  v_new_status text;
  v_current_fingerprint text;
  v_request_fingerprint text;
  v_receipt jsonb;
begin
  perform public.form_record_assert_read_access(p_base_id);

  if p_encounter_id is null or p_operation_id is null then
    perform public.form_record_error('FORM_RECORD_CONFLICT', 'identifiers_required');
  end if;

  select e.* into v_enc
    from public.encounter e
    join public.patient p on p.id = e.patient_id
   where e.id = p_encounter_id
     and p.base_id = p_base_id
     and p.deleted_at is null
     and e.deleted_at is null;
  if not found then
    perform public.form_record_error('FORM_RECORD_FORBIDDEN', 'encounter_unavailable');
  end if;

  perform public.form_record_assert_write_access(
    p_base_id, v_enc.created_by, v_enc.validation_status, p_validation_status
  );

  v_request_fingerprint := public.form_preparation_fingerprint(jsonb_build_object(
    'recordKind', 'encounter',
    'baseId', p_base_id,
    'recordId', p_encounter_id,
    'patch', p_patch,
    'validationStatus', p_validation_status,
    'reason', p_reason,
    'expectedRecordRevision', p_expected_record_revision,
    'recordDefinitionRevision', p_record_definition_revision,
    'contextFingerprint', p_context_fingerprint
  ));

  perform pg_advisory_xact_lock(hashtextextended(
    'record-form:' || auth.uid()::text || ':' || p_operation_id::text, 0
  ));

  select * into v_operation
    from public.record_form_operation
   where actor_id = auth.uid() and operation_id = p_operation_id;
  if found then
    if v_operation.request_fingerprint is distinct from v_request_fingerprint then
      perform public.form_record_error('FORM_RECORD_CONFLICT', 'operation_reused');
    end if;
    return v_operation.receipt;
  end if;

  select * into v_base
    from public.base
   where id = p_base_id and deleted_at is null
   for share;
  if not found then
    perform public.form_record_error('FORM_RECORD_FORBIDDEN', 'base_unavailable');
  end if;

  select e.* into v_enc
    from public.encounter e
    join public.patient p on p.id = e.patient_id
   where e.id = p_encounter_id
     and p.base_id = p_base_id
     and p.deleted_at is null
     and e.deleted_at is null
   for update;
  if not found then
    perform public.form_record_error('FORM_RECORD_FORBIDDEN', 'encounter_unavailable');
  end if;
  perform public.form_record_assert_write_access(
    p_base_id, v_enc.created_by, v_enc.validation_status, p_validation_status
  );

  if p_expected_record_revision is null
     or v_enc.record_revision is distinct from p_expected_record_revision then
    perform public.form_record_error('FORM_RECORD_CONFLICT', 'record_revision');
  end if;

  if p_record_definition_revision is null
     or v_enc.template_version_id is distinct from p_record_definition_revision then
    perform public.form_record_error('FORM_CONTEXT_CHANGED', 'definition_revision');
  end if;

  v_active_version := coalesce(v_base.current_template_version_id, v_enc.template_version_id);
  v_current_fingerprint := public.form_record_context_fingerprint(
    'encounter', v_enc.id, v_enc.record_revision,
    p_base_id, v_base.form_revision, v_enc.template_version_id, v_enc.data
  );
  if p_context_fingerprint is null
     or p_context_fingerprint is distinct from v_current_fingerprint then
    perform public.form_record_error('FORM_CONTEXT_CHANGED', 'context_fingerprint');
  end if;

  perform public.form_record_assert_patch(
    v_enc.template_version_id, v_active_version, 'encounter', p_patch,
    v_enc.encounter_type
  );
  v_old := coalesce(v_enc.data, '{}'::jsonb);
  v_new := v_old || p_patch;
  perform public.form_record_assert_known_data(
    v_enc.template_version_id, v_active_version, 'encounter', v_new
  );
  perform public.assert_data_valid(v_enc.template_version_id, 'encounter', v_new);
  if v_active_version is distinct from v_enc.template_version_id then
    perform public.assert_data_valid(v_active_version, 'encounter', v_new);
  end if;

  v_new_status := coalesce(p_validation_status, v_enc.validation_status);
  if v_new_status <> 'draft' or not public.can_edit_structured_data(p_base_id) then
    perform public.assert_required_complete(
      v_enc.template_version_id, 'encounter', v_new, v_enc.encounter_type, v_enc.group_section_key
    );
  end if;
  perform public.form_record_assert_no_changed_hidden_values(
    v_active_version, 'encounter', v_old, v_new
  );
  v_justification_status := public.form_justification_status(p_base_id, v_reason);

  for v_key in
    select key from (
      select jsonb_object_keys(v_old) as key
      union
      select jsonb_object_keys(v_new) as key
    ) keys
  loop
    if (v_old -> v_key) is distinct from (v_new -> v_key) then
      insert into public.field_change_log
        (base_id, entity, entity_id, field_key, old_value, new_value,
         changed_by, reason, justification_status, source)
      values
        (p_base_id, 'encounter', p_encounter_id, v_key, v_old -> v_key,
         v_new -> v_key, auth.uid(), v_reason, v_justification_status,
         'manual_correction');
    end if;
  end loop;

  select p.patient_code into v_code
    from public.patient p
   where p.id = v_enc.patient_id
     and p.base_id = p_base_id
     and p.deleted_at is null;
  select pi.date_of_birth into v_dob
    from public.patient_identity pi
   where pi.base_id = p_base_id
     and pi.patient_code = v_code
     and pi.deleted_at is null;
  v_age := public.compute_age(v_dob, v_enc.encounter_date, coalesce(v_enc.age_unit, 'years'));

  update public.encounter
     set data = v_new,
         validation_status = v_new_status,
         age_value = v_age,
         updated_at = clock_timestamp()
   where id = p_encounter_id
   returning * into v_enc;

  for v_key in
    select key from (
      select jsonb_object_keys(v_old) as key
      union
      select jsonb_object_keys(v_new) as key
    ) keys
  loop
    if (v_old -> v_key) is distinct from (v_new -> v_key) then
      insert into public.record_field_provenance
        (record_kind, record_id, field_key, origin, captured_by, definition_revision,
         operation_id, value_fingerprint)
      values
        ('encounter', p_encounter_id, v_key,
         case when exists (
           select 1 from public.template_field h
            where h.template_version_id = p_record_definition_revision
              and h.scope = 'encounter' and h.field_key = v_key
         ) then 'correction' else 'completion' end,
         auth.uid(),
         case when exists (
           select 1 from public.template_field h
            where h.template_version_id = p_record_definition_revision
              and h.scope = 'encounter' and h.field_key = v_key
         ) then p_record_definition_revision else v_active_version end,
         p_operation_id,
         public.form_record_value_fingerprint(v_enc.data -> v_key));
    end if;
  end loop;

  v_receipt := jsonb_build_object(
    'recordKind', 'encounter',
    'recordId', p_encounter_id,
    'recordRevision', v_enc.record_revision,
    'validationStatus', v_enc.validation_status,
    'operationId', p_operation_id,
    'activeRevision', v_base.form_revision,
    'recordDefinitionRevision', v_enc.template_version_id,
    'contextFingerprint', public.form_record_context_fingerprint(
      'encounter', v_enc.id, v_enc.record_revision, p_base_id,
      v_base.form_revision, v_enc.template_version_id, v_enc.data
    )
  );
  insert into public.record_form_operation(
    actor_id, operation_id, record_kind, record_id, request_fingerprint, receipt
  ) values (
    auth.uid(), p_operation_id, 'encounter', p_encounter_id,
    v_request_fingerprint, v_receipt
  );
  return v_receipt;
end
$$;

-- L66 §6.5 : la cible d'une regle de visibilite ne peut pas etre un groupe repetable.
-- Corps repris a l'identique de 20260905160000_block_visibility.sql, un seul refus ajoute.
create or replace function public.assert_rule_structure(p_version_id uuid, p_rule jsonb)
returns void language plpgsql stable set search_path = public, pg_temp as $$
declare
  op                 text;
  lf                 text;
  rf                 text;
  cf                 text;
  tf                 text;
  ts                 text;
  thenop             text;
  cf_scope           text;
  tf_scope           text;
  target_parent      uuid;
  target_repeatable  boolean;
  target_has_field   boolean;
  target_has_section boolean;
  driver             public.template_field;
  configured         jsonb;
  v_release_id       uuid;
  item               jsonb;
  ok_ops             text[] := array['equals','not_equals','greater_than','greater_or_equal','less_than','less_or_equal'];
  ok_if_ops          text[] := array['equals','not_equals','greater_than','greater_or_equal','less_than','less_or_equal','in','contains_any'];
  ok_then            text[] := array['required','visible'];
begin
  if p_rule is null or jsonb_typeof(p_rule) is distinct from 'object' then
    raise exception 'Structure de regle invalide';
  end if;

  -- Le format contains_any ne peut pas être reinterpreté comme une comparaison ou une
  -- condition composite. La cible de visibilité peut toutefois être un champ OU un bloc.
  if p_rule ? 'if' and p_rule -> 'if' ->> 'operator' = 'contains_any' then
    if p_rule ?| array['operator', 'left_field', 'right_field']
       or jsonb_typeof(p_rule -> 'if' -> 'field') is distinct from 'string'
       or exists (
         select 1 from jsonb_object_keys(p_rule -> 'if') k
          where k not in ('field', 'operator', 'value', 'terminologyReleaseId')
       ) then
      raise exception 'contains_any : une seule condition de champ est autorisee pour "%"',
        coalesce(p_rule -> 'if' ->> 'field', '?');
    end if;
  end if;

  if p_rule ? 'operator' and p_rule ? 'left_field' and p_rule ? 'right_field' then
    op := p_rule ->> 'operator';
    if op is null or not (op = any(ok_ops)) then
      raise exception 'Operateur de regle invalide : %', op;
    end if;
    lf := p_rule ->> 'left_field';
    rf := p_rule ->> 'right_field';
    if not exists (
      select 1 from public.template_field
       where template_version_id = p_version_id and field_key = lf
    ) then
      raise exception 'Champ inconnu dans la regle : %', lf;
    end if;
    if not exists (
      select 1 from public.template_field
       where template_version_id = p_version_id and field_key = rf
    ) then
      raise exception 'Champ inconnu dans la regle : %', rf;
    end if;
    return;
  end if;

  if not (p_rule ? 'if' and p_rule ? 'then')
     or jsonb_typeof(p_rule -> 'if') is distinct from 'object'
     or jsonb_typeof(p_rule -> 'then') is distinct from 'object' then
    raise exception 'Structure de regle invalide (attendu {operator,left_field,right_field} ou {if,then})';
  end if;

  op := p_rule -> 'if' ->> 'operator';
  cf := p_rule -> 'if' ->> 'field';
  thenop := p_rule -> 'then' ->> 'operator';
  target_has_field := p_rule -> 'then' ? 'field';
  target_has_section := p_rule -> 'then' ? 'section';

  if op is null or not (op = any(ok_if_ops)) then
    raise exception 'Operateur conditionnel invalide : %', op;
  end if;
  if thenop is null or not (thenop = any(ok_then)) then
    raise exception 'La clause then doit etre operator=required ou operator=visible';
  end if;
  if target_has_field and target_has_section then
    raise exception 'Une regle ne peut cibler a la fois un champ et un bloc';
  end if;
  if target_has_field and jsonb_typeof(p_rule -> 'then' -> 'field') is distinct from 'string' then
    raise exception 'La cible then.field doit etre une chaine';
  end if;
  if target_has_section and jsonb_typeof(p_rule -> 'then' -> 'section') is distinct from 'string' then
    raise exception 'La cible then.section doit etre une chaine';
  end if;
  if target_has_section and thenop <> 'visible' then
    raise exception 'Une cible de bloc n''accepte que l''operateur visible';
  end if;
  if (not target_has_field) and (not target_has_section) then
    raise exception 'La clause then doit cibler un champ ou un bloc';
  end if;
  if cf is null or not exists (
    select 1 from public.template_field
     where template_version_id = p_version_id and field_key = cf
  ) then
    raise exception 'Champ inconnu dans la regle (if) : %', coalesce(cf, '?');
  end if;
  select scope into cf_scope
    from public.template_field
   where template_version_id = p_version_id and field_key = cf;

  if p_rule -> 'if' ? 'terminologyReleaseId' and op <> 'contains_any' then
    raise exception 'Release terminologique interdite pour "%"', cf;
  end if;

  -- Validation versionnée de contains_any, inchangée pour les cibles champ et bloc.
  if op = 'contains_any' then
    select * into driver
      from public.template_field
     where template_version_id = p_version_id and field_key = cf;
    if driver.type not in ('select', 'multiselect', 'terminology') then
      raise exception 'contains_any : type de pilote non autorise pour "%"', driver.label;
    end if;
    configured := p_rule -> 'if' -> 'value';
    if jsonb_typeof(configured) is distinct from 'array' then
      raise exception 'contains_any : liste de codes requise pour "%"', driver.label;
    end if;
    if jsonb_array_length(configured) = 0 then
      raise exception 'contains_any : liste vide pour "%"', driver.label;
    end if;
    if exists (
      select 1 from jsonb_array_elements(configured) e
       where jsonb_typeof(e) <> 'string'
          or btrim(e #>> '{}', U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF') = ''
    ) then
      raise exception 'contains_any : code invalide pour "%"', driver.label;
    end if;
    if (select count(distinct e) from jsonb_array_elements(configured) e) <> jsonb_array_length(configured) then
      raise exception 'contains_any : codes dupliques pour "%"', driver.label;
    end if;
    if driver.type = 'terminology' then
      if jsonb_typeof(p_rule -> 'if' -> 'terminologyReleaseId') is distinct from 'string'
         or (p_rule -> 'if' ->> 'terminologyReleaseId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        raise exception 'contains_any : release terminologique explicite requise pour "%"', driver.label;
      end if;
      v_release_id := (p_rule -> 'if' ->> 'terminologyReleaseId')::uuid;
      if not exists (select 1 from public.terminology_release r where r.id = v_release_id) then
        raise exception 'contains_any : release terminologique inconnue pour "%"', driver.label;
      end if;
    elsif p_rule -> 'if' ? 'terminologyReleaseId' then
      raise exception 'contains_any : release terminologique interdite pour "%"', driver.label;
    end if;
    for item in select value from jsonb_array_elements(configured) loop
      if driver.type = 'terminology' then
        if not exists (
          select 1 from public.terminology_concept c
           where c.release_id = v_release_id and c.code = item #>> '{}' and c.is_selectable
        ) then
          raise exception 'contains_any : code absent de la release pour "%"', driver.label;
        end if;
      elsif not coalesce(driver.allowed_values @> jsonb_build_array(item), false) then
        raise exception 'contains_any : code absent des options pour "%"', driver.label;
      end if;
    end loop;
  end if;

  if target_has_field then
    tf := p_rule -> 'then' ->> 'field';
    select scope into tf_scope
      from public.template_field
     where template_version_id = p_version_id and field_key = tf;
    if tf is null or tf_scope is null then
      raise exception 'Champ inconnu dans la regle (then) : %', coalesce(tf, '?');
    end if;

    if thenop = 'visible' then
      if cf = tf then
        raise exception 'Regle d''affichage : une variable ne peut pas commander son propre affichage';
      end if;
      if cf_scope <> tf_scope then
        raise exception 'Regle d''affichage : les deux variables doivent appartenir a la meme fiche (patient ou visite)';
      end if;
    end if;
  else
    ts := p_rule -> 'then' ->> 'section';
    select parent_section_id, is_repeatable into target_parent, target_repeatable
      from public.template_section
     where template_version_id = p_version_id and section_key = ts;
    if not found then
      raise exception 'Section cible inconnue dans la regle : %', coalesce(ts, '?');
    end if;
    if target_parent is not null then
      raise exception 'Une sous-section ne peut pas porter une regle : ciblez son bloc racine';
    end if;
    -- L66 §6.5 : un groupe repetable n'est jamais la cible d'une regle de visibilite.
    -- Un groupe vide se lit de lui-meme : zero ligne. Les regles INTERNES au groupe,
    -- entre variables d'une meme occurrence, restent inchangees.
    if target_repeatable then
      raise exception 'Regle d''affichage : un groupe repetable ne peut pas etre la cible d''une regle';
    end if;
    -- Refus atomique : un bloc ne peut jamais être partiellement évalué si ses variables
    -- appartiennent à l'autre fiche (patient/rencontre).
    if exists (
      select 1
        from public.template_section_field_keys(p_version_id, ts) sf
        join public.template_field f
          on f.template_version_id = p_version_id and f.field_key = sf.field_key
       where f.scope <> cf_scope
    ) then
      raise exception 'Regle d''affichage : le bloc et son pilote doivent appartenir a la meme fiche (patient ou visite)';
    end if;
    if exists (
      select 1 from public.template_section_field_keys(p_version_id, ts) sf
       where sf.field_key = cf
    ) then
      raise exception 'Regle d''affichage : le pilote ne peut pas appartenir au bloc qu''il commande';
    end if;
  end if;
end $$;

notify pgrst, 'reload schema';
commit;
