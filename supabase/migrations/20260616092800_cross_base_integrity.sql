-- =============================================================================
-- 20260616092800_cross_base_integrity.sql  (audit 3 §5.6)
-- Plusieurs tables dupliquent un base_id tout en referencant une autre entite. Rien
-- n'imposait que les DEUX cotes appartiennent a la MEME base -> on pouvait creer des liens
-- incoherents (soumission base B ciblant un patient de la base A), avec des effets RLS /
-- audit / cascade imprevisibles. On ajoute des triggers d'integrite referentielle "meme base".
-- SECURITY DEFINER : la verification doit aboutir independamment de la RLS de l'appelant.
-- Migration ADDITIVE.
-- =============================================================================

-- raw_submission.target_patient_id doit appartenir a raw_submission.base_id.
create or replace function public.guard_xbase_submission()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v uuid;
begin
  select base_id into v from public.patient where id = new.target_patient_id;
  if v is distinct from new.base_id then
    raise exception 'Coherence inter-bases : le patient cible n''appartient pas a la base de la soumission';
  end if;
  return new;
end $$;
create trigger trg_xbase_submission
  before insert or update on public.raw_submission
  for each row execute function public.guard_xbase_submission();

-- raw_document.submission_id doit etre de la meme base que le document.
create or replace function public.guard_xbase_document()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v uuid;
begin
  select base_id into v from public.raw_submission where id = new.submission_id;
  if v is distinct from new.base_id then
    raise exception 'Coherence inter-bases : le document et sa soumission ne sont pas de la meme base';
  end if;
  return new;
end $$;
create trigger trg_xbase_document
  before insert or update on public.raw_document
  for each row execute function public.guard_xbase_document();

-- curation_task.submission_id doit etre de la meme base que la tache.
create or replace function public.guard_xbase_task()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v uuid;
begin
  select base_id into v from public.raw_submission where id = new.submission_id;
  if v is distinct from new.base_id then
    raise exception 'Coherence inter-bases : la tache et sa soumission ne sont pas de la meme base';
  end if;
  return new;
end $$;
create trigger trg_xbase_task
  before insert or update on public.curation_task
  for each row execute function public.guard_xbase_task();

-- curation_draft.task_id doit etre de la meme base que le brouillon.
create or replace function public.guard_xbase_draft()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v uuid;
begin
  select base_id into v from public.curation_task where id = new.task_id;
  if v is distinct from new.base_id then
    raise exception 'Coherence inter-bases : le brouillon et sa tache ne sont pas de la meme base';
  end if;
  return new;
end $$;
create trigger trg_xbase_draft
  before insert or update on public.curation_draft
  for each row execute function public.guard_xbase_draft();

-- curation_clarification.task_id doit etre de la meme base que la clarification.
create or replace function public.guard_xbase_clarification()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v uuid;
begin
  select base_id into v from public.curation_task where id = new.task_id;
  if v is distinct from new.base_id then
    raise exception 'Coherence inter-bases : la clarification et sa tache ne sont pas de la meme base';
  end if;
  return new;
end $$;
create trigger trg_xbase_clarification
  before insert or update on public.curation_clarification
  for each row execute function public.guard_xbase_clarification();
