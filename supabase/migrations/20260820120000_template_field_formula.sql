-- =============================================================================
-- 20260820120000_template_field_formula.sql  (L35)
--
-- VARIABLES CALCULEES : une calculatrice, jamais une formule clinique.
--
-- L'utilisateur ecrit lui-meme le calcul dans son gabarit :
-- `duree_sejour = date_sortie - date_entree`. Le produit ne livre AUCUNE formule toute
-- faite -- ni IMC, ni Glasgow, ni clairance : ce serait nous qui repondrions de sa version,
-- de sa validite et des droits d'usage de l'echelle.
--
-- LE RESULTAT N'EST JAMAIS STOCKE, et PL/pgSQL NE L'EVALUE JAMAIS.
--   * rien n'est ecrit dans `patient.data` ni dans `encounter.data` sous cette cle ;
--   * aucune RPC ne calcule ;
--   * le calcul vit dans UN SEUL module TypeScript,
--     `supabase/functions/generate-export/exportContract.ts`, que le navigateur lit par
--     ré-export (`src/domain/export.ts`) et que l'Edge Function de production lit
--     directement. Un evaluateur pose la tourne a l'identique aux deux endroits, et le
--     hors-ligne suit sans travail supplementaire.
--
-- CE QUE FAIT PL/pgSQL, et rien d'autre :
--   1. il VALIDE la formule au moment ou la variable est enregistree -- syntaxe, operandes
--      existants, types compatibles -- sur le modele de `default_value` (L28) ;
--   2. il SAIT qu'une variable est calculee (`formula is not null`) pour l'ECARTER de la
--      completude et de la file « a completer ».
-- Il ne calcule jamais un resultat. Cette distinction est la propriete qui tient le lot :
-- une seconde implementation de la meme semantique sur des valeurs cliniques est
-- exactement ce que ce decoupage evite.
--
-- LA FORMULE APPARTIENT A LA VERSION DE GABARIT (decision du 2026-08-20, option A), comme
-- le libelle, les bornes et les valeurs autorisees. Une fiche saisie sous l'ancienne
-- version garde donc le resultat de l'ancienne formule -- coherent avec la completude, qui
-- evalue deja chaque dossier contre sa propre version. Aucun mecanisme nouveau n'est requis
-- pour cela : `guard_template_field_update` interdit deja toute modification d'un champ
-- appartenant a une version publiee ou archivee.
--
-- GRAMMAIRE FERMEE, et rien de plus :
--   * UNE seule operation, deux operandes : `A op B`. Pas d'imbrication, donc aucune regle
--     de priorite invisible -- `a + b / 2` ne peut pas exister ;
--   * `+ - * /` entre variables `number`/`integer` et constantes litterales ;
--   * `date - date`, et elle seule entre deux dates, qui rend un nombre ENTIER de jours ;
--   * les operandes sont des variables SAISIES de la MEME version et de la MEME portee :
--     une variable calculee ne peut pas en referencer une autre. Cette interdiction
--     SUPPRIME la detection de cycles au lieu de la coder.
--
-- Migration ADDITIVE : colonne nullable sans valeur par defaut, aucune reecriture de table,
-- aucune donnee patient ou rencontre touchee. Les variables existantes gardent exactement
-- leur sens actuel.
-- =============================================================================

alter table public.template_field
  add column formula text;

comment on column public.template_field.formula is
  'Calcul defini par l''utilisateur, forme canonique « A op B » (L35). Null = variable saisie. '
  'Le resultat n''est JAMAIS stocke : il est recalcule a l''affichage et a l''export par '
  'exportContract.ts. PL/pgSQL valide cette formule mais ne l''evalue jamais.';

-- Garde-fou structurel : une formule d'une seule operation reste courte.
alter table public.template_field
  add constraint template_field_formula_length
  check (formula is null or char_length(formula) <= 200);

-- Le type de sortie est DEDUIT (voir le declencheur), donc toujours numerique. La contrainte
-- rend la propriete vraie par construction, y compris pour une ecriture qui contournerait le
-- declencheur lors d'une maintenance future.
alter table public.template_field
  add constraint template_field_formula_numeric_output
  check (formula is null or type in ('number', 'integer'));

-- =============================================================================
-- 1. Validation de la formule a l'enregistrement de la variable
-- =============================================================================

-- Le constructeur ECRIT EN DIRECT dans template_field (insert PostgREST) : la validation ne
-- peut pas vivre dans la seule RPC de modification. Elle est portee par un declencheur, qui
-- couvre toutes les voies d'ecriture presentes et futures.
--
-- Une formule invalide est REFUSEE ICI, pas decouverte a la saisie sous la forme d'une
-- colonne vide que personne ne sait expliquer.
create function public.enforce_template_field_formula()
returns trigger language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  v_formula    text := nullif(btrim(new.formula), '');
  v_tokens       text[];
  v_operator     text;
  v_operand      text;
  v_type         text;
  v_peer_formula text;
  v_dates        int := 0;
  v_named        int := 0;
  v_output       text;
begin
  new.formula := v_formula;
  if v_formula is null then return new; end if;

  -- Attributs qui ne peuvent pas coexister avec un calcul. Rien n'etant saisi sous cette
  -- variable, chacun d'eux promettrait quelque chose que la saisie ne peut pas tenir.
  if new.required then
    raise exception 'Une variable calculee ne peut pas etre obligatoire ("%") : rien n''y est saisi, personne ne pourrait la completer', new.label;
  end if;
  if nullif(btrim(new.default_value), '') is not null then
    raise exception 'Une variable calculee ne peut pas avoir de valeur proposee ("%") : sa valeur vient de la formule', new.label;
  end if;
  if new.is_multiple then
    raise exception 'Une variable calculee ne peut pas etre multivaluee ("%")', new.label;
  end if;

  -- Les raisons de valeur manquante, elles, sont RAMENEES A VIDE au lieu d'etre refusees :
  -- la colonne porte une valeur PAR DEFAUT non vide (les trois raisons historiques, L33), et
  -- refuser reviendrait a punir l'appelant pour un defaut de colonne que personne n'a
  -- demande. Une variable calculee n'est jamais saisie : aucune raison ne peut s'y appliquer.
  -- Le booleen part avec la liste, sinon `trg_template_field_missing_reasons` -- qui se
  -- declenche APRES celui-ci, l'ordre etant alphabetique -- les reinjecterait.
  new.missing_reasons := '{}'::text[];
  new.allow_missing_codes := false;

  -- --- Syntaxe : trois jetons separes par des espaces, un seul operateur. ---------------
  v_tokens := regexp_split_to_array(v_formula, '\s+');
  if array_length(v_tokens, 1) is distinct from 3 then
    raise exception 'Formule invalide pour "%" : une seule operation entre deux elements est acceptee, par exemple « date_sortie - date_entree »', new.label;
  end if;
  v_operator := v_tokens[2];
  if v_operator not in ('+', '-', '*', '/') then
    raise exception 'Formule invalide pour "%" : seules les operations + - * / sont acceptees', new.label;
  end if;

  -- --- Operandes : constante litterale, ou variable saisie de la meme version. ----------
  foreach v_operand in array array[v_tokens[1], v_tokens[3]] loop
    if v_operand ~ '^-?([0-9]+(\.[0-9]+)?|\.[0-9]+)$' then
      continue;  -- constante litterale
    end if;
    if v_operand !~ '^[A-Za-z_][A-Za-z0-9_]*$' then
      raise exception 'Formule invalide pour "%" : « % » n''est ni un nombre ni un nom de variable', new.label, v_operand;
    end if;
    v_named := v_named + 1;
    if v_operand = new.field_key then
      raise exception 'Formule invalide pour "%" : une variable ne peut pas se referencer elle-meme', new.label;
    end if;

    select f.type, f.formula into v_type, v_peer_formula
      from public.template_field f
     where f.template_version_id = new.template_version_id
       and f.scope = new.scope
       and f.field_key = v_operand
     limit 1;
    if not found then
      raise exception 'Formule invalide pour "%" : la variable « % » n''existe pas dans cette version, ou n''a pas la meme portee', new.label, v_operand;
    end if;
    -- Une variable calculee ne peut pas en referencer une autre : c'est ce qui SUPPRIME la
    -- detection de cycles au lieu de la coder.
    if v_peer_formula is not null then
      raise exception 'Formule invalide pour "%" : « % » est elle-meme une variable calculee', new.label, v_operand;
    end if;
    if v_type not in ('number', 'integer', 'date') then
      raise exception 'Formule invalide pour "%" : « % » n''est ni un nombre ni une date', new.label, v_operand;
    end if;
    if v_type = 'date' then v_dates := v_dates + 1; end if;
  end loop;

  -- Deux constantes ne font pas une variable : « 2 + 3 » vaut 5 pour tout le monde.
  if v_named = 0 then
    raise exception 'Formule invalide pour "%" : au moins un element doit etre une variable du gabarit', new.label;
  end if;

  -- --- Type de sortie : DEDUIT, jamais choisi. -----------------------------------------
  if v_dates = 2 then
    if v_operator <> '-' then
      raise exception 'Formule invalide pour "%" : entre deux dates, seule la soustraction a un sens (elle rend un nombre de jours)', new.label;
    end if;
    v_output := 'integer';
  elsif v_dates = 1 then
    -- « date + 3 » demanderait de decider si 3 est un jour, un mois ou une heure. On refuse
    -- plutot que de choisir a la place du medecin.
    raise exception 'Formule invalide pour "%" : une date ne se combine qu''avec une autre date, par soustraction', new.label;
  else
    v_output := 'number';
  end if;

  -- Le type est DEDUIT de la formule, pas envoye par le client : un client d'une autre
  -- version ne peut donc pas faire diverger l'etiquette de la colonne et son contenu reel.
  new.type := v_output;

  -- La restitution des formules stockees reste la forme canonique : un espace de chaque
  -- cote de l'operateur, exactement ce que `parseFormula` sait relire.
  new.formula := v_tokens[1] || ' ' || v_operator || ' ' || v_tokens[3];
  return new;
end $$;
revoke all on function public.enforce_template_field_formula() from public, anon, authenticated;

create trigger trg_template_field_formula
  before insert or update of formula, type, scope, required, default_value, missing_reasons, is_multiple
  on public.template_field
  for each row execute function public.enforce_template_field_formula();

-- =============================================================================
-- 2. Les operandes ne peuvent pas disparaitre sous la formule
-- =============================================================================

-- Sans cette garde, supprimer `date_entree` -- ou en changer le type -- laisserait
-- `duree_sejour` pointer dans le vide. La colonne sortirait VIDE a l'export, sans erreur
-- nulle part : le pire des deux mondes, puisque personne ne saurait qu'il y a un probleme.
create function public.enforce_template_field_formula_operand()
returns trigger language plpgsql security invoker set search_path = public, pg_temp as $$
declare v_dependent text;
begin
  if tg_op = 'UPDATE'
     and new.field_key is not distinct from old.field_key
     and new.type is not distinct from old.type
     and new.scope is not distinct from old.scope then
    return new;
  end if;

  select f.label into v_dependent
    from public.template_field f
   where f.template_version_id = old.template_version_id
     and f.id <> old.id
     and f.formula is not null
     and f.scope = old.scope
     and old.field_key = any(regexp_split_to_array(f.formula, '\s+'))
   limit 1;

  if v_dependent is not null then
    raise exception 'Variable utilisee par la formule de "%" : corrigez ou supprimez d''abord la variable calculee', v_dependent;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
revoke all on function public.enforce_template_field_formula_operand() from public, anon, authenticated;

create trigger trg_template_field_formula_operand
  before delete or update of field_key, type, scope
  on public.template_field
  for each row execute function public.enforce_template_field_formula_operand();

-- =============================================================================
-- 3. Une variable calculee ne bascule pas sous les fiches deja saisies
-- =============================================================================

-- Reprise a l'IDENTIQUE de la definition L21 (20260818045033), avec `formula` ajoutee a la
-- liste des changements SEMANTIQUES. Le cas vise : transformer en variable calculee une
-- variable deja renseignee dans des dossiers. Les valeurs saisies seraient alors masquees
-- par un calcul, sans etre effacees ni signalees.
create or replace function public.guard_template_field_update()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  semantic boolean;
begin
  if auth.uid() is not null and public.template_version_locked(old.template_version_id) then
    raise exception 'Version publiee/archivee immuable : creez une nouvelle version du jeu de variables';
  end if;

  semantic := (new.field_key is distinct from old.field_key)
           or (new.type is distinct from old.type)
           or (new.is_multiple is distinct from old.is_multiple)
           or (new.scope is distinct from old.scope)
           or (new.required is distinct from old.required)
           or (new.encounter_types is distinct from old.encounter_types)
           or (new.min_value is distinct from old.min_value)
           or (new.max_value is distinct from old.max_value)
           or (new.formula is distinct from old.formula);
  if semantic and public.template_field_in_use(old.id) then
    raise exception 'Variable deja utilisee : seuls le libelle, la section et l''unite sont modifiables. Pour changer son comportement, creez une nouvelle version du jeu de variables.';
  end if;
  return new;
end $$;
revoke all on function public.guard_template_field_update() from public, anon, authenticated;

-- =============================================================================
-- 4. Recopie d'une version a l'autre
-- =============================================================================

-- Reprise a l'IDENTIQUE de la definition L21, avec `formula` ajoutee. La liste des colonnes
-- recopiees vit a UN SEUL endroit depuis L28 : sans cet ajout, dupliquer un gabarit perdrait
-- silencieusement toutes les formules -- exactement le defaut discret que la centralisation
-- avait ete faite pour empecher.
create or replace function public.copy_template_fields(
  p_source_version_id  uuid,
  p_target_version_id  uuid,
  p_force_patient_scope boolean default false
) returns void
language sql security invoker set search_path = public, pg_temp as $$
  insert into public.template_section
    (template_version_id, section_key, label, display_order)
  select p_target_version_id, ts.section_key, ts.label, ts.display_order
  from public.template_section ts
  where ts.template_version_id = p_source_version_id
  order by ts.display_order, ts.section_key
  on conflict (template_version_id, section_key) do nothing;

  insert into public.template_field
    (template_version_id, field_key, label, description, default_value, scope, section, section_id,
     type, is_multiple, unit, allowed_values, allowed_options, required, min_value, max_value,
     allow_missing_codes, missing_reasons, formula, display_order, encounter_types)
  select p_target_version_id, src.field_key, src.label, src.description, src.default_value,
         case when p_force_patient_scope then 'patient' else src.scope end,
         src.section, tgt.id, src.type, src.is_multiple, src.unit, src.allowed_values,
         src.allowed_options, src.required, src.min_value, src.max_value,
         src.allow_missing_codes, src.missing_reasons, src.formula, src.display_order,
         case when p_force_patient_scope then null else src.encounter_types end
  from public.template_field src
  left join public.template_section src_s on src_s.id = src.section_id
  left join public.template_section tgt
         on tgt.template_version_id = p_target_version_id
        and tgt.section_key = src_s.section_key
  where src.template_version_id = p_source_version_id
  order by src.display_order, src.id;
$$;
revoke all on function public.copy_template_fields(uuid, uuid, boolean) from public, anon, authenticated;

-- =============================================================================
-- 5. Surcharge de `update_template_field` portant la formule
-- =============================================================================

-- Nouvelle surcharge pour le client L35. Les signatures anterieures restent disponibles aux
-- PWA non rafraichies : sans `p_formula`, elles resolvent la signature L21 et la variable
-- reste saisie, exactement comme avant ce lot.
create function public.update_template_field(
  p_field_id uuid, p_field_key text, p_label text, p_description text, p_default_value text,
  p_scope text, p_section text, p_type text, p_required boolean, p_is_multiple boolean,
  p_missing_reasons text[], p_allowed_options jsonb, p_formula text,
  p_encounter_types text[] default null, p_allowed_values jsonb default null,
  p_min_value numeric default null, p_max_value numeric default null,
  p_unit text default null
) returns public.template_field
language plpgsql security definer set search_path = public, pg_temp as $$
declare cur public.template_field; semantic boolean; res public.template_field;
begin
  select * into cur from public.template_field where id = p_field_id;
  if not found then raise exception 'Champ introuvable'; end if;
  if not public.owns_template(public.template_of_version(cur.template_version_id)) then
    raise exception 'Modification du gabarit non autorisee';
  end if;
  semantic := (p_field_key is distinct from cur.field_key)
           or (p_type is distinct from cur.type)
           or (coalesce(p_is_multiple, false) is distinct from cur.is_multiple)
           or (p_scope is distinct from cur.scope)
           or (p_required is distinct from cur.required)
           or ((case when p_scope = 'encounter' then p_encounter_types else null end) is distinct from cur.encounter_types)
           or (p_min_value is distinct from cur.min_value)
           or (p_max_value is distinct from cur.max_value)
           or (nullif(btrim(p_formula), '') is distinct from cur.formula);
  if semantic and public.template_field_in_use(p_field_id) then
    raise exception 'Variable deja utilisee : seuls le libelle, la consigne de saisie, la valeur proposee, la section, l''unite et les options sont modifiables. Pour changer son comportement, creez une nouvelle version du gabarit.';
  end if;
  update public.template_field
     set field_key = p_field_key, label = p_label, description = nullif(btrim(p_description), ''),
         default_value = nullif(btrim(p_default_value), ''),
         scope = p_scope, section = p_section, type = p_type, required = p_required,
         is_multiple = coalesce(p_is_multiple, false),
         encounter_types = case when p_scope = 'encounter' then p_encounter_types else null end,
         allowed_options = p_allowed_options,
         allowed_values = case when p_allowed_options is not null
                               then public.template_field_option_keys(p_allowed_options)
                               else p_allowed_values end,
         min_value = p_min_value, max_value = p_max_value,
         unit = p_unit, missing_reasons = coalesce(p_missing_reasons, '{}'::text[]),
         -- Le declencheur `trg_template_field_formula` valide et deduit le type de sortie.
         formula = nullif(btrim(p_formula), '')
   where id = p_field_id returning * into res;
  return res;
end $$;
revoke all on function public.update_template_field(uuid, text, text, text, text, text, text, text, boolean, boolean, text[], jsonb, text, text[], jsonb, numeric, numeric, text) from public, anon;
grant execute on function public.update_template_field(uuid, text, text, text, text, text, text, text, boolean, boolean, text[], jsonb, text, text[], jsonb, numeric, numeric, text) to authenticated;

-- =============================================================================
-- 6. La completude IGNORE les variables calculees
-- =============================================================================

-- Le corollaire a ne pas manquer. Rien n'etant stocke sous la cle d'une variable calculee,
-- elle apparaitrait a 0 % chez TOUT LE MONDE, et remplirait une file « a completer » ou
-- personne ne peut rien completer -- une liste de travail impossible a solder.
--
-- ATTENTION : ces fonctions savent seulement qu'une variable EST calculee (`formula is
-- null`). Elles n'evaluent jamais la formule.

-- 6a. `missing_required_fields` (L32/L34) : reprise a l'identique, avec l'exclusion ajoutee.
-- Le declencheur refuse deja « calculee + obligatoire » ; ce filtre rend la propriete vraie
-- par construction, y compris pour une ligne heritee d'une maintenance future.
create or replace function public.missing_required_fields(
  p_version uuid, p_scope text, p_data jsonb, p_encounter_type text default null
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
     and (
       p_scope <> 'encounter'
       or p_encounter_type is null
       or f.encounter_types is null
       or cardinality(f.encounter_types) = 0
       or p_encounter_type = any(f.encounter_types)
     )
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
grant execute on function public.missing_required_fields(uuid, text, jsonb, text) to authenticated;

-- 6b. `base_completeness_stats` (B1) : reprise a l'identique, avec l'exclusion ajoutee aux
-- quatre branches (patient/rencontre x historique/courant).
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
       and (tf.encounter_types is null or cardinality(tf.encounter_types) = 0 or e.encounter_type = any(tf.encounter_types))

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
       and (tf.encounter_types is null or cardinality(tf.encounter_types) = 0 or e.encounter_type = any(tf.encounter_types))
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
grant execute on function public.base_completeness_stats(uuid, text) to authenticated;

-- 6c. `base_completion_queue_page` (B2) : reprise a l'identique, avec l'exclusion ajoutee
-- aux deux sous-requetes laterales.
create or replace function public.base_completion_queue_page(
  p_base_id uuid,
  p_limit int default 50,
  p_offset int default 0
)
returns jsonb
language sql stable security invoker set search_path = public, pg_temp as $$
  with params as (
    select greatest(1, least(coalesce(p_limit, 50), 500))::int as lim,
           greatest(0, coalesce(p_offset, 0))::int as off
  ),
  pat_items as (
    select jsonb_build_object(
        'kind', 'patient', 'patientId', p.id, 'code', p.patient_code, 'status', p.validation_status,
        'missing', m.missing
      ) as item,
      p.patient_code as code, 0 as rank, p.created_at
    from public.patient p
    cross join lateral (
      select coalesce(jsonb_agg(tf.label order by tf.display_order, tf.field_key), '[]'::jsonb) as missing
      from public.template_field tf
      where tf.template_version_id = p.template_version_id
        and tf.scope = 'patient' and tf.required
        and tf.formula is null
        and not public.value_documented(p.data -> tf.field_key)
    ) m
    where p.base_id = p_base_id and p.deleted_at is null and p.validation_status <> 'curated'
      and jsonb_array_length(m.missing) > 0
  ),
  enc_items as (
    select jsonb_build_object(
        'kind', 'encounter', 'patientId', p.id, 'encounterId', e.id, 'code', p.patient_code,
        'encounterType', e.encounter_type, 'encounterDate', e.encounter_date, 'status', e.validation_status,
        'missing', m.missing
      ) as item,
      p.patient_code as code, 1 as rank, e.created_at
    from public.encounter e
    join public.patient p on p.id = e.patient_id
    cross join lateral (
      select coalesce(jsonb_agg(tf.label order by tf.display_order, tf.field_key), '[]'::jsonb) as missing
      from public.template_field tf
      where tf.template_version_id = e.template_version_id
        and tf.scope = 'encounter' and tf.required
        and tf.formula is null
        and (tf.encounter_types is null or cardinality(tf.encounter_types) = 0 or e.encounter_type = any(tf.encounter_types))
        and not public.value_documented(e.data -> tf.field_key)
    ) m
    where p.base_id = p_base_id and p.deleted_at is null and e.deleted_at is null
      and e.validation_status <> 'curated'
      and jsonb_array_length(m.missing) > 0
  ),
  all_items as (
    select * from pat_items
    union all
    select * from enc_items
  ),
  page_items as (
    select a.*
      from all_items a, params
     order by a.code, a.rank, a.created_at
     limit (select lim from params)
     offset (select off from params)
  ),
  total_count as (
    select count(*)::int as n from all_items
  )
  select jsonb_build_object(
    'items', coalesce((select jsonb_agg(p.item order by p.code, p.rank, p.created_at) from page_items p), '[]'::jsonb),
    'total', (select n from total_count),
    'limit', (select lim from params),
    'offset', (select off from params),
    'hasMore', ((select off from params) + (select lim from params) < (select n from total_count))
  );
$$;
grant execute on function public.base_completion_queue_page(uuid, int, int) to authenticated;

-- =============================================================================
-- 7. L'instantane hors-ligne transporte la formule
-- =============================================================================

-- Le calcul vit deja cote client : il suffit que la METADONNEE voyage pour que le formulaire
-- hors-ligne affiche le meme resultat que le formulaire en ligne. Reprise a l'identique de
-- la definition L21, avec `formula` ajoutee a la version courante et aux versions
-- historiques. Aucune donnee patient ou rencontre n'est modifiee.
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
        'id', ts.id, 'sectionKey', ts.section_key, 'label', ts.label, 'displayOrder', ts.display_order
      ) order by ts.display_order, ts.section_key)
      from public.template_section ts
      where ts.template_version_id = (select current_template_version_id from public.base where id = p_base_id)
    ), '[]'::jsonb),
    'sectionsByVersion', coalesce((
      select jsonb_object_agg(v.tvid::text, v.sections)
      from (
        select ts.template_version_id as tvid,
               jsonb_agg(jsonb_build_object(
                 'id', ts.id, 'sectionKey', ts.section_key, 'label', ts.label,
                 'displayOrder', ts.display_order
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
            'data', e.data, 'updatedAt', e.updated_at, 'templateVersionId', e.template_version_id
          ) order by e.encounter_date)
          from public.encounter e where e.patient_id = p.id and e.deleted_at is null
        ), '[]'::jsonb)
      ) order by p.created_at)
      from public.patient p where p.base_id = p_base_id and p.deleted_at is null
    ), '[]'::jsonb)
  );
$$;
revoke all on function public.download_base_snapshot(uuid) from public, anon, authenticated;
grant execute on function public.download_base_snapshot(uuid) to authenticated;
