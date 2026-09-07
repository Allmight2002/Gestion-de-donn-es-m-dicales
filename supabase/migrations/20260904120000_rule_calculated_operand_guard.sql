-- =============================================================================
-- 20260904120000_rule_calculated_operand_guard.sql   (correctif L32 x L35)
--
-- UNE REGLE NE PEUT PAS PORTER SUR UNE VARIABLE CALCULEE.
--
-- L35 (20260820120000) est categorique : « LE RESULTAT N'EST JAMAIS STOCKE ». Rien n'est
-- ecrit dans `patient.data` ni `encounter.data` sous la cle d'une variable calculee, et
-- aucune RPC ne calcule. Le validateur de structure des regles (L32, 20260815090000) est
-- ANTERIEUR DE CINQ JOURS aux formules : il verifie l'appartenance des champs a la version,
-- l'auto-reference, l'egalite de portee et l'acyclicite -- mais rien ne l'avertit qu'un
-- operande peut designer une valeur qui n'existera jamais dans les donnees.
--
-- Consequence, avant ce correctif : `visibility_hidden_fields` lit le pilote par
-- `p_data -> v_cond`, ne trouve rien, et `rule_value_present` etant faux, elle masque la
-- cible -- a chaque evaluation, definitivement. Un bloc « malnutrition » pilote par un
-- rapport poids/taille calcule disparait du formulaire sans un mot, et une fiche qui porte
-- encore sa valeur est refusee a la finalisation par `assert_no_hidden_values`.
--
-- -----------------------------------------------------------------------------
-- CE QUI EST REFUSE, ET POURQUOI CE N'EST PAS LA MEME CHOSE PARTOUT
-- -----------------------------------------------------------------------------
-- L'operande absent produit trois effets differents selon la forme de la regle. Le critere
-- retenu n'est pas « il y a une variable calculee quelque part » mais « la regle ne peut
-- plus faire son travail, pour aucune donnee, jamais » :
--
--   * `visible` + pilote calcule (`visible_driver`) -- la cible est masquee POUR TOUJOURS et
--     la fiche qui porte sa valeur devient infinalisable. DESTRUCTEUR. C'est exactement le
--     raisonnement que L32 tenait deja pour les portees croisees : « une condition portee
--     par l'autre fiche n'est jamais verifiable, donc masquerait la variable pour toujours ».
--     Ce correctif applique cette phrase a un cas que son auteur ne pouvait pas connaitre.
--
--   * `required` + cible calculee (`required_target`) -- des que la condition est vraie,
--     `rule_holds` exige une valeur qui n'est jamais saisie : la regle est TOUJOURS violee et
--     la fiche ne peut plus etre finalisee. DESTRUCTEUR. Le produit refuse deja
--     `required = true` sur une variable calculee (« rien n'y est saisi, personne ne pourrait
--     la completer ») : l'exiger par une regle est la meme promesse ecrite autrement, et la
--     refuser est une mise en coherence, pas une extension.
--
--   * `required` + pilote calcule (`required_driver`) et comparaison portant sur un calcul
--     (`comparison_operand`) -- la regle est INERTE : `rule_holds` la declare inapplicable et
--     rend « respectee ». Rien n'est detruit. Refuser demandait donc un argument propre, et
--     le voici : le gabarit affiche une exigence de completude ou de coherence en toutes
--     lettres (`RuleSummary` en fait une phrase francaise) et ne l'applique jamais. Une
--     garantie fausse est un defaut de registre clinique a part entiere ; elle est decidable
--     A L'ECRITURE, sans donnee ; et la rendre vraie supposerait d'evaluer la formule en
--     PL/pgSQL, ce que L35 interdit comme sa propriete centrale. Accepter la regle
--     reviendrait a laisser croire a un controle architecturalement hors de portee.
--
--   * `visible` + CIBLE calculee -- RESTE AUTORISE. Masquer un resultat affiche ne detruit
--     rien : il n'y a aucune valeur a saisir, aucune fiche a refuser, et `assert_no_hidden_values`
--     ne trouve jamais de valeur sous cette cle. Interdire ce cas retirerait une possibilite
--     utile sans rien proteger.
--
-- -----------------------------------------------------------------------------
-- Le message NOMME la variable, JAMAIS son contenu
-- -----------------------------------------------------------------------------
-- Le libelle est une metadonnee de gabarit. Ni la formule elle-meme ni aucune valeur de
-- dossier n'apparaissent dans le refus.
--
-- -----------------------------------------------------------------------------
-- LES REGLES DEJA ENREGISTREES NE SONT PAS REVALIDEES
-- -----------------------------------------------------------------------------
-- Aucune contrainte de table, aucune revalidation en masse : le controle vit dans les
-- declencheurs d'ECRITURE. Une version existante continue donc de se charger, de s'evaluer
-- et de s'exporter exactement comme avant -- une correction qui empecherait d'ouvrir une
-- version serait pire que le defaut qu'elle repare.
--
-- Ce qui change pour une regle heritee : la MODIFIER devient impossible (le declencheur
-- couvre `insert or update`), la SUPPRIMER reste possible. C'est voulu : on ne retouche pas
-- une regle qui ne peut pas fonctionner, on la remplace. Et si la version est publiee ou
-- archivee -- donc immuable -- le seul chemin reste une nouvelle version de gabarit.
--
-- `calculated_field_rule_conflicts(version)` existe pour cela : elle liste, sans rien
-- modifier, les regles concernees d'une version, avec la variable en cause et la phrase a
-- afficher. Un diagnostic lisible plutot qu'un echec brut.
--
-- Migration ADDITIVE : aucune colonne, aucune contrainte de table, aucune reecriture, aucune
-- donnee patient ou rencontre touchee. Deux fonctions existantes sont remplacees par
-- `create or replace` (leurs declencheurs restent en place et pointent sur la nouvelle
-- definition), le reste est nouveau.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Ou une regle designe-t-elle une variable ?
-- -----------------------------------------------------------------------------
-- Fonction PURE de la regle : elle ne consulte pas le gabarit et ne dit pas si la variable
-- est calculee. Cette separation est ce qui permet de l'utiliser aux trois endroits qui en
-- ont besoin -- l'ecriture d'une regle, l'ajout d'une formule sur une variable existante, et
-- le diagnostic d'une version -- alors que le declencheur de `template_field` travaille sur
-- une formule qui n'est PAS ENCORE en base et qu'une lecture de table ne verrait pas.
--
-- `problem` est un code stable, pas une phrase : l'interface et les tests s'y accrochent, la
-- formulation peut evoluer sans les casser.
create or replace function public.rule_operand_positions(p_rule jsonb)
returns table (field_key text, problem text)
language sql immutable set search_path = public, pg_temp as $$
  select s.f, s.pb from (
    -- Comparaison : { operator, left_field, right_field }
    select (p_rule ->> 'left_field') as f, 'comparison_operand'::text as pb
     where p_rule ? 'operator' and p_rule ? 'left_field' and p_rule ? 'right_field'
    union all
    select (p_rule ->> 'right_field'), 'comparison_operand'
     where p_rule ? 'operator' and p_rule ? 'left_field' and p_rule ? 'right_field'
    union all
    -- Conditionnelle : le PILOTE. Le code depend du verbe, parce que la consequence en depend.
    select (p_rule -> 'if' ->> 'field'),
           case (p_rule -> 'then' ->> 'operator')
             when 'visible'  then 'visible_driver'::text
             when 'required' then 'required_driver'::text
           end
     where p_rule ? 'if' and p_rule ? 'then'
    union all
    -- Conditionnelle : la CIBLE, uniquement pour l'obligation. `visible` sur une cible
    -- calculee est legitime et n'est deliberement pas signalee.
    select (p_rule -> 'then' ->> 'field'), 'required_target'::text
     where p_rule ? 'if' and p_rule ? 'then' and (p_rule -> 'then' ->> 'operator') = 'required'
  ) s(f, pb)
  where s.f is not null and s.pb is not null
$$;

-- Depuis 20260714213326, `alter default privileges` retire EXECUTE a tout le monde sur
-- CHAQUE NOUVELLE fonction : une fonction sans GRANT explicite est injoignable. Ces trois
-- aides sont appelees a l'interieur de declencheurs `security invoker`, donc AVEC les droits
-- de la personne qui ecrit -- sans ce grant, enregistrer une regle echouerait sur
-- « permission denied » au lieu d'etre validee. Elles ne lisent que des metadonnees de
-- gabarit, sous la RLS de l'appelant.
grant execute on function public.rule_operand_positions(jsonb) to authenticated;

-- Libelle de la variable SI elle est calculee, sinon null. Une seule lecture de gabarit,
-- partagee : `field_key` est unique par version, toutes portees confondues.
create or replace function public.rule_calculated_field_label(p_version_id uuid, p_field_key text)
returns text language sql stable set search_path = public, pg_temp as $$
  select coalesce(nullif(btrim(tf.label), ''), tf.field_key)
    from public.template_field tf
   where tf.template_version_id = p_version_id
     and tf.field_key = p_field_key
     and nullif(btrim(tf.formula), '') is not null
   limit 1
$$;
grant execute on function public.rule_calculated_field_label(uuid, text) to authenticated;

-- La phrase vit a UN SEUL endroit : le refus a l'ecriture d'une regle, le refus a l'ajout
-- d'une formule et le diagnostic disent donc exactement la meme chose.
create or replace function public.rule_calculated_operand_message(p_problem text, p_label text)
returns text language sql immutable set search_path = public, pg_temp as $$
  select case p_problem
    when 'visible_driver' then
      'Regle d''affichage : « ' || p_label || ' » est une variable calculee, dont le resultat '
      || 'n''est jamais enregistre. La condition ne serait jamais verifiable et la variable a '
      || 'afficher resterait masquee pour toujours. Pilotez l''affichage par une variable saisie.'
    when 'required_target' then
      'Regle conditionnelle : « ' || p_label || ' » est une variable calculee, rien n''y est '
      || 'saisi. L''exiger rendrait la fiche impossible a finaliser.'
    when 'required_driver' then
      'Regle conditionnelle : « ' || p_label || ' » est une variable calculee, dont le resultat '
      || 'n''est jamais enregistre. La condition ne serait jamais verifiable et la regle ne se '
      || 'declencherait jamais. Conditionnez l''obligation a une variable saisie.'
    when 'comparison_operand' then
      'Regle de coherence : « ' || p_label || ' » est une variable calculee, dont le resultat '
      || 'n''est jamais enregistre. La regle ne se declencherait jamais. Comparez les variables '
      || 'saisies dont le calcul depend.'
    else
      'Regle incompatible avec la variable calculee « ' || p_label || ' »'
  end
$$;
grant execute on function public.rule_calculated_operand_message(text, text) to authenticated;

-- -----------------------------------------------------------------------------
-- 2. Refus a l'ECRITURE de la regle
-- -----------------------------------------------------------------------------
create or replace function public.assert_rule_calculated_operands(p_version_id uuid, p_rule jsonb)
returns void language plpgsql stable set search_path = public, pg_temp as $$
declare r record; v_label text;
begin
  if p_rule is null or jsonb_typeof(p_rule) <> 'object' then return; end if;
  for r in select p.field_key, p.problem from public.rule_operand_positions(p_rule) p loop
    v_label := public.rule_calculated_field_label(p_version_id, r.field_key);
    if v_label is not null then
      raise exception '%', public.rule_calculated_operand_message(r.problem, v_label);
    end if;
  end loop;
end $$;
-- Appelee par `guard_validation_rule_structure`, qui s'execute avec les droits de la personne
-- qui enregistre la regle : meme raison que pour les trois aides ci-dessus.
grant execute on function public.assert_rule_calculated_operands(uuid, jsonb) to authenticated;

-- Reprise a l'IDENTIQUE de la definition L32 (20260815090000), plus le controle ci-dessus.
-- Il se place APRES la structure -- inutile de parler de variables calculees a une regle dont
-- la forme est deja fausse -- et AVANT l'acyclicite, dont le graphe n'a de sens qu'entre
-- variables reellement pilotables.
create or replace function public.guard_validation_rule_structure()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  perform public.assert_rule_structure(new.template_version_id, new.rule);
  perform public.assert_rule_calculated_operands(new.template_version_id, new.rule);
  perform public.assert_visibility_acyclic(new.template_version_id, new.rule, new.id);
  return new;
end $$;

-- -----------------------------------------------------------------------------
-- 3. La porte de derriere : la regle d'abord, la formule ensuite
-- -----------------------------------------------------------------------------
-- Sans ce declencheur, l'interdiction se contourne en deux temps sur une version en
-- brouillon : poser la regle sur une variable saisie, puis lui ajouter une formule.
-- `guard_template_field_update` ne s'y oppose pas -- il ne regarde que les variables DEJA
-- RENSEIGNEES dans des dossiers, et un brouillon n'en a aucune.
--
-- Meme forme et meme portee de privileges que ses deux voisins `trg_template_field_formula*`
-- (L35) : `security invoker`, donc la lecture des regles reste soumise a la RLS de l'appelant,
-- exactement comme la lecture des operandes l'est deja dans `..._formula_operand`.
--
-- L'ordre alphabetique des declencheurs BEFORE le place APRES `trg_template_field_formula` :
-- `new.formula` est deja normalisee et validee quand ce controle s'execute.
create or replace function public.enforce_template_field_formula_rules()
returns trigger language plpgsql security invoker set search_path = public, pg_temp as $$
declare v_label text; v_problem text;
begin
  if nullif(btrim(new.formula), '') is null then return new; end if;
  v_label := coalesce(nullif(btrim(new.label), ''), new.field_key);

  select p.problem into v_problem
    from public.validation_rule vr
    cross join lateral public.rule_operand_positions(vr.rule) p
   where vr.template_version_id = new.template_version_id
     and p.field_key = new.field_key
   limit 1;

  if v_problem is not null then
    raise exception '%', public.rule_calculated_operand_message(v_problem, v_label);
  end if;
  return new;
end $$;
revoke all on function public.enforce_template_field_formula_rules() from public, anon, authenticated;

create trigger trg_template_field_formula_rules
  before insert or update of formula
  on public.template_field
  for each row execute function public.enforce_template_field_formula_rules();

-- -----------------------------------------------------------------------------
-- 4. Diagnostic d'une version, en LECTURE SEULE
-- -----------------------------------------------------------------------------
-- Repond a la seule question qui compte pour une base existante : « cette version
-- contient-elle une regle qui ne peut pas fonctionner, et laquelle ? ». Elle ne modifie
-- rien, ne refuse rien, et ne rend que des metadonnees de gabarit -- jamais une valeur de
-- dossier. `security invoker` : la RLS de l'appelant s'applique, on ne voit que les regles
-- des versions auxquelles on a deja acces.
create or replace function public.calculated_field_rule_conflicts(p_version_id uuid)
returns table (rule_id uuid, problem text, field_key text, label text, message text)
language sql stable set search_path = public, pg_temp as $$
  select vr.id,
         p.problem,
         p.field_key,
         l.calc_label,
         public.rule_calculated_operand_message(p.problem, l.calc_label)
    from public.validation_rule vr
    cross join lateral public.rule_operand_positions(vr.rule) p
    cross join lateral (
      select public.rule_calculated_field_label(vr.template_version_id, p.field_key) as calc_label
    ) l
   where vr.template_version_id = p_version_id
     and l.calc_label is not null
   order by p.problem, p.field_key
$$;
grant execute on function public.calculated_field_rule_conflicts(uuid) to authenticated;
