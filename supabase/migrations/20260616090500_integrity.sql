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
