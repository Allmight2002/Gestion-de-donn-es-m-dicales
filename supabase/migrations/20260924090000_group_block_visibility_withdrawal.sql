-- =============================================================================
-- 20260924090000_group_block_visibility_withdrawal.sql
-- L72e : visibilite serveur d'un groupe repetable en sous-section, et retrait
-- (docs/l72-groupe-repetable-sous-section.md §4 R4, §5 ; decisions D1 a D7 de
-- docs/prompts-lots.md).
--
-- 1. Un predicat unique, `repeatable_group_root_visible` : la section racine du
--    groupe est-elle visible pour cette fiche ? La regle de bloc est evaluee sur
--    la SECTION, cascade comprise, et non par intersection de cles de variables :
--    un bloc peut ne porter aucune variable propre. Une condition non verifiable
--    vaut « masque ».
-- 2. R4 (D1) : un declencheur sur `encounter` refuse la creation et la correction
--    d'une occurrence dont le bloc parent est masque. La suppression reste permise.
-- 3. Retrait (D2, D4, D5) : un declencheur sur `patient.data` refuse toute ecriture
--    de la fiche qui ferait passer la racine d'un groupe de visible a masque alors
--    qu'il porte des occurrences vivantes ; un declencheur sur la version courante
--    de la base refuse la meme perte de visibilite par changement de version.
--    Tous les chemins d'ecriture (update_patient, update_patient_compatible,
--    import, curation, reparation des cles, commit_work_draft, E2,
--    set_base_template_version) passent par ces declencheurs sans etre redefinis.
-- 4. Deux surcharges declaratives, `update_patient(..., p_withdrawn_occurrences)`
--    et `update_patient_compatible(..., p_withdrawn_occurrences)` : le meme
--    enregistrement, s'il declare les occurrences (identifiant et revision), ecrit
--    la fiche par la fonction existante, inchangee, puis verifie que la declaration
--    decrit exactement ce qui se masque et supprime ces occurrences en douceur,
--    dans UNE transaction. Le parametre est OBLIGATOIRE dans la
--    surcharge : PostgREST choisit la fonction par noms d'arguments, un appel
--    sans declaration resout donc toujours l'ancienne signature.
--
-- Aucune donnee clinique n'est lue pour etre reecrite ; seules les occurrences
-- explicitement declarees sont supprimees en douceur. Aucune restauration par
-- occurrence n'est creee (D6).
--
-- Retour arriere : supprimer les trois declencheurs (le comportement d'avant L72e
-- revient) puis les deux surcharges et les fonctions ajoutees ici. Aucune donnee
-- n'est a reprendre : les occurrences supprimees par un retrait declare restent
-- supprimees, comme apres une suppression individuelle.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. Predicat unique
-- -----------------------------------------------------------------------------

-- `visibility_hidden_fields` rend le point fixe des variables masquees, cascade
-- comprise : un pilote masque y vaut absent. Il ne dit rien d'un bloc sans
-- variable propre, puisqu'il raisonne par cles. Le verdict de SECTION se lit donc
-- ici : un bloc de la chaine du groupe est masque des qu'une regle d'affichage qui
-- le cible n'est pas satisfaite — pilote masque, absent, ou operateur faux. Le
-- point fixe des variables etant deja atteint, ce verdict est exact.
--
-- Un groupe racine n'est jamais masque : une regle ne peut pas cibler un groupe
-- (L66 §6.5), et la chaine d'un groupe racine se reduit a lui-meme. Une version
-- inconnue ou une cle qui n'y designe pas un groupe vaut « masque » : echec ferme.
create or replace function public.repeatable_group_root_visible(
  p_version_id uuid,
  p_group_section_key text,
  p_data jsonb
) returns boolean
language plpgsql stable set search_path = public, pg_temp as $$
declare
  v_section public.template_section;
  v_chain text[];
  v_hidden text[];
  v_data jsonb := coalesce(p_data, '{}'::jsonb);
begin
  if p_version_id is null or p_group_section_key is null then return false; end if;
  select * into v_section
    from public.template_section
   where template_version_id = p_version_id and section_key = p_group_section_key;
  if not found or not v_section.is_repeatable then return false; end if;

  with recursive chain(id, section_key, parent_section_id, depth) as (
    select s.id, s.section_key, s.parent_section_id, 0
      from public.template_section s where s.id = v_section.id
    union all
    select s.id, s.section_key, s.parent_section_id, c.depth + 1
      from public.template_section s
      join chain c on s.id = c.parent_section_id
     where c.depth < 8
  )
  select array_agg(section_key) into v_chain from chain;

  if not exists (
    select 1 from public.validation_rule vr
     where vr.template_version_id = p_version_id
       and (vr.rule -> 'then' ->> 'operator') = 'visible'
       and (vr.rule -> 'then' ->> 'section') = any(v_chain)
  ) then
    return true;
  end if;

  v_hidden := public.visibility_hidden_fields(p_version_id, v_data);
  -- CASE et non OR : l'operateur ne doit jamais recevoir un pilote absent.
  return not exists (
    select 1 from public.validation_rule vr
     where vr.template_version_id = p_version_id
       and (vr.rule -> 'then' ->> 'operator') = 'visible'
       and (vr.rule -> 'then' ->> 'section') = any(v_chain)
       and case
         when nullif(vr.rule -> 'if' ->> 'field', '') is null then true
         when (vr.rule -> 'if' ->> 'field') = any(v_hidden) then true
         when not public.rule_value_present(v_data -> (vr.rule -> 'if' ->> 'field')) then true
         else not public.rule_apply_op(
           vr.rule -> 'if' ->> 'operator',
           v_data -> (vr.rule -> 'if' ->> 'field'),
           vr.rule -> 'if' -> 'value')
       end
  );
end $$;
revoke all on function public.repeatable_group_root_visible(uuid, text, jsonb)
  from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 2. Erreurs structurees, sans valeur clinique
-- -----------------------------------------------------------------------------

-- Le code figure dans le message : les files hors ligne classent sur le texte
-- brut de l'erreur. Le detail JSON porte le code, l'action attendue et, pour un
-- retrait, les groupes (cle, bloc, nombre, identifiants, revisions).
create or replace function public.group_withdrawal_error(p_code text, p_details jsonb default '{}'::jsonb)
returns void language plpgsql volatile set search_path = public, pg_temp as $$
declare
  v_action text := case p_code
    when 'GROUP_BLOCK_HIDDEN' then 'refresh_required'
    when 'GROUP_WITHDRAWAL_CONFLICT' then 'refresh_required'
    when 'GROUP_WITHDRAWAL_REQUIRED' then 'confirm_withdrawal'
    else 'reject'
  end;
begin
  if v_action = 'refresh_required' then
    raise exception using errcode = 'P0001', message = p_code,
      detail = (coalesce(p_details, '{}'::jsonb)
        || jsonb_build_object('code', p_code, 'action', v_action))::text,
      hint = 'refresh_required';
  end if;
  raise exception using errcode = 'P0001', message = p_code,
    detail = (coalesce(p_details, '{}'::jsonb)
      || jsonb_build_object('code', p_code, 'action', v_action))::text;
end $$;
revoke all on function public.group_withdrawal_error(text, jsonb) from public, anon, authenticated;

-- Racine d'un groupe dans une version : son parent, ou lui-meme s'il est racine.
create or replace function public.repeatable_group_block_key(p_version_id uuid, p_group_section_key text)
returns text language sql stable set search_path = public, pg_temp as $$
  select coalesce(parent.section_key, g.section_key)
    from public.template_section g
    left join public.template_section parent on parent.id = g.parent_section_id
   where g.template_version_id = p_version_id and g.section_key = p_group_section_key;
$$;
revoke all on function public.repeatable_group_block_key(uuid, text) from public, anon, authenticated;

-- Etat vivant d'un groupe pour un patient : identifiants et revisions, tries.
create or replace function public.patient_group_occurrences(p_patient_id uuid, p_group_section_key text)
returns jsonb language sql stable set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'recordRevision', e.record_revision)
           order by e.id), '[]'::jsonb)
    from public.encounter e
   where e.patient_id = p_patient_id
     and e.group_section_key = p_group_section_key
     and e.deleted_at is null;
$$;
revoke all on function public.patient_group_occurrences(uuid, text) from public, anon, authenticated;

-- Groupes d'un patient qui portent des occurrences vivantes et dont la racine
-- passe de visible (ancien etat) a masquee (nouvel etat). Un groupe deja masque
-- avant l'ecriture n'est pas compte : l'ecriture ne le masque pas (D10).
create or replace function public.patient_group_withdrawals(
  p_patient_id uuid,
  p_old_version_id uuid,
  p_old_data jsonb,
  p_new_version_id uuid,
  p_new_data jsonb
) returns jsonb
language plpgsql stable set search_path = public, pg_temp as $$
declare
  v_key text;
  v_occurrences jsonb;
  v_groups jsonb := '[]'::jsonb;
begin
  for v_key in
    select distinct e.group_section_key
      from public.encounter e
     where e.patient_id = p_patient_id
       and e.group_section_key is not null
       and e.deleted_at is null
     order by 1
  loop
    if public.repeatable_group_root_visible(p_old_version_id, v_key, p_old_data)
       and not public.repeatable_group_root_visible(p_new_version_id, v_key, p_new_data) then
      v_occurrences := public.patient_group_occurrences(p_patient_id, v_key);
      v_groups := v_groups || jsonb_build_array(jsonb_build_object(
        'sectionKey', v_key,
        'blockKey', coalesce(public.repeatable_group_block_key(p_new_version_id, v_key),
                             public.repeatable_group_block_key(p_old_version_id, v_key)),
        'count', jsonb_array_length(v_occurrences),
        'occurrences', v_occurrences
      ));
    end if;
  end loop;
  return v_groups;
end $$;
revoke all on function public.patient_group_withdrawals(uuid, uuid, jsonb, uuid, jsonb)
  from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 3. R4 : une occurrence ne s'ecrit pas dans un bloc masque
-- -----------------------------------------------------------------------------

-- Couvre create_encounter et ses delegues (create_encounter_idempotent,
-- replay_encounter_create), update_encounter et replay_encounter_update,
-- update_encounter_compatible et commit_work_draft. La suppression douce, et la
-- restauration d'une base entiere, ne sont pas des ecritures d'occurrence.
--
-- La version courante est lue sous `for share` : un changement de version
-- concurrent (UPDATE de base) attend la fin de cette ecriture, ou l'inverse, et
-- chaque cote evalue l'etat engage par l'autre.
create or replace function public.guard_group_occurrence_block_visible()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_base_id uuid;
  v_data jsonb;
  v_version_id uuid;
begin
  if new.group_section_key is null or new.deleted_at is not null then return new; end if;
  if tg_op = 'UPDATE' then
    if old.deleted_at is not null then return new; end if;
    if new.data is not distinct from old.data
       and new.validation_status is not distinct from old.validation_status
       and new.encounter_date is not distinct from old.encounter_date then
      return new;
    end if;
  end if;

  select p.base_id, p.data into v_base_id, v_data
    from public.patient p where p.id = new.patient_id;
  select b.current_template_version_id into v_version_id
    from public.base b where b.id = v_base_id for share;
  v_version_id := coalesce(v_version_id, new.template_version_id);

  if not public.repeatable_group_root_visible(v_version_id, new.group_section_key, v_data) then
    perform public.group_withdrawal_error('GROUP_BLOCK_HIDDEN',
      jsonb_build_object('sectionKey', new.group_section_key,
        'blockKey', public.repeatable_group_block_key(v_version_id, new.group_section_key)));
  end if;
  return new;
end $$;
revoke all on function public.guard_group_occurrence_block_visible() from public, anon, authenticated;

drop trigger if exists trg_encounter_group_block_visible on public.encounter;
create trigger trg_encounter_group_block_visible
  before insert or update on public.encounter
  for each row execute function public.guard_group_occurrence_block_visible();

-- -----------------------------------------------------------------------------
-- 4. Retrait : une ecriture de la fiche ne masque pas des occurrences vivantes
-- -----------------------------------------------------------------------------

-- Tout chemin — ancien client, import, curation, reparation des cles, brouillon de
-- travail — est refuse avec la liste structuree des groupes concernes. Seule une
-- surcharge declarative (section 6) differe ce controle, pour la fiche qu'elle
-- ecrit et le temps de cet appel : elle refait elle-meme la comparaison exacte
-- juste apres, dans la meme transaction. Le reglage est local a la transaction et
-- aucune fonction exposee ne permet a un compte de le poser (meme principe que
-- `app.form_preparation_operation`, E2).
create or replace function public.guard_patient_group_withdrawal()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_version_id uuid;
  v_groups jsonb;
begin
  if new.data is not distinct from old.data or new.deleted_at is not null then return new; end if;
  if not exists (
    select 1 from public.encounter e
     where e.patient_id = new.id and e.group_section_key is not null and e.deleted_at is null
  ) then
    return new;
  end if;
  if current_setting('app.group_withdrawal_patient', true) = new.id::text then return new; end if;

  select b.current_template_version_id into v_version_id
    from public.base b where b.id = new.base_id for share;
  v_version_id := coalesce(v_version_id, new.template_version_id);
  v_groups := public.patient_group_withdrawals(new.id, v_version_id, old.data, v_version_id, new.data);
  if jsonb_array_length(v_groups) > 0 then
    perform public.group_withdrawal_error('GROUP_WITHDRAWAL_REQUIRED',
      jsonb_build_object('groups', v_groups));
  end if;
  return new;
end $$;
revoke all on function public.guard_patient_group_withdrawal() from public, anon, authenticated;

drop trigger if exists trg_patient_group_withdrawal on public.patient;
create trigger trg_patient_group_withdrawal
  before update of data on public.patient
  for each row execute function public.guard_patient_group_withdrawal();

-- Changement de version d'une base (E2 `apply_form_preparation`,
-- `set_base_template_version`) : les memes donnees evaluees sous une autre
-- version peuvent masquer un bloc. Un tel changement ne se declare pas fiche par
-- fiche : il est refuse, avec des comptes seulement. Le nom du declencheur le fait
-- passer APRES `trg_base_template_version`, qui valide la version cible.
create or replace function public.guard_base_version_group_withdrawal()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_patient record;
  v_groups jsonb;
  v_patients integer := 0;
  v_occurrences integer := 0;
  v_keys text[] := '{}';
  v_group jsonb;
begin
  if new.current_template_version_id is not distinct from old.current_template_version_id
     or old.current_template_version_id is null
     or new.deleted_at is not null then
    return new;
  end if;

  for v_patient in
    select p.id, p.data
      from public.patient p
     where p.base_id = new.id
       and p.deleted_at is null
       and exists (
         select 1 from public.encounter e
          where e.patient_id = p.id and e.group_section_key is not null and e.deleted_at is null
       )
     order by p.id
  loop
    v_groups := public.patient_group_withdrawals(
      v_patient.id, old.current_template_version_id, v_patient.data,
      new.current_template_version_id, v_patient.data);
    if jsonb_array_length(v_groups) > 0 then
      v_patients := v_patients + 1;
      for v_group in select value from jsonb_array_elements(v_groups) loop
        v_occurrences := v_occurrences + (v_group ->> 'count')::integer;
        if not (v_group ->> 'sectionKey') = any(v_keys) then
          v_keys := v_keys || (v_group ->> 'sectionKey');
        end if;
      end loop;
    end if;
  end loop;

  if v_patients > 0 then
    perform public.group_withdrawal_error('GROUP_WITHDRAWAL_VERSION_REFUSED',
      jsonb_build_object('patients', v_patients, 'occurrences', v_occurrences,
        'sectionKeys', to_jsonb(v_keys)));
  end if;
  return new;
end $$;
revoke all on function public.guard_base_version_group_withdrawal() from public, anon, authenticated;

drop trigger if exists trg_base_version_group_withdrawal on public.base;
create trigger trg_base_version_group_withdrawal
  before update of current_template_version_id on public.base
  for each row execute function public.guard_base_version_group_withdrawal();

-- -----------------------------------------------------------------------------
-- 5. Declaration : controle avant ecriture, comparaison exacte apres
-- -----------------------------------------------------------------------------

-- Forme attendue :
--   [{"sectionKey": "g1", "occurrences": [{"id": "<uuid>", "recordRevision": 3}, ...]}, ...]
-- Avant l'ecriture de la fiche : forme, permission de suppression, puis verrou de
-- TOUTES les occurrences vivantes du patient. L'appelant tient deja la ligne
-- patient `for update` : aucune occurrence ne peut etre creee (create_encounter
-- verrouille la meme ligne), ni corrigee ou supprimee (verrou de ligne), jusqu'a
-- la fin de la transaction. Rend la declaration normalisee : groupes tries par
-- cle, occurrences triees par identifiant.
create or replace function public.patient_group_withdrawal_prepare(
  p_patient_id uuid,
  p_declared jsonb
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_base_id uuid;
  v_group jsonb;
  v_item jsonb;
  v_keys text[] := '{}';
  v_ids uuid[] := '{}';
  v_normalized jsonb;
begin
  if p_declared is null or jsonb_typeof(p_declared) <> 'array' then
    perform public.group_withdrawal_error('GROUP_WITHDRAWAL_INVALID', '{}'::jsonb);
  end if;
  for v_group in select value from jsonb_array_elements(p_declared) loop
    if jsonb_typeof(v_group) <> 'object'
       or jsonb_typeof(v_group -> 'sectionKey') is distinct from 'string'
       or nullif(btrim(v_group ->> 'sectionKey'), '') is null
       or jsonb_typeof(v_group -> 'occurrences') is distinct from 'array'
       or jsonb_array_length(v_group -> 'occurrences') = 0
       or (v_group ->> 'sectionKey') = any(v_keys) then
      perform public.group_withdrawal_error('GROUP_WITHDRAWAL_INVALID', '{}'::jsonb);
    end if;
    for v_item in select value from jsonb_array_elements(v_group -> 'occurrences') loop
      if jsonb_typeof(v_item) <> 'object'
         or jsonb_typeof(v_item -> 'id') is distinct from 'string'
         or (v_item ->> 'id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
         or jsonb_typeof(v_item -> 'recordRevision') is distinct from 'number'
         or (v_item ->> 'recordRevision') !~ '^[1-9][0-9]{0,17}$'
         or (v_item ->> 'id')::uuid = any(v_ids) then
        perform public.group_withdrawal_error('GROUP_WITHDRAWAL_INVALID', '{}'::jsonb);
      end if;
      v_ids := v_ids || (v_item ->> 'id')::uuid;
    end loop;
    v_keys := v_keys || (v_group ->> 'sectionKey');
  end loop;

  select base_id into v_base_id from public.patient
   where id = p_patient_id and deleted_at is null for update;
  -- La suppression d'une occurrence reste l'acte de `soft_delete_encounter` :
  -- meme permission, controlee avant toute lecture des occurrences.
  if v_base_id is null or not public.can_edit_structured_data(v_base_id) then
    perform public.group_withdrawal_error('GROUP_WITHDRAWAL_FORBIDDEN', '{}'::jsonb);
  end if;

  perform 1 from public.encounter e
   where e.patient_id = p_patient_id and e.group_section_key is not null and e.deleted_at is null
   order by e.id
     for update;

  select coalesce(jsonb_agg(jsonb_build_object(
           'sectionKey', g.value ->> 'sectionKey',
           'occurrences', (
             select jsonb_agg(jsonb_build_object(
                      'id', (o.value ->> 'id')::uuid,
                      'recordRevision', (o.value ->> 'recordRevision')::bigint)
                    order by (o.value ->> 'id')::uuid)
               from jsonb_array_elements(g.value -> 'occurrences') o))
         order by g.value ->> 'sectionKey'), '[]'::jsonb)
    into v_normalized
    from jsonb_array_elements(p_declared) g;
  return v_normalized;
end $$;
revoke all on function public.patient_group_withdrawal_prepare(uuid, jsonb) from public, anon, authenticated;

-- Apres l'ecriture de la fiche : les groupes qui passent de visible a masque, avec
-- leurs occurrences vivantes, doivent etre EXACTEMENT ceux declares. Toute
-- divergence — occurrence ajoutee, modifiee ou deja supprimee, groupe declare qui
-- reste visible, groupe masque non declare — donne un conflit qui annule toute la
-- transaction, fiche comprise. Sinon les occurrences sont supprimees en douceur,
-- avec un motif engendre qui nomme le BLOC (libelle de structure), jamais le
-- diagnostic ni la valeur pilote (D4).
create or replace function public.patient_group_withdrawal_commit(
  p_patient_id uuid,
  p_old_data jsonb,
  p_declared jsonb
) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_patient public.patient;
  v_version_id uuid;
  v_actual jsonb;
  v_group jsonb;
  v_item jsonb;
  v_key text;
  v_block_key text;
  v_label text;
  v_reason text;
  v_id uuid;
begin
  select * into v_patient from public.patient where id = p_patient_id;
  select b.current_template_version_id into v_version_id
    from public.base b where b.id = v_patient.base_id for share;
  v_version_id := coalesce(v_version_id, v_patient.template_version_id);
  v_actual := public.patient_group_withdrawals(
    p_patient_id, v_version_id, p_old_data, v_version_id, v_patient.data);

  if (select coalesce(jsonb_agg(jsonb_build_object(
              'sectionKey', a.value ->> 'sectionKey', 'occurrences', a.value -> 'occurrences')
            order by a.value ->> 'sectionKey'), '[]'::jsonb)
        from jsonb_array_elements(v_actual) a) is distinct from p_declared then
    perform public.group_withdrawal_error('GROUP_WITHDRAWAL_CONFLICT',
      jsonb_build_object('groups', v_actual));
  end if;

  for v_group in select value from jsonb_array_elements(v_actual) loop
    v_key := v_group ->> 'sectionKey';
    v_block_key := v_group ->> 'blockKey';
    select nullif(btrim(s.label), '') into v_label
      from public.template_section s
     where s.template_version_id = v_version_id and s.section_key = v_block_key;
    v_reason := format('Retrait du bloc « %s » : occurrence supprimée avec l''enregistrement de la fiche',
      coalesce(v_label, v_block_key));
    for v_item in select value from jsonb_array_elements(v_group -> 'occurrences') loop
      v_id := (v_item ->> 'id')::uuid;
      update public.encounter
         set deleted_at = now(), deleted_by = auth.uid(), deletion_reason = v_reason
       where id = v_id and deleted_at is null;
      perform public.log_audit('encounter_deleted', 'encounter', v_id, v_patient.base_id,
        jsonb_build_object('justification_status', 'generated', 'reason', v_reason,
          'withdrawal', true, 'group_section_key', v_key, 'block_key', v_block_key));
    end loop;
  end loop;
end $$;
revoke all on function public.patient_group_withdrawal_commit(uuid, jsonb, jsonb) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 6. Surcharges declaratives des deux ecritures de la fiche
-- -----------------------------------------------------------------------------

-- Ordre : conflit de version d'abord (la fonction existante le leve, avec son
-- code habituel) ; controle et verrous de la declaration ; ecriture de la fiche par
-- la fonction existante, inchangee, controle de retrait differe ; comparaison
-- exacte et suppressions douces. Une erreur a n'importe quelle etape annule tout.
--
-- Chaque suppression d'occurrence rafraichit la date d'inclusion du patient
-- (`trg_refresh_patient_inclusion_date`) et fait donc avancer sa revision : la
-- valeur rendue est relue APRES les suppressions, pour ne pas annoncer une
-- revision deja depassee.
create function public.update_patient(
  p_patient_id uuid,
  p_data jsonb,
  p_validation_status text,
  p_reason text,
  p_expected_version bigint,
  p_withdrawn_occurrences jsonb
)
returns public.patient
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_pat public.patient;
  v_old jsonb;
  v_declared jsonb;
begin
  if p_withdrawn_occurrences is null then
    return public.update_patient(p_patient_id, p_data, p_validation_status, p_reason, p_expected_version);
  end if;
  select * into v_pat from public.patient
   where id = p_patient_id and deleted_at is null for update;
  if not found or p_expected_version is null or v_pat.row_version is distinct from p_expected_version then
    return public.update_patient(p_patient_id, p_data, p_validation_status, p_reason, p_expected_version);
  end if;
  v_old := coalesce(v_pat.data, '{}'::jsonb);

  v_declared := public.patient_group_withdrawal_prepare(p_patient_id, p_withdrawn_occurrences);
  perform set_config('app.group_withdrawal_patient', p_patient_id::text, true);
  perform public.update_patient(p_patient_id, p_data, p_validation_status, p_reason, p_expected_version);
  perform set_config('app.group_withdrawal_patient', '', true);
  perform public.patient_group_withdrawal_commit(p_patient_id, v_old, v_declared);

  select * into v_pat from public.patient where id = p_patient_id;
  return v_pat;
end $$;
revoke all on function public.update_patient(uuid, jsonb, text, text, bigint, jsonb) from public, anon;
grant execute on function public.update_patient(uuid, jsonb, text, text, bigint, jsonb) to authenticated;

create function public.update_patient_compatible(
  p_base_id uuid,
  p_patient_id uuid,
  p_patch jsonb,
  p_validation_status text,
  p_reason text,
  p_expected_record_revision bigint,
  p_record_definition_revision uuid,
  p_operation_id uuid,
  p_context_fingerprint text,
  p_withdrawn_occurrences jsonb
)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_pat public.patient;
  v_base public.base;
  v_old jsonb;
  v_declared jsonb;
  v_receipt jsonb;
begin
  if p_withdrawn_occurrences is null or p_patient_id is null or p_operation_id is null then
    return public.update_patient_compatible(p_base_id, p_patient_id, p_patch, p_validation_status,
      p_reason, p_expected_record_revision, p_record_definition_revision, p_operation_id,
      p_context_fingerprint);
  end if;
  perform public.form_record_assert_read_access(p_base_id);

  -- Meme verrou consultatif que la fonction existante (il est reentrant) : un
  -- rejeu de la meme operation rend son recu au lieu de pretendre a un conflit.
  perform pg_advisory_xact_lock(hashtextextended(
    'record-form:' || auth.uid()::text || ':' || p_operation_id::text, 0
  ));
  if exists (
    select 1 from public.record_form_operation o
     where o.actor_id = auth.uid() and o.operation_id = p_operation_id
  ) then
    return public.update_patient_compatible(p_base_id, p_patient_id, p_patch, p_validation_status,
      p_reason, p_expected_record_revision, p_record_definition_revision, p_operation_id,
      p_context_fingerprint);
  end if;

  -- Ordre de verrou de la fonction existante : base partagee, puis fiche.
  perform 1 from public.base where id = p_base_id and deleted_at is null for share;
  select * into v_pat from public.patient
   where id = p_patient_id and base_id = p_base_id and deleted_at is null for update;
  if not found or p_expected_record_revision is null
     or v_pat.row_version is distinct from p_expected_record_revision then
    return public.update_patient_compatible(p_base_id, p_patient_id, p_patch, p_validation_status,
      p_reason, p_expected_record_revision, p_record_definition_revision, p_operation_id,
      p_context_fingerprint);
  end if;
  v_old := coalesce(v_pat.data, '{}'::jsonb);

  v_declared := public.patient_group_withdrawal_prepare(p_patient_id, p_withdrawn_occurrences);
  perform set_config('app.group_withdrawal_patient', p_patient_id::text, true);
  v_receipt := public.update_patient_compatible(p_base_id, p_patient_id, p_patch, p_validation_status,
    p_reason, p_expected_record_revision, p_record_definition_revision, p_operation_id,
    p_context_fingerprint);
  perform set_config('app.group_withdrawal_patient', '', true);
  perform public.patient_group_withdrawal_commit(p_patient_id, v_old, v_declared);

  -- Le recu garde son contrat : revision et empreinte de contexte ACTUELLES. Il est
  -- mis a jour la ou la fonction existante l'a range, pour qu'un rejeu rende le meme.
  select * into v_pat from public.patient where id = p_patient_id;
  select * into v_base from public.base where id = p_base_id;
  v_receipt := v_receipt || jsonb_build_object(
    'recordRevision', v_pat.row_version,
    'contextFingerprint', public.form_record_context_fingerprint(
      'patient', v_pat.id, v_pat.row_version, v_pat.base_id,
      v_base.form_revision, v_pat.template_version_id, v_pat.data));
  update public.record_form_operation
     set receipt = v_receipt
   where actor_id = auth.uid() and operation_id = p_operation_id;
  return v_receipt;
end $$;
revoke all on function public.update_patient_compatible(uuid, uuid, jsonb, text, text, bigint, uuid, uuid, text, jsonb)
  from public, anon;
grant execute on function public.update_patient_compatible(uuid, uuid, jsonb, text, text, bigint, uuid, uuid, text, jsonb)
  to authenticated;

notify pgrst, 'reload schema';
commit;
