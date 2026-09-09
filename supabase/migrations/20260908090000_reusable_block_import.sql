-- =============================================================================
-- 20260908090000_reusable_block_import.sql  (L58)
--
-- IMPORT SERVEUR D'UN BLOC REUTILISABLE, entre deux versions de jeu de variables.
--
-- Un bloc n'est PAS un objet nouveau : c'est une `template_section` sans parent, dans une
-- version deja lisible. Ce lot n'ajoute ni table de blocs, ni catalogue, ni role, ni
-- permission. Il ajoute UN verbe : inserer un bloc lisible dans une version en cours
-- d'edition, par COPIE et jamais par reference (D2).
--
-- MIGRATION ADDITIVE ET DORMANTE : aucune interface ne l'appelle a ce stade (c'est L59 qui
-- appellera les deux fonctions). Aucune migration appliquee n'est modifiee, aucune donnee
-- clinique n'est reecrite, aucune base existante ne change d'apparence au deploiement.
--
-- CE QUE CETTE MIGRATION CHANGE POUR L'EXISTANT, et rien d'autre :
--   1. deux colonnes de provenance NULLABLES sur `template_section` (D3) ;
--   2. la liste des 21 colonnes recopiees de `template_field` sort de
--      `copy_template_fields` pour vivre dans `copy_template_field_rows`, que la recopie de
--      version ET l'import partagent. La liste reste a UN SEUL endroit : c'est exactement
--      l'invariant que la centralisation de L28 avait pose, et que deux listes
--      concurrentes trahiraient en silence a la prochaine colonne ajoutee ;
--   3. `copy_template_fields` recopie desormais la provenance telle quelle, pour qu'une
--      version suivante conserve la provenance de son bloc (§4.5) ;
--   4. `guard_template_section_write` laisse passer l'effacement de provenance provoque par
--      `on delete set null` : sans cela, supprimer un gabarit source rendrait indelebile
--      une version cible publiee.
--
-- POURQUOI L'IMPORT N'APPELLE PAS `copy_template_fields` :
--   son dernier statement ECRASE `diagnosis_configuration` de la cible par celle de la
--   source, ce que le §4.3 interdit ; et elle copie TOUTE la version, sans filtre de bloc.
--   La reutilisation porte donc sur la liste de colonnes (corps partage), pas sur un appel.
--
-- POURQUOI LES DEUX ENTREES SONT `security definer` :
--   `lock_template_section_version` et `normalize_template_section_order`, exigees par les
--   §4.6 et §4.2, sont revoquees de `authenticated` ; et une source lisible via
--   `can_read_template` mais non possedee ne se lit pas sous la RLS de l'appelant. Sous
--   invoker, une source interdite ne leverait pas : elle rendrait ZERO ligne, et
--   `IMPORT_SOURCE_FORBIDDEN` deviendrait indiscernable de « bloc inconnu ». Le prologue
--   d'autorisation est donc explicite, et `auth.uid()` reste le claim du JWT : aucune garde
--   conditionnee par l'authentification n'est relachee.
-- =============================================================================

-- =============================================================================
-- 1. Provenance (D3) : posee a l'import, transportee par la recopie, lue par personne
-- =============================================================================

alter table public.template_section
  add column source_template_version_id uuid references public.template_version(id) on delete set null;
alter table public.template_section
  add column source_section_key text;

comment on column public.template_section.source_template_version_id is
  'Provenance L58 : version d''ou ce bloc a ete importe. Nulle pour tout l''existant. '
  'Aucune lecture en v1 : elle est posee parce qu''elle serait irrecuperable apres coup.';
comment on column public.template_section.source_section_key is
  'Provenance L58 : code du bloc dans la version source, recopie tel quel par les six voies de recopie.';

-- Reprise a l'IDENTIQUE de la definition L54, avec UNE exemption ajoutee en tete de la
-- branche UPDATE. `on delete set null` transforme la suppression d'une version source en un
-- UPDATE sur les sections qui la citent ; sans exemption, la garde de gel refuserait cet
-- UPDATE des que la version cible est publiee, et le gabarit source deviendrait indelebile.
-- L'exemption est etroite : elle n'accepte QUE l'effacement de la provenance, toutes les
-- autres colonnes restant inchangees.
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
     and (new.id, new.template_version_id, new.section_key, new.label, new.display_order,
          new.parent_section_id, new.source_section_key)
         is not distinct from
         (old.id, old.template_version_id, old.section_key, old.label, old.display_order,
          old.parent_section_id, old.source_section_key) then
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

-- =============================================================================
-- 2. La liste des colonnes recopiees, a UN SEUL endroit
-- =============================================================================

-- Extraction EXACTE des 21 colonnes de la definition L55 de `copy_template_fields`, plus un
-- filtre de cles. `p_field_keys` nul = toute la version source : c'est le comportement des
-- six voies de recopie, inchange. Non nul = les seules variables d'un bloc importe.
--
-- Ces 21 colonnes sont TOUTES les colonnes de `template_field` sauf `id`. Toute colonne
-- omise serait absorbee SANS ERREUR par un defaut de colonne ou par un declencheur
-- d'enforcement (missing_reasons ramenee aux trois raisons historiques, allowed_options
-- regeneree depuis allowed_values en perdant les libelles corriges, is_multiple retombant a
-- false, formule perdue) : le defaut ne se verrait qu'au premier formulaire ou au premier
-- export. C'est la raison d'etre de cette fonction.
create function public.copy_template_field_rows(
  p_source_version_id   uuid,
  p_target_version_id   uuid,
  p_force_patient_scope boolean,
  p_field_keys          text[]
) returns void
language sql security invoker set search_path = public, pg_temp as $$
  insert into public.template_field
    (template_version_id, field_key, label, description, default_value, scope, section, section_id,
     type, is_multiple, unit, allowed_values, allowed_options, required, min_value, max_value,
     allow_missing_codes, missing_reasons, formula, display_order, encounter_types)
  select p_target_version_id, src.field_key, src.label, src.description, src.default_value,
         case when p_force_patient_scope then 'patient' else src.scope end,
         case when p_field_keys is null then src.section else null end,
         tgt.id, src.type, src.is_multiple, src.unit, src.allowed_values,
         src.allowed_options, src.required, src.min_value, src.max_value,
         src.allow_missing_codes, src.missing_reasons, src.formula, src.display_order,
         case when p_force_patient_scope then null else src.encounter_types end
  from public.template_field src
  left join public.template_section src_s on src_s.id = src.section_id
  left join public.template_section tgt
         on tgt.template_version_id = p_target_version_id
        and tgt.section_key = coalesce(src_s.section_key, src.section)
  where src.template_version_id = p_source_version_id
    and (p_field_keys is null or src.field_key = any(p_field_keys))
  order by src.display_order, src.id;
$$;
revoke all on function public.copy_template_field_rows(uuid, uuid, boolean, text[]) from public, anon, authenticated;

-- Meme signature qu'en L55 -- jamais une surcharge : un quatrieme parametre rendrait
-- ambigus les six appels existants a deux arguments. Seuls changent la delegation de la
-- liste de colonnes et la recopie de la provenance.
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
     source_template_version_id, source_section_key)
  select p_target_version_id, ts.section_key, ts.label, ts.display_order,
         ts.source_template_version_id, ts.source_section_key
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

  perform public.copy_template_field_rows(p_source_version_id, p_target_version_id, p_force_patient_scope, null);
  update public.template_version set diagnosis_configuration = config where id = p_target_version_id;
end $$;

-- =============================================================================
-- 3. Refus types (§4.4)
-- =============================================================================

-- Forme de `block_hidden_value`, la seule que le web sait decoder : une phrase humaine dans
-- `message`, le code stable dans le JSON de `detail`. La forme « message nu » et la forme
-- « JSON dans le message » ne sont pas lisibles par `structuredErrorCode`, qui ignore
-- explicitement le code PostgreSQL P0001.
--
-- `detail` ne porte que des identifiants de gabarit -- cles de variable et de section --,
-- que l'editeur voit deja. Jamais de valeur clinique.
create function public.template_import_refusal(p_code text, p_details jsonb default '{}'::jsonb)
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
    else 'Import de bloc refuse.'
  end;
  raise exception using errcode = 'P0001', message = v_message,
    detail = (coalesce(p_details, '{}'::jsonb) || jsonb_build_object('code', p_code))::text,
    hint = 'import_refused';
end $$;
revoke all on function public.template_import_refusal(text, jsonb) from public, anon, authenticated;

-- =============================================================================
-- 4. Le plan d'import, partage par la previsualisation et par l'ecriture
-- =============================================================================

-- UNE seule fonction de decision pour les deux entrees : deux chemins d'autorisation
-- distincts divergeraient, et le §9.1-7 exige que la previsualisation et l'import rendent le
-- meme rapport sur la meme entree. `p_apply` ne change que deux choses : le verrou et les
-- ecritures. Le rapport, lui, est construit AVANT toute ecriture, dans les deux cas.
--
-- Les refus resolubles cle par cle (conflit de variable, reutilisation, operande de formule)
-- sont ACCUMULES dans `conflicts` ; l'import leve alors le premier d'entre eux. Les refus
-- structurels (droits, bloc inconnu, version gelee ou utilisee, code de section deja pris)
-- sont leves par les DEUX entrees : aucun choix de reutilisation ne les resout.
create function public.template_section_import_plan(
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
revoke all on function public.template_section_import_plan(uuid, text, uuid, text[], boolean)
  from public, anon, authenticated;

-- =============================================================================
-- 5. Les deux entrees (§4.1)
-- =============================================================================

-- Entree `stable` en lecture seule : p_apply=false exclut les verrous et les ecritures
-- du plan partage. Les tests comparent les compteurs avant et apres previsualisation.
create function public.preview_template_section_import(
  p_source_version_id  uuid,
  p_source_section_key text,
  p_target_version_id  uuid,
  p_reuse_field_keys   text[] default '{}'::text[]
) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  return public.template_section_import_plan(
    p_source_version_id, p_source_section_key, p_target_version_id, p_reuse_field_keys, false);
end $$;
revoke all on function public.preview_template_section_import(uuid, text, uuid, text[]) from public, anon;
grant execute on function public.preview_template_section_import(uuid, text, uuid, text[]) to authenticated;

-- L'import ne recoit PAS le rapport de previsualisation et ne lui fait jamais confiance : il
-- rejoue le meme plan sous le verrou de version, dans une seule transaction.
create function public.import_template_section(
  p_source_version_id  uuid,
  p_source_section_key text,
  p_target_version_id  uuid,
  p_reuse_field_keys   text[] default '{}'::text[]
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  return public.template_section_import_plan(
    p_source_version_id, p_source_section_key, p_target_version_id, p_reuse_field_keys, true);
end $$;
revoke all on function public.import_template_section(uuid, text, uuid, text[]) from public, anon;
grant execute on function public.import_template_section(uuid, text, uuid, text[]) to authenticated;
