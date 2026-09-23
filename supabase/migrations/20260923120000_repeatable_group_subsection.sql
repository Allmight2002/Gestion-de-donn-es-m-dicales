-- =============================================================================
-- 20260923120000_repeatable_group_subsection.sql
-- L72a : un groupe repetable peut etre une SOUS-SECTION d'un bloc racine, pour
-- heriter du rang et de la visibilite de ce bloc
-- (docs/l72-groupe-repetable-sous-section.md).
--
-- Additive : aucune ligne clinique n'est lue pour etre reecrite, aucun groupe
-- deja racine n'est deplace. Les gardes qui restent : un seul niveau (pas de
-- groupe sous un groupe), pas de sous-section DANS un groupe, un groupe n'est
-- jamais la cible d'une regle, un groupe ne contient que des variables de
-- rencontre.
--
-- Le lot n'est pas « retirer une contrainte » : sans les correctifs de
-- `template_section_field_keys` et de `form_record_field_group_applicable`,
-- un groupe enfant rendrait des verdicts faux sans lever d'erreur (§2.2).
--
-- Hors lot : export (L72d), retrait du diagnostic (L72e), et le refus serveur
-- d'une occurrence dont le bloc parent est masque (R4, decision ouverte).
--
-- Retour arriere : reappliquer les definitions de 20260918191752 (gardes,
-- create_encounter), 20260905160000 (template_section_field_keys),
-- 20260919110000 (form_record_field_group_applicable), 20260909025040
-- (template_import_refusal) et 20260908090000 (entrees d'import), puis recreer
-- la contrainte racine en NOT VALID si un groupe enfant a ete declare entre-temps.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. G-a : la contrainte de table racine est levee
-- -----------------------------------------------------------------------------

alter table public.template_section
  drop constraint template_section_repeatable_root_only;

-- -----------------------------------------------------------------------------
-- 2. Resolution des variables d'un bloc : R1 et R3 au meme endroit
-- -----------------------------------------------------------------------------

-- R1 : le filtre `parent_section_id is null` est leve. Une cle de sous-section
-- rend desormais ses propres variables ; auparavant elle rendait zero ligne, ce
-- qui aurait fait d'un groupe enfant un groupe sans aucune variable applicable
-- (rien de requis dans l'occurrence, et ses variables de nouveau reclamees sur
-- une rencontre ordinaire). Un groupe n'a jamais de sous-section : il rend
-- exactement ses variables, a quelque profondeur qu'il soit.
--
-- R3 : l'expansion d'une racine EXCLUT ses enfants repetables. Leurs variables
-- ne figurent jamais dans la fiche sur laquelle une regle de bloc est evaluee :
-- un groupe est une suite de lignes `encounter`, pas une partie de la fiche.
-- Les inclure ferait melanger portee patient et portee rencontre dans le
-- controle de portee de `assert_rule_structure`, qui refuserait alors la regle
-- du bloc de diagnostic (rupture 2). L'exclusion est posee ICI et non dans ce
-- seul controle, parce que la meme expansion alimente aussi
-- `visibility_hidden_fields` et `assert_block_hidden_values` : evaluees sur les
-- donnees d'une occurrence, ou le pilote patient est absent, elles masqueraient
-- toutes les variables du groupe — rien de requis dans l'occurrence, et toute
-- valeur saisie refusee comme « valeur d'un bloc masque », chez tous les
-- patients. L'heritage de visibilite d'un groupe enfant se fait par l'etape
-- (L72c), pas par des cles de variables.
--
-- Une racine sans enfant repetable — donc toute version anterieure a L72 —
-- rend exactement le meme ensemble qu'avant.
create or replace function public.template_section_field_keys(
  p_version_id uuid,
  p_section_key text
) returns table(field_key text)
language sql stable security invoker set search_path = public, pg_temp as $$
  with target as (
    select id
      from public.template_section
     where template_version_id = p_version_id
       and section_key = p_section_key
  )
  select distinct tf.field_key
    from public.template_field tf
    join public.template_section s
      on s.template_version_id = p_version_id
     and (tf.section_id = s.id or tf.section = s.section_key)
   where tf.template_version_id = p_version_id
     and exists (
       select 1 from target t
        where s.id = t.id
           or (s.parent_section_id = t.id and not s.is_repeatable)
     );
$$;

-- Les appelants E3 designaient le groupe par une racine repetable. Le groupe peut
-- desormais etre une sous-section : seul `is_repeatable` le qualifie.
create or replace function public.form_record_field_group_applicable(
  p_version_id uuid,
  p_field_key text,
  p_group_section_key text
)
returns boolean
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select case
    when p_group_section_key is null then not exists (
      select 1
        from public.template_section s
        cross join lateral public.template_section_field_keys(p_version_id, s.section_key) k
       where s.template_version_id = p_version_id
         and s.is_repeatable
         and k.field_key = p_field_key
    )
    else exists (
      select 1
        from public.template_section s
       where s.template_version_id = p_version_id
         and s.section_key = p_group_section_key
         and s.is_repeatable
         and exists (
           select 1
             from public.template_section_field_keys(p_version_id, p_group_section_key) k
            where k.field_key = p_field_key
         )
    )
  end
$$;

-- -----------------------------------------------------------------------------
-- 3. G-b : la garde d'ecriture de section accepte un groupe enfant
-- -----------------------------------------------------------------------------

-- Corps repris a l'identique de 20260918191752_repeatable_groups.sql, un seul refus
-- retire (« Un groupe repetable est un bloc racine »). Ce qui borne toujours le
-- groupe enfant : le parent doit etre une racine (un seul niveau), un groupe
-- n'accepte pas de sous-section et ne peut pas etre enfant d'un groupe, la
-- bascule et le changement de parent restent refuses sur une version utilisee.
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
  if tg_op = 'UPDATE' and new.is_repeatable is distinct from old.is_repeatable
     and public.template_version_in_use(v_version) then
    raise exception 'Version deja utilisee : creez une nouvelle version';
  end if;
  if tg_op <> 'DELETE' then
    if (new.is_repeatable and exists (
          select 1 from public.template_section where parent_section_id = new.id))
       or exists (select 1 from public.template_section
                  where id = new.parent_section_id and is_repeatable) then
      raise exception 'Un groupe répétable n''accepte pas de sous-section';
    end if;
    if new.is_repeatable and exists (
      select 1 from public.template_field f where f.template_version_id = v_version
        and (f.section_id = new.id or f.section = new.section_key) and f.scope <> 'encounter'
    ) then
      raise exception 'Un groupe répétable ne contient que des variables de rencontre';
    end if;
    -- L66 §6.5, sens inverse : un bloc deja cible d'une regle ne devient pas repetable,
    -- sinon la version porterait l'etat que §6.5 interdit d'atteindre par l'autre bord.
    if new.is_repeatable and exists (
      select 1 from public.validation_rule r where r.template_version_id = v_version
        and r.rule #>> '{then,section}' = new.section_key
    ) then
      raise exception 'Regle d''affichage : un groupe repetable ne peut pas etre la cible d''une regle';
    end if;
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

-- -----------------------------------------------------------------------------
-- 4. G-c : une occurrence designe un bloc repetable de sa version, a toute profondeur
-- -----------------------------------------------------------------------------

-- Declencheur d'occurrence : corps repris de 20260918191752, refus racine retire.
create or replace function public.guard_repeatable_encounter()
returns trigger language plpgsql security invoker set search_path = public, pg_temp as $$
declare v_section public.template_section;
begin
  if tg_op = 'UPDATE' and new.group_section_key is distinct from old.group_section_key then
    raise exception 'Le groupe d''une rencontre ne se modifie pas';
  end if;
  if new.group_section_key is null then return new; end if;
  select * into v_section from public.template_section
    where template_version_id = new.template_version_id and section_key = new.group_section_key;
  if not found then raise exception 'Groupe inconnu pour cette version'; end if;
  if not v_section.is_repeatable then
    raise exception 'Ce bloc n''est pas un groupe répétable';
  end if;
  if tg_op = 'UPDATE' and (new.patient_id is distinct from old.patient_id
      or new.template_version_id is distinct from old.template_version_id) then
    raise exception 'Le groupe d''une rencontre ne se modifie pas';
  end if;
  new.encounter_type := 'autre';
  if new.encounter_date is null then
    new.age_value := null;
    new.age_unit := null;
  end if;
  if new.deleted_at is null and (tg_op = 'INSERT' or old.deleted_at is not null) then
    perform 1 from public.patient where id = new.patient_id for update;
    if (select count(*) from public.encounter
         where patient_id = new.patient_id and group_section_key = new.group_section_key
           and deleted_at is null and id <> new.id) >= 50 then
      raise exception 'Nombre maximal d''occurrences atteint pour ce groupe';
    end if;
  end if;
  return new;
end $$;

-- RPC de creation : corps repris de 20260918191752, refus racine retire.
-- `create_encounter_idempotent` (L69) et `replay_encounter_create` (L71) lui
-- delegent l'ecriture : ils heritent de la garde sans etre redefinis.
create or replace function public.create_encounter(
  p_patient_id        uuid,
  p_encounter_type    text,
  p_encounter_date    date,
  p_validation_status text,
  p_data              jsonb,
  p_age_unit          text default 'years',
  p_group_section_key text default null
) returns public.encounter
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_base uuid; v_code text; v_tv uuid; v_dob date; v_age numeric; v_unit text; v_enc public.encounter;
  v_status text;
  v_section public.template_section;
begin
  select base_id, patient_code into v_base, v_code
  from public.patient where id = p_patient_id and deleted_at is null for update;
  if v_base is null then raise exception 'Patient introuvable'; end if;
  if not public.can_create_structured_data(v_base) then raise exception 'Acces refuse'; end if;

  v_status := coalesce(p_validation_status, 'draft');
  -- Promouvoir directement en 'curated' est un acte de curation, pas de saisie :
  -- reserve a can_edit_structured_data (le medecin).
  if v_status = 'curated' and not public.can_edit_structured_data(v_base) then
    raise exception 'Acces refuse';
  end if;

  select current_template_version_id into v_tv from public.base where id = v_base;

  if p_group_section_key is not null then
    select * into v_section from public.template_section
      where template_version_id = v_tv and section_key = p_group_section_key;
    if not found then raise exception 'Groupe inconnu pour cette version'; end if;
    if not v_section.is_repeatable then
      raise exception 'Ce bloc n''est pas un groupe répétable';
    end if;
    p_encounter_type := 'autre';
    if (select count(*) from public.encounter where patient_id = p_patient_id
        and group_section_key = p_group_section_key and deleted_at is null) >= 50 then
      raise exception 'Nombre maximal d''occurrences atteint pour ce groupe';
    end if;
  end if;

  -- Re-validation SERVEUR (§5.4/§5.5) : memes bornes/listes/type que le moteur React.
  perform public.assert_data_valid(v_tv, 'encounter', coalesce(p_data, '{}'::jsonb) - 'age_at_encounter');
  -- Regle A : completude exigee des la sortie du brouillon ('complete'), pour tous
  -- les comptes. Regle B : compte de mission -> exigee a chaque enregistrement.
  if v_status <> 'draft' or not public.can_edit_structured_data(v_base) then
    perform public.assert_required_complete(v_tv, 'encounter', coalesce(p_data, '{}'::jsonb) - 'age_at_encounter', p_encounter_type, p_group_section_key);
  end if;

  v_unit := coalesce(p_age_unit, 'years');
  select date_of_birth into v_dob
  from public.patient_identity where base_id = v_base and patient_code = v_code and deleted_at is null;
  v_age := public.compute_age(v_dob, p_encounter_date, v_unit);

  insert into public.encounter
    (patient_id, template_version_id, encounter_type, encounter_date, age_value, age_unit,
     data, collection_mode, validation_status, created_by, group_section_key)
  values
    (p_patient_id, v_tv, p_encounter_type, p_encounter_date, v_age, case when v_age is not null then v_unit else null end,
     coalesce(p_data, '{}'::jsonb) - 'age_at_encounter', 'direct', v_status, auth.uid(), p_group_section_key)
  returning * into v_enc;

  return v_enc;
end $$;

-- -----------------------------------------------------------------------------
-- 5. Import de bloc (L58) : un bloc portant un groupe enfant est refuse
-- -----------------------------------------------------------------------------

-- L'import copie la racine et ses sous-sections SANS `is_repeatable`, et ses variables
-- par `template_section_field_keys`, qui n'inclut plus un enfant repetable. Un groupe
-- enfant arriverait donc dans la cible comme une sous-section ordinaire et VIDE : ses
-- variables perdues sans message. Tant que l'import ne sait pas porter un groupe, il le
-- refuse. Le controle suit le plan en lecture seule, qui a deja verifie l'acces a la
-- source : il ne revele rien d'une version inaccessible.
create or replace function public.template_import_refusal(p_code text, p_details jsonb default '{}'::jsonb)
returns void language plpgsql stable set search_path = public, pg_temp as $$
declare v_message text;
begin
  v_message := case p_code
    when 'IMPORT_SOURCE_FORBIDDEN' then 'Ce jeu de variables source n''est pas accessible.'
    when 'IMPORT_TARGET_FORBIDDEN' then 'Vous ne pouvez pas modifier ce jeu de variables.'
    when 'IMPORT_SOURCE_NOT_A_BLOCK' then 'Ce code ne designe pas un bloc de la version source : une sous-section ne s''importe pas seule.'
    when 'IMPORT_SOURCE_HAS_REPEATABLE_GROUP' then 'Ce bloc contient un groupe repetable : son import n''est pas encore pris en charge.'
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

create function public.assert_import_source_without_repeatable_child(
  p_source_version_id  uuid,
  p_source_section_key text
) returns void
language plpgsql stable set search_path = public, pg_temp as $$
begin
  if exists (
    select 1
      from public.template_section root
      join public.template_section child on child.parent_section_id = root.id
     where root.template_version_id = p_source_version_id
       and root.section_key = p_source_section_key
       and child.is_repeatable
  ) then
    perform public.template_import_refusal('IMPORT_SOURCE_HAS_REPEATABLE_GROUP',
      jsonb_build_object('sectionKey', p_source_section_key));
  end if;
end $$;
revoke all on function public.assert_import_source_without_repeatable_child(uuid, text)
  from public, anon, authenticated;

create or replace function public.preview_template_section_import(
  p_source_version_id  uuid,
  p_source_section_key text,
  p_target_version_id  uuid,
  p_reuse_field_keys   text[] default '{}'::text[]
) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_report jsonb;
begin
  v_report := public.template_section_import_plan(
    p_source_version_id, p_source_section_key, p_target_version_id, p_reuse_field_keys, false);
  perform public.assert_import_source_without_repeatable_child(p_source_version_id, p_source_section_key);
  return v_report;
end $$;

create or replace function public.import_template_section(
  p_source_version_id  uuid,
  p_source_section_key text,
  p_target_version_id  uuid,
  p_reuse_field_keys   text[] default '{}'::text[]
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  -- Plan en lecture seule d'abord : ses refus d'acces precedent le controle de groupe.
  perform public.template_section_import_plan(
    p_source_version_id, p_source_section_key, p_target_version_id, p_reuse_field_keys, false);
  -- Le verrou du plan applique, pris ici plus tot et dans le MEME ordre (par identifiant,
  -- pour les imports croises) : la structure source ne bouge plus jusqu'au commit, donc le
  -- controle reste vrai a l'ecriture. Le plan le reprend ensuite sans attente.
  perform 1 from public.template_version
    where id in (p_source_version_id, p_target_version_id) order by id for update;
  perform public.assert_import_source_without_repeatable_child(p_source_version_id, p_source_section_key);
  return public.template_section_import_plan(
    p_source_version_id, p_source_section_key, p_target_version_id, p_reuse_field_keys, true);
end $$;

notify pgrst, 'reload schema';
commit;
