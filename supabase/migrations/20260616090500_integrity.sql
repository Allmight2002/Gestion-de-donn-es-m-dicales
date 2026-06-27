-- =============================================================================
-- 20260616090500_integrity.sql  (v3.0)
-- Declencheurs d'integrite (invariants du modele).
-- =============================================================================

-- 1) Profil cree a l'inscription. global_role toujours 'member' (jamais via metadonnees
--    client) ; 'system_admin' octroye explicitement cote serveur.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  -- Auto-inscription : tout nouveau compte est MEDECIN. Les roles staff (curateur /
  -- validateur / analyste) sont attribues ensuite par l'admin systeme.
  insert into public.profiles (id, full_name, global_role, language)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    'medecin',
    coalesce(new.raw_user_meta_data ->> 'language', 'fr')
  )
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 2) Anti-escalade : nul ne change son propre global_role (sauf contexte serveur).
create or replace function public.guard_profile_role()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is not null
     and new.global_role is distinct from old.global_role
     and not public.is_system_admin() then
    raise exception 'Modification de global_role non autorisee';
  end if;
  return new;
end $$;

create trigger trg_guard_profile_role
  before update on public.profiles
  for each row execute function public.guard_profile_role();

-- 3) Gabarits EDITABLES librement (cahier v3.0) : plus d'immuabilite des versions
-- publiees. Le proprietaire (medecin ou admin pour les modeles globaux) peut ajouter /
-- modifier / supprimer champs et regles a tout moment. Risque de derive sur les donnees
-- deja saisies ASSUME (choix produit pour la demo) ; le cloisonnement reste porte par la
-- RLS de possession (owns_template). Horodatage de publication gere par l'audit.

-- 4) updated_at maintenu sur patient et encounter.
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger trg_patient_updated
  before update on public.patient
  for each row execute function public.set_updated_at();

create trigger trg_encounter_updated
  before update on public.encounter
  for each row execute function public.set_updated_at();

-- 5) Propriete d'une base IMMUABLE (§7.3) : owner_user_id ne change jamais (deja garanti
-- par la RLS base_update, mais rendu EXPLICITE et auditable ici, avec une erreur claire).
create or replace function public.guard_base_owner_immutable()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if new.owner_user_id is distinct from old.owner_user_id then
    raise exception 'Le proprietaire d''une base est immuable (owner_user_id)';
  end if;
  return new;
end $$;

create trigger trg_base_owner_immutable
  before update on public.base
  for each row execute function public.guard_base_owner_immutable();

-- 6) Integrite 'curated' (audit §5.1) : toute ligne PROMUE/maintenue en 'curated' doit etre
-- VALIDE (bornes/types/listes via assert_data_valid), sans champ inconnu (assert_no_unknown_fields)
-- et COMPLETE (champs requis, type-aware). Pour TOUTES les voies d'ecriture (RPC, correction,
-- appel API direct -> ferme le contournement `update encounter set data = data || '{...99}'`).
create or replace function public.assert_curated_complete()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if new.validation_status = 'curated' then
    if tg_table_name = 'patient' then
      perform public.assert_data_valid(new.template_version_id, 'patient', new.data);
      perform public.assert_no_unknown_fields(new.template_version_id, 'patient', new.data);
      perform public.assert_required_complete(new.template_version_id, 'patient', new.data);
    else
      perform public.assert_data_valid(new.template_version_id, 'encounter', new.data);
      perform public.assert_no_unknown_fields(new.template_version_id, 'encounter', new.data);
      perform public.assert_required_complete(new.template_version_id, 'encounter', new.data, new.encounter_type);
    end if;
  end if;
  return new;
end $$;

create trigger trg_patient_curated_complete
  before insert or update on public.patient
  for each row execute function public.assert_curated_complete();
create trigger trg_encounter_curated_complete
  before insert or update on public.encounter
  for each row execute function public.assert_curated_complete();

-- 7) Immuabilite des colonnes STRUCTURELLES (audit §5.3) : un UPDATE direct (hors RPC) ne doit
-- pas pouvoir reparenter une rencontre, desynchroniser le code patient identite/analytique, ni
-- falsifier l'origine. Les RPC ne modifient JAMAIS ces colonnes -> aucun flux legitime casse.
create or replace function public.guard_structural_immutable()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if tg_table_name = 'patient' then
    if new.base_id is distinct from old.base_id
       or new.patient_code is distinct from old.patient_code
       or new.template_version_id is distinct from old.template_version_id
       or new.created_by is distinct from old.created_by
       or new.created_at is distinct from old.created_at then
      raise exception 'Colonne structurelle immuable (patient : base_id / patient_code / template_version_id / created_by / created_at)';
    end if;
  elsif tg_table_name = 'encounter' then
    if new.patient_id is distinct from old.patient_id
       or new.template_version_id is distinct from old.template_version_id
       or new.created_by is distinct from old.created_by
       or new.created_at is distinct from old.created_at then
      raise exception 'Colonne structurelle immuable (encounter : patient_id / template_version_id / created_by / created_at)';
    end if;
  elsif tg_table_name = 'patient_identity' then
    if new.base_id is distinct from old.base_id
       or new.patient_code is distinct from old.patient_code
       or new.created_by is distinct from old.created_by
       or new.created_at is distinct from old.created_at then
      raise exception 'Colonne structurelle immuable (patient_identity : base_id / patient_code / created_by / created_at)';
    end if;
  end if;
  return new;
end $$;

create trigger trg_patient_structural_immutable
  before update on public.patient
  for each row execute function public.guard_structural_immutable();
create trigger trg_encounter_structural_immutable
  before update on public.encounter
  for each row execute function public.guard_structural_immutable();
create trigger trg_identity_structural_immutable
  before update on public.patient_identity
  for each row execute function public.guard_structural_immutable();
