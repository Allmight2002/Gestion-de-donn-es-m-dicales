-- L58 : previsualisation des cycles et exemption de provenance strictement bornee.
-- Migration corrective additive : la migration initiale publiee dans la PR reste intacte.
-- Aucun backfill ni changement de donnees. Les signatures et ACL sont conservees.
-- Le plan refuse un cycle avant toute ecriture ; les gardes finales restent en place.
-- L'exemption FK compare toutes les colonnes, y compris created_at et les futurs ajouts.
-- Reprise : corriger en avant ; ne jamais retirer les gardes pour faire passer un import.

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

create or replace function public.template_import_refusal(p_code text, p_details jsonb default '{}'::jsonb)
returns void language plpgsql stable set search_path = public, pg_temp as $$
declare v_message text;
begin
  v_message := case p_code
    when 'IMPORT_SOURCE_FORBIDDEN' then 'Ce jeu de variables source n''est pas accessible.'
    when 'IMPORT_TARGET_FORBIDDEN' then 'Vous ne pouvez pas modifier ce jeu de variables.'
    when 'IMPORT_SOURCE_NOT_A_BLOCK' then 'Ce code ne designe pas un bloc de la version source : une sous-section ne s''importe pas seule.'
    when 'IMPORT_TARGET_LOCKED' then 'Version publiee ou archivee : creez une nouvelle version avant d''importer un bloc.'
    when 'IMPORT_TARGET_IN_USE' then 'Cette version porte deja des dossiers : creez la version suivante avant d''importer un bloc.'
    when 'IMPORT_SECTION_EXISTS' then 'Un bloc ou une sous-section porte deja ce code dans la version cible.'
    when 'IMPORT_FIELD_CONFLICT' then 'Une variable de meme code existe deja dans la version cible.'
    when 'IMPORT_REUSE_INCOMPATIBLE' then 'La variable a reutiliser n''a pas le meme type, la meme portee ou le meme caractere multivalue.'
    when 'IMPORT_REUSE_IN_BLOCK' then 'La variable a reutiliser appartient a un autre bloc : remontez-la d''abord au tronc commun.'
    when 'IMPORT_FORMULA_OPERAND_MISSING' then 'Une variable calculee du bloc utilise un element absent du bloc et de la version cible.'
    when 'IMPORT_FORMULA_OPERAND_INCOMPATIBLE' then 'Un element utilise par une formule a une portee ou un type incompatible, ou est deja calcule.'
    when 'IMPORT_VISIBILITY_CYCLE' then 'Les regles du bloc formeraient une dependance circulaire avec celles de la version cible.'
    else 'Import de bloc refuse.'
  end;
  raise exception using errcode = 'P0001', message = v_message,
    detail = (coalesce(p_details, '{}'::jsonb) || jsonb_build_object('code', p_code))::text,
    hint = 'import_refused';
end $$;

create or replace function public.template_section_import_plan(
  p_source_version_id  uuid,
  p_source_section_key text,
  p_target_version_id  uuid,
  p_reuse_field_keys   text[],
  p_apply              boolean
) returns jsonb
language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  v_reuse       text[] := coalesce(p_reuse_field_keys, '{}'::text[]);
  v_src_tpl     uuid;
  v_tgt_tpl     uuid;
  v_root_id     uuid;
  v_block_keys  text[];
  v_subsections text[];
  v_imported    text[] := '{}'::text[];
  v_reused      text[] := '{}'::text[];
  v_conflicts   jsonb  := '[]'::jsonb;
  v_activation  jsonb;
  v_rule_ids    uuid[];
  v_report      jsonb;
  v_cycle       boolean;
  v_base_order  int;
  v_taken       text;
  v_key         text;
  v_tokens      text[];
  v_token       text;
  f             record;
  t             record;
begin
  if auth.uid() is null then
    perform public.template_import_refusal('IMPORT_TARGET_FORBIDDEN');
  end if;
  if p_source_version_id is null or p_target_version_id is null
     or btrim(coalesce(p_source_section_key, '')) = '' then
    perform public.template_import_refusal('IMPORT_SOURCE_NOT_A_BLOCK');
  end if;

  -- La propriete de la cible est verifiee AVANT le verrou : un tiers ne doit jamais pouvoir
  -- immobiliser la ligne de version d'un gabarit qui ne lui appartient pas. Une cible
  -- inconnue et une cible interdite rendent le meme code : rien ne doit permettre de sonder
  -- l'existence d'une version.
  select tv.template_id into v_tgt_tpl from public.template_version tv where tv.id = p_target_version_id;
  if not found or not public.owns_template(v_tgt_tpl) then
    perform public.template_import_refusal('IMPORT_TARGET_FORBIDDEN');
  end if;

  select tv.template_id into v_src_tpl from public.template_version tv where tv.id = p_source_version_id;
  if not found or not public.can_read_template(v_src_tpl) then
    perform public.template_import_refusal('IMPORT_SOURCE_FORBIDDEN');
  end if;

  -- Les deux versions sont verrouillees dans le meme ordre pour les imports croises.
  -- La source reste coherente entre le rapport et la copie, meme si elle est un brouillon.
  if p_apply then
    perform 1 from public.template_version
      where id in (p_source_version_id, p_target_version_id) order by id for update;
    -- Les triggers d'invariants prennent aussi le verrou de version avant le commit
    -- d'une modification de champ/regle. Ne pas verrouiller ces lignes ici : leur
    -- UPDATE prend la ligne avant la version, ce qui inverserait l'ordre des verrous.
  end if;

  select tv.template_id into v_tgt_tpl from public.template_version tv where tv.id = p_target_version_id;
  if not found or not public.owns_template(v_tgt_tpl) then
    perform public.template_import_refusal('IMPORT_TARGET_FORBIDDEN');
  end if;

  select tv.template_id into v_src_tpl from public.template_version tv where tv.id = p_source_version_id;
  if not found or not public.can_read_template(v_src_tpl) then
    perform public.template_import_refusal('IMPORT_SOURCE_FORBIDDEN');
  end if;

  select s.id into v_root_id from public.template_section s
   where s.template_version_id = p_source_version_id
     and s.section_key = p_source_section_key
     and s.parent_section_id is null;
  if not found then
    perform public.template_import_refusal('IMPORT_SOURCE_NOT_A_BLOCK',
      jsonb_build_object('sectionKey', p_source_section_key));
  end if;

  -- Le code type precede le message herite de `lock_template_section_version` : la ligne de
  -- version est deja verrouillee ci-dessus, donc aucune course ne s'intercale.
  if public.template_version_locked(p_target_version_id) then
    perform public.template_import_refusal('IMPORT_TARGET_LOCKED');
  end if;
  if p_apply then
    perform public.lock_template_section_version(p_target_version_id);
  end if;
  -- D6 : `guard_validation_rule_inuse` interdit d'ecrire une regle sur une version portant un
  -- dossier. Un import y produirait un demi-bloc silencieux. La version suivante est la voie,
  -- et l'import ne la cree jamais lui-meme.
  if public.template_version_in_use(p_target_version_id) then
    perform public.template_import_refusal('IMPORT_TARGET_IN_USE');
  end if;

  select coalesce(array_agg(s.section_key order by s.display_order, s.section_key), '{}'::text[])
    into v_subsections
    from public.template_section s
   where s.template_version_id = p_source_version_id and s.parent_section_id = v_root_id;

  -- D5 : jamais de renommage automatique. `sexe_2` detruirait la comparabilite entre bases.
  -- La cle est unique par version tous niveaux confondus : le refus couvre donc aussi une
  -- sous-section importee dont le code serait deja pris par un bloc de la cible.
  select s.section_key into v_taken
    from public.template_section s
   where s.template_version_id = p_target_version_id
     and s.section_key = any(array[p_source_section_key] || v_subsections)
   order by s.section_key limit 1;
  if found then
    perform public.template_import_refusal('IMPORT_SECTION_EXISTS', jsonb_build_object('sectionKey', v_taken));
  end if;

  -- Appartenance au bloc : le MEME predicat que `template_section_field_keys`, qui accepte
  -- deliberement le miroir texte en plus de `section_id`. Un predicat sur `section_id` seul
  -- oublierait en silence une variable heritee rattachee par le seul code texte.
  select coalesce(array_agg(k.field_key order by k.field_key), '{}'::text[])
    into v_block_keys
    from public.template_section_field_keys(p_source_version_id, p_source_section_key) k;

  -- Une cle de reutilisation qui ne resout aucun conflit n'est pas ignoree en silence.
  foreach v_key in array v_reuse loop
    if v_key is null or not (v_key = any(v_block_keys))
       or not exists (select 1 from public.template_field
                       where template_version_id = p_target_version_id and field_key = v_key) then
      v_conflicts := v_conflicts || jsonb_build_object(
        'code', 'IMPORT_REUSE_INCOMPATIBLE', 'fieldKey', v_key,
        'existingSection', null, 'reusable', false);
    end if;
  end loop;

  for f in select tf.field_key, tf.type, tf.is_multiple, tf.scope
             from public.template_field tf
            where tf.template_version_id = p_source_version_id
              and tf.field_key = any(v_block_keys)
            order by tf.field_key
  loop
    select tf.type, tf.is_multiple, tf.scope, tf.section, tf.section_id into t
      from public.template_field tf
     where tf.template_version_id = p_target_version_id and tf.field_key = f.field_key;
    if not found then
      v_imported := v_imported || f.field_key;
    elsif (f.field_key = any(v_reuse)) is not true then
      v_conflicts := v_conflicts || jsonb_build_object(
        'code', 'IMPORT_FIELD_CONFLICT', 'fieldKey', f.field_key,
        'existingSection', t.section,
        -- L59 ne proposera la reutilisation que si le serveur l'a jugee possible ici.
        'reusable', t.type is not distinct from f.type
                and t.is_multiple is not distinct from f.is_multiple
                and t.scope is not distinct from f.scope
                and t.section_id is null and t.section is null);
    elsif t.type is distinct from f.type
       or t.is_multiple is distinct from f.is_multiple
       or t.scope is distinct from f.scope then
      v_conflicts := v_conflicts || jsonb_build_object(
        'code', 'IMPORT_REUSE_INCOMPATIBLE', 'fieldKey', f.field_key,
        'existingSection', t.section, 'reusable', false);
    elsif t.section_id is not null or t.section is not null then
      -- Le refus a ne jamais contourner (§1.1 de spec-blocs-pathologies) : reutiliser une
      -- variable enfermee dans un autre bloc rendrait le bloc importe troue des que cet autre
      -- bloc est masque. La seule resolution correcte est de la remonter au tronc commun.
      v_conflicts := v_conflicts || jsonb_build_object(
        'code', 'IMPORT_REUSE_IN_BLOCK', 'fieldKey', f.field_key,
        'existingSection', t.section, 'reusable', false);
    else
      v_reused := v_reused || f.field_key;
    end if;
  end loop;

  -- D8 : une formule muette est pire qu'un refus. La grammaire est fermee (« A op B ») :
  -- les operandes sont les jetons 1 et 3, hors constantes litterales.
  for f in select tf.field_key, tf.formula, tf.scope
             from public.template_field tf
            where tf.template_version_id = p_source_version_id
              and tf.field_key = any(v_imported) and tf.formula is not null
            order by tf.field_key
  loop
    v_tokens := regexp_split_to_array(f.formula, '\s+');
    foreach v_token in array array[v_tokens[1], v_tokens[3]] loop
      continue when v_token is null or v_token ~ '^-?([0-9]+(\.[0-9]+)?|\.[0-9]+)$';
      if not (v_token = any(v_block_keys))
         and not exists (select 1 from public.template_field
                          where template_version_id = p_target_version_id and field_key = v_token) then
        v_conflicts := v_conflicts || jsonb_build_object(
          'code', 'IMPORT_FORMULA_OPERAND_MISSING', 'fieldKey', f.field_key,
          'operandKey', v_token, 'existingSection', null, 'reusable', false);
      elsif not (v_token = any(v_imported)) then
        select target.type, target.scope, target.formula, source.type as source_type into t
          from public.template_field target
          join public.template_field source on source.template_version_id = p_source_version_id
            and source.field_key = v_token
         where target.template_version_id = p_target_version_id and target.field_key = v_token;
        if found and (t.scope is distinct from f.scope or t.formula is not null
           or t.type not in ('number', 'integer', 'date')
           or (t.type = 'date') is distinct from (t.source_type = 'date')) then
          v_conflicts := v_conflicts || jsonb_build_object(
            'code', 'IMPORT_FORMULA_OPERAND_INCOMPATIBLE', 'fieldKey', f.field_key,
            'operandKey', v_token, 'existingSection', null, 'reusable', false);
        end if;
      end if;
    end loop;
  end loop;

  -- Regles INTERNES au bloc : toutes les cles citees appartiennent au bloc. Une cible
  -- `then.section` n'est jamais interne -- son pilote est, par construction, exterieur au
  -- bloc qu'il commande -- donc ni la regle d'activation ni une regle d'un autre bloc ne
  -- sont copiees (D7 et §4.3).
  select coalesce(array_agg(vr.id order by vr.id), '{}'::uuid[])
    into v_rule_ids
    from public.validation_rule vr
   where vr.template_version_id = p_source_version_id
     and (
       (vr.rule ? 'if' and vr.rule ? 'then' and vr.rule -> 'then' ? 'field'
        and (vr.rule -> 'if' ->> 'field') = any(v_block_keys)
        and (vr.rule -> 'then' ->> 'field') = any(v_block_keys))
       or (vr.rule ? 'left_field' and vr.rule ? 'right_field'
        and (vr.rule ->> 'left_field') = any(v_block_keys)
        and (vr.rule ->> 'right_field') = any(v_block_keys))
     );

  -- La regle d'activation n'est jamais copiee : son `if` nomme un pilote du tronc commun de
  -- la SOURCE, qui n'existe pas forcement dans la cible. Le rapport la decrit : c'est la
  -- matiere de L60.
  select vr.rule -> 'if' into v_activation
    from public.validation_rule vr
   where vr.template_version_id = p_source_version_id
     and vr.rule -> 'then' ->> 'section' = p_source_section_key
     and vr.rule -> 'then' ->> 'operator' = 'visible'
   order by vr.id limit 1;

  -- Graphe propose complet, sans ecriture : regles cibles + TOUTES les regles importees.
  -- Tester les regles une par une contre la cible manquerait les cycles qui traversent
  -- plusieurs nouvelles aretes. Les blocs cibles sont deployes comme dans L52.
  -- Les cles de sections en collision sont deja refusees et les champs reutilises restent
  -- au tronc commun : un import ne change donc pas les membres des blocs cibles existants.
  with recursive proposed_rules as (
    select vr.rule from public.validation_rule vr
     where vr.template_version_id = p_target_version_id or vr.id = any(v_rule_ids)
  ), edges(child, parent) as (
    select rule -> 'then' ->> 'field', rule -> 'if' ->> 'field'
      from proposed_rules
     where rule -> 'then' ->> 'operator' = 'visible'
       and rule -> 'then' ->> 'field' is not null
    union
    select sf.field_key, r.rule -> 'if' ->> 'field'
      from proposed_rules r
      cross join lateral public.template_section_field_keys(
        p_target_version_id, r.rule -> 'then' ->> 'section'
      ) sf
     where r.rule -> 'then' ->> 'operator' = 'visible'
       and r.rule -> 'then' ->> 'section' is not null
  ), reach(child, parent) as (
    select child, parent from edges where child is not null and parent is not null
    union
    select r.child, e.parent from reach r join edges e on e.child = r.parent
  )
  select exists (select 1 from reach where child = parent) into v_cycle;
  if v_cycle then
    v_conflicts := v_conflicts || jsonb_build_object(
      'code', 'IMPORT_VISIBILITY_CYCLE', 'fieldKey', null,
      'existingSection', null, 'reusable', false);
  end if;

  v_report := jsonb_build_object(
    'sectionKey',     p_source_section_key,
    'subsections',    to_jsonb(v_subsections),
    'importedFields', to_jsonb(v_imported),
    'reusedFields',   to_jsonb(v_reused),
    'copiedRules',    coalesce(array_length(v_rule_ids, 1), 0),
    'activationRule', coalesce(v_activation, 'null'::jsonb),
    'conflicts',      v_conflicts);

  if not p_apply then
    return v_report;
  end if;
  if jsonb_array_length(v_conflicts) > 0 then
    perform public.template_import_refusal(v_conflicts -> 0 ->> 'code', v_conflicts -> 0);
  end if;

  -- --- Ecritures, dans l'ordre impose par les gardes : sections, parente, variables, -----
  -- --- renumerotation, puis regles. Une regle posee avant ses variables echouerait sur ---
  -- --- « Champ inconnu dans la regle », et une regle posee avant la seconde passe de -----
  -- --- parente ferait refuser la promotion d'une racine en sous-section. -----------------

  select coalesce(max(s.display_order), -1) into v_base_order
    from public.template_section s where s.template_version_id = p_target_version_id;

  insert into public.template_section
    (template_version_id, section_key, label, display_order,
     source_template_version_id, source_section_key)
  select p_target_version_id, s.section_key, s.label,
         v_base_order + (row_number() over (order by (s.id = v_root_id) desc,
                                                     s.display_order, s.section_key))::int,
         p_source_version_id, s.section_key
    from public.template_section s
   where s.template_version_id = p_source_version_id
     and (s.id = v_root_id or s.parent_section_id = v_root_id);

  -- Seconde passe : le parent se resout par la CLE stable dans la version cible, jamais par
  -- l'identifiant. Aucune sous-section importee ne pointe donc vers la version source.
  update public.template_section child
     set parent_section_id = parent.id
    from public.template_section src, public.template_section parent
   where src.template_version_id = p_source_version_id and src.parent_section_id = v_root_id
     and child.template_version_id = p_target_version_id and child.section_key = src.section_key
     and parent.template_version_id = p_target_version_id and parent.section_key = p_source_section_key;

  -- Le miroir `template_field.section` n'est JAMAIS ecrit en direct : le declencheur de
  -- synchronisation le pose depuis `section_id`, comme partout ailleurs (§4.3).
  perform public.copy_template_field_rows(p_source_version_id, p_target_version_id, false, v_imported);

  perform public.normalize_template_section_order(p_target_version_id);

  insert into public.validation_rule(template_version_id, rule, message, severity)
  select p_target_version_id, vr.rule, vr.message, vr.severity
    from public.validation_rule vr
   where vr.id = any(v_rule_ids)
   order by vr.id;

  -- Revalidation complete de la cible avant le commit : structure, operandes calcules,
  -- acyclicite de visibilite et configuration diagnostique.
  perform public.validate_template_version_invariants(p_target_version_id);

  return v_report;
end $$;
