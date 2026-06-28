-- =============================================================================
-- 20260616092600_curation_draft_scope.sql  (v3.0)
-- Audit §5.4 : une tache de portee `encounter` pouvait, via son brouillon, modifier les
-- DONNEES PERMANENTES du patient (ex. `sexe`) a la finalisation. La portee n'etait pas
-- contrainte cote serveur.
-- Correctif (defense a la SOURCE, additive) : un trigger refuse qu'un brouillon de portee
-- `encounter` porte des donnees permanentes patient. On bloque le mauvais brouillon des sa
-- saisie (plus tot qu'a la finalisation). La portee `patient` reste un "cas complet"
-- (donnees permanentes + rencontres) conforme a l'usage du produit.
-- Migration ADDITIVE.
-- =============================================================================
create or replace function public.guard_curation_draft_scope()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_scope text;
begin
  select s.scope into v_scope
    from public.curation_task t
    join public.raw_submission s on s.id = t.submission_id
   where t.id = new.task_id;
  if v_scope = 'encounter' and coalesce(new.patient_data, '{}'::jsonb) is distinct from '{}'::jsonb then
    raise exception 'Portee rencontre : le brouillon ne doit pas modifier les donnees permanentes du patient (§5.4)';
  end if;
  return new;
end $$;

create trigger trg_curation_draft_scope
  before insert or update on public.curation_draft
  for each row execute function public.guard_curation_draft_scope();
