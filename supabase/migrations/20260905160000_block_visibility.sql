-- L52 : visibilité conditionnelle au niveau d'un bloc racine.
--
-- Cette migration est additive. Elle ne modifie aucune migration déjà appliquée et ne
-- réécrit aucune fiche. `then.section` porte le `section_key` stable d'un bloc racine ;
-- les UUID restent des détails internes à la version.

-- -----------------------------------------------------------------------------
-- 1. Une cible de bloc se résout toujours vers la version courante
-- -----------------------------------------------------------------------------

-- Fonction interne partagée par l'évaluation, la complétude et les gardes de données.
-- Elle ne renvoie que les variables attachées au bloc racine lui-même ou à l'une de ses
-- sous-sections. Le miroir `section` est accepté en plus de `section_id` pour ne pas
-- transformer une ancienne ligne de maintenance en variable silencieusement orpheline.
create or replace function public.template_section_field_keys(
  p_version_id uuid,
  p_section_key text
) returns table(field_key text)
language sql stable security invoker set search_path = public, pg_temp as $$
  with root as (
    select id
      from public.template_section
     where template_version_id = p_version_id
       and section_key = p_section_key
       and parent_section_id is null
  )
  select distinct tf.field_key
    from public.template_field tf
    join public.template_section s
      on s.template_version_id = p_version_id
     and (tf.section_id = s.id or tf.section = s.section_key)
   where tf.template_version_id = p_version_id
     and exists (
       select 1 from root r
        where s.id = r.id or s.parent_section_id = r.id
     );
$$;
revoke all on function public.template_section_field_keys(uuid, text) from public, anon;
grant execute on function public.template_section_field_keys(uuid, text) to authenticated;

-- -----------------------------------------------------------------------------
-- 2. Point fixe de visibilité : champ et bloc ont exactement la même sémantique
-- -----------------------------------------------------------------------------

create or replace function public.visibility_hidden_fields(p_version uuid, p_data jsonb)
returns text[] language plpgsql stable set search_path = public, pg_temp as $$
declare
  v_rules         jsonb[];
  v_rule          jsonb;
  v_hidden        text[] := '{}';
  v_targets       text[];
  v_target        text;
  v_driver_key    text;
  v_driver        jsonb;
  v_changed       boolean := true;
  v_passes        int := 0;
begin
  if p_version is null then return v_hidden; end if;

  select coalesce(array_agg(vr.rule), '{}'::jsonb[]) into v_rules
    from public.validation_rule vr
   where vr.template_version_id = p_version
     and vr.rule ? 'if' and vr.rule ? 'then'
     and (vr.rule -> 'then' ->> 'operator') = 'visible'
     and (vr.rule -> 'if' ->> 'field') is not null
     and (
       (vr.rule -> 'then' ->> 'field') is not null
       or (vr.rule -> 'then' ->> 'section') is not null
     );

  if coalesce(array_length(v_rules, 1), 0) = 0 then return v_hidden; end if;

  -- Chaque passe ajoute seulement des clés. Une chaîne de dépendances de règles finit donc
  -- toujours, même si une version héritée a été importée avec un graphe incohérent.
  while v_changed and v_passes < array_length(v_rules, 1) + 1 loop
    v_changed := false;
    v_passes := v_passes + 1;

    foreach v_rule in array v_rules loop
      if (v_rule -> 'then' ->> 'field') is not null then
        v_targets := array[v_rule -> 'then' ->> 'field'];
      else
        select coalesce(array_agg(sf.field_key order by sf.field_key), '{}'::text[])
          into v_targets
          from public.template_section_field_keys(
            p_version,
            v_rule -> 'then' ->> 'section'
          ) sf;
      end if;

      v_driver_key := v_rule -> 'if' ->> 'field';
      -- Un pilote masqué vaut absent : c'est le terme de cascade du point fixe.
      v_driver := case when v_driver_key = any(v_hidden) then null else p_data -> v_driver_key end;

      foreach v_target in array v_targets loop
        continue when v_target = any(v_hidden);
        -- Les deux tests restent séparés : l'opérateur ne doit jamais recevoir un JSON
        -- absent et tenter de le convertir implicitement en chaîne.
        if not public.rule_value_present(v_driver)
           or not public.rule_apply_op(v_rule -> 'if' ->> 'operator', v_driver, v_rule -> 'if' -> 'value') then
          v_hidden := array_append(v_hidden, v_target);
          v_changed := true;
        end if;
      end loop;
    end loop;
  end loop;

  return v_hidden;
end $$;
grant execute on function public.visibility_hidden_fields(uuid, jsonb) to authenticated;

-- -----------------------------------------------------------------------------
-- 3. Contrat de structure, avec cible `field` OU `section`
-- -----------------------------------------------------------------------------

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
    select parent_section_id into target_parent
      from public.template_section
     where template_version_id = p_version_id and section_key = ts;
    if not found then
      raise exception 'Section cible inconnue dans la regle : %', coalesce(ts, '?');
    end if;
    if target_parent is not null then
      raise exception 'Une sous-section ne peut pas porter une regle : ciblez son bloc racine';
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

-- -----------------------------------------------------------------------------
-- 4. Le graphe ajoute une arête pour chaque variable du bloc
-- -----------------------------------------------------------------------------

create or replace function public.assert_visibility_acyclic(
  p_version_id uuid,
  p_rule jsonb,
  p_rule_id uuid
) returns void language plpgsql stable set search_path = public, pg_temp as $$
declare
  v_from text;
  v_to text;
  v_cycle boolean := false;
begin
  if not (p_rule ? 'if' and p_rule ? 'then') then return; end if;
  if (p_rule -> 'then' ->> 'operator') is distinct from 'visible' then return; end if;
  v_from := p_rule -> 'if' ->> 'field';
  if v_from is null then return; end if;

  -- `edges(child,parent)` signifie « la visibilité de child dépend de parent ». Pour une
  -- cible bloc, le bloc est donc déplié en une arête par variable, sous-sections incluses.
  with recursive edges(child, parent) as (
    select vr.rule -> 'then' ->> 'field', vr.rule -> 'if' ->> 'field'
      from public.validation_rule vr
     where vr.template_version_id = p_version_id
       and (p_rule_id is null or vr.id <> p_rule_id)
       and vr.rule ? 'if' and vr.rule ? 'then'
       and (vr.rule -> 'then' ->> 'operator') = 'visible'
       and (vr.rule -> 'then' ->> 'field') is not null
    union all
    select sf.field_key, vr.rule -> 'if' ->> 'field'
      from public.validation_rule vr
      cross join lateral public.template_section_field_keys(
        p_version_id, vr.rule -> 'then' ->> 'section'
      ) sf
     where vr.template_version_id = p_version_id
       and (p_rule_id is null or vr.id <> p_rule_id)
       and vr.rule ? 'if' and vr.rule ? 'then'
       and (vr.rule -> 'then' ->> 'operator') = 'visible'
       and (vr.rule -> 'then' ->> 'section') is not null
  ),
  candidate_targets(field_key) as (
    select p_rule -> 'then' ->> 'field'
     where (p_rule -> 'then' ->> 'field') is not null
    union all
    select sf.field_key
      from public.template_section_field_keys(
        p_version_id, p_rule -> 'then' ->> 'section'
      ) sf
     where (p_rule -> 'then' ->> 'section') is not null
  ),
  reach(node) as (
    -- `edges(child,parent)` inverse l'arête métier : la cible dépend du pilote. En
    -- partant du pilote candidat et en remontant les dépendances existantes, on retrouve
    -- une cible candidate exactement lorsqu'elle ferme un cycle.
    select v_from
    union
    select e.parent
      from edges e
      join reach r on e.child = r.node
  )
  select exists (
    select 1 from candidate_targets c join reach r on r.node = c.field_key
  ) into v_cycle;

  if v_cycle then
    v_to := coalesce(p_rule -> 'then' ->> 'field', p_rule -> 'then' ->> 'section');
    raise exception 'Regle d''affichage circulaire : % finirait par dependre de lui-meme', v_to;
  end if;
end $$;
grant execute on function public.assert_visibility_acyclic(uuid, jsonb, uuid) to authenticated;

create or replace function public.guard_validation_rule_structure()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  perform public.assert_rule_structure(new.template_version_id, new.rule);
  perform public.assert_rule_calculated_operands(new.template_version_id, new.rule);
  perform public.assert_visibility_acyclic(new.template_version_id, new.rule, new.id);
  return new;
end $$;

-- -----------------------------------------------------------------------------
-- 5. Validateur unique des invariants de version
-- -----------------------------------------------------------------------------

-- Toute mutation de structure qui peut changer le sens d'une règle repasse par CE point.
-- La ligne de version est verrouillée ici même lorsque l'appelant a emprunté une voie
-- directe autorisée par la RLS. Les RPC multi-écritures peuvent appeler la fonction à leur
-- dernier statement ; les triggers ci-dessous couvrent les écritures unitaires directes.
create or replace function public.validate_template_version_invariants(p_version_id uuid)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r record;
begin
  if p_version_id is null then return; end if;
  perform 1 from public.template_version where id = p_version_id for update;
  if not found then
    -- Les cascades de suppression d'une version détruisent ses enfants après la ligne
    -- parent. Elles ne doivent pas être transformées en une fausse violation de structure.
    return;
  end if;

  for r in
    select id, rule
      from public.validation_rule
     where template_version_id = p_version_id
     order by id
  loop
    perform public.assert_rule_structure(p_version_id, r.rule);
    perform public.assert_rule_calculated_operands(p_version_id, r.rule);
    perform public.assert_visibility_acyclic(p_version_id, r.rule, r.id);
  end loop;
end $$;
revoke all on function public.validate_template_version_invariants(uuid) from public, anon, authenticated;

create or replace function public.run_template_version_invariants()
returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_version_id uuid := coalesce(new.template_version_id, old.template_version_id);
begin
  perform public.validate_template_version_invariants(v_version_id);
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end $$;
revoke all on function public.run_template_version_invariants() from public, anon, authenticated;

-- Une validation APRES chaque statement protège aussi les écritures directes. Les RPC qui
-- insèrent plusieurs éléments dans plusieurs statements disposent du même filet en appelant
-- le validateur à la fin ; le verrou de version leur interdit l'entrelacement concurrent.
drop trigger if exists trg_template_version_invariants_rule on public.validation_rule;
create trigger trg_template_version_invariants_rule
  after insert or update or delete on public.validation_rule
  for each row execute function public.run_template_version_invariants();

drop trigger if exists trg_template_version_invariants_field on public.template_field;
create trigger trg_template_version_invariants_field
  after insert or update or delete on public.template_field
  for each row execute function public.run_template_version_invariants();

drop trigger if exists trg_template_version_invariants_section on public.template_section;
create trigger trg_template_version_invariants_section
  after insert or update or delete on public.template_section
  for each row execute function public.run_template_version_invariants();

-- -----------------------------------------------------------------------------
-- 6. Valeur sous un bloc masqué : refus serveur pour TOUS les statuts
-- -----------------------------------------------------------------------------

-- Ce garde distingue une variable masquée par sa propre règle de champ d'une variable
-- appartenant à un bloc dont la condition est fausse. La première conserve la sémantique
-- historique ; la seconde est la nouvelle barrière de compatibilité pour les anciens clients.
create or replace function public.assert_block_hidden_values(
  p_version uuid,
  p_scope text,
  p_data jsonb
) returns void
language plpgsql stable set search_path = public, pg_temp as $$
declare
  v_hidden text[];
  v_driver_key text;
  v_driver jsonb;
  block_rule record;
  f record;
begin
  if p_data is null then return; end if;
  if not exists (
    select 1 from public.validation_rule
     where template_version_id = p_version
       and rule ? 'if' and rule ? 'then'
       and rule -> 'then' ? 'section'
       and (rule -> 'then' ->> 'operator') = 'visible'
  ) then
    return;
  end if;

  v_hidden := public.visibility_hidden_fields(p_version, p_data);
  for block_rule in
    select rule
      from public.validation_rule
     where template_version_id = p_version
       and rule ? 'if' and rule ? 'then'
       and (rule -> 'then' ->> 'section') is not null
       and (rule -> 'then' ->> 'operator') = 'visible'
  loop
    v_driver_key := block_rule.rule -> 'if' ->> 'field';
    v_driver := case when v_driver_key = any(v_hidden) then null else p_data -> v_driver_key end;
    -- Une condition non vérifiable ou fausse masque le bloc. Les champs masqués par une
    -- règle de champ seule ne passent pas ici si le bloc est lui-même visible.
    if not public.rule_value_present(v_driver)
       or not public.rule_apply_op(
         block_rule.rule -> 'if' ->> 'operator',
         v_driver,
         block_rule.rule -> 'if' -> 'value'
       ) then
      for f in
        select tf.field_key
          from public.template_section_field_keys(
            p_version, block_rule.rule -> 'then' ->> 'section'
          ) sf
          join public.template_field tf
            on tf.template_version_id = p_version and tf.field_key = sf.field_key
         where tf.scope = p_scope
           -- Un code de valeur manquante est une saisie volontaire : il doit être annoncé
           -- puis refusé sous un bloc masqué exactement comme une valeur ordinaire.
           and p_data ? tf.field_key
           and (p_data -> tf.field_key) <> 'null'::jsonb
      loop
        raise exception using
          errcode = 'P0001',
          message = 'Une valeur appartient a un bloc masque : actualisez l’application avant de reprendre l’enregistrement.',
          detail = jsonb_build_object(
            'code', 'block_hidden_value',
            'field', f.field_key,
            'section', block_rule.rule -> 'then' ->> 'section',
            'action', 'refresh_required'
          )::text,
          hint = 'refresh_required';
      end loop;
    end if;
  end loop;
end $$;
revoke all on function public.assert_block_hidden_values(uuid, text, jsonb) from public, anon;
grant execute on function public.assert_block_hidden_values(uuid, text, jsonb) to authenticated;

create or replace function public.assert_curated_complete()
returns trigger language plpgsql set search_path = public, pg_temp as $$
declare
  v_scope text := case when tg_table_name = 'patient' then 'patient' else 'encounter' end;
begin
  -- Nouvelle règle L52 : une valeur d'un bloc masqué est interdite dès le brouillon.
  -- Aucun DELETE implicite : le serveur refuse et laisse la charge locale intacte.
  perform public.assert_block_hidden_values(new.template_version_id, v_scope, new.data);
  -- L51 : barrière analogue pour les cibles de champ contains_any.
  perform public.assert_contains_any_hidden_values(new.template_version_id, v_scope, new.data);

  -- Aucune clé inconnue du gabarit, quel que soit le statut.
  perform public.assert_no_unknown_fields(new.template_version_id, v_scope, new.data);

  -- Complétude hors brouillon + règles complètes uniquement à la finalisation, comme avant
  -- L52. Les champs masqués sont déjà retirés par assert_required_complete.
  if new.validation_status <> 'draft' then
    if v_scope = 'patient' then
      perform public.assert_required_complete(new.template_version_id, 'patient', new.data);
    else
      perform public.assert_required_complete(new.template_version_id, 'encounter', new.data, new.encounter_type);
    end if;
  end if;

  if new.validation_status = 'curated' then
    perform public.assert_data_valid(new.template_version_id, v_scope, new.data);
    perform public.assert_validation_rules(new.template_version_id, new.data);
    perform public.assert_no_hidden_values(new.template_version_id, v_scope, new.data);
  end if;
  return new;
end $$;

-- -----------------------------------------------------------------------------
-- 7. Publication et copie : même validation finale, mêmes clés stables
-- -----------------------------------------------------------------------------

create or replace function public.publish_template_version(p_version_id uuid)
returns public.template_version
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v public.template_version;
begin
  if auth.uid() is null then raise exception 'Authentification requise'; end if;
  select * into v
    from public.template_version
   where id = p_version_id
   for update;
  if not found then raise exception 'Version introuvable'; end if;
  if not public.owns_template(v.template_id) then
    raise exception 'Modification du jeu de variables non autorisee';
  end if;
  if v.status <> 'draft' then
    raise exception 'Seule une version draft peut etre publiee';
  end if;

  -- Contrôle complet sous le même verrou que les mutations de configuration. Une copie de
  -- règle ne peut donc publier une `section_key` qui ne résout pas vers un bloc de la cible.
  perform public.validate_template_version_invariants(p_version_id);

  delete from public.template_version_status_authorization
   where created_at < now() - interval '1 day';
  insert into public.template_version_status_authorization (txid, version_id, from_status, to_status)
  values (txid_current(), p_version_id, 'draft', 'published')
  on conflict (txid, version_id, from_status, to_status)
  do update set used_at = null, created_at = now();

  update public.template_version
     set status = 'published', published_at = coalesce(published_at, now())
   where id = p_version_id
   returning * into v;
  return v;
end $$;
revoke all on function public.publish_template_version(uuid) from public, anon;
grant execute on function public.publish_template_version(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 8. Conflit clinique : verrouiller la ligne avant de comparer le jeton
-- -----------------------------------------------------------------------------

-- Le jeton `updated_at` existait déjà, mais la lecture n'était pas verrouillée avant le test.
-- Deux corrections concurrentes pouvaient ainsi franchir le test ensemble. Le verrou placé
-- avant la comparaison garantit qu'une seule intention gagne ; l'autre reçoit CONFLIT_VERSION
-- avant d'insérer son journal ou de modifier la fiche.
create or replace function public.update_encounter(
  p_encounter_id      uuid,
  p_data              jsonb,
  p_validation_status text,
  p_reason            text,
  p_expected_updated_at timestamptz default null
) returns public.encounter
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_enc public.encounter;
  v_base uuid;
  v_code text;
  v_dob date;
  v_age numeric;
  v_old jsonb;
  v_new jsonb;
  v_key text;
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
      and coalesce(p_validation_status, v_enc.validation_status) in ('draft','complete')
    ) then
      raise exception 'Acces refuse';
    end if;
  end if;

  if p_expected_updated_at is not null
     and date_trunc('milliseconds', v_enc.updated_at)
       is distinct from date_trunc('milliseconds', p_expected_updated_at) then
    raise exception using
      errcode = 'P0001',
      message = 'CONFLIT_VERSION : la rencontre a ete modifiee entre-temps',
      detail = jsonb_build_object(
        'code', 'conflict_version',
        'entity', 'encounter',
        'action', 'refresh_required'
      )::text,
      hint = 'refresh_required';
  end if;

  v_new := coalesce(p_data, '{}'::jsonb) - 'age_at_encounter';
  perform public.assert_data_valid(v_enc.template_version_id, 'encounter', v_new);
  if coalesce(p_validation_status, v_enc.validation_status) <> 'draft'
     or not public.can_edit_structured_data(v_base) then
    perform public.assert_required_complete(
      v_enc.template_version_id, 'encounter', v_new, v_enc.encounter_type
    );
  end if;

  select date_of_birth into v_dob
    from public.patient_identity
   where base_id = v_base and patient_code = v_code and deleted_at is null;
  v_age := public.compute_age(v_dob, v_enc.encounter_date, coalesce(v_enc.age_unit, 'years'));

  v_old := v_enc.data;
  for v_key in
    select key from (
      select jsonb_object_keys(v_old) as key
      union
      select jsonb_object_keys(v_new) as key
    ) keys
  loop
    if (v_old -> v_key) is distinct from (v_new -> v_key) then
      insert into public.field_change_log
        (base_id, entity, entity_id, field_key, old_value, new_value, changed_by, reason, source)
      values
        (v_base, 'encounter', p_encounter_id, v_key, v_old -> v_key, v_new -> v_key,
         auth.uid(), p_reason, 'manual_correction');
    end if;
  end loop;

  update public.encounter
     set data = v_new,
         validation_status = coalesce(p_validation_status, v_enc.validation_status),
         age_value = v_age,
         updated_at = now()
   where id = p_encounter_id
   returning * into v_enc;
  return v_enc;
end $$;
revoke all on function public.update_encounter(uuid, jsonb, text, text, timestamptz) from public, anon;
grant execute on function public.update_encounter(uuid, jsonb, text, text, timestamptz) to authenticated;

-- Même contrat pour la fiche permanente. La version et le verrou existaient déjà ; cette
-- redéfinition additive ne change que la forme sûre de l'erreur de conflit, afin que le web
-- et le rejeu hors-ligne puissent demander un rechargement sans exposer de donnée clinique.
create or replace function public.update_patient(
  p_patient_id      uuid,
  p_data            jsonb,
  p_validation_status text,
  p_reason          text,
  p_expected_version bigint
) returns public.patient
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_pat public.patient;
  v_old jsonb;
  v_new jsonb;
  v_key text;
begin
  select * into v_pat
    from public.patient
   where id = p_patient_id and deleted_at is null
   for update;
  if not found then raise exception 'Patient introuvable'; end if;

  if not public.can_edit_structured_data(v_pat.base_id) then
    if not (
      public.can_create_structured_data(v_pat.base_id)
      and v_pat.created_by = auth.uid()
      and v_pat.validation_status = 'draft'
      and coalesce(p_validation_status, v_pat.validation_status) in ('draft','complete')
    ) then
      raise exception 'Acces refuse';
    end if;
  end if;

  if p_expected_version is null then
    raise exception using
      errcode = 'P0001',
      message = 'CONFLIT_VERSION : version patient requise',
      detail = jsonb_build_object(
        'code', 'conflict_version',
        'entity', 'patient',
        'action', 'refresh_required'
      )::text,
      hint = 'refresh_required';
  end if;
  if v_pat.row_version is distinct from p_expected_version then
    raise exception using
      errcode = 'P0001',
      message = 'CONFLIT_VERSION : le patient a ete modifie entre-temps',
      detail = jsonb_build_object(
        'code', 'conflict_version',
        'entity', 'patient',
        'action', 'refresh_required'
      )::text,
      hint = 'refresh_required';
  end if;

  perform public.assert_data_valid(v_pat.template_version_id, 'patient', coalesce(p_data, '{}'::jsonb));
  if coalesce(p_validation_status, v_pat.validation_status) <> 'draft'
     or not public.can_edit_structured_data(v_pat.base_id) then
    perform public.assert_required_complete(v_pat.template_version_id, 'patient', coalesce(p_data, '{}'::jsonb));
  end if;

  v_old := v_pat.data;
  v_new := coalesce(p_data, '{}'::jsonb);
  for v_key in
    select key from (
      select jsonb_object_keys(v_old) as key
      union
      select jsonb_object_keys(v_new) as key
    ) keys
  loop
    if (v_old -> v_key) is distinct from (v_new -> v_key) then
      insert into public.field_change_log
        (base_id, entity, entity_id, field_key, old_value, new_value, changed_by, reason, source)
      values
        (v_pat.base_id, 'patient', p_patient_id, v_key, v_old -> v_key, v_new -> v_key,
         auth.uid(), p_reason, 'manual_correction');
    end if;
  end loop;

  update public.patient
     set data = v_new,
         validation_status = coalesce(p_validation_status, v_pat.validation_status),
         updated_at = now()
   where id = p_patient_id
   returning * into v_pat;
  return v_pat;
end $$;
revoke all on function public.update_patient(uuid, jsonb, text, text, bigint) from public, anon;
grant execute on function public.update_patient(uuid, jsonb, text, text, bigint) to authenticated;
