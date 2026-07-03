-- =============================================================================
-- seed.sql  (v3.0) — Donnees de demonstration ENTIEREMENT FICTIVES (§17).
-- AUCUNE DONNEE REELLE. Mot de passe commun : Password123!
--
-- Comptes :
--   admin@demo.test       system_admin (administration)
--   templates@demo.test   system_admin (gestionnaire de gabarits)
--   alice@demo.test        member — proprietaire de la base
--   bob@demo.test          member — 2e medecin (sans acces a la base d'Alice)
--   editor@demo.test       member — collaborateur editeur (identite + documents)
--   curator1@demo.test     member — curateur
--   curator2@demo.test     member — curateur
--   validator@demo.test    member — curateur (le role `validateur` est supprime ; ce compte
--                          devient un 2e curateur)
--   anna.analyst@demo.test medecin — collaboratrice avec partage EXPORT seul (analytique +
--                          export, jamais l'identite) — le role GLOBAL 'analyste' est supprime.
--
-- NB cloud : creer les comptes via l'Admin API en production (cf. README).
-- Les donnees du sous-systeme curation (depots, taches, brouillons) sont ajoutees
-- a l'etape "donnees de demo" du sous-systeme curation.
-- =============================================================================

insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
                        email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
('00000000-0000-0000-0000-000000000000','11111111-1111-1111-1111-111111111111','authenticated','authenticated','admin@demo.test', crypt('Password123!', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}','{"full_name":"Admin Systeme","language":"fr"}', now(), now()),
('00000000-0000-0000-0000-000000000000','1f111111-1111-1111-1111-111111111111','authenticated','authenticated','templates@demo.test', crypt('Password123!', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}','{"full_name":"Gestionnaire Gabarits","language":"fr"}', now(), now()),
('00000000-0000-0000-0000-000000000000','22222222-2222-2222-2222-222222222222','authenticated','authenticated','alice@demo.test', crypt('Password123!', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}','{"full_name":"Dr Alice Martin","language":"fr"}', now(), now()),
('00000000-0000-0000-0000-000000000000','33333333-3333-3333-3333-333333333333','authenticated','authenticated','bob@demo.test', crypt('Password123!', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}','{"full_name":"Dr Bob Durand","language":"fr"}', now(), now()),
('00000000-0000-0000-0000-000000000000','55555555-5555-5555-5555-555555555555','authenticated','authenticated','editor@demo.test', crypt('Password123!', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}','{"full_name":"Edith Editrice","language":"fr"}', now(), now()),
('00000000-0000-0000-0000-000000000000','66666666-6666-6666-6666-666666666666','authenticated','authenticated','curator1@demo.test', crypt('Password123!', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}','{"full_name":"Carl Curateur","language":"fr"}', now(), now()),
('00000000-0000-0000-0000-000000000000','77777777-7777-7777-7777-777777777777','authenticated','authenticated','curator2@demo.test', crypt('Password123!', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}','{"full_name":"Carla Curatrice","language":"fr"}', now(), now()),
('00000000-0000-0000-0000-000000000000','88888888-8888-8888-8888-888888888888','authenticated','authenticated','validator@demo.test', crypt('Password123!', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}','{"full_name":"Valentin Validateur","language":"fr"}', now(), now()),
('00000000-0000-0000-0000-000000000000','44444444-4444-4444-4444-444444444444','authenticated','authenticated','anna.analyst@demo.test', crypt('Password123!', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}','{"full_name":"Anna Analyste","language":"fr"}', now(), now());

update public.profiles set global_role = 'system_admin' where id in
  ('11111111-1111-1111-1111-111111111111','1f111111-1111-1111-1111-111111111111');
-- Roles globaux (auto = medecin ; le staff est attribue par l'admin systeme).
-- alice / bob / editor = medecin (editor partage la base d'Alice, medecin-a-medecin).
update public.profiles set global_role = 'curateur'   where id in ('66666666-6666-6666-6666-666666666666','77777777-7777-7777-7777-777777777777');
update public.profiles set global_role = 'curateur'   where id = '88888888-8888-8888-8888-888888888888';
update public.profiles set global_role = 'medecin'    where id = '44444444-4444-4444-4444-444444444444';

-- Identites email (requises par l'Auth Supabase/GoTrue pour la connexion mot de passe).
-- Bloc CONDITIONNEL : la table auth.identities n'existe que sur un vrai Supabase ; dans
-- le PostgreSQL embarque des tests (shim minimal), ce bloc est ignore -> tests intacts.
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'auth' and table_name = 'identities') then
    insert into auth.identities (id, user_id, provider_id, identity_data, provider, created_at, updated_at, last_sign_in_at)
    select gen_random_uuid(), u.id, u.id::text,
           jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
           'email', now(), now(), now()
    from auth.users u
    where u.email like '%@demo.test'
      and not exists (select 1 from auth.identities i where i.user_id = u.id and i.provider = 'email');

    -- GoTrue lit ces colonnes de jeton comme des chaines NON nulles : un seed SQL doit
    -- les mettre a '' (sinon "Database error querying schema" au login).
    update auth.users set
      confirmation_token         = coalesce(confirmation_token, ''),
      recovery_token             = coalesce(recovery_token, ''),
      email_change               = coalesce(email_change, ''),
      email_change_token_new     = coalesce(email_change_token_new, ''),
      email_change_token_current = coalesce(email_change_token_current, ''),
      phone_change               = coalesce(phone_change, ''),
      phone_change_token         = coalesce(phone_change_token, ''),
      reauthentication_token     = coalesce(reauthentication_token, '')
    where email like '%@demo.test';
  end if;
end $$;

-- Gabarit "Neurochirurgie" : gabarit PERSONNEL d'Alice (proprietaire, editable librement).
insert into public.template (id, name, specialty, owner_user_id, is_global) values
  ('10000000-0000-0000-0000-000000000001', 'Neurochirurgie', 'neurochirurgie', '22222222-2222-2222-2222-222222222222', false);
insert into public.template_version (id, template_id, version_number, status, created_by) values
  ('10000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-000000000001', 1, 'draft', '22222222-2222-2222-2222-222222222222');

insert into public.template_field
  (template_version_id, field_key, label, scope, section, type, unit, allowed_values, required, min_value, max_value, allow_missing_codes, display_order)
values
('10000000-0000-0000-0000-0000000000a1','sexe','Sexe','patient','clinique','select',null,'["M","F"]'::jsonb,true,null,null,false,1),
('10000000-0000-0000-0000-0000000000a1','birth_year','Annee de naissance','patient','clinique','integer',null,null,true,1900,2025,false,2),
('10000000-0000-0000-0000-0000000000a1','blood_group','Groupe sanguin','patient','biologie','select',null,'["A+","A-","B+","B-","AB+","AB-","O+","O-"]'::jsonb,false,null,null,true,3),
('10000000-0000-0000-0000-0000000000a1','admission_date','Date d''admission','encounter','clinique','date',null,null,true,null,null,false,4),
('10000000-0000-0000-0000-0000000000a1','diagnosis','Diagnostic','encounter','clinique','text',null,null,true,null,null,true,5),
('10000000-0000-0000-0000-0000000000a1','glasgow_score','Score de Glasgow','encounter','clinique','integer',null,null,true,3,15,false,6),
('10000000-0000-0000-0000-0000000000a1','ct_result','Resultat TDM','encounter','paraclinique','text',null,null,false,null,null,true,7),
('10000000-0000-0000-0000-0000000000a1','discharge_date','Date de sortie','encounter','clinique','date',null,null,false,null,null,true,8),
('10000000-0000-0000-0000-0000000000a1','outcome','Evolution','encounter','clinique','select',null,'["gueri","sequelles","deces"]'::jsonb,false,null,null,true,9),
('10000000-0000-0000-0000-0000000000a1','death_date','Date de deces','encounter','clinique','date',null,null,false,null,null,true,10),
('10000000-0000-0000-0000-0000000000a1','hemoglobin','Hemoglobine','encounter','biologie','number','g/dL',null,false,0,25,true,11);

insert into public.validation_rule (template_version_id, rule, message, severity) values
('10000000-0000-0000-0000-0000000000a1','{"operator":"greater_or_equal","left_field":"discharge_date","right_field":"admission_date"}'::jsonb,'La date de sortie doit etre >= la date d''admission','block'),
('10000000-0000-0000-0000-0000000000a1','{"if":{"field":"outcome","operator":"equals","value":"deces"},"then":{"field":"death_date","operator":"required"}}'::jsonb,'Si evolution = deces, la date de deces est requise','block');

-- Dates d'admission / sortie : pertinentes UNIQUEMENT pour une hospitalisation (une
-- consultation ou un suivi n'a qu'une date simple = encounter_date). admission_date cesse
-- donc d'etre requis pour un suivi/consultation.
update public.template_field set encounter_types = '{hospitalisation}'
 where template_version_id = '10000000-0000-0000-0000-0000000000a1'
   and field_key in ('admission_date','discharge_date');

-- a1 reste 'draft' : le gabarit de la base d'Alice est editable librement (v3.0).

-- Modele GLOBAL "officiel" (catalogue) propose aux autres medecins : copie de a1.
insert into public.template (id, name, specialty, owner_user_id, is_global) values
  ('10000000-0000-0000-0000-000000000002', 'Neurochirurgie (modele standard)', 'neurochirurgie', null, true);
insert into public.template_version (id, template_id, version_number, status, created_by, published_at) values
  ('10000000-0000-0000-0000-0000000000a2', '10000000-0000-0000-0000-000000000002', 1, 'published', '1f111111-1111-1111-1111-111111111111', now());
insert into public.template_field
  (template_version_id, field_key, label, scope, section, type, unit, allowed_values, required, min_value, max_value, allow_missing_codes, display_order, encounter_types)
select '10000000-0000-0000-0000-0000000000a2', field_key, label, scope, section, type, unit, allowed_values, required, min_value, max_value, allow_missing_codes, display_order, encounter_types
from public.template_field where template_version_id = '10000000-0000-0000-0000-0000000000a1';
insert into public.validation_rule (template_version_id, rule, message, severity)
select '10000000-0000-0000-0000-0000000000a2', rule, message, severity
from public.validation_rule where template_version_id = '10000000-0000-0000-0000-0000000000a1';

-- Base d'Alice + acces granulaires (6 permissions) -------------------------------
insert into public.base (id, name, specialty, owner_user_id, current_template_version_id) values
  ('20000000-0000-0000-0000-000000000001', 'Registre Neurochirurgie - Dr Alice', 'neurochirurgie', '22222222-2222-2222-2222-222222222222', '10000000-0000-0000-0000-0000000000a1');

-- Partage de base ENTRE MEDECINS (v3.0 §7) : viewer / editor (+ permissions granulaires).
-- anna = collaboratrice 'viewer' avec EXPORT seul, jamais l'identite (le role de partage
-- 'analyst' est supprime ; la capacite reste portee par les PERMISSIONS). Les curateurs
-- travaillent le POOL GLOBAL via leur role global, ils ne sont pas invites ici.
insert into public.base_access (base_id, user_id, access_role, can_view_identity, can_view_raw_documents, can_edit_structured_data, can_export_data, can_manage_access, granted_by) values
  ('20000000-0000-0000-0000-000000000001','44444444-4444-4444-4444-444444444444','viewer',  false,false,false,true, false,'22222222-2222-2222-2222-222222222222'),
  ('20000000-0000-0000-0000-000000000001','55555555-5555-5555-5555-555555555555','editor',  true, false,true, false,false,'22222222-2222-2222-2222-222222222222');

-- 10 patients fictifs (saisie directe, verifies) ---------------------------------
do $$
declare
  v_base uuid := '20000000-0000-0000-0000-000000000001';
  v_tv   uuid := '10000000-0000-0000-0000-0000000000a1';
  v_owner uuid := '22222222-2222-2222-2222-222222222222';
  i int; v_pid uuid; v_code text; v_dob date; v_sex text; v_bg text; v_year int;
  v_adm date; v_gcs int; v_out text; v_hb numeric; v_age numeric;
  blood text[] := array['A+','O+','B+','AB+','O-'];
  sexes text[] := array['M','F'];
  diag  text[] := array['TC grave','Hematome sous-dural','Hematome extra-dural','AVC hemorragique','Tumeur cerebrale'];
  ct    text[] := array['normal','hematome','oedeme','engagement'];
begin
  for i in 1..10 loop
    v_code := 'NCH-' || lpad(i::text, 3, '0');
    v_dob  := date '1955-01-01' + ((i * 1234) % 16000);
    v_sex  := sexes[1 + (i % 2)];
    v_bg   := blood[1 + (i % 5)];
    v_year := extract(year from v_dob)::int;

    insert into public.patient_identity
      (base_id, patient_code, full_name, date_of_birth, phone, external_identifier, created_by)
    values
      (v_base, v_code, 'Patient Fictif ' || i, v_dob, '06000000' || lpad(i::text,2,'0'), 'HOSP-' || i, v_owner);

    insert into public.patient (base_id, patient_code, template_version_id, data, collection_mode, validation_status, created_by)
    values (v_base, v_code, v_tv,
            jsonb_build_object('sexe', v_sex, 'birth_year', v_year, 'blood_group', v_bg),
            'direct', 'curated', v_owner)
    returning id into v_pid;

    v_adm := date '2024-01-05' + ((i * 17) % 300);
    v_gcs := 3 + ((i * 3) % 13);
    v_out := (array['gueri','sequelles','deces','gueri'])[1 + (i % 4)];
    v_hb  := (9 + (i % 6))::numeric; -- hemoglobine numerique ; le cas "inconnu" devient un code manquant ci-dessous
    v_age := public.compute_age(v_dob, v_adm, 'years');

    insert into public.encounter
      (patient_id, template_version_id, encounter_type, encounter_date, age_value, age_unit, data, collection_mode, validation_status, created_by)
    values
      (v_pid, v_tv, 'hospitalisation', v_adm, v_age, 'years',
       jsonb_build_object(
         'admission_date', to_char(v_adm, 'YYYY-MM-DD'),
         'diagnosis', diag[1 + (i % 5)],
         'glasgow_score', v_gcs,
         'ct_result', ct[1 + (i % 4)],
         'discharge_date', to_char(v_adm + (5 + (i % 20)), 'YYYY-MM-DD'),
         'outcome', v_out,
         'death_date', case when v_out = 'deces' then to_char(v_adm + (2 + (i % 5)), 'YYYY-MM-DD') else null end,
         'hemoglobin', case when i % 4 = 0 then jsonb_build_object('__missing__', 'inconnu') else to_jsonb(v_hb) end
       ), 'direct', 'curated', v_owner);

    if i % 3 = 0 or i % 4 = 0 then
      insert into public.encounter
        (patient_id, template_version_id, encounter_type, encounter_date, age_value, age_unit, data, collection_mode, validation_status, created_by)
      values
        (v_pid, v_tv, 'suivi', v_adm + 90, public.compute_age(v_dob, v_adm + 90, 'years'), 'years',
         jsonb_build_object('diagnosis', 'controle post-operatoire', 'glasgow_score', least(15, v_gcs + 3), 'outcome', 'gueri', 'hemoglobin', jsonb_build_object('__missing__', 'non_fait')),
         'direct', 'curated', v_owner);
    end if;
  end loop;
end $$;

-- 1 piece jointe clinique (zone restreinte) sur NCH-001 --------------------------
insert into public.clinical_attachment (patient_id, kind, label, storage_path, mime_type, deidentification_confirmed, created_by)
select p.id, 'imagerie', 'TDM cerebrale (fictif)', '20000000-0000-0000-0000-000000000001/' || p.id || '/ct.jpg', 'image/jpeg', true, '22222222-2222-2222-2222-222222222222'
from public.patient p
where p.base_id = '20000000-0000-0000-0000-000000000001' and p.patient_code = 'NCH-001';

-- 1 cohorte FIGEE d'exemple : TC graves (GCS<=8), validees ------------------------
insert into public.cohort (id, base_id, name, filter_definition, cohort_type, snapshot_at, validated_only, created_by) values
  ('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'TC graves (GCS<=8) - figee',
   '{"conditions":[{"scope":"encounter","field":"glasgow_score","op":"lte","value":8}]}'::jsonb, 'snapshot', now(), true,
   '22222222-2222-2222-2222-222222222222');

insert into public.cohort_member (cohort_id, patient_id)
select distinct '30000000-0000-0000-0000-000000000001'::uuid, p.id
from public.patient p join public.encounter e on e.patient_id = p.id
where p.base_id = '20000000-0000-0000-0000-000000000001' and (e.data ->> 'glasgow_score')::int <= 8;

insert into public.cohort_encounter_member (cohort_id, encounter_id)
select '30000000-0000-0000-0000-000000000001'::uuid, e.id
from public.encounter e join public.patient p on p.id = e.patient_id
where p.base_id = '20000000-0000-0000-0000-000000000001' and (e.data ->> 'glasgow_score')::int <= 8;

-- Demonstration CURATION (POOL GLOBAL) : un cas OUVERT (code opaque) depose par Alice
-- pour NCH-002, avec un document deidentifie. Pret a etre RESERVE par un curateur.
do $$
declare
  v_base uuid := '20000000-0000-0000-0000-000000000001';
  v_pat  uuid;
  v_sub  uuid;
begin
  select id into v_pat from public.patient where base_id = v_base and patient_code = 'NCH-002';

  insert into public.raw_submission (base_id, target_patient_id, template_version_id, case_code, external_ref, status, submitted_by)
  values (v_base, v_pat, '10000000-0000-0000-0000-0000000000a1', 'CASE-DEMO01', 'DOSSIER-2024-002', 'in_curation', '22222222-2222-2222-2222-222222222222')
  returning id into v_sub;

  insert into public.raw_document (submission_id, base_id, label, storage_path, mime_type, created_by)
  values (v_sub, v_base, 'Compte-rendu (deidentifie, fictif)', v_base || '/' || v_sub || '/cr.pdf', 'application/pdf', '22222222-2222-2222-2222-222222222222');

  -- Tache OUVERTE dans le pool (aucun curateur affecte) -> a reserver.
  insert into public.curation_task (base_id, submission_id, status, created_by)
  values (v_base, v_sub, 'open', '22222222-2222-2222-2222-222222222222');
end $$;

-- Cas en PREPARATION (cote medecin) : cree pour NCH-003 mais AUCUN document encore depose
-- -> statut 'preparing', INVISIBLE du pool, en attente que le medecin le soumette ("Suivi
-- des demandes" affiche « A completer — documents requis »).
do $$
declare
  v_base uuid := '20000000-0000-0000-0000-000000000001';
  v_pat  uuid;
  v_sub  uuid;
begin
  select id into v_pat from public.patient where base_id = v_base and patient_code = 'NCH-003';

  insert into public.raw_submission (base_id, target_patient_id, template_version_id, case_code, external_ref, status, submitted_by)
  values (v_base, v_pat, '10000000-0000-0000-0000-0000000000a1', 'CASE-DEMO02', 'DOSSIER-2024-003', 'received', '22222222-2222-2222-2222-222222222222')
  returning id into v_sub;

  insert into public.curation_task (base_id, submission_id, status, created_by)
  values (v_base, v_sub, 'preparing', '22222222-2222-2222-2222-222222222222');
end $$;
