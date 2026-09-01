-- =============================================================================
-- 20260815090000_template_rule_visibility.sql  (L32)
--
-- AFFICHAGE CONDITIONNEL : ne montrer les variables d'imagerie que si une imagerie a ete
-- faite. Troisieme forme de regle, a cote des deux existantes, dans la MEME structure JSON
-- a liste blanche d'operateurs -- jamais evaluee comme du code :
--
--   { "if":   { "field": "imagerie_faite", "operator": "equals", "value": true },
--     "then": { "field": "imagerie_type",  "operator": "visible" } }
--
-- `then.operator` n'accepte plus que deux verbes, et toujours aucun autre : `required`
-- (l'existant) et `visible` (ce lot).
--
-- -----------------------------------------------------------------------------
-- Compatibilite descendante : une regle d'affichage est INERTE pour l'ancien code
-- -----------------------------------------------------------------------------
-- `rule_holds` d'avant ce lot repond « respectee » a toute clause `then` dont l'operateur
-- n'est pas `required`, et le moteur React fait de meme. Une PWA installee non rafraichie,
-- ou un instantane hors-ligne deja telecharge, MONTRENT donc la variable au lieu de la
-- masquer -- ils n'echouent pas et n'effacent rien. Le serveur reste seul juge.
--
-- -----------------------------------------------------------------------------
-- La valeur d'un champ masque est EFFACEE, jamais en silence  (decision 2026-08-14)
-- -----------------------------------------------------------------------------
-- Conserver la valeur ferait raconter deux histoires differentes au formulaire et a
-- l'export : une colonne pourrait porter une valeur que le medecin croit avoir retiree, et
-- une analyse la compterait. L'interface annonce le nombre de valeurs concernees AVANT
-- l'enregistrement et n'efface qu'a l'enregistrement ; le serveur, lui, REFUSE a la
-- finalisation toute fiche portant encore la valeur d'un champ masque. L'erreur nomme le
-- libelle de la variable, jamais son contenu.
--
-- Aucune donnee existante n'est touchee : `guard_validation_rule_inuse` interdit deja
-- d'ajouter une regle a une version qui porte des donnees. Une regle d'affichage ne peut
-- donc PAS masquer retroactivement des fiches deja saisies -- il faut une nouvelle version
-- de gabarit, et les anciennes fiches gardent la leur. C'est aussi pourquoi l'export n'a
-- aucune evaluation de regle a faire : une colonne masquee est simplement absente des
-- donnees, donc vide, et la colonne reste presente pour les fiches ou la variable
-- s'appliquait.
--
-- -----------------------------------------------------------------------------
-- VISIBILITE D'ABORD, OBLIGATION ENSUITE
-- -----------------------------------------------------------------------------
-- Un champ masque ne peut pas etre obligatoire, sinon une fiche devient impossible a
-- valider pour un champ que personne ne voit. L'ordre est impose ICI, pas seulement a
-- l'ecran : `assert_required_complete` et `assert_validation_rules` gardent leur signature
-- et sautent les champs masques, donc TOUS leurs appelants (saisie directe, curation,
-- import, declencheur de finalisation) heritent de l'ordre sans etre modifies.
--
-- -----------------------------------------------------------------------------
-- Cycles interdits a l'ENREGISTREMENT de la regle
-- -----------------------------------------------------------------------------
-- « A masque par B, B masque par A » rend les deux variables definitivement invisibles :
-- aucune ne peut etre renseignee, donc aucune ne peut satisfaire la condition de l'autre.
-- Le graphe est valide quand la regle est ecrite, pas a chaque saisie : une fiche ne doit
-- jamais avoir a se defendre contre un gabarit incoherent.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Champs MASQUES pour un jeu de donnees
-- -----------------------------------------------------------------------------
-- Trois proprietes, identiques au moteur React (src/domain/validation.ts) :
--   * condition non verifiable -> MASQUE (lecture stricte : un formulaire vierge ne montre
--     pas les variables conditionnelles) ;
--   * plusieurs regles sur une meme variable se cumulent en ET ;
--   * une variable pilote elle-meme masquee est lue comme ABSENTE -> masquage en cascade,
--     d'ou le point fixe.
-- L'ensemble ne fait que grandir et le nombre de passes est borne par le nombre de regles :
-- la boucle termine meme si un gabarit incoherent avait echappe au controle de cycles.
--
-- `field_key` etant unique par version tous scopes confondus, l'ensemble n'a pas besoin de
-- connaitre le scope : une cle designe une variable et une seule.
create or replace function public.visibility_hidden_fields(p_version uuid, p_data jsonb)
returns text[] language plpgsql stable set search_path = public, pg_temp as $$
declare
  v_rules  jsonb[];
  v_rule   jsonb;
  v_hidden text[] := '{}';
  v_target text;
  v_cond   text;
  v_driver jsonb;
  v_changed boolean := true;
  v_passes int := 0;
begin
  if p_version is null then return v_hidden; end if;

  select coalesce(array_agg(vr.rule), '{}'::jsonb[]) into v_rules
    from public.validation_rule vr
   where vr.template_version_id = p_version
     and vr.rule ? 'if' and vr.rule ? 'then'
     and (vr.rule -> 'then' ->> 'operator') = 'visible'
     and (vr.rule -> 'then' ->> 'field') is not null
     and (vr.rule -> 'if' ->> 'field') is not null
     and (vr.rule -> 'if' ->> 'operator') is not null;

  if coalesce(array_length(v_rules, 1), 0) = 0 then return v_hidden; end if;

  while v_changed and v_passes <= array_length(v_rules, 1) loop
    v_changed := false;
    v_passes := v_passes + 1;
    foreach v_rule in array v_rules loop
      v_target := v_rule -> 'then' ->> 'field';
      continue when v_target = any(v_hidden);
      v_cond := v_rule -> 'if' ->> 'field';
      -- Pilote masque = pilote absent : c'est ce qui fait la cascade.
      v_driver := case when v_cond = any(v_hidden) then null else p_data -> v_cond end;
      -- Deux `if` distincts et non une disjonction : l'ordre d'evaluation d'un `or` n'est pas
      -- garanti, et `rule_apply_op` sur une valeur absente comparerait deux chaines vides.
      if not public.rule_value_present(v_driver) then
        v_hidden := v_hidden || v_target; v_changed := true;
      elsif not public.rule_apply_op(v_rule -> 'if' ->> 'operator', v_driver, v_rule -> 'if' -> 'value') then
        v_hidden := v_hidden || v_target; v_changed := true;
      end if;
    end loop;
  end loop;

  return v_hidden;
end $$;
grant execute on function public.visibility_hidden_fields(uuid, jsonb) to authenticated;

-- -----------------------------------------------------------------------------
-- 2. Evaluation des regles, consciente du masquage
-- -----------------------------------------------------------------------------
-- Une regle d'AFFICHAGE ne se viole pas : elle dit ce qu'on montre, elle n'exige rien.
-- Une regle qui porte sur un champ masque est inapplicable, comme lorsqu'un operande manque.
create or replace function public.rule_holds(rule jsonb, data jsonb, hidden text[])
returns boolean language plpgsql immutable set search_path = public, pg_temp as $$
declare cond jsonb; thn jsonb; op text; cf text; tf text; lf text; rf text;
  comparison text[] := array['equals','not_equals','greater_than','greater_or_equal','less_than','less_or_equal'];
  conditionop text[] := array['equals','not_equals','greater_than','greater_or_equal','less_than','less_or_equal','in'];
  v_hidden text[] := coalesce(hidden, '{}');
begin
  if rule is null or jsonb_typeof(rule) <> 'object' then return true; end if;

  -- Conditionnelle : { if:{field,operator,value}, then:{field, operator:'required'|'visible'} }
  if (rule ? 'if') and (rule ? 'then') then
    cond := rule -> 'if'; thn := rule -> 'then';
    if (thn ->> 'operator') = 'visible' then return true; end if;   -- regle d'affichage : rien a exiger
    op := cond ->> 'operator'; cf := cond ->> 'field'; tf := thn ->> 'field';
    if op is null or not (op = any(conditionop)) then return true; end if;          -- operateur non whitelist -> ignoree
    -- VISIBILITE D'ABORD : ni la condition ni l'exigence ne portent sur un champ masque.
    if cf = any(v_hidden) or tf = any(v_hidden) then return true; end if;
    if cf is null or not public.rule_value_present(data -> cf) then return true; end if; -- condition inapplicable
    if not public.rule_apply_op(op, data -> cf, cond -> 'value') then return true; end if; -- condition fausse -> respectee
    if (thn ->> 'operator') = 'required' then
      return public.rule_value_present(data -> tf);
    end if;
    return true;
  end if;

  -- Comparaison : { operator, left_field, right_field }
  if rule ? 'operator' then
    op := rule ->> 'operator';
    if not (op = any(comparison)) then return true; end if;
    lf := rule ->> 'left_field'; rf := rule ->> 'right_field';
    if lf is null or rf is null then return true; end if;
    if lf = any(v_hidden) or rf = any(v_hidden) then return true; end if;
    if not public.rule_value_present(data -> lf) or not public.rule_value_present(data -> rf) then
      return true; -- regle inapplicable si un operande absent
    end if;
    return public.rule_apply_op(op, data -> lf, data -> rf);
  end if;

  return true;
end $$;
grant execute on function public.rule_holds(jsonb, jsonb, text[]) to authenticated;

-- Signature historique CONSERVEE : elle delegue, sans masquage. Un appelant qui l'utilise
-- encore obtient exactement le comportement d'avant ce lot.
create or replace function public.rule_holds(rule jsonb, data jsonb)
returns boolean language sql immutable set search_path = public, pg_temp as $$
  select public.rule_holds(rule, data, '{}'::text[])
$$;

-- Impose les regles `block` d'une version, apres avoir ecarte les champs masques.
create or replace function public.assert_validation_rules(p_version uuid, p_data jsonb)
returns void language plpgsql stable set search_path = public, pg_temp as $$
declare r record; v_hidden text[];
begin
  if p_data is null then return; end if;
  v_hidden := public.visibility_hidden_fields(p_version, p_data);
  for r in
    select rule, coalesce(message, 'Regle de coherence non respectee') as message
    from public.validation_rule
    where template_version_id = p_version and severity = 'block'
  loop
    if not public.rule_holds(r.rule, p_data, v_hidden) then
      raise exception '%', r.message;
    end if;
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- 3. Completude : un champ MASQUE n'est jamais obligatoire
-- -----------------------------------------------------------------------------
-- Signature inchangee : saisie directe, curation, import et declencheur de finalisation
-- heritent de l'ordre d'evaluation sans une seule ligne modifiee chez eux.
create or replace function public.assert_required_complete(
  p_version uuid, p_scope text, p_data jsonb, p_encounter_type text default null
)
returns void language plpgsql stable set search_path = public, pg_temp as $$
declare f record; v jsonb; v_hidden text[];
begin
  v_hidden := public.visibility_hidden_fields(p_version, p_data);
  for f in
    select field_key, label from public.template_field
    where template_version_id = p_version and scope = p_scope and required = true
      -- Champ de rencontre restreint a certains types : requis SEULEMENT pour ces types.
      -- Type inconnu (null) -> on n'allege pas (conservateur).
      and (
        p_scope <> 'encounter'
        or p_encounter_type is null
        or encounter_types is null
        or cardinality(encounter_types) = 0
        or p_encounter_type = any(encounter_types)
      )
      -- L32 : masque -> pas obligatoire. Sinon la fiche devient invalidable a l'aveugle.
      and not (field_key = any(v_hidden))
  loop
    v := p_data -> f.field_key;
    if (p_data is null) or (not (p_data ? f.field_key)) or (v is null) or (jsonb_typeof(v) = 'null')
       or (jsonb_typeof(v) = 'string' and (v #>> '{}') = '') then
      raise exception 'Champ requis manquant : %', coalesce(f.label, f.field_key);
    end if;
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- 4. Une fiche FINALISEE ne porte pas la valeur d'un champ masque
-- -----------------------------------------------------------------------------
-- L'effacement est produit par l'interface, qui l'annonce avant de le faire. Ce controle
-- est le filet : il refuse ce qui a contourne le formulaire (appel API direct, instantane
-- hors-ligne perime), au lieu d'effacer en silence a la place de la personne. Le message
-- nomme le LIBELLE de la variable et jamais son contenu, qui est une donnee de dossier.
create or replace function public.assert_no_hidden_values(p_version uuid, p_scope text, p_data jsonb)
returns void language plpgsql stable set search_path = public, pg_temp as $$
declare v_hidden text[]; f record;
begin
  if p_data is null then return; end if;
  v_hidden := public.visibility_hidden_fields(p_version, p_data);
  if coalesce(array_length(v_hidden, 1), 0) = 0 then return; end if;

  for f in
    select tf.field_key, tf.label from public.template_field tf
    where tf.template_version_id = p_version and tf.scope = p_scope
      and tf.field_key = any(v_hidden)
      and p_data ? tf.field_key
      and public.rule_value_present(p_data -> tf.field_key)
    order by tf.display_order, tf.field_key
  loop
    raise exception 'Variable masquee par une regle d''affichage : % -- retirez sa valeur avant de finaliser',
      coalesce(f.label, f.field_key);
  end loop;
end $$;
grant execute on function public.assert_no_hidden_values(uuid, text, jsonb) to authenticated;

-- Declencheur de finalisation : meme corps qu'en 20260616093800, plus le controle ci-dessus.
-- L'ordre compte : completude et regles ont deja ecarte les champs masques, ce dernier
-- controle verifie qu'aucune VALEUR ne subsiste sous un champ masque.
create or replace function public.assert_curated_complete()
returns trigger language plpgsql set search_path = public, pg_temp as $$
declare v_scope text := case when tg_table_name = 'patient' then 'patient' else 'encounter' end;
begin
  -- §4.5 : aucune cle inconnue du gabarit, QUEL QUE SOIT le statut (draft / complete / curated).
  perform public.assert_no_unknown_fields(new.template_version_id, v_scope, new.data);

  -- Validation complete (bornes/types deja portees par les RPC ; ici en defense) + completude +
  -- regles : uniquement a la FINALISATION (curated).
  if new.validation_status = 'curated' then
    perform public.assert_data_valid(new.template_version_id, v_scope, new.data);
    if v_scope = 'patient' then
      perform public.assert_required_complete(new.template_version_id, 'patient', new.data);
    else
      perform public.assert_required_complete(new.template_version_id, 'encounter', new.data, new.encounter_type);
    end if;
    perform public.assert_validation_rules(new.template_version_id, new.data);
    perform public.assert_no_hidden_values(new.template_version_id, v_scope, new.data);
  end if;
  return new;
end $$;

-- -----------------------------------------------------------------------------
-- 5. Structure de la regle : `visible` accepte, meme scope, et graphe acyclique
-- -----------------------------------------------------------------------------
create or replace function public.assert_rule_structure(p_version_id uuid, p_rule jsonb)
returns void language plpgsql stable set search_path = public, pg_temp as $$
declare
  op text; lf text; rf text; cf text; tf text; thenop text; cf_scope text; tf_scope text;
  ok_ops    text[] := array['equals','not_equals','greater_than','greater_or_equal','less_than','less_or_equal'];
  ok_if_ops text[] := array['equals','not_equals','greater_than','greater_or_equal','less_than','less_or_equal','in'];
  ok_then   text[] := array['required','visible'];
begin
  if p_rule ? 'operator' and p_rule ? 'left_field' and p_rule ? 'right_field' then
    op := p_rule ->> 'operator';
    if not (op = any(ok_ops)) then raise exception 'Operateur de regle invalide : %', op; end if;
    lf := p_rule ->> 'left_field'; rf := p_rule ->> 'right_field';
    if not exists (select 1 from public.template_field where template_version_id = p_version_id and field_key = lf) then
      raise exception 'Champ inconnu dans la regle : %', lf; end if;
    if not exists (select 1 from public.template_field where template_version_id = p_version_id and field_key = rf) then
      raise exception 'Champ inconnu dans la regle : %', rf; end if;
  elsif p_rule ? 'if' and p_rule ? 'then' then
    op := p_rule -> 'if' ->> 'operator'; cf := p_rule -> 'if' ->> 'field'; tf := p_rule -> 'then' ->> 'field';
    thenop := p_rule -> 'then' ->> 'operator';
    if not (op = any(ok_if_ops)) then raise exception 'Operateur conditionnel invalide : %', op; end if;
    if thenop is null or not (thenop = any(ok_then)) then
      raise exception 'La clause then doit etre operator=required ou operator=visible'; end if;
    select scope into cf_scope from public.template_field
     where template_version_id = p_version_id and field_key = cf;
    if cf is null or cf_scope is null then
      raise exception 'Champ inconnu dans la regle (if) : %', coalesce(cf, '?'); end if;
    select scope into tf_scope from public.template_field
     where template_version_id = p_version_id and field_key = tf;
    if tf is null or tf_scope is null then
      raise exception 'Champ inconnu dans la regle (then) : %', coalesce(tf, '?'); end if;

    if thenop = 'visible' then
      -- Une variable ne peut pas commander son propre affichage : elle ne s'afficherait jamais.
      if cf = tf then
        raise exception 'Regle d''affichage : une variable ne peut pas commander son propre affichage'; end if;
      -- Patient et rencontre sont deux fiches distinctes : une condition portee par l'autre
      -- fiche n'est jamais verifiable, donc masquerait la variable pour toujours.
      if cf_scope <> tf_scope then
        raise exception 'Regle d''affichage : les deux variables doivent appartenir a la meme fiche (patient ou visite)'; end if;
    end if;
  else
    raise exception 'Structure de regle invalide (attendu {operator,left_field,right_field} ou {if,then})';
  end if;
end $$;

-- Acyclicite du graphe d'affichage, VERIFIEE A L'ENREGISTREMENT de la regle.
-- Arete pilote -> pilotee : l'affichage de `then.field` DEPEND de `if.field`. Un cycle
-- existe si, en remontant les dependances depuis la variable pilote, on retombe sur la
-- variable pilotee. `p_rule_id` exclut la ligne en cours de mise a jour, qui est encore
-- presente en base sous son ancienne forme.
create or replace function public.assert_visibility_acyclic(p_version_id uuid, p_rule jsonb, p_rule_id uuid)
returns void language plpgsql stable set search_path = public, pg_temp as $$
declare v_from text; v_to text; v_cycle boolean;
begin
  if not (p_rule ? 'if' and p_rule ? 'then') then return; end if;
  if (p_rule -> 'then' ->> 'operator') is distinct from 'visible' then return; end if;
  v_from := p_rule -> 'if' ->> 'field';
  v_to   := p_rule -> 'then' ->> 'field';
  if v_from is null or v_to is null then return; end if;

  with recursive edges(child, parent) as (
    select vr.rule -> 'then' ->> 'field', vr.rule -> 'if' ->> 'field'
      from public.validation_rule vr
     where vr.template_version_id = p_version_id
       and (p_rule_id is null or vr.id <> p_rule_id)
       and vr.rule ? 'if' and vr.rule ? 'then'
       and (vr.rule -> 'then' ->> 'operator') = 'visible'
    union all
    select v_to, v_from
  ),
  reach(node) as (
    select v_from
    union
    select e.parent from edges e join reach r on e.child = r.node
  )
  select exists (select 1 from reach where node = v_to) into v_cycle;

  if v_cycle then
    raise exception 'Regle d''affichage circulaire : % finirait par dependre de lui-meme', v_to;
  end if;
end $$;
grant execute on function public.assert_visibility_acyclic(uuid, jsonb, uuid) to authenticated;

create or replace function public.guard_validation_rule_structure()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  perform public.assert_rule_structure(new.template_version_id, new.rule);
  perform public.assert_visibility_acyclic(new.template_version_id, new.rule, new.id);
  return new;
end $$;
