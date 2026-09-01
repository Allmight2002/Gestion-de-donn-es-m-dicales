-- =============================================================================
-- 20260814170000_template_field_missing_reasons.sql  (L33)
--
-- RAISONS DE VALEUR MANQUANTE, choisies VARIABLE PAR VARIABLE.
--
-- Cinq raisons existent desormais. Les TROIS PREMIERES SONT HISTORIQUES : ni leur code
-- ni leur sens ne changent, et toute fiche deja saisie reste lisible et modifiable telle
-- quelle. Les deux dernieres sont ajoutees par ce lot.
--
--   non_fait        l'examen ou le geste n'a pas ete realise
--   inconnu         l'information a ete cherchee et n'a pas ete retrouvee
--   non_applicable  la question ne se pose pas pour cette personne
--   refus           la personne a refuse                                     (NOUVEAU)
--   non_documente   personne n'a cherche -- distinct d'« inconnu », qui laisse
--                   croire que l'information a ete cherchee                  (NOUVEAU)
--
-- « Non realise » convient a un examen, pas a un sexe : c'est le defaut que ce lot corrige.
-- La liste cesse d'etre identique pour toutes les variables.
--
-- -----------------------------------------------------------------------------
-- allow_missing_codes : CONSERVE, EN MIROIR
-- -----------------------------------------------------------------------------
-- `missing_reasons` devient la source de verite ; `allow_missing_codes` n'est plus regle
-- a la main mais DERIVE d'elle (vrai = liste non vide). Le booleen n'est pas supprime
-- parce qu'il est deja recopie sur des appareils hors de portee :
--   * `download_base_snapshot` l'emet dans l'instantane hors-ligne, stocke sur le telephone ;
--   * une PWA installee garde son ancien JavaScript jusqu'au prochain rafraichissement ;
--   * `src/data/offline.ts` retombe sur `?? true` quand la cle manque.
-- Le retirer ferait donc basculer un appareil non rafraichi vers « valeurs manquantes
-- autorisees partout », y compris sur les variables ou elles sont interdites -- sans erreur
-- visible. Une seule verite, deux lectures : c'est le declencheur qui l'impose.
--
-- -----------------------------------------------------------------------------
-- Retirer une raison d'une variable DEJA UTILISEE : refuse
-- -----------------------------------------------------------------------------
-- AJOUTER reste libre a tout moment : elargir ce qui est acceptable ne peut invalider
-- aucune fiche. RETIRER est refuse tant que la variable porte des donnees -- la regle qui
-- s'appliquait deja au booleen. Consequence recherchee : aucune fiche ne peut porter une
-- raison absente de la liste de SA version de gabarit, donc toute fiche ancienne reste
-- modifiable PAR CONSTRUCTION, sans cas particulier dans la validation, qui reste sans etat.
-- Pour restreindre, on cree une nouvelle version du gabarit : les fiches existantes restent
-- rattachees a l'ancienne, dont la liste ne bouge pas.
--
-- Ce refus vit dans le declencheur de CE fichier et non dans `guard_template_field_update`,
-- pour une raison d'ordre d'execution : deux declencheurs BEFORE UPDATE sur la meme table
-- s'executent par ordre alphabetique de nom, et un garde place ailleurs verrait, selon
-- l'ordre, un `missing_reasons` non encore reconcilie -- donc un retrait invisible venant
-- d'un client qui n'envoie que le booleen. Le controle est place la ou la reconciliation a
-- lieu : il est alors juste quel que soit l'ordre.
-- =============================================================================

-- =============================================================================
-- 1. La colonne
-- =============================================================================

-- NOT NULL avec valeur par defaut constante : pas de reecriture de table (defaut stocke au
-- catalogue). La valeur par defaut reprend les TROIS codes historiques, en accord avec
-- `allow_missing_codes boolean not null default true` : une insertion qui ne mentionne ni
-- l'une ni l'autre colonne se comporte exactement comme avant ce lot.
alter table public.template_field
  add column missing_reasons text[] not null
  default array['non_fait', 'inconnu', 'non_applicable']::text[];

-- Garde-fou structurel independant du declencheur. Un element NULL n'est pas « contenu »
-- au sens de `<@` : il est donc refuse ici aussi.
alter table public.template_field
  add constraint template_field_missing_reasons_known
  check (missing_reasons <@ array['non_fait', 'inconnu', 'non_applicable', 'refus', 'non_documente']::text[]);

-- Reprise des donnees existantes, AVANT la creation du declencheur pour qu'il ne la
-- contrarie pas : une variable qui refusait les valeurs manquantes n'en propose aucune.
-- Les autres gardent exactement les trois codes qu'elles proposaient deja.
update public.template_field
   set missing_reasons = '{}'::text[]
 where not allow_missing_codes;

comment on column public.template_field.missing_reasons is
  'Raisons de valeur manquante proposees pour CETTE variable. Source de verite ; allow_missing_codes en est le miroir. Liste vide = aucune valeur manquante acceptee.';

-- =============================================================================
-- 2. Reconciliation liste <-> booleen, et refus du retrait
-- =============================================================================

-- SECURITY DEFINER, comme `guard_template_field_update` dont ce declencheur partage le role :
-- il doit consulter `template_field_in_use` quel que soit le droit d'execution du client. En
-- INVOKER, une revocation ulterieure de ce droit ne desactiverait pas le garde, elle le ferait
-- ECHOUER en erreur — un garde qui casse est un garde qu'on finit par retirer. La fonction
-- n'ecrit rien d'elle-meme (elle ne fait que normaliser NEW) et reste revoquee de tous les roles.
create function public.enforce_template_field_missing_reasons()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_known    constant text[] := array['non_fait', 'inconnu', 'non_applicable', 'refus', 'non_documente'];
  v_historic constant text[] := array['non_fait', 'inconnu', 'non_applicable'];
  v_list     text[];
begin
  -- Une raison inconnue est REFUSEE, jamais ignoree en silence : une faute de frappe cote
  -- client doit se voir, pas produire une variable amputee d'une raison.
  if exists (
    select 1 from unnest(coalesce(new.missing_reasons, '{}'::text[])) as r(code)
     where r.code is null or not (r.code = any (v_known))
  ) then
    raise exception 'Raison de valeur manquante inconnue pour "%"', new.label;
  end if;

  -- Normalisation : sans doublon et dans l'ordre canonique. Rend la comparaison OLD/NEW
  -- fiable et le dictionnaire d'export stable d'une generation a l'autre.
  select coalesce(array_agg(k.code order by k.rank), '{}'::text[])
    into v_list
    from unnest(v_known) with ordinality as k(code, rank)
   where k.code = any (coalesce(new.missing_reasons, '{}'::text[]));

  if tg_op = 'INSERT' then
    -- Un client ANTERIEUR a ce lot n'envoie que le booleen : il ne sait pas exprimer une
    -- liste, et la valeur par defaut de la colonne lui en attribuerait une a son insu. Le
    -- booleen tranche donc a l'insertion, dans les deux sens.
    if not coalesce(new.allow_missing_codes, false) then
      v_list := '{}'::text[];
    elsif cardinality(v_list) = 0 then
      v_list := v_historic;
    end if;
  elsif v_list is not distinct from old.missing_reasons
        and new.allow_missing_codes is distinct from old.allow_missing_codes then
    -- Seul le booleen a bouge -> ecriture d'un client ancien : il fait foi.
    v_list := case when new.allow_missing_codes then v_historic else '{}'::text[] end;
  end if;

  -- Retrait sur une variable en service : refuse. L'ajout, lui, ne rencontre pas ce test.
  if tg_op = 'UPDATE'
     and exists (select 1 from unnest(old.missing_reasons) as r(code) where not (r.code = any (v_list)))
     and public.template_field_in_use(old.id) then
    raise exception 'Variable deja utilisee : une raison de valeur manquante ne peut plus etre retiree de "%". En ajouter reste possible ; pour en retirer, creez une nouvelle version du jeu de variables.', new.label;
  end if;

  new.missing_reasons := v_list;
  -- Le booleen REFLETE la liste : il n'est plus une seconde decision, donc plus une
  -- seconde facon de se contredire.
  new.allow_missing_codes := cardinality(v_list) > 0;
  return new;
end $$;
revoke all on function public.enforce_template_field_missing_reasons() from public, anon, authenticated;

create trigger trg_template_field_missing_reasons
  before insert or update of missing_reasons, allow_missing_codes
  on public.template_field
  for each row execute function public.enforce_template_field_missing_reasons();

-- `allow_missing_codes` sort de la liste des changements semantiques : il n'est plus une
-- decision propre mais le reflet de `missing_reasons`, dont le retrait est desormais garde
-- ci-dessus. L'y laisser interdirait d'AJOUTER une raison a une variable en service, ce que
-- ce lot autorise explicitement -- elargir ne peut invalider aucune fiche.
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
           or (coalesce(new.allowed_values, 'null'::jsonb) is distinct from coalesce(old.allowed_values, 'null'::jsonb))
           or (new.min_value is distinct from old.min_value)
           or (new.max_value is distinct from old.max_value);
  if semantic and public.template_field_in_use(old.id) then
    raise exception 'Variable deja utilisee : seuls le libelle, la section et l''unite sont modifiables. Pour changer son comportement, creez une nouvelle version du jeu de variables.';
  end if;
  return new;
end $$;

-- =============================================================================
-- 3. Recopie d'une version a l'autre
-- =============================================================================

-- Meme lecon qu'a L28 : une colonne oubliee ici se perd EN SILENCE a la duplication d'un
-- gabarit. Une variable qui ne proposait que « refus » se retrouverait avec les trois codes
-- historiques dans la version suivante.
create or replace function public.copy_template_fields(
  p_source_version_id  uuid,
  p_target_version_id  uuid,
  p_force_patient_scope boolean default false
) returns void
language sql security invoker set search_path = public, pg_temp as $$
  insert into public.template_field
    (template_version_id, field_key, label, description, default_value, scope, section, type,
     unit, allowed_values, required, min_value, max_value, allow_missing_codes, missing_reasons,
     display_order, encounter_types)
  select p_target_version_id, field_key, label, description, default_value,
         case when p_force_patient_scope then 'patient' else scope end,
         section, type, unit, allowed_values, required, min_value, max_value,
         allow_missing_codes, missing_reasons, display_order,
         case when p_force_patient_scope then null else encounter_types end
  from public.template_field
  where template_version_id = p_source_version_id
  order by display_order, id;
$$;

-- =============================================================================
-- 4. Modification d'une variable
-- =============================================================================

-- Nouvelle signature portant la liste. L'ANCIENNE reste en place, inchangee : un client non
-- rafraichi continue de l'appeler et le declencheur traduit son booleen en liste.
create function public.update_template_field(
  p_field_id uuid, p_field_key text, p_label text, p_description text, p_default_value text,
  p_scope text, p_section text, p_type text, p_required boolean,
  p_missing_reasons text[],
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
  -- `missing_reasons` est absent de ce test : son retrait est garde par le declencheur de
  -- table, qui couvre aussi la voie directe, et son ajout est autorise.
  semantic := (p_field_key is distinct from cur.field_key)
           or (p_type is distinct from cur.type) or (p_scope is distinct from cur.scope)
           or (p_required is distinct from cur.required)
           or ((case when p_scope = 'encounter' then p_encounter_types else null end) is distinct from cur.encounter_types)
           or (coalesce(p_allowed_values, 'null'::jsonb) is distinct from coalesce(cur.allowed_values, 'null'::jsonb))
           or (p_min_value is distinct from cur.min_value) or (p_max_value is distinct from cur.max_value);
  if semantic and public.template_field_in_use(p_field_id) then
    raise exception 'Variable deja utilisee : seuls le libelle, la consigne de saisie, la valeur proposee, la section et l''unite sont modifiables. Pour changer son comportement, creez une nouvelle version du gabarit.';
  end if;
  update public.template_field
     set field_key = p_field_key, label = p_label, description = nullif(btrim(p_description), ''),
         default_value = nullif(btrim(p_default_value), ''),
         scope = p_scope, section = p_section, type = p_type, required = p_required,
         encounter_types = case when p_scope = 'encounter' then p_encounter_types else null end,
         allowed_values = p_allowed_values, min_value = p_min_value, max_value = p_max_value,
         unit = p_unit, missing_reasons = coalesce(p_missing_reasons, '{}'::text[])
   where id = p_field_id returning * into res;
  return res;
end $$;
revoke all on function public.update_template_field(uuid, text, text, text, text, text, text, text, boolean, text[], text[], jsonb, numeric, numeric, text) from public, anon;
grant execute on function public.update_template_field(uuid, text, text, text, text, text, text, text, boolean, text[], text[], jsonb, numeric, numeric, text) to authenticated;

-- =============================================================================
-- 5. Instantane hors-ligne
-- =============================================================================

-- L'instantane emet DESORMAIS LES DEUX. Le booleen pour les copies deja telechargees et les
-- clients non rafraichis, la liste pour les autres : c'est ce qui rend la transition sans
-- fenetre de bascule.
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

-- =============================================================================
-- 6. Validation d'une fiche
-- =============================================================================

-- La liste des raisons cesse d'etre ecrite en dur : elle est lue sur la variable. Les
-- messages nomment le LIBELLE de la variable et jamais la valeur -- ni la donnee clinique,
-- ni la raison invoquee, qui dit deja quelque chose de la personne.
create or replace function public.assert_data_valid(p_version uuid, p_scope text, p_data jsonb)
returns void language plpgsql stable set search_path = public, pg_temp as $$
declare
  f   record;
  v   jsonb;
  n   numeric;
  txt text;
begin
  if p_data is null then return; end if;
  for f in
    select field_key, label, type, unit, allowed_values, min_value, max_value, missing_reasons
    from public.template_field
    where template_version_id = p_version and scope = p_scope
  loop
    if not (p_data ? f.field_key) then continue; end if;
    v := p_data -> f.field_key;
    if v is null or jsonb_typeof(v) = 'null' then continue; end if;

    if jsonb_typeof(v) = 'object' and (v ? '__missing__') then
      if cardinality(f.missing_reasons) = 0 then
        raise exception 'Valeur manquante non autorisee pour "%"', f.label;
      end if;
      if (v ->> '__missing__') is null
         or (v ->> '__missing__') not in ('non_fait', 'inconnu', 'non_applicable', 'refus', 'non_documente') then
        raise exception 'Code de donnee manquante invalide pour "%"', f.label;
      end if;
      if not (f.missing_reasons @> array[v ->> '__missing__']) then
        raise exception 'Raison de valeur manquante non autorisee pour "%"', f.label;
      end if;
      continue;
    end if;

    if f.type = 'terminology' then
      if jsonb_typeof(v) <> 'object' then
        raise exception 'Code et libelle attendus pour "%"', f.label;
      end if;
      if exists (select 1 from jsonb_object_keys(v) k where k not in ('code','label')) then
        raise exception 'Contenu inattendu pour "%"', f.label;
      end if;
      if jsonb_typeof(v -> 'code') <> 'string' or jsonb_typeof(v -> 'label') <> 'string'
         or btrim(coalesce(v ->> 'code', '')) = '' or btrim(coalesce(v ->> 'label', '')) = '' then
        raise exception 'Code et libelle requis pour "%"', f.label;
      end if;
      if not exists (
        select 1
        from public.terminology_concept c
        where c.code = (v ->> 'code')
          and c.is_selectable
          and c.label = (v ->> 'label')
      ) then
        raise exception 'Diagnostic inconnu ou libelle non conforme pour "%"', f.label;
      end if;
      continue;
    end if;

    if f.type = 'multiselect' then
      if jsonb_typeof(v) <> 'array' then
        raise exception 'Liste (tableau) attendue pour "%"', f.label;
      end if;
      if exists (select 1 from jsonb_array_elements(v) el(value) where jsonb_typeof(el.value) <> 'string') then
        raise exception 'Liste de textes attendue pour "%"', f.label;
      end if;
      if f.allowed_values is not null
         and exists (select 1 from jsonb_array_elements_text(v) el where not (f.allowed_values @> jsonb_build_array(el))) then
        raise exception 'Valeur non autorisee pour "%"', f.label;
      end if;
      continue;
    end if;

    if f.type in ('number','integer') then
      if jsonb_typeof(v) <> 'number' then
        raise exception 'Valeur numerique JSON attendue pour "%"', f.label;
      end if;
      n := (v #>> '{}')::numeric;
      if f.type = 'integer' and n <> trunc(n) then
        raise exception 'Entier attendu pour "%"', f.label;
      end if;
      if f.min_value is not null and n < f.min_value then
        raise exception '"%" en dessous du minimum autorise (%)', f.label, f.min_value;
      end if;
      if f.max_value is not null and n > f.max_value then
        raise exception '"%" au dessus du maximum autorise (%)', f.label, f.max_value;
      end if;
      continue;
    end if;

    if f.type = 'boolean' then
      if jsonb_typeof(v) <> 'boolean' then
        raise exception 'Booleen JSON attendu pour "%"', f.label;
      end if;
      continue;
    end if;

    if jsonb_typeof(v) <> 'string' then
      raise exception 'Texte JSON attendu pour "%"', f.label;
    end if;
    txt := v #>> '{}';
    if txt is null or txt = '' then continue; end if;

    if f.type = 'select' then
      if f.allowed_values is not null and not (f.allowed_values @> jsonb_build_array(txt)) then
        raise exception 'Valeur non autorisee pour "%"', f.label;
      end if;
    elsif f.type = 'date' then
      if not public.is_strict_date_text(txt) then
        raise exception 'Date invalide pour "%" (format AAAA-MM-JJ attendu)', f.label;
      end if;
    elsif f.type = 'datetime' then
      if not public.is_strict_datetime_text(txt) then
        raise exception 'Date/heure invalide pour "%" (format ISO AAAA-MM-JJTHH:MM attendu)', f.label;
      end if;
    end if;
  end loop;
end $$;

comment on function public.assert_data_valid(uuid, text, jsonb) is
  'Valide types, bornes, terminologies et raisons de valeur manquante propres a chaque variable. Les couples historiques restent valides tant que leur publication est conservee.';
