-- =============================================================================
-- 20260729104500_mission_accounts.sql
-- Comptes de mission (docs/spec-comptes-mission.md, lot L10).
--
-- Un medecin confie la saisie d'UNE base a un etudiant / enqueteur de terrain, pour
-- une duree bornee et revocable. Le socle existant (base_access, revocation, audit)
-- est reutilise tel quel ; cette migration ajoute les quatre pieces manquantes :
--
--   1. un ROLE GLOBAL dedie `saisisseur` -> toute policy ecrite `is_medecin() and ...`
--      l'exclut par defaut (echec ferme) : il ne peut ni creer de base, ni de gabarit ;
--   2. une PERMISSION DE CREATION separee (`can_create_structured_data`) qui distingue
--      « creer » de « modifier » -> la saisie est possible, la correction d'une donnee
--      soumise reste reservee au medecin ;
--   3. une EXPIRATION d'acces (`base_access.expires_at`) verifiee par la base a chaque
--      requete -> un jeton deja emis ne survit pas a l'echeance ;
--   4. les RPC de provisionnement / prolongation / inventaire adossees a l'Edge Function
--      d'invitation (`create-mission-account`).
--
-- Decisions du demandeur (2026-07-29) : duree maximale 24 mois prolongeable ; lecture
-- de l'identite reglee A LA CREATION, desactivee par defaut, justification obligatoire
-- a l'activation ; pas de televersement en v1 ; purge des comptes echus a 12 mois apres
-- l'echeance (regle consignee, operation d'entretien manuelle).
--
-- ADDITIVE : aucune migration existante n'est modifiee. Toutes les lignes `base_access`
-- deja en place gardent `expires_at is null` (= acces permanent, comportement actuel) et
-- `can_create_structured_data = false` (sans effet : les RPC de creation acceptent aussi
-- `can_edit_structured_data`, cf. §7 de la spec).
-- =============================================================================

-- =============================================================================
-- 1. Role global `saisisseur`
-- =============================================================================

alter table public.profiles drop constraint if exists profiles_global_role_check;
alter table public.profiles add constraint profiles_global_role_check
  check (global_role in ('system_admin','medecin','curateur','saisisseur'));

comment on column public.profiles.global_role is
  'system_admin | medecin (cree/possede des bases) | curateur (pool de curation) | '
  'saisisseur (compte de mission : saisit sur UNE base, pour une duree bornee).';

-- =============================================================================
-- 2. base_access : echeance, permission de creation, justification identite
-- =============================================================================

alter table public.base_access
  add column if not exists expires_at                 timestamptz,
  add column if not exists can_create_structured_data boolean not null default false,
  add column if not exists identity_justification     text;

comment on column public.base_access.expires_at is
  'null = acces permanent (collaboration entre medecins, comportement historique). '
  'Non-null = mission : la base refuse tout acces des que now() >= expires_at.';
comment on column public.base_access.can_create_structured_data is
  'Creer patients / rencontres / valeurs SANS pouvoir modifier une donnee deja soumise. '
  'Les RPC de creation acceptent can_create OU can_edit (compatibilite des editeurs existants).';
comment on column public.base_access.identity_justification is
  'Motif consigne quand un compte de mission recoit la lecture de l''identite nominative. '
  'Obligatoire des que can_view_identity est vrai pour un profil saisisseur.';

-- =============================================================================
-- 3. Garde de coherence des lignes d'acces
--    Remplace guard_base_access_medecin (20260616094200) : le beneficiaire d'un acces
--    actif peut desormais etre un medecin OU un compte de mission, ce dernier sous des
--    invariants stricts appliques PAR LA BASE, quelle que soit la voie d'ecriture.
-- =============================================================================

create or replace function public.guard_base_access_medecin()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_role text;
begin
  -- Une ligne revoquee reste modifiable (nettoyage d'anciens acces invalides).
  if new.revoked_at is not null then
    return new;
  end if;

  select p.global_role into v_role from public.profiles p where p.id = new.user_id;

  if v_role is null or v_role not in ('medecin','saisisseur') then
    raise exception 'base_access reserve aux comptes medecin';
  end if;

  if v_role = 'saisisseur' then
    -- Une mission est bornee dans le temps : pas d'echeance, pas d'acces.
    if new.expires_at is null then
      raise exception 'Un compte de mission exige une echeance';
    end if;
    -- Duree maximale d'une mission : 24 mois (prolongeable par le medecin).
    if new.expires_at > now() + interval '24 months' then
      raise exception 'La duree d''une mission ne peut depasser 24 mois';
    end if;
    -- Un compte de mission SAISIT ; il ne corrige pas, n'exporte pas, ne gere pas
    -- les acces et ne voit pas les documents bruts (upload exclu de la v1).
    if new.can_edit_structured_data or new.can_export_data
       or new.can_manage_access or new.can_view_raw_documents then
      raise exception 'Permissions interdites pour un compte de mission';
    end if;
    -- La saisie est la raison d'etre du compte : sans elle, la ligne n'a pas de sens.
    if not new.can_create_structured_data then
      raise exception 'Un compte de mission exige la permission de creation';
    end if;
    -- Lecture de l'identite : reglee a la creation, justification consignee.
    if new.can_view_identity and coalesce(btrim(new.identity_justification), '') = '' then
      raise exception 'Justification requise pour ouvrir l''identite a un compte de mission';
    end if;
    -- UNE seule base par compte de mission : c'est le cloisonnement principal du role.
    if exists (
      select 1 from public.base_access a
      where a.user_id = new.user_id and a.base_id <> new.base_id and a.revoked_at is null
    ) then
      raise exception 'Un compte de mission ne peut etre rattache qu''a une seule base';
    end if;
  end if;

  return new;
end $$;

-- =============================================================================
-- 4. Fonctions d'autorisation
--    L'expiration s'ajoute a TOUTES les fonctions de permission : une ligne echue
--    n'autorise plus rien, y compris pour un collaborateur medecin.
--    Le role saisisseur n'est ajoute qu'a has_base_access, can_create_structured_data
--    et can_view_identity ; son exclusion des autres permissions reste STRUCTURELLE
--    (`is_medecin()` seul). La condition « base non supprimee » de 20260616096000 est
--    conservee telle quelle : une base mise a la corbeille n'autorise toujours rien.
-- =============================================================================

create or replace function public.is_saisisseur()
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.global_role = 'saisisseur')
$$;

-- Forme reprise de 20260616096000 (base non supprimee + branche proprietaire en ligne),
-- a laquelle s'ajoutent l'echeance et, la ou c'est voulu, le role saisisseur.
create or replace function public.has_base_access(p_base uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select (public.is_medecin() or public.is_saisisseur())
     and exists (select 1 from public.base b where b.id = p_base and b.deleted_at is null)
     and (
       exists (select 1 from public.base b where b.id = p_base and b.owner_user_id = auth.uid())
       or exists (select 1 from public.base_access a
                  where a.base_id = p_base and a.user_id = auth.uid() and a.revoked_at is null
                    and (a.expires_at is null or a.expires_at > now()))
     )
$$;

-- Creer une donnee structuree : can_create OU can_edit (compatibilite : un editeur
-- existant, qui n'a pas can_create, continue de creer exactement comme avant).
create or replace function public.can_create_structured_data(p_base uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select (public.is_medecin() or public.is_saisisseur())
     and exists (select 1 from public.base b where b.id = p_base and b.deleted_at is null)
     and (
       exists (select 1 from public.base b where b.id = p_base and b.owner_user_id = auth.uid())
       or exists (select 1 from public.base_access a
                  where a.base_id = p_base and a.user_id = auth.uid() and a.revoked_at is null
                    and (a.expires_at is null or a.expires_at > now())
                    and (a.can_create_structured_data or a.can_edit_structured_data))
     )
$$;

create or replace function public.can_view_identity(p_base uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select (public.is_medecin() or public.is_saisisseur())
     and exists (select 1 from public.base b where b.id = p_base and b.deleted_at is null)
     and (
       exists (select 1 from public.base b where b.id = p_base and b.owner_user_id = auth.uid())
       or exists (select 1 from public.base_access a
                  where a.base_id = p_base and a.user_id = auth.uid() and a.revoked_at is null
                    and (a.expires_at is null or a.expires_at > now())
                    and a.can_view_identity)
     )
$$;

create or replace function public.can_view_raw_documents(p_base uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select public.is_medecin()
     and exists (select 1 from public.base b where b.id = p_base and b.deleted_at is null)
     and (
       exists (select 1 from public.base b where b.id = p_base and b.owner_user_id = auth.uid())
       or exists (select 1 from public.base_access a
                  where a.base_id = p_base and a.user_id = auth.uid() and a.revoked_at is null
                    and (a.expires_at is null or a.expires_at > now())
                    and a.can_view_raw_documents)
     )
$$;

create or replace function public.can_edit_structured_data(p_base uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select public.is_medecin()
     and exists (select 1 from public.base b where b.id = p_base and b.deleted_at is null)
     and (
       exists (select 1 from public.base b where b.id = p_base and b.owner_user_id = auth.uid())
       or exists (select 1 from public.base_access a
                  where a.base_id = p_base and a.user_id = auth.uid() and a.revoked_at is null
                    and (a.expires_at is null or a.expires_at > now())
                    and a.can_edit_structured_data)
     )
$$;

create or replace function public.can_export_data(p_base uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select public.is_medecin()
     and exists (select 1 from public.base b where b.id = p_base and b.deleted_at is null)
     and (
       exists (select 1 from public.base b where b.id = p_base and b.owner_user_id = auth.uid())
       or exists (select 1 from public.base_access a
                  where a.base_id = p_base and a.user_id = auth.uid() and a.revoked_at is null
                    and (a.expires_at is null or a.expires_at > now())
                    and a.can_export_data)
     )
$$;

create or replace function public.can_manage_access(p_base uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select public.is_medecin()
     and exists (select 1 from public.base b where b.id = p_base and b.deleted_at is null)
     and (
       exists (select 1 from public.base b where b.id = p_base and b.owner_user_id = auth.uid())
       or exists (select 1 from public.base_access a
                  where a.base_id = p_base and a.user_id = auth.uid() and a.revoked_at is null
                    and (a.expires_at is null or a.expires_at > now())
                    and a.can_manage_access)
     )
$$;

create or replace function public.can_write_identity(p_base uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select public.is_medecin()
     and exists (select 1 from public.base b where b.id = p_base and b.deleted_at is null)
     and (
       exists (select 1 from public.base b where b.id = p_base and b.owner_user_id = auth.uid())
       or exists (select 1 from public.base_access a
                  where a.base_id = p_base and a.user_id = auth.uid() and a.revoked_at is null
                    and (a.expires_at is null or a.expires_at > now())
                    and a.can_view_identity and a.can_edit_structured_data)
     )
$$;

create or replace function public.can_curate(p_base uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select public.is_medecin()
     and exists (select 1 from public.base b where b.id = p_base and b.deleted_at is null)
     and (
       exists (select 1 from public.base b where b.id = p_base and b.owner_user_id = auth.uid())
       or exists (select 1 from public.base_access a
                  where a.base_id = p_base and a.user_id = auth.uid() and a.revoked_at is null
                    and (a.expires_at is null or a.expires_at > now())
                    and (a.can_edit_structured_data or a.can_export_data))
     )
$$;

-- La base attribuee doit rester visible au compte de mission (sinon il ne voit rien).
-- L'echeance s'applique ici aussi : a l'expiration, la base disparait de sa liste.
drop policy if exists base_select on public.base;
create policy base_select on public.base for select to authenticated using (
  deleted_at is null
  and (public.is_medecin() or public.is_saisisseur())
  and (
    owner_user_id = auth.uid()
    or exists (
      select 1 from public.base_access ba
      where ba.base_id = base.id and ba.user_id = auth.uid() and ba.revoked_at is null
        and (ba.expires_at is null or ba.expires_at > now())
    )
  )
);

-- Surfaces de lecture qui ne relevent PAS de la saisie : cohortes, exports, historique
-- de corrections, lots d'import. `has_base_access` s'ouvrant au compte de mission, ces
-- policies doivent redire explicitement `is_medecin()`, sans quoi un compte temporaire
-- verrait le travail scientifique de la base. Aucun changement pour les medecins.
drop policy if exists fcl_select on public.field_change_log;
create policy fcl_select on public.field_change_log for select to authenticated
  using (public.is_medecin() and public.has_base_access(base_id));

drop policy if exists c_select on public.cohort;
create policy c_select on public.cohort for select to authenticated
  using (public.is_medecin() and public.has_base_access(base_id));

drop policy if exists cm_select on public.cohort_member;
create policy cm_select on public.cohort_member for select to authenticated
  using (public.is_medecin() and public.has_base_access(public.base_of_cohort(cohort_id)));

drop policy if exists cem_select on public.cohort_encounter_member;
create policy cem_select on public.cohort_encounter_member for select to authenticated
  using (public.is_medecin() and public.has_base_access(public.base_of_cohort(cohort_id)));

-- export_log : rien a changer ici. Sa policy de lecture exige deja can_export_data
-- (20260616095700), fonction reservee aux medecins : un compte de mission en est donc
-- exclu d'office. La redefinir ramenerait la lecture a sa version d'origine, plus large.

drop policy if exists ib_select on public.import_batch;
create policy ib_select on public.import_batch for select to authenticated
  using (public.is_medecin() and public.has_base_access(base_id));

-- =============================================================================
-- 5. Role a l'inscription : lu UNIQUEMENT dans app_metadata
--    raw_user_meta_data est modifiable par l'utilisateur lui-meme : y lire un role
--    serait une escalade de privilege triviale. Seul 'saisisseur' est accepte ;
--    toute autre valeur retombe sur 'medecin' (auto-inscription publique inchangee).
-- =============================================================================

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_requested text;
begin
  v_requested := coalesce(new.raw_app_meta_data, '{}'::jsonb) ->> 'global_role';

  insert into public.profiles (id, full_name, global_role, language)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    case when v_requested = 'saisisseur' then 'saisisseur' else 'medecin' end,
    coalesce(new.raw_user_meta_data ->> 'language', 'fr')
  )
  on conflict (id) do nothing;
  return new;
end $$;

-- =============================================================================
-- 6. Declassement de role -> revocation des acces
--    Etend 20260616095000 : quitter le role saisisseur revoque aussi, sinon un compte
--    promu puis retrograde retrouverait un acces actif silencieusement.
-- =============================================================================

create or replace function public.guard_profile_role()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_email text;
begin
  if auth.uid() is not null and new.global_role is distinct from old.global_role then
    if new.id = auth.uid() then
      raise exception 'Modification de son propre global_role non autorisee';
    end if;
    if not public.is_system_admin() then
      raise exception 'Modification de global_role non autorisee';
    end if;
  end if;

  if old.global_role in ('medecin','saisisseur') and new.global_role is distinct from old.global_role then
    update public.base_access
       set revoked_at = now()
     where user_id = new.id
       and revoked_at is null;

    select email into v_email from auth.users where id = new.id;
    if v_email is not null then
      update public.base_invitation
         set status = 'revoked'
       where status = 'pending'
         and lower(invited_email) = lower(v_email);
    end if;
  end if;

  return new;
end $$;

-- =============================================================================
-- 7. RPC de creation : autorisation elargie a can_create_structured_data
--    create_patient exigeait can_write_identity parce qu'elle ecrit la ligne
--    patient_identity qui porte le code (« patient minimal », §7.1). Un compte de
--    mission doit pouvoir creer ce patient SANS jamais toucher aux champs nominatifs :
--    la fonction refuse desormais explicitement toute valeur nominative fournie par un
--    appelant qui n'a pas can_write_identity, et n'ecrit que le code.
-- =============================================================================

create or replace function public.create_patient(
  p_base_id             uuid,
  p_patient_code        text,
  p_full_name           text,
  p_date_of_birth       date,
  p_phone               text,
  p_address             text,
  p_external_identifier text,
  p_permanent_data      jsonb
) returns public.patient
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_tv uuid;
  v_patient public.patient;
  v_can_write_identity boolean;
begin
  if p_patient_code is null or btrim(p_patient_code) = '' then raise exception 'Code patient requis'; end if;
  -- Autorisation EXPLICITE (la fonction est DEFINER : elle ne s'appuie pas sur la RLS).
  if not public.can_create_structured_data(p_base_id) then raise exception 'Acces refuse'; end if;

  v_can_write_identity := public.can_write_identity(p_base_id);

  -- Sans droit d'ecriture sur l'identite, AUCUN champ nominatif ne peut etre soumis :
  -- refus explicite plutot qu'ignorance silencieuse (une donnee tue ne doit pas laisser
  -- croire a l'appelant qu'elle a ete enregistree).
  if not v_can_write_identity then
    if coalesce(btrim(p_full_name), '') <> ''
       or p_date_of_birth is not null
       or coalesce(btrim(p_phone), '') <> ''
       or coalesce(btrim(p_address), '') <> ''
       or coalesce(btrim(p_external_identifier), '') <> '' then
      raise exception 'Acces identite requis pour renseigner l''identite nominative';
    end if;
  end if;

  select current_template_version_id into v_tv from public.base where id = p_base_id;
  if v_tv is null then raise exception 'La base n''a pas de version de gabarit courante'; end if;

  perform public.assert_data_valid(v_tv, 'patient', coalesce(p_permanent_data, '{}'::jsonb));

  insert into public.patient_identity
    (base_id, patient_code, full_name, date_of_birth, phone, address, external_identifier, created_by)
  values (
    p_base_id, btrim(p_patient_code),
    case when v_can_write_identity then p_full_name end,
    case when v_can_write_identity then p_date_of_birth end,
    case when v_can_write_identity then p_phone end,
    case when v_can_write_identity then p_address end,
    case when v_can_write_identity then p_external_identifier end,
    auth.uid()
  );

  insert into public.patient
    (base_id, patient_code, template_version_id, data, collection_mode, validation_status, created_by)
  values
    (p_base_id, btrim(p_patient_code), v_tv, coalesce(p_permanent_data, '{}'::jsonb), 'direct', 'draft', auth.uid())
  returning * into v_patient;

  return v_patient;
end $$;

create or replace function public.create_encounter(
  p_patient_id        uuid,
  p_encounter_type    text,
  p_encounter_date    date,
  p_validation_status text,
  p_data              jsonb,
  p_age_unit          text default 'years'
) returns public.encounter
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_base uuid; v_code text; v_tv uuid; v_dob date; v_age numeric; v_unit text; v_enc public.encounter;
  v_status text;
begin
  select base_id, patient_code into v_base, v_code
  from public.patient where id = p_patient_id and deleted_at is null;
  if v_base is null then raise exception 'Patient introuvable'; end if;
  if not public.can_create_structured_data(v_base) then raise exception 'Acces refuse'; end if;

  v_status := coalesce(p_validation_status, 'draft');
  -- Promouvoir directement en 'curated' est un acte de curation, pas de saisie :
  -- reserve a can_edit_structured_data (le medecin).
  if v_status = 'curated' and not public.can_edit_structured_data(v_base) then
    raise exception 'Acces refuse';
  end if;

  select current_template_version_id into v_tv from public.base where id = v_base;

  -- Re-validation SERVEUR (§5.4/§5.5) : memes bornes/listes/type que le moteur React.
  perform public.assert_data_valid(v_tv, 'encounter', coalesce(p_data, '{}'::jsonb) - 'age_at_encounter');
  if v_status = 'curated' then
    perform public.assert_required_complete(v_tv, 'encounter', coalesce(p_data, '{}'::jsonb) - 'age_at_encounter', p_encounter_type);
  end if;

  v_unit := coalesce(p_age_unit, 'years');
  select date_of_birth into v_dob
  from public.patient_identity where base_id = v_base and patient_code = v_code and deleted_at is null;
  v_age := public.compute_age(v_dob, p_encounter_date, v_unit);

  insert into public.encounter
    (patient_id, template_version_id, encounter_type, encounter_date, age_value, age_unit,
     data, collection_mode, validation_status, created_by)
  values
    (p_patient_id, v_tv, p_encounter_type, p_encounter_date, v_age, case when v_age is not null then v_unit else null end,
     coalesce(p_data, '{}'::jsonb) - 'age_at_encounter', 'direct', v_status, auth.uid())
  returning * into v_enc;

  return v_enc;
end $$;

-- =============================================================================
-- 8. RPC de correction : le compte de mission corrige SON PROPRE BROUILLON
--    Une faute de frappe doit rester reparable par son auteur tant que la donnee
--    n'est pas soumise. Des qu'elle passe en 'complete', elle devient immuable pour
--    lui : la correction repasse par le medecin (motif + field_change_log).
-- =============================================================================

create or replace function public.update_encounter(
  p_encounter_id      uuid,
  p_data              jsonb,
  p_validation_status text,
  p_reason            text,
  p_expected_updated_at timestamptz default null
) returns public.encounter
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_enc public.encounter; v_base uuid; v_code text; v_dob date; v_age numeric;
  v_old jsonb; v_new jsonb; v_key text;
begin
  select * into v_enc from public.encounter where id = p_encounter_id and deleted_at is null;
  if not found then raise exception 'Rencontre introuvable'; end if;

  select base_id, patient_code into v_base, v_code from public.patient where id = v_enc.patient_id;

  if not public.can_edit_structured_data(v_base) then
    -- Voie « saisisseur » : son propre brouillon, vers brouillon ou soumission.
    if not (
      public.can_create_structured_data(v_base)
      and v_enc.created_by = auth.uid()
      and v_enc.validation_status = 'draft'
      and coalesce(p_validation_status, v_enc.validation_status) in ('draft','complete')
    ) then
      raise exception 'Acces refuse';
    end if;
  end if;

  -- §13 : verrou optimiste (voir 20260616092200).
  if p_expected_updated_at is not null
     and date_trunc('milliseconds', v_enc.updated_at) is distinct from date_trunc('milliseconds', p_expected_updated_at) then
    raise exception 'CONFLIT_VERSION : la rencontre a ete modifiee entre-temps' using errcode = 'P0001';
  end if;

  perform public.assert_data_valid(v_enc.template_version_id, 'encounter', coalesce(p_data, '{}'::jsonb) - 'age_at_encounter');

  select date_of_birth into v_dob
  from public.patient_identity where base_id = v_base and patient_code = v_code and deleted_at is null;
  v_age := public.compute_age(v_dob, v_enc.encounter_date, coalesce(v_enc.age_unit, 'years'));

  v_old := v_enc.data;
  v_new := coalesce(p_data, '{}'::jsonb) - 'age_at_encounter';

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
        (v_base, 'encounter', p_encounter_id, v_key, v_old -> v_key, v_new -> v_key, auth.uid(), p_reason, 'manual_correction');
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

create or replace function public.update_patient(
  p_patient_id uuid,
  p_data jsonb,
  p_validation_status text,
  p_reason text,
  p_expected_version bigint
) returns public.patient
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_pat public.patient; v_old jsonb; v_new jsonb; v_key text;
begin
  select * into v_pat from public.patient
   where id = p_patient_id and deleted_at is null for update;
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
    raise exception 'CONFLIT_VERSION : version patient requise' using errcode = 'P0001';
  end if;
  if v_pat.row_version is distinct from p_expected_version then
    raise exception 'CONFLIT_VERSION : le patient a ete modifie entre-temps' using errcode = 'P0001';
  end if;

  perform public.assert_data_valid(v_pat.template_version_id, 'patient', coalesce(p_data, '{}'::jsonb));
  v_old := v_pat.data;
  v_new := coalesce(p_data, '{}'::jsonb);
  for v_key in
    select key from (select jsonb_object_keys(v_old) as key union select jsonb_object_keys(v_new) as key) keys
  loop
    if (v_old -> v_key) is distinct from (v_new -> v_key) then
      insert into public.field_change_log (base_id, entity, entity_id, field_key, old_value, new_value, changed_by, reason, source)
      values (v_pat.base_id, 'patient', p_patient_id, v_key, v_old -> v_key, v_new -> v_key, auth.uid(), p_reason, 'manual_correction');
    end if;
  end loop;
  update public.patient set data = v_new,
    validation_status = coalesce(p_validation_status, v_pat.validation_status), updated_at = now()
    where id = p_patient_id returning * into v_pat;
  return v_pat;
end $$;

-- =============================================================================
-- 9. Cycle de vie d'une mission
-- =============================================================================

-- Provisionnement / rejeu. Appelee par l'Edge Function AVEC LE JETON DU MEDECIN (jamais
-- sous service_role) : l'autorisation et l'audit reposent donc sur auth.uid(), comme
-- pour toutes les autres RPC du produit. Idempotente : rejouer la meme demande met la
-- ligne a jour (nouvelle echeance, revocation levee) au lieu d'echouer.
create or replace function public.provision_mission_access(
  p_base_id                uuid,
  p_user_id                uuid,
  p_expires_at             timestamptz,
  p_can_view_identity      boolean default false,
  p_identity_justification text default null
) returns public.base_access
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_role   text;
  v_result public.base_access;
begin
  if auth.uid() is null then raise exception 'Authentification requise'; end if;
  if not public.is_medecin() then raise exception 'Gestion des acces reservee aux medecins'; end if;
  if not (public.is_base_owner(p_base_id) or public.can_manage_access(p_base_id)) then
    raise exception 'Gestion des acces requise';
  end if;

  select p.global_role into v_role from public.profiles p where p.id = p_user_id;
  if v_role is distinct from 'saisisseur' then
    raise exception 'Compte de mission attendu';
  end if;

  if p_expires_at is null or p_expires_at <= now() then
    raise exception 'Echeance de mission invalide';
  end if;
  if p_expires_at > now() + interval '24 months' then
    raise exception 'La duree d''une mission ne peut depasser 24 mois';
  end if;
  if coalesce(p_can_view_identity, false) and coalesce(btrim(p_identity_justification), '') = '' then
    raise exception 'Justification requise pour ouvrir l''identite a un compte de mission';
  end if;

  insert into public.base_access (
    base_id, user_id, access_role,
    can_view_identity, can_view_raw_documents, can_edit_structured_data,
    can_export_data, can_manage_access, can_create_structured_data,
    expires_at, identity_justification, granted_by
  )
  values (
    p_base_id, p_user_id, 'editor',
    coalesce(p_can_view_identity, false), false, false,
    false, false, true,
    p_expires_at, nullif(btrim(coalesce(p_identity_justification, '')), ''), auth.uid()
  )
  on conflict (base_id, user_id) do update set
    access_role                = 'editor',
    can_view_identity          = excluded.can_view_identity,
    can_view_raw_documents     = false,
    can_edit_structured_data   = false,
    can_export_data            = false,
    can_manage_access          = false,
    can_create_structured_data = true,
    expires_at                 = excluded.expires_at,
    identity_justification     = excluded.identity_justification,
    granted_by                 = excluded.granted_by,
    revoked_at                 = null
  returning * into v_result;

  perform public.log_audit(
    'mission_granted', 'base_access', v_result.id, p_base_id,
    jsonb_build_object(
      'user_id', p_user_id,
      'expires_at', p_expires_at,
      'can_view_identity', coalesce(p_can_view_identity, false)
    )
  );

  return v_result;
end $$;

-- Prolongation : une these deborde souvent. Repousse l'echeance sans toucher au reste.
create or replace function public.extend_mission_access(
  p_access_id  uuid,
  p_expires_at timestamptz
) returns public.base_access
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  acc      public.base_access;
  v_role   text;
  v_result public.base_access;
begin
  if auth.uid() is null then raise exception 'Authentification requise'; end if;

  select * into acc from public.base_access where id = p_access_id for update;
  if not found then raise exception 'Acces introuvable'; end if;

  if not public.is_medecin() then raise exception 'Gestion des acces reservee aux medecins'; end if;
  if not (public.is_base_owner(acc.base_id) or public.can_manage_access(acc.base_id)) then
    raise exception 'Gestion des acces requise';
  end if;

  select p.global_role into v_role from public.profiles p where p.id = acc.user_id;
  if v_role is distinct from 'saisisseur' then
    raise exception 'Compte de mission attendu';
  end if;

  if p_expires_at is null or p_expires_at <= now() then
    raise exception 'Echeance de mission invalide';
  end if;
  if p_expires_at > now() + interval '24 months' then
    raise exception 'La duree d''une mission ne peut depasser 24 mois';
  end if;

  -- Prolonger ne ressuscite pas un acces revoque : la reactivation passe par le
  -- provisionnement (meme chemin que la creation, meme audit).
  if acc.revoked_at is not null then
    raise exception 'Acces revoque : reactivation requise';
  end if;

  update public.base_access set expires_at = p_expires_at
   where id = p_access_id
  returning * into v_result;

  perform public.log_audit(
    'mission_extended', 'base_access', p_access_id, acc.base_id,
    jsonb_build_object('user_id', acc.user_id, 'from', acc.expires_at, 'to', p_expires_at)
  );

  return v_result;
end $$;

-- Inventaire des comptes de mission d'une base, pour l'ecran du medecin. L'e-mail de
-- l'etudiant vit dans auth.users, hors de portee du client : cette lecture ciblee est
-- reservee au proprietaire / gestionnaire de la base.
create or replace function public.mission_accounts(p_base_id uuid)
returns table (
  access_id              uuid,
  user_id                uuid,
  email                  text,
  full_name              text,
  expires_at             timestamptz,
  revoked_at             timestamptz,
  created_at             timestamptz,
  can_view_identity      boolean,
  identity_justification text,
  activated              boolean
)
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then raise exception 'Authentification requise'; end if;
  if not public.is_medecin() then raise exception 'Gestion des acces reservee aux medecins'; end if;
  if not (public.is_base_owner(p_base_id) or public.can_manage_access(p_base_id)) then
    raise exception 'Gestion des acces requise';
  end if;

  return query
    select a.id, a.user_id, u.email::text, p.full_name,
           a.expires_at, a.revoked_at, a.created_at,
           a.can_view_identity, a.identity_justification,
           (u.email_confirmed_at is not null) as activated
    from public.base_access a
    join public.profiles p on p.id = a.user_id
    join auth.users u on u.id = a.user_id
    where a.base_id = p_base_id
      and p.global_role = 'saisisseur'
    order by a.created_at desc;
end $$;

-- Etat d'une adresse pour l'Edge Function d'invitation (idempotence : reprendre un
-- provisionnement interrompu sans jamais retrograder un compte existant). Reservee au
-- service_role : exposer l'existence d'un compte a un client permettrait d'enumerer
-- les adresses inscrites.
create or replace function public.mission_account_lookup(p_email text)
returns table (user_id uuid, global_role text, activated boolean)
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  return query
    select u.id, p.global_role, (u.email_confirmed_at is not null)
    from auth.users u
    left join public.profiles p on p.id = u.id
    where lower(u.email) = lower(btrim(coalesce(p_email, '')))
      and btrim(coalesce(p_email, '')) <> '';
end $$;

-- =============================================================================
-- 10. Privileges d'execution
--     Toute fonction DEFINER executable par `authenticated` doit figurer dans
--     supabase/security-definer-allowlist.json (controle db:function-acl:verify).
-- =============================================================================

revoke all on function public.is_saisisseur() from public, anon;
grant execute on function public.is_saisisseur() to authenticated;

revoke all on function public.can_create_structured_data(uuid) from public, anon;
grant execute on function public.can_create_structured_data(uuid) to authenticated;

revoke all on function public.provision_mission_access(uuid, uuid, timestamptz, boolean, text) from public, anon;
grant execute on function public.provision_mission_access(uuid, uuid, timestamptz, boolean, text) to authenticated;

revoke all on function public.extend_mission_access(uuid, timestamptz) from public, anon;
grant execute on function public.extend_mission_access(uuid, timestamptz) to authenticated;

revoke all on function public.mission_accounts(uuid) from public, anon;
grant execute on function public.mission_accounts(uuid) to authenticated;

-- Jamais exposee au client : ni anon, ni authenticated (donc absente de l'allowlist).
revoke all on function public.mission_account_lookup(text) from public, anon, authenticated;
grant execute on function public.mission_account_lookup(text) to service_role;
