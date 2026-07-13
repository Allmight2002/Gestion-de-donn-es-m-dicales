-- Cohort snapshots must never reference analytical rows from another base.
-- The invariant is enforced on every direct INSERT/UPDATE, independently of RLS.

create or replace function public.guard_cohort_patient_membership()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_cohort_base uuid;
  v_patient_base uuid;
begin
  select base_id into v_cohort_base from public.cohort where id = new.cohort_id;
  select base_id into v_patient_base from public.patient where id = new.patient_id and deleted_at is null;
  if v_cohort_base is null or v_patient_base is null or v_patient_base is distinct from v_cohort_base then
    raise exception 'COHORT_SCOPE_MISMATCH: patient hors de la base de la cohorte' using errcode = '23514';
  end if;
  return new;
end $$;
revoke all on function public.guard_cohort_patient_membership() from public, anon, authenticated;

create or replace function public.guard_cohort_encounter_membership()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_cohort_base uuid;
  v_patient_base uuid;
begin
  select base_id into v_cohort_base from public.cohort where id = new.cohort_id;
  select p.base_id into v_patient_base
    from public.encounter e
    join public.patient p on p.id = e.patient_id
   where e.id = new.encounter_id and e.deleted_at is null and p.deleted_at is null;
  if v_cohort_base is null or v_patient_base is null or v_patient_base is distinct from v_cohort_base then
    raise exception 'COHORT_SCOPE_MISMATCH: rencontre hors de la base de la cohorte' using errcode = '23514';
  end if;
  return new;
end $$;
revoke all on function public.guard_cohort_encounter_membership() from public, anon, authenticated;

drop trigger if exists trg_cohort_patient_membership_scope on public.cohort_member;
create constraint trigger trg_cohort_patient_membership_scope
  after insert or update on public.cohort_member
  deferrable initially immediate
  for each row execute function public.guard_cohort_patient_membership();

drop trigger if exists trg_cohort_encounter_membership_scope on public.cohort_encounter_member;
create constraint trigger trg_cohort_encounter_membership_scope
  after insert or update on public.cohort_encounter_member
  deferrable initially immediate
  for each row execute function public.guard_cohort_encounter_membership();

create or replace function public.guard_cohort_base_immutable()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.base_id is distinct from old.base_id then
    raise exception 'COHORT_SCOPE_MISMATCH: la base d une cohorte est immuable' using errcode = '23514';
  end if;
  return new;
end $$;
revoke all on function public.guard_cohort_base_immutable() from public, anon, authenticated;
drop trigger if exists trg_cohort_base_immutable on public.cohort;
create trigger trg_cohort_base_immutable
  before update of base_id on public.cohort
  for each row execute function public.guard_cohort_base_immutable();

-- Do not hide pre-existing corruption during rollout. The Edge Function also
-- performs the same exhaustive checks so a rollout ordered Edge-first fails closed.
do $$
begin
  if exists (
    select 1
      from public.cohort_member cm
      join public.cohort c on c.id = cm.cohort_id
      join public.patient p on p.id = cm.patient_id
     where p.base_id is distinct from c.base_id
  ) or exists (
    select 1
      from public.cohort_encounter_member cem
      join public.cohort c on c.id = cem.cohort_id
      join public.encounter e on e.id = cem.encounter_id
      join public.patient p on p.id = e.patient_id
     where p.base_id is distinct from c.base_id
  ) then
    raise exception 'COHORT_SCOPE_MISMATCH: donnees historiques incoherentes a corriger avant migration';
  end if;
end $$;
