-- =============================================================================
-- L74e — Refus à l'écriture des règles sans effet (docs/l74-contexte-patient-occurrences.md,
-- §2.2 P1 à P5, §4 D5, arbitrage du 7 octobre 2026).
--
-- Chaque règle s'évalue sur UNE fiche : la fiche patient, une rencontre ordinaire, ou une
-- occurrence d'un groupe répétable (désigné par sa section, à toute profondeur). Une règle
-- dont les opérandes ne sont pas lus sur la même fiche ne fonctionne jamais, à une
-- exception près (D2, L74a) : une variable permanente peut commander l'AFFICHAGE d'une
-- variable de groupe.
--
-- | Règle                                          | Exigence                                    |
-- |------------------------------------------------|---------------------------------------------|
-- | `visible` sur une variable                     | même espace, ou pilote permanent → groupe   |
-- | `required`, comparaison                        | même espace                                 |
-- | `visible` sur un bloc portant un groupe enfant | pilote permanent (P5)                       |
-- | `visible` sur un bloc, pilote dans un groupe   | refusée (la fiche ne lit pas ses occurrences)|
--
-- Le critère est celui de `src/domain/ruleSpaces.ts` (L74d), plus la dernière ligne,
-- arbitrée après son écriture.
--
-- Où le refus s'applique (contrainte impérative de D5) :
--   * `assert_rule_structure` n'est PAS modifiée : `validate_template_version_invariants`
--     la rejoue sur toutes les règles d'une version à chaque modification de structure. Une
--     version qui porte déjà une règle sans effet reste donc entièrement modifiable.
--   * Le refus vit dans la garde de LIGNE `guard_validation_rule_structure`, à l'insertion
--     ou à la modification du CONTENU d'une règle (`rule` ou version), écrite directement.
--   * Une règle reprise à l'identique d'une autre version (duplication, version suivante,
--     promotion, base depuis un modèle, import de bloc ou de définition, préparation de
--     formulaire) n'est pas une écriture nouvelle : elle est acceptée telle quelle.
--   * Une réécriture portée par un autre déclencheur (suivi du renommage d'une clé,
--     `follow_template_field_key_rename`) n'est pas non plus une écriture de la règle.
--   * Cas symétrique de P5 : rendre répétable une sous-section, ou y déplacer un groupe, sous
--     un bloc déjà commandé par une variable non permanente. Nouveau déclencheur de ligne sur
--     `template_section`, limité aux changements de `is_repeatable` et de parent ; la garde
--     existante `guard_template_section_write` n'est pas redéfinie.
--
-- Aucun message ne nomme une valeur : seulement le problème. Rien d'autre ne change.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. Espace d'évaluation d'une variable
-- -----------------------------------------------------------------------------
-- 'patient' | 'encounter' | 'group:<section_key>' ; null pour une variable inconnue.
-- Miroir de `fieldRuleSpace` : une variable permanente est lue sur la fiche patient ; une
-- variable de rencontre l'est dans le groupe de sa section ou d'un ancêtre répétable, sinon
-- sur la rencontre ordinaire. Une variable sans section relève de la section de repli
-- `other`, comme côté web. Une boucle de parents s'arrête sans verdict de groupe.
create or replace function public.rule_field_space(p_version_id uuid, p_field_key text)
returns text language sql stable security invoker set search_path = public, pg_temp as $$
  with recursive field as (
    select f.scope, coalesce(nullif(btrim(f.section), ''), 'other') as section_key
      from public.template_field f
     where f.template_version_id = p_version_id and f.field_key = p_field_key
  ), chain(id, section_key, parent_section_id, is_repeatable, depth, path) as (
    select s.id, s.section_key, s.parent_section_id, s.is_repeatable, 1, array[s.id]
      from public.template_section s
      join field on field.section_key = s.section_key
     where s.template_version_id = p_version_id and field.scope <> 'patient'
    union all
    select p.id, p.section_key, p.parent_section_id, p.is_repeatable, c.depth + 1, c.path || p.id
      from chain c
      join public.template_section p on p.id = c.parent_section_id
     where not p.id = any(c.path)
  )
  select case
    when field.scope = 'patient' then 'patient'
    else coalesce(
      (select 'group:' || c.section_key from chain c where c.is_repeatable order by c.depth limit 1),
      'encounter')
  end
  from field;
$$;
revoke all on function public.rule_field_space(uuid, text) from public, anon;
grant execute on function public.rule_field_space(uuid, text) to authenticated;

-- Le bloc porte-t-il un groupe répétable parmi ses descendants stricts ? Miroir de
-- `sectionCarriesGroup`.
create or replace function public.rule_section_carries_group(p_version_id uuid, p_section_key text)
returns boolean language sql stable security invoker set search_path = public, pg_temp as $$
  with recursive descendants(id, is_repeatable, path) as (
    select c.id, c.is_repeatable, array[s.id, c.id]
      from public.template_section s
      join public.template_section c on c.parent_section_id = s.id
     where s.template_version_id = p_version_id and s.section_key = p_section_key
    union all
    select c.id, c.is_repeatable, d.path || c.id
      from descendants d
      join public.template_section c on c.parent_section_id = d.id
     where not c.id = any(d.path)
  )
  select exists (select 1 from descendants where is_repeatable);
$$;
revoke all on function public.rule_section_carries_group(uuid, text) from public, anon;
grant execute on function public.rule_section_carries_group(uuid, text) to authenticated;

-- -----------------------------------------------------------------------------
-- 2. Verdict d'une règle
-- -----------------------------------------------------------------------------
-- Code du problème, ou null si la règle peut fonctionner. Miroir de `ruleSpaceVerdict` :
-- une règle illisible ou qui cite une variable inconnue est déclarée utilisable, sa
-- structure et l'existence de ses opérandes restant vérifiées par `assert_rule_structure`.
create or replace function public.rule_space_problem(p_version_id uuid, p_rule jsonb)
returns text language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare
  v_left   text;
  v_right  text;
  v_driver text;
  v_target text;
  v_verb   text;
begin
  if p_rule is null or jsonb_typeof(p_rule) is distinct from 'object' then
    return null;
  end if;

  if p_rule ? 'left_field' and p_rule ? 'right_field' then
    v_left := public.rule_field_space(p_version_id, p_rule ->> 'left_field');
    v_right := public.rule_field_space(p_version_id, p_rule ->> 'right_field');
    if v_left is null or v_right is null or v_left = v_right then
      return null;
    end if;
    return 'comparison_cross_space';
  end if;

  if jsonb_typeof(p_rule -> 'if') is distinct from 'object'
     or jsonb_typeof(p_rule -> 'then') is distinct from 'object' then
    return null;
  end if;
  v_driver := public.rule_field_space(p_version_id, p_rule -> 'if' ->> 'field');
  if v_driver is null then
    return null;
  end if;
  v_verb := p_rule -> 'then' ->> 'operator';

  if v_verb = 'visible' and jsonb_typeof(p_rule -> 'then' -> 'section') = 'string' then
    if v_driver <> 'patient'
       and public.rule_section_carries_group(p_version_id, p_rule -> 'then' ->> 'section') then
      return 'block_group_driver';
    end if;
    -- Arbitrage du 7 octobre : une rencontre ou une fiche ne lit pas les occurrences.
    if v_driver like 'group:%' then
      return 'block_driver_in_group';
    end if;
    return null;
  end if;

  if v_verb is distinct from 'visible' and v_verb is distinct from 'required' then
    return null;
  end if;
  v_target := public.rule_field_space(p_version_id, p_rule -> 'then' ->> 'field');
  if v_target is null or v_target = v_driver then
    return null;
  end if;
  if v_verb = 'visible' and v_driver = 'patient' and v_target like 'group:%' then
    return null;
  end if;
  return case v_verb when 'visible' then 'visible_cross_space' else 'required_cross_space' end;
end $$;
revoke all on function public.rule_space_problem(uuid, jsonb) from public, anon;
grant execute on function public.rule_space_problem(uuid, jsonb) to authenticated;

-- Refus structuré. Le message dit pourquoi, sans aucune valeur ni libellé.
create or replace function public.rule_without_effect_error(p_problem text)
returns void language plpgsql set search_path = public, pg_temp as $$
begin
  raise exception using
    errcode = 'P0001',
    message = case p_problem
      when 'visible_cross_space' then
        'Regle sans effet : le pilote et la variable affichee ne sont pas lus sur la meme fiche. Seule une variable permanente peut commander l''affichage d''une variable de groupe.'
      when 'required_cross_space' then
        'Regle sans effet : une obligation ne relie que des variables lues sur la meme fiche (patient, visite ou meme groupe repetable).'
      when 'comparison_cross_space' then
        'Regle sans effet : une comparaison ne relie que des variables lues sur la meme fiche (patient, visite ou meme groupe repetable).'
      when 'block_group_driver' then
        'Regle sans effet : un bloc qui porte un groupe repetable ne peut etre commande que par une variable permanente.'
      when 'block_driver_in_group' then
        'Regle sans effet : une variable de groupe repetable ne peut pas commander l''affichage d''un bloc.'
      else 'Regle sans effet'
    end,
    detail = jsonb_build_object('code', 'RULE_WITHOUT_EFFECT', 'problem', p_problem)::text;
end $$;
revoke all on function public.rule_without_effect_error(text) from public, anon;
grant execute on function public.rule_without_effect_error(text) to authenticated;

-- -----------------------------------------------------------------------------
-- 3. Garde de ligne des règles
-- -----------------------------------------------------------------------------
-- Corps de 20260927121847 (structure, opérandes calculés), plus le refus D5. Celui-ci ne
-- s'applique qu'à une écriture de la règle elle-même :
--   * par une personne authentifiée, comme le gel des versions publiées : une écriture de
--     maintenance sans identité (service, reprise de données) n'est pas une saisie ;
--   * insertion, ou modification de `rule` ou de la version (pas du message ni de la
--     gravité, qui laissent une règle existante telle quelle) ;
--   * au premier niveau de déclencheur : une réécriture portée par un autre déclencheur
--     (renommage de clé) n'en est pas une ;
--   * à l'insertion, une règle identique à une règle d'une autre version est une reprise,
--     pas une écriture nouvelle (D5 : les règles existantes ne sont jamais bloquées).
-- La version est verrouillée avant le verdict, comme le fait la garde des sections : une
-- règle et un changement de structure concurrents ne peuvent pas se croiser.
create or replace function public.guard_validation_rule_structure()
returns trigger language plpgsql set search_path = public, pg_temp as $$
declare v_problem text;
begin
  perform public.assert_rule_structure(new.template_version_id, new.rule);
  perform public.assert_rule_calculated_operands(new.template_version_id, new.rule);

  if auth.uid() is not null
     and pg_trigger_depth() = 1
     and (tg_op = 'INSERT'
          or new.rule is distinct from old.rule
          or new.template_version_id is distinct from old.template_version_id) then
    perform 1 from public.template_version where id = new.template_version_id for update;
    v_problem := public.rule_space_problem(new.template_version_id, new.rule);
    if v_problem is not null
       and not (tg_op = 'INSERT' and exists (
         select 1 from public.validation_rule r
          where r.rule = new.rule and r.template_version_id <> new.template_version_id
       )) then
      perform public.rule_without_effect_error(v_problem);
    end if;
  end if;
  return new;
end $$;

-- -----------------------------------------------------------------------------
-- 4. Cas symétrique de P5 : garde des sections
-- -----------------------------------------------------------------------------
-- Une section devient un groupe sous un bloc, ou un groupe rejoint un bloc : si ce bloc
-- (ou un ancêtre) est déjà commandé par une variable non permanente, le groupe serait
-- toujours masqué. Seul ce changement est refusé ; le rejeu des invariants n'est pas
-- concerné, et une version qui porte déjà ce cas reste modifiable. La recopie de version
-- insère les sections avant les règles : elle ne rencontre jamais ce refus.
create or replace function public.guard_template_section_rule_space()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if auth.uid() is null
     or pg_trigger_depth() <> 1
     or not new.is_repeatable
     or new.parent_section_id is null
     or (tg_op = 'UPDATE'
         and old.is_repeatable is not distinct from new.is_repeatable
         and old.parent_section_id is not distinct from new.parent_section_id) then
    return new;
  end if;
  -- Même verrou que la garde des règles, pris avant de lire les règles.
  perform 1 from public.template_version where id = new.template_version_id for update;
  if exists (
       with recursive ancestors(id, section_key, parent_section_id, path) as (
         select s.id, s.section_key, s.parent_section_id, array[s.id]
           from public.template_section s
          where s.id = new.parent_section_id
         union all
         select p.id, p.section_key, p.parent_section_id, a.path || p.id
           from ancestors a
           join public.template_section p on p.id = a.parent_section_id
          where not p.id = any(a.path)
       )
       select 1
         from ancestors a
         join public.validation_rule r
           on r.template_version_id = new.template_version_id
          and r.rule -> 'then' ->> 'operator' = 'visible'
          and r.rule -> 'then' ->> 'section' = a.section_key
        where public.rule_field_space(new.template_version_id, r.rule -> 'if' ->> 'field')
              is distinct from 'patient'
     ) then
    perform public.rule_without_effect_error('block_group_driver');
  end if;
  return new;
end $$;
revoke all on function public.guard_template_section_rule_space() from public, anon, authenticated;

drop trigger if exists trg_template_section_rule_space on public.template_section;
create trigger trg_template_section_rule_space
  before insert or update of is_repeatable, parent_section_id on public.template_section
  for each row execute function public.guard_template_section_rule_space();

notify pgrst, 'reload schema';
commit;
