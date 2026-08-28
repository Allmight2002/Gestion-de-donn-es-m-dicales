-- =============================================================================
-- 20260815161000_option_key_repair.sql  (L30 — conversion des donnees existantes)
--
-- CE QUE CETTE CONVERSION REPARE, ET CE QU'ELLE NE FAIT PAS.
--
-- Le lot L30 donne a chaque option de liste un code stable. Pour les listes DEJA en
-- service, ce code est la chaine elle-meme : les fiches portent donc deja leur code, et
-- il n'y a AUCUNE reecriture de masse a faire. La migration precedente est purement
-- additive.
--
-- Reste le degat DEJA COMMIS. Avant ce lot, corriger une option laissait derriere elle
-- des fiches portant l'ancienne chaine, absente de la liste : invalides a la prochaine
-- ecriture, et comptees comme une modalite distincte a l'analyse. Rien ne les signalait.
-- C'est ce que cette conversion repare, fiche par fiche, en ramenant la valeur orpheline
-- sur l'option qui lui correspond.
--
-- REGLE DE RAPPROCHEMENT. Une valeur orpheline est rattachee a une option lorsque, apres
-- normalisation (minuscules, accents ramenes a la lettre de base -- la meme fonction que
-- la recherche de terminologie, sans nouvelle extension), elle correspond a EXACTEMENT
-- UNE option, par son libelle ou par son code. Zero correspondance ou plusieurs : la
-- fiche est BLOQUEE et rapportee. Jamais ecartee en silence, jamais devinee.
--
-- EXIGENCES TENUES (les memes que L26) :
--   * apercu en LECTURE SEULE (`preview_option_key_repair`), qui ne modifie rien ;
--   * OPT-IN explicite : `repair_option_keys` refuse d'agir sans `p_confirm => true` ;
--   * TRANSACTIONNELLE PAR ENREGISTREMENT : chaque fiche est traitee dans sa propre
--     sous-transaction ; un echec n'emporte pas les fiches deja converties ;
--   * IDEMPOTENTE PAR CONSTRUCTION : une fiche dont la valeur est deja un code connu
--     n'apparait pas au plan. Rejouer la conversion apres une interruption ne reconvertit
--     rien et ne journalise rien -- il n'y a donc pas de cle d'operation a inventer, la
--     convergence est portee par l'etat lui-meme ;
--   * TRACEE dans `field_change_log` avec l'ancienne et la nouvelle valeur, sous une
--     source dediee `option_key_repair` ;
--   * CONCURRENCE : la ligne est verrouillee puis RELUE avant ecriture, et la fiche est
--     laissee intacte si elle a bouge depuis l'apercu. Aucune modification concurrente
--     n'est ecrasee.
--
-- ADDITIVE. Une contrainte `check` elargie (surensemble : aucune ligne existante ne peut
-- la violer) et trois fonctions nouvelles. Retour arriere : supprimer les fonctions et
-- retablir la contrainte precedente.
-- =============================================================================

-- =============================================================================
-- 1. Une source de journal dediee
-- =============================================================================

-- Une conversion technique ne doit pas se confondre avec une correction clinique
-- (`manual_correction`) : l'auteur n'a pas change d'avis sur la donnee, c'est son codage
-- qui a change. Elargissement d'un `check` sur une table portant des donnees : la nouvelle
-- liste est un SURENSEMBLE de l'ancienne, donc aucune ligne ne peut la violer. `not valid`
-- puis `validate` evite malgre tout de tenir un verrou exclusif pendant le parcours de la
-- table -- `validate constraint` ne prend qu'un SHARE UPDATE EXCLUSIVE, qui ne bloque ni
-- les lectures ni les ecritures concurrentes.
alter table public.field_change_log drop constraint if exists field_change_log_source_check;
alter table public.field_change_log
  add constraint field_change_log_source_check
  check (source in ('direct_entry', 'curation_validation', 'curation_finalization',
                    'manual_correction', 'import', 'option_key_repair'))
  not valid;
alter table public.field_change_log validate constraint field_change_log_source_check;

-- =============================================================================
-- 2. Rapprochement d'une valeur orpheline
-- =============================================================================

-- Rend le code de l'UNIQUE option correspondante, ou NULL s'il y en a zero ou plusieurs.
-- L'ambiguite vaut refus : deux options qui se ressemblent apres normalisation designent
-- deux modalites que personne ici n'a le droit de departager.
create function public.resolve_option_key(p_options jsonb, p_value text)
returns text
language sql immutable set search_path = public, pg_temp as $$
  with candidate as (
    select distinct o.value ->> 'value_key' as key
    from jsonb_array_elements(coalesce(p_options, '[]'::jsonb)) o
    where public.terminology_normalize(o.value ->> 'label')     = public.terminology_normalize(p_value)
       or public.terminology_normalize(o.value ->> 'value_key') = public.terminology_normalize(p_value)
  )
  select case when (select count(*) from candidate) = 1 then (select key from candidate) end;
$$;
comment on function public.resolve_option_key(jsonb, text) is
  'Code de l''unique option correspondant a une valeur orpheline (libelle ou code, normalises). NULL si aucune ou plusieurs.';

-- =============================================================================
-- 3. Le plan : une ligne par (fiche, variable) a convertir
-- =============================================================================

-- Fonction INTERNE, partagee par l'apercu et l'execution : l'apercu ne peut donc pas
-- annoncer autre chose que ce qui sera fait. Revoquee de tous les roles ; les deux RPC
-- publiques ci-dessous verifient l'autorisation avant de l'appeler.
create function public.option_key_repair_plan(p_base_id uuid)
returns table (
  entity         text,
  entity_id      uuid,
  field_key      text,
  field_label    text,
  old_value      jsonb,
  new_value      jsonb,
  changes        jsonb,
  blocked_values text[]
)
language sql stable security definer set search_path = public, pg_temp as $$
  with rec as (
    select 'patient'::text as entity, p.id as entity_id, p.template_version_id as tv, p.data as data
    from public.patient p
    where p.base_id = p_base_id and p.deleted_at is null
    union all
    select 'encounter'::text, e.id, e.template_version_id, e.data
    from public.encounter e
    join public.patient p on p.id = e.patient_id
    where p.base_id = p_base_id and p.deleted_at is null and e.deleted_at is null
  ),
  pair as (
    select r.entity, r.entity_id, tf.field_key, tf.label as field_label, tf.type,
           tf.allowed_options, r.data -> tf.field_key as v
    from rec r
    join public.template_field tf
      on tf.template_version_id = r.tv
     and tf.scope = r.entity
     and tf.type in ('select', 'multiselect')
     and tf.allowed_options is not null
    where r.data ? tf.field_key
  ),
  -- Une ligne par valeur elementaire : la valeur d'un `select`, chaque element d'un
  -- `multiselect`. `orig` conserve la valeur JSON telle quelle, pour qu'un element qui
  -- n'est pas une chaine soit RECOPIE et non perdu a la reconstruction.
  elem as (
    select p.entity, p.entity_id, p.field_key, p.field_label, p.type, p.allowed_options, p.v,
           1 as ord, p.v as orig,
           case when jsonb_typeof(p.v) = 'string' then p.v #>> '{}' end as txt
    from pair p
    where p.type = 'select'
    union all
    select p.entity, p.entity_id, p.field_key, p.field_label, p.type, p.allowed_options, p.v,
           el.ord::int, el.value,
           case when jsonb_typeof(el.value) = 'string' then el.value #>> '{}' end
    from pair p
    cross join lateral jsonb_array_elements(p.v) with ordinality el(value, ord)
    where p.type = 'multiselect' and jsonb_typeof(p.v) = 'array'
  ),
  judged as (
    select e.*,
      -- Une valeur vide ou non textuelle (un code de valeur manquante, par exemple) n'est
      -- pas une option : elle est laissee strictement intacte.
      case when e.txt is null or e.txt = '' then true
           else exists (select 1 from jsonb_array_elements(e.allowed_options) o
                        where o.value ->> 'value_key' = e.txt)
      end as conforming,
      case when e.txt is null or e.txt = '' then null
           else public.resolve_option_key(e.allowed_options, e.txt)
      end as resolved
    from elem e
  ),
  per_field as (
    select entity, entity_id, field_key, field_label, type, v,
           bool_and(conforming) as all_conforming,
           coalesce(array_agg(txt order by ord) filter (where not conforming and resolved is null),
                    '{}'::text[]) as blocked,
           coalesce(jsonb_agg(jsonb_build_object('from', txt, 'to', resolved) order by ord)
                    filter (where not conforming and resolved is not null), '[]'::jsonb) as changes,
           jsonb_agg(case when not conforming and resolved is not null then to_jsonb(resolved) else orig end
                     order by ord) as rebuilt
    from judged
    group by entity, entity_id, field_key, field_label, type, v
  )
  select entity, entity_id, field_key, field_label, v,
         case when type = 'select' then rebuilt -> 0 else rebuilt end,
         changes, blocked
  from per_field
  where not all_conforming;
$$;
revoke all on function public.option_key_repair_plan(uuid) from public, anon, authenticated;

-- =============================================================================
-- 4. Apercu — LECTURE SEULE
-- =============================================================================

-- `stable` : le moteur refusera toute ecriture depuis cette fonction. La garantie de
-- lecture seule n'est donc pas seulement une intention de redaction.
create function public.preview_option_key_repair(p_base_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_result jsonb;
begin
  if not public.can_edit_structured_data(p_base_id) then
    raise exception 'Acces refuse';
  end if;

  with plan as (select * from public.option_key_repair_plan(p_base_id)),
  per_record as (
    select entity, entity_id, bool_or(cardinality(blocked_values) > 0) as blocked
    from plan group by entity, entity_id
  ),
  mapping as (
    select p.entity, p.field_key, c.value ->> 'from' as from_value, c.value ->> 'to' as to_key,
           count(*) as occurrences
    from plan p cross join lateral jsonb_array_elements(p.changes) c
    group by p.entity, p.field_key, c.value ->> 'from', c.value ->> 'to'
  ),
  blocking as (
    select p.entity, p.field_key, b.value as blocked_value, count(*) as occurrences
    from plan p cross join lateral unnest(p.blocked_values) b(value)
    group by p.entity, p.field_key, b.value
  ),
  per_field as (
    select p.entity, p.field_key, min(p.field_label) as field_label,
           count(*) filter (where cardinality(p.blocked_values) = 0) as repairable,
           count(*) filter (where cardinality(p.blocked_values) > 0) as blocked
    from plan p group by p.entity, p.field_key
  )
  select jsonb_build_object(
    'baseId', p_base_id,
    'records', jsonb_build_object(
      'repairable', (select count(*) from per_record where not blocked),
      'blocked',    (select count(*) from per_record where blocked)
    ),
    'fields', coalesce((
      select jsonb_agg(jsonb_build_object(
        'entity', f.entity,
        'fieldKey', f.field_key,
        'label', f.field_label,
        'repairableRecords', f.repairable,
        'blockedRecords', f.blocked,
        'mappings', coalesce((
          select jsonb_agg(jsonb_build_object('from', m.from_value, 'to', m.to_key, 'occurrences', m.occurrences)
                 order by m.from_value)
          from mapping m where m.entity = f.entity and m.field_key = f.field_key
        ), '[]'::jsonb),
        'blockingValues', coalesce((
          select jsonb_agg(jsonb_build_object('value', b.blocked_value, 'occurrences', b.occurrences)
                 order by b.blocked_value)
          from blocking b where b.entity = f.entity and b.field_key = f.field_key
        ), '[]'::jsonb)
      ) order by f.entity, f.field_key)
      from per_field f
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end $$;
revoke all on function public.preview_option_key_repair(uuid) from public, anon;
grant execute on function public.preview_option_key_repair(uuid) to authenticated;
comment on function public.preview_option_key_repair(uuid) is
  'Apercu en lecture seule de la conversion des options de liste : fiches convertibles, rapprochements proposes, valeurs bloquantes.';

-- =============================================================================
-- 5. Execution — opt-in, par enregistrement, tracee
-- =============================================================================

create function public.repair_option_keys(p_base_id uuid, p_confirm boolean default false)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_plan     jsonb;
  v_row      jsonb;
  v_id       uuid;
  v_entity   text;
  v_data     jsonb;
  v_new      jsonb;
  v_tv       uuid;
  v_repaired int := 0;
  v_fields   int := 0;
  v_blocked  int := 0;
  v_skipped  int := 0;
  v_failed   int := 0;
begin
  if not public.can_edit_structured_data(p_base_id) then
    raise exception 'Acces refuse';
  end if;
  -- OPT-IN. Un apercu ne se transforme jamais en execution par inadvertance.
  if not coalesce(p_confirm, false) then
    raise exception 'Conversion non confirmee : relisez l''apercu avant de l''executer';
  end if;

  -- Le plan est MATERIALISE avant la premiere ecriture : la boucle ne lit donc pas une
  -- table qu'elle est en train de modifier.
  select coalesce(jsonb_agg(t.x), '[]'::jsonb) into v_plan
  from (
    select jsonb_build_object(
             'entity',   entity,
             'entityId', entity_id,
             'blocked',  bool_or(cardinality(blocked_values) > 0),
             'changes',  jsonb_object_agg(field_key, new_value),
             'previous', jsonb_object_agg(field_key, old_value)
           ) as x
    from public.option_key_repair_plan(p_base_id)
    group by entity, entity_id
  ) t;

  for v_row in select el.value from jsonb_array_elements(v_plan) el
  loop
    v_entity := v_row ->> 'entity';
    v_id     := (v_row ->> 'entityId')::uuid;

    -- Une seule valeur non rapprochable BLOQUE toute la fiche : on ne convertit jamais a
    -- moitie un enregistrement, ce qui laisserait cohabiter deux codages dans la meme fiche.
    if coalesce((v_row ->> 'blocked')::boolean, false) then
      v_blocked := v_blocked + 1;
      continue;
    end if;

    -- Sous-transaction : la fiche reussit ou echoue seule.
    begin
      v_data := null; v_tv := null;
      if v_entity = 'patient' then
        select data, template_version_id into v_data, v_tv
        from public.patient where id = v_id and deleted_at is null for update;
      else
        select data, template_version_id into v_data, v_tv
        from public.encounter where id = v_id and deleted_at is null for update;
      end if;

      if v_data is null then
        -- Supprimee entre l'apercu et l'execution.
        v_skipped := v_skipped + 1;
      elsif exists (
        select 1 from jsonb_each(v_row -> 'previous') p
        where (v_data -> p.key) is distinct from p.value
      ) then
        -- Modifiee entre-temps : on ne recouvre pas le travail de quelqu'un d'autre.
        v_skipped := v_skipped + 1;
      else
        v_new := v_data || (v_row -> 'changes');
        -- Defense en profondeur : la fiche convertie doit passer la validation serveur
        -- ordinaire, sans quoi la conversion aurait produit une fiche inecrivable.
        perform public.assert_data_valid(
          v_tv, v_entity,
          case when v_entity = 'encounter' then v_new - 'age_at_encounter' else v_new end
        );

        if v_entity = 'patient' then
          update public.patient set data = v_new where id = v_id;
        else
          update public.encounter set data = v_new where id = v_id;
        end if;

        insert into public.field_change_log
          (base_id, entity, entity_id, field_key, old_value, new_value, changed_by, reason, source)
        select p_base_id, v_entity, v_id, c.key,
               v_row -> 'previous' -> c.key, c.value, auth.uid(),
               'Conversion des options de liste en codes internes (L30)', 'option_key_repair'
        from jsonb_each(v_row -> 'changes') c;

        v_repaired := v_repaired + 1;
        v_fields   := v_fields + (select count(*)::int from jsonb_each(v_row -> 'changes'));
      end if;
    exception when others then
      -- Le detail de l'erreur reste au serveur : le compte suffit a l'appelant, qui
      -- relancera un apercu.
      v_failed := v_failed + 1;
    end;
  end loop;

  perform public.log_audit('option_keys_repaired', 'base', p_base_id, p_base_id,
    jsonb_build_object('repaired', v_repaired, 'fields', v_fields,
                       'blocked', v_blocked, 'skipped', v_skipped, 'failed', v_failed));

  return jsonb_build_object(
    'baseId', p_base_id,
    'repairedRecords', v_repaired,
    'repairedFields', v_fields,
    'blockedRecords', v_blocked,
    'skippedRecords', v_skipped,
    'failedRecords', v_failed
  );
end $$;
revoke all on function public.repair_option_keys(uuid, boolean) from public, anon;
grant execute on function public.repair_option_keys(uuid, boolean) to authenticated;
comment on function public.repair_option_keys(uuid, boolean) is
  'Ramene les valeurs orphelines des listes sur leur option (opt-in, par enregistrement, idempotente, tracee dans field_change_log). Une valeur non rapprochable bloque sa fiche.';

-- =============================================================================
-- 6. Decouverte immediate par l'API
-- =============================================================================

-- PostgREST conserve un cache de schema. Ce lot ajoute deux RPC publiques et une
-- surcharge de `update_template_field` : sans cette notification, l'interface les
-- appellerait avant que l'API ne les connaisse. Additive, ne touche ni donnees, ni roles,
-- ni ACL.
notify pgrst, 'reload schema';
