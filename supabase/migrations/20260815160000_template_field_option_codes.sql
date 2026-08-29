-- =============================================================================
-- 20260815160000_template_field_option_codes.sql  (L30)
--
-- CODE INTERNE STABLE POUR LES OPTIONS DE LISTE.
--
-- LE DEFAUT. Une option de `select` / `multiselect` etait stockee EN TEXTE : la chaine
-- elle-meme partait dans `patient.data` / `encounter.data`, et la validation la comparait
-- a `allowed_values`. Corriger une option -- « hematome » en « hematome » accentue --
-- rendait les fiches deja saisies invalides a la prochaine ecriture et scindait une
-- modalite en DEUX dans les statistiques. Rien ne le signalait.
--
-- LA SOLUTION, celle du referentiel de terminologie (20260726210000) appliquee aux listes
-- ordinaires : une option devient un objet
--
--     { "value_key": "...", "label": "...", "is_active": true|false }
--
-- Le `value_key` part en base et ne bouge JAMAIS ; le `label` reste modifiable ; une
-- option retiree du formulaire est DESACTIVEE et non supprimee, sinon l'historique
-- devient illisible.
--
-- -----------------------------------------------------------------------------
-- `allowed_values` : CONSERVE, EN MIROIR  (meme raisonnement qu'a L33)
-- -----------------------------------------------------------------------------
-- `allowed_options` porte la verite ; `allowed_values` devient le tableau de ses
-- `value_key`, tenu a jour par le declencheur. Le miroir n'est pas un confort :
--   * `download_base_snapshot` a deja depose `allowed_values` sur des telephones ;
--   * une PWA installee garde son ancien JavaScript jusqu'au prochain rafraichissement,
--     et rendrait « [object Object] » dans chaque menu deroulant si la colonne changeait
--     de forme sous elle (defaut D5, deja paye une fois) ;
--   * `assert_data_valid`, `enforce_template_field_default_value` et toute la validation
--     serveur continuent de lire `allowed_values` : AUCUNE ligne de validation n'est
--     reecrite par ce lot, donc aucune fiche existante ne change de verdict.
--
-- REPRISE DES DONNEES EXISTANTES : le `value_key` d'une option deja en service est la
-- CHAINE ELLE-MEME, verbatim. Consequence recherchee : les fiches deja saisies portent
-- deja leur value_key, et il n'y a rien a reecrire -- ni dans `patient.data`, ni dans les
-- regles de coherence, ni dans les filtres de cohorte enregistres, ni dans les valeurs
-- proposees, qui recopient tous ces memes chaines. La migration est purement additive.
--
-- -----------------------------------------------------------------------------
-- Ce qu'une variable DEJA UTILISEE autorise desormais
-- -----------------------------------------------------------------------------
-- AUTORISE : renommer un libelle, ajouter une option, en desactiver une, les reordonner.
-- REFUSE   : retirer une option (sa cle disparait) et changer une cle -- les deux seules
--            operations qui rendraient une fiche existante invalide a la prochaine
--            ecriture. C'est exactement le defaut corrige ici.
-- Avant ce lot, `guard_template_field_update` refusait TOUTE modification de la liste des
-- qu'une donnee existait : corriger « hematome » etait donc impossible, pas seulement
-- dangereux.
--
-- UNE OPTION DESACTIVEE RESTE VALIDE A L'ECRITURE. Elle sort de la saisie (l'interface ne
-- la propose plus) mais reste dans `allowed_values`, donc une fiche qui la porte reste
-- modifiable sur ses autres champs sans cas particulier. La validation reste SANS ETAT :
-- elle ne compare jamais une fiche a son passe. Meme choix qu'a L33.
--
-- RETOUR ARRIERE. Supprimer les deux declencheurs et la colonne `allowed_options`, puis
-- retablir `guard_template_field_update` et `update_template_field` dans leur version du
-- 2026-08-14 : `allowed_values` n'a jamais cesse d'etre alimentee, donc rien a reconstruire.
-- =============================================================================

-- =============================================================================
-- 1. La colonne
-- =============================================================================

-- Nullable et sans defaut : aucune reecriture de table, et « pas de liste » reste
-- distinct de « liste vide ».
alter table public.template_field add column allowed_options jsonb;

-- Garde-fou structurel independant du declencheur. La forme detaillee (cles, types,
-- unicite) est verifiee par le declencheur, seul endroit ou une erreur peut etre nommee.
alter table public.template_field
  add constraint template_field_allowed_options_array
  check (allowed_options is null or jsonb_typeof(allowed_options) = 'array');

comment on column public.template_field.allowed_options is
  'Options de liste : [{value_key, label, is_active}]. Source de verite ; allowed_values en est le miroir (tableau des value_key, actives ET inactives).';

-- =============================================================================
-- 2. Conversions entre les deux formes
-- =============================================================================

-- Liste de chaines -> liste d'options, en CONSERVANT le libelle et l'etat actif des cles
-- deja connues. Sans cette conservation, un client anterieur au lot qui reenvoie la seule
-- liste de cles (tout ce qu'il sait exprimer) effacerait en silence les libelles corriges.
create function public.template_field_options_from_values(p_values jsonb, p_previous jsonb)
returns jsonb
language sql immutable set search_path = public, pg_temp as $$
  select case
    when p_values is null then null
    else coalesce((
      select jsonb_agg(
               jsonb_build_object(
                 'value_key', v.key,
                 'label',     coalesce(prev.label, v.key),
                 'is_active', coalesce(prev.is_active, true)
               ) order by v.ord)
      from (
        -- Dedoublonnage sur la cle, en conservant la premiere position d'apparition.
        select el.value #>> '{}' as key, min(el.ord) as ord
        from jsonb_array_elements(p_values) with ordinality el(value, ord)
        group by el.value #>> '{}'
      ) v
      left join lateral (
        select o.value ->> 'label' as label, (o.value ->> 'is_active')::boolean as is_active
        from jsonb_array_elements(coalesce(p_previous, '[]'::jsonb)) o
        where o.value ->> 'value_key' = v.key
        limit 1
      ) prev on true
    ), '[]'::jsonb)
  end
$$;
comment on function public.template_field_options_from_values(jsonb, jsonb) is
  'Reconstruit des options a partir de la seule liste de cles, en preservant libelles et etat actif deja enregistres.';

-- Liste d'options -> tableau des cles, dans l'ordre. C'est le miroir `allowed_values`.
create function public.template_field_option_keys(p_options jsonb)
returns jsonb
language sql immutable set search_path = public, pg_temp as $$
  select case
    when p_options is null then null
    else coalesce((
      select jsonb_agg(o.value -> 'value_key' order by o.ord)
      from jsonb_array_elements(p_options) with ordinality o(value, ord)
    ), '[]'::jsonb)
  end
$$;

-- =============================================================================
-- 3. Reconciliation des deux colonnes, et refus du retrait
-- =============================================================================

-- SECURITY DEFINER, comme les autres gardes de `template_field` : la fonction doit
-- consulter `template_field_in_use` quel que soit le droit d'execution du client. Elle
-- n'ecrit rien d'elle-meme (elle normalise NEW) et reste revoquee de tous les roles.
--
-- Le refus du retrait vit ICI et non dans `guard_template_field_update`, pour la meme
-- raison qu'a L33 : deux declencheurs BEFORE UPDATE s'executent par ordre alphabetique de
-- nom, et un garde place ailleurs verrait, selon l'ordre, une liste non encore reconciliee
-- -- donc un retrait invisible venant d'un client qui n'envoie que `allowed_values`.
-- `trg_template_field_allowed_options` precede `trg_template_field_default_value`,
-- `trg_template_field_missing_reasons` et `trg_tf_update` : tous voient des colonnes deja
-- coherentes.
create function public.enforce_template_field_allowed_options()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_options jsonb;
  v_values  jsonb;
begin
  -- --- Quelle colonne fait foi pour CETTE ecriture ? ------------------------------------
  if tg_op = 'UPDATE' and new.allowed_options is distinct from old.allowed_options then
    -- Client conscient des options : elles font foi, et le miroir est recalcule.
    v_options := new.allowed_options;
  elsif tg_op = 'INSERT' and new.allowed_options is not null then
    v_options := new.allowed_options;
  else
    -- Client anterieur au lot : il n'envoie que les cles. Les libelles deja corriges et
    -- les desactivations sont conserves pour les cles qu'il reconduit.
    -- Type verifie AVANT la conversion : `jsonb_array_elements` sur un scalaire leve une
    -- erreur brute, qui ne dirait rien a l'utilisateur.
    if new.allowed_values is not null and jsonb_typeof(new.allowed_values) <> 'array' then
      raise exception 'Liste de valeurs invalide pour "%" : une liste est attendue', new.label;
    end if;
    -- Une liste de cles contenant autre chose qu'un texte non vide ne peut pas etre
    -- convertie sans PERDRE une valeur autorisee, donc sans invalider une fiche qui la
    -- porte. Refus explicite plutot que retrecissement silencieux.
    if new.allowed_values is not null
       and (tg_op = 'INSERT' or new.allowed_values is distinct from old.allowed_values)
       and exists (
         select 1 from jsonb_array_elements(new.allowed_values) el
         where jsonb_typeof(el.value) <> 'string' or btrim(el.value #>> '{}') = ''
       ) then
      raise exception 'Liste de valeurs invalide pour "%" : chaque valeur doit etre un texte non vide', new.label;
    end if;
    v_options := public.template_field_options_from_values(
      new.allowed_values,
      case when tg_op = 'UPDATE' then old.allowed_options end
    );
  end if;

  -- --- Forme des options ---------------------------------------------------------------
  if v_options is not null then
    if jsonb_typeof(v_options) <> 'array' then
      raise exception 'Liste d''options invalide pour "%"', new.label;
    end if;
    -- Le type est verifie A PART : `jsonb_object_keys` leve une erreur brute sur un
    -- element scalaire, et une erreur brute ne dit rien a l'utilisateur.
    if exists (select 1 from jsonb_array_elements(v_options) o where jsonb_typeof(o.value) <> 'object') then
      raise exception 'Option invalide pour "%" : un code, un libelle et un etat sont attendus', new.label;
    end if;
    -- Une cle surnumeraire, un libelle vide ou un `is_active` ABSENT sont REFUSES, jamais
    -- ignores : une option amputee en silence retirerait une valeur du formulaire. La
    -- presence de chaque cle est testee explicitement -- `jsonb_typeof` d'une cle absente
    -- rend NULL, qui n'est pas `true`, et laisserait donc passer l'option incomplete.
    if exists (
      select 1 from jsonb_array_elements(v_options) o
      where not (o.value ? 'value_key') or not (o.value ? 'label') or not (o.value ? 'is_active')
         or (select count(*) from jsonb_object_keys(o.value) k where k not in ('value_key', 'label', 'is_active')) > 0
         or jsonb_typeof(o.value -> 'value_key') <> 'string'
         or jsonb_typeof(o.value -> 'label') <> 'string'
         or jsonb_typeof(o.value -> 'is_active') <> 'boolean'
         or btrim(o.value ->> 'value_key') = ''
         or btrim(o.value ->> 'label') = ''
    ) then
      raise exception 'Option invalide pour "%" : un code, un libelle et un etat sont attendus', new.label;
    end if;
    if (select count(distinct o.value ->> 'value_key') from jsonb_array_elements(v_options) o)
       <> jsonb_array_length(v_options) then
      raise exception 'Deux options portent le meme code dans "%"', new.label;
    end if;
  end if;

  v_values := public.template_field_option_keys(v_options);

  -- --- Retrait d'une option sur une variable en service : refuse -----------------------
  -- Renommer, ajouter, desactiver et reordonner ne rencontrent pas ce test : aucun de ces
  -- gestes ne fait disparaitre une cle, donc aucun ne peut invalider une fiche existante.
  if tg_op = 'UPDATE' and old.allowed_values is not null
     and exists (
       select 1 from jsonb_array_elements_text(old.allowed_values) k
       where not (coalesce(v_values, '[]'::jsonb) @> jsonb_build_array(k.value))
     )
     and public.template_field_in_use(old.id) then
    raise exception 'Variable deja utilisee : une option ne peut plus etre retiree de "%". La renommer, en ajouter ou la desactiver reste possible ; pour en retirer, creez une nouvelle version du jeu de variables.', new.label;
  end if;

  -- --- Coherence avec la valeur proposee (L28) -----------------------------------------
  -- Desactiver l'option qui sert de valeur proposee prefererait une modalite qu'on vient
  -- justement de retirer de la saisie. Refus explicite plutot que correction silencieuse.
  if v_options is not null and nullif(btrim(coalesce(new.default_value, '')), '') is not null
     and exists (
       select 1 from jsonb_array_elements(v_options) o
       where o.value ->> 'value_key' = btrim(new.default_value)
         and not (o.value ->> 'is_active')::boolean
     ) then
    raise exception 'Option desactivee alors qu''elle est la valeur proposee de "%" : changez la valeur proposee d''abord', new.label;
  end if;

  new.allowed_options := v_options;
  new.allowed_values  := v_values;
  return new;
end $$;
revoke all on function public.enforce_template_field_allowed_options() from public, anon, authenticated;

create trigger trg_template_field_allowed_options
  before insert or update of allowed_values, allowed_options, default_value
  on public.template_field
  for each row execute function public.enforce_template_field_allowed_options();

-- La validation de la valeur proposee doit aussi se declencher quand seules les options
-- bougent (une option retiree d'un brouillon peut etre celle qui etait proposee).
drop trigger if exists trg_template_field_default_value on public.template_field;
create trigger trg_template_field_default_value
  before insert or update of default_value, type, allowed_values, allowed_options, min_value, max_value
  on public.template_field
  for each row execute function public.enforce_template_field_default_value();

-- `allowed_values` sort de la liste des changements semantiques du garde generique : le
-- retrait d'une option est desormais garde ci-dessus, avec l'information necessaire pour
-- distinguer un retrait (interdit) d'un renommage ou d'un ajout (autorises). L'y laisser
-- interdirait de corriger « hematome », c'est-a-dire le defaut meme que ce lot traite.
create or replace function public.guard_template_field_update()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  semantic boolean;
begin
  if auth.uid() is not null and public.template_version_locked(old.template_version_id) then
    raise exception 'Version publiee/archivee immuable : creez une nouvelle version du jeu de variables';
  end if;

  semantic := (new.field_key is distinct from old.field_key)
           or (new.type      is distinct from old.type)
           or (new.scope     is distinct from old.scope)
           or (new.required  is distinct from old.required)
           or (new.encounter_types is distinct from old.encounter_types)
           or (new.min_value is distinct from old.min_value)
           or (new.max_value is distinct from old.max_value);
  if semantic and public.template_field_in_use(old.id) then
    raise exception 'Variable deja utilisee : seuls le libelle, la section et l''unite sont modifiables. Pour changer son comportement, creez une nouvelle version du jeu de variables.';
  end if;
  return new;
end $$;

-- =============================================================================
-- 4. Reprise des listes existantes
-- =============================================================================

-- Chaque liste deja saisie devient une liste d'options dont la cle EST la chaine stockee.
-- Les fiches existantes portent donc deja leur value_key : aucune donnee clinique n'est
-- touchee ici, et `allowed_values` conserve exactement le meme contenu.
update public.template_field
   set allowed_options = public.template_field_options_from_values(allowed_values, null)
 where allowed_values is not null
   and allowed_options is null;

-- =============================================================================
-- 5. Recopie d'une version a l'autre
-- =============================================================================

-- Meme lecon qu'a L28 et L33 : une colonne oubliee ici se perd EN SILENCE a la
-- duplication d'un gabarit -- les libelles corriges retomberaient sur les cles.
create or replace function public.copy_template_fields(
  p_source_version_id  uuid,
  p_target_version_id  uuid,
  p_force_patient_scope boolean default false
) returns void
language sql security invoker set search_path = public, pg_temp as $$
  insert into public.template_field
    (template_version_id, field_key, label, description, default_value, scope, section, type,
     unit, allowed_values, allowed_options, required, min_value, max_value, allow_missing_codes,
     missing_reasons, display_order, encounter_types)
  select p_target_version_id, field_key, label, description, default_value,
         case when p_force_patient_scope then 'patient' else scope end,
         section, type, unit, allowed_values, allowed_options, required, min_value, max_value,
         allow_missing_codes, missing_reasons, display_order,
         case when p_force_patient_scope then null else encounter_types end
  from public.template_field
  where template_version_id = p_source_version_id
  order by display_order, id;
$$;

-- =============================================================================
-- 6. Modification d'une variable
-- =============================================================================

-- Nouvelle signature portant les options. Les PRECEDENTES restent en place, inchangees :
-- un client non rafraichi continue de les appeler et le declencheur traduit sa liste de
-- cles en options, sans perdre les libelles.
create function public.update_template_field(
  p_field_id uuid, p_field_key text, p_label text, p_description text, p_default_value text,
  p_scope text, p_section text, p_type text, p_required boolean,
  p_missing_reasons text[],
  p_allowed_options jsonb,
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
  -- Ni `missing_reasons` ni les options ne figurent dans ce test : leurs retraits sont
  -- gardes par les declencheurs de table, qui couvrent aussi la voie directe, et leurs
  -- ajouts sont autorises.
  semantic := (p_field_key is distinct from cur.field_key)
           or (p_type is distinct from cur.type) or (p_scope is distinct from cur.scope)
           or (p_required is distinct from cur.required)
           or ((case when p_scope = 'encounter' then p_encounter_types else null end) is distinct from cur.encounter_types)
           or (p_min_value is distinct from cur.min_value) or (p_max_value is distinct from cur.max_value);
  if semantic and public.template_field_in_use(p_field_id) then
    raise exception 'Variable deja utilisee : seuls le libelle, la consigne de saisie, la valeur proposee, la section, l''unite et les options sont modifiables. Pour changer son comportement, creez une nouvelle version du gabarit.';
  end if;
  update public.template_field
     set field_key = p_field_key, label = p_label, description = nullif(btrim(p_description), ''),
         default_value = nullif(btrim(p_default_value), ''),
         scope = p_scope, section = p_section, type = p_type, required = p_required,
         encounter_types = case when p_scope = 'encounter' then p_encounter_types else null end,
         allowed_options = p_allowed_options,
         allowed_values = case when p_allowed_options is not null
                               then public.template_field_option_keys(p_allowed_options)
                               else p_allowed_values end,
         min_value = p_min_value, max_value = p_max_value,
         unit = p_unit, missing_reasons = coalesce(p_missing_reasons, '{}'::text[])
   where id = p_field_id returning * into res;
  return res;
end $$;
revoke all on function public.update_template_field(uuid, text, text, text, text, text, text, text, boolean, text[], jsonb, text[], jsonb, numeric, numeric, text) from public, anon;
grant execute on function public.update_template_field(uuid, text, text, text, text, text, text, text, boolean, text[], jsonb, text[], jsonb, numeric, numeric, text) to authenticated;

-- =============================================================================
-- 7. Instantane hors-ligne
-- =============================================================================

-- L'instantane emet DESORMAIS LES DEUX. Les cles pour les copies deja telechargees et les
-- clients non rafraichis, les options pour les autres : la bascule n'a pas de fenetre.
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
        'scope', tf.scope, 'type', tf.type, 'displayOrder', tf.display_order,
        'section', tf.section, 'unit', tf.unit, 'allowedValues', tf.allowed_values,
        'allowedOptions', tf.allowed_options,
        'required', tf.required, 'minValue', tf.min_value, 'maxValue', tf.max_value,
        'allowMissingCodes', tf.allow_missing_codes, 'missingReasons', to_jsonb(tf.missing_reasons),
        'encounterTypes', to_jsonb(tf.encounter_types)
      ) order by tf.display_order, tf.field_key)
      from public.template_field tf
      where tf.template_version_id = (select current_template_version_id from public.base where id = p_base_id)
    ), '[]'::jsonb),
    'fieldsByVersion', coalesce((
      select jsonb_object_agg(v.tvid::text, v.fields)
      from (
        select tf.template_version_id as tvid,
               jsonb_agg(jsonb_build_object(
                 'id', tf.id, 'fieldKey', tf.field_key, 'label', tf.label,
                 'description', tf.description, 'defaultValue', tf.default_value,
                 'scope', tf.scope, 'type', tf.type, 'displayOrder', tf.display_order,
                 'section', tf.section, 'unit', tf.unit, 'allowedValues', tf.allowed_values,
                 'allowedOptions', tf.allowed_options,
                 'required', tf.required, 'minValue', tf.min_value, 'maxValue', tf.max_value,
                 'allowMissingCodes', tf.allow_missing_codes, 'missingReasons', to_jsonb(tf.missing_reasons),
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
                 'id', vr.id,
                 'rule', vr.rule,
                 'message', vr.message,
                 'severity', vr.severity
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
