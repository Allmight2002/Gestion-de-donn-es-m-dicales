-- =============================================================================
-- 20260616092300_guard_curated_downgrade.sql  (v3.0)
-- Audit §5.2 : une donnee `curated` pouvait etre RETROGRADEE par ecriture directe
-- (update ... set validation_status='draft', data='{...99}', age_value=999), echappant
-- a la validation (le trigger renforce ne s'applique pleinement que sur `curated`).
-- Deux defenses, sur TOUTES les voies d'ecriture :
--   1) interdiction de rabaisser une ligne `curated` (patient + encounter) ;
--   2) age_value TOUJOURS recalcule par le serveur a l'ecriture (non falsifiable).
-- Migration ADDITIVE (ne reecrit aucun ancien fichier).
-- =============================================================================

-- 1) Interdiction de retrograder une donnee finalisee. Aucun flux legitime ne rabaisse un
--    `curated` (les corrections le maintiennent ; la finalisation ne fait que draft->curated).
create or replace function public.guard_no_curated_downgrade()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if old.validation_status = 'curated' and new.validation_status is distinct from 'curated' then
    raise exception 'Retrogradation interdite : une donnee finalisee (curated) ne peut etre rabaissee';
  end if;
  return new;
end $$;

create trigger trg_patient_no_downgrade
  before update on public.patient
  for each row execute function public.guard_no_curated_downgrade();
create trigger trg_encounter_no_downgrade
  before update on public.encounter
  for each row execute function public.guard_no_curated_downgrade();

-- 2) age_value recalcule par le serveur a chaque mise a jour : une valeur fournie directement
--    (ex. age_value=999) est ECRASEE par l'age calcule depuis la date de naissance. SECURITY
--    DEFINER pour lire l'identite (DOB) meme sans acces identite (l'age reste, lui, analytique).
create or replace function public.recompute_encounter_age()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_base uuid; v_code text; v_dob date;
begin
  select p.base_id, p.patient_code into v_base, v_code from public.patient p where p.id = new.patient_id;
  select date_of_birth into v_dob
    from public.patient_identity where base_id = v_base and patient_code = v_code and deleted_at is null;
  new.age_value := public.compute_age(v_dob, new.encounter_date, coalesce(new.age_unit, 'years'));
  return new;
end $$;

create trigger trg_encounter_recompute_age
  before update on public.encounter
  for each row execute function public.recompute_encounter_age();
