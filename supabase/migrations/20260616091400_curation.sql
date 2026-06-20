-- =============================================================================
-- 20260616091400_curation.sql  (v3.0 — POOL GLOBAL)
-- Sous-systeme de CURATION : le medecin SOUMET un cas avec des documents DEJA
-- deidentifies (deidentification a sa charge), qui entre dans un POOL GLOBAL sous un
-- CODE OPAQUE (case_code). Les CURATEURS (role global) voient le pool, RESERVENT un cas
-- (anti-collision), le structurent ; les VALIDATEURS (role global) valident -> les
-- donnees deviennent VERIFIEES dans la zone analytique du medecin.
--
-- Confidentialite : curateur/validateur ont un ROLE GLOBAL, AUCUN acces base, donc
-- AUCUN acces a patient_identity (RLS). Ils ne voient que le code opaque + les documents
-- (deidentifies) + les champs a remplir. La validation est ATOMIQUE et journalisee ;
-- l'age est calcule cote serveur (DOB lue en interne, jamais exposee).
-- =============================================================================

-- 1) Unite de collecte : un "cas" soumis au pool, rattache (cote medecin) a un patient. -
create table public.raw_submission (
  id                uuid primary key default gen_random_uuid(),
  base_id           uuid not null references public.base(id) on delete cascade,
  target_patient_id uuid not null references public.patient(id) on delete cascade,
  template_version_id uuid references public.template_version(id), -- gabarit a remplir (champs visibles au curateur)
  scope             text not null default 'patient' check (scope in ('patient','encounter')), -- donnees permanentes OU une rencontre
  case_code         text not null unique, -- code OPAQUE montre au staff (jamais le patient_code)
  external_ref      text,
  collection_mode   text not null default 'assisted' check (collection_mode in ('direct','assisted','mixed')),
  status            text not null default 'received' check (status in ('received','in_curation','validated','rejected')),
  notes             text,
  submitted_by      uuid references public.profiles(id),
  created_at        timestamptz not null default now()
);
create index on public.raw_submission (base_id);
create index on public.raw_submission (target_patient_id);

-- 2) Document brut (octets dans le bucket raw-documents ; ligne en zone restreinte). ---
create table public.raw_document (
  id            uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.raw_submission(id) on delete cascade,
  base_id       uuid not null references public.base(id) on delete cascade,
  label         text,
  storage_path  text not null,
  mime_type     text not null,
  -- Inspection a l'upload (§5.3) : type reel detecte (magic bytes), taille, empreinte.
  detected_mime_type text,
  file_size     bigint,
  file_hash     text,
  inspection_status text not null default 'accepted_client'
    check (inspection_status in ('pending','accepted_client','accepted','quarantined')),
  inspected_at  timestamptz,
  created_by    uuid references public.profiles(id),
  created_at    timestamptz not null default now(),
  deleted_at    timestamptz,
  deletion_reason text
);
create index on public.raw_document (submission_id);
create index on public.raw_document (base_id);

-- 3) Tache de curation : affectation d'une soumission a un curateur. -------------------
create table public.curation_task (
  id            uuid primary key default gen_random_uuid(),
  base_id       uuid not null references public.base(id) on delete cascade,
  submission_id uuid not null references public.raw_submission(id) on delete cascade,
  assigned_to   uuid references public.profiles(id),
  status        text not null default 'open' check (status in ('open','assigned','in_progress','submitted','validated','rejected')),
  created_by    uuid references public.profiles(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);
create index on public.curation_task (base_id);
create index on public.curation_task (assigned_to);

-- 4) Brouillon : la proposition structuree du curateur (donnees analytiques). ----------
--    patient_data = donnees permanentes proposees (fusionnees a la validation).
--    encounters   = tableau de rencontres proposees [{encounter_type, encounter_date,
--                   age_unit, data}], creees VERIFIEES a la validation.
create table public.curation_draft (
  id           uuid primary key default gen_random_uuid(),
  task_id      uuid not null references public.curation_task(id) on delete cascade,
  base_id      uuid not null references public.base(id) on delete cascade,
  patient_data jsonb not null default '{}'::jsonb,
  encounters   jsonb not null default '[]'::jsonb,
  status       text not null default 'draft' check (status in ('draft','submitted','validated','rejected')),
  created_by   uuid references public.profiles(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index on public.curation_draft (task_id);
create index on public.curation_draft (base_id);

-- 5) Revue de validation : la decision du validateur (trace). --------------------------
create table public.curation_review (
  id          uuid primary key default gen_random_uuid(),
  draft_id    uuid not null references public.curation_draft(id) on delete cascade,
  base_id     uuid not null references public.base(id) on delete cascade,
  decision    text not null check (decision in ('approved','rejected')),
  comment     text,
  reviewed_by uuid references public.profiles(id),
  created_at  timestamptz not null default now()
);
create index on public.curation_review (draft_id);
create index on public.curation_review (base_id);

-- updated_at automatique (meme fonction que patient/encounter).
create trigger trg_curation_task_updated  before update on public.curation_task  for each row execute function public.set_updated_at();
create trigger trg_curation_draft_updated before update on public.curation_draft for each row execute function public.set_updated_at();

-- =============================================================================
-- Helper : l'utilisateur courant est-il le curateur AFFECTE a cette tache ?
-- (lit curation_task -> pas de recursion avec les policies de curation_draft.)
-- =============================================================================
create or replace function public.is_assigned_curator(p_task_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.curation_task t where t.id = p_task_id and t.assigned_to = auth.uid())
$$;

-- Le curateur courant a-t-il RESERVE la tache portant cette soumission ? Sert a ne donner
-- acces aux DOCUMENTS qu'apres reservation (et seulement de SA tache), pas a tout le pool.
create or replace function public.is_assigned_to_submission(p_submission_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.curation_task t where t.submission_id = p_submission_id and t.assigned_to = auth.uid())
$$;

-- =============================================================================
-- Privileges + RLS (chaque table : RLS activee ; sans policy = tout refuse).
-- =============================================================================
grant select, insert, update, delete on
  public.raw_submission, public.raw_document, public.curation_task,
  public.curation_draft, public.curation_review to authenticated;
grant execute on function public.is_assigned_curator(uuid) to authenticated;
grant execute on function public.is_assigned_to_submission(uuid) to authenticated;

-- POOL GLOBAL : lecture par le medecin PROPRIETAIRE du cas (suivi) OU par le staff de
-- curation (curateur/validateur — l'ANALYSTE est exclu) ; role GLOBAL, sans acces base,
-- donc jamais l'identite. Ecriture des cas + documents reservee au medecin proprietaire
-- (il deidentifie au depot).

alter table public.raw_submission enable row level security;
create policy rs_select on public.raw_submission for select to authenticated
  using (public.is_base_owner(base_id) or public.is_curation_staff());
create policy rs_insert on public.raw_submission for insert to authenticated
  with check (public.is_base_owner(base_id));
create policy rs_update on public.raw_submission for update to authenticated
  using (public.is_base_owner(base_id) or public.is_curation_staff())
  with check (public.is_base_owner(base_id) or public.is_curation_staff());

-- raw_document : documents (deidentifies) du cas. Lus par le PROPRIETAIRE, le curateur
-- AYANT RESERVE ce cas, ou un VALIDATEUR (pour la revue). Un curateur NON affecte ne voit
-- PAS les documents (il voit seulement la liste du pool) -> acces apres reservation (§5.1).
-- Deposes par le proprietaire. Jamais l'analyste, jamais l'admin systeme.
alter table public.raw_document enable row level security;
create policy rd_select on public.raw_document for select to authenticated
  using (
    (public.is_base_owner(base_id) or public.is_assigned_to_submission(submission_id) or public.is_validateur())
    and deleted_at is null
  );
create policy rd_insert on public.raw_document for insert to authenticated
  with check (public.is_base_owner(base_id));
create policy rd_update on public.raw_document for update to authenticated
  using (public.is_base_owner(base_id)) with check (public.is_base_owner(base_id));

-- curation_task : le pool. Visible proprietaire + staff. Creee par le proprietaire ;
-- mise a jour par le proprietaire, le curateur AFFECTE, ou un validateur (transitions).
alter table public.curation_task enable row level security;
create policy ct_select on public.curation_task for select to authenticated
  using (public.is_base_owner(base_id) or public.is_curation_staff());
create policy ct_insert on public.curation_task for insert to authenticated
  with check (public.is_base_owner(base_id));
create policy ct_update on public.curation_task for update to authenticated
  using (public.is_base_owner(base_id) or public.is_assigned_curator(id) or public.is_validateur())
  with check (public.is_base_owner(base_id) or public.is_assigned_curator(id) or public.is_validateur());

-- curation_draft : ecrit par le curateur AFFECTE (qui a reserve le cas) ; lu par le
-- proprietaire, le staff et le curateur affecte.
alter table public.curation_draft enable row level security;
create policy cd_select on public.curation_draft for select to authenticated
  using (public.is_base_owner(base_id) or public.is_curation_staff() or public.is_assigned_curator(task_id));
create policy cd_insert on public.curation_draft for insert to authenticated
  with check (public.is_base_owner(base_id) or (public.is_curateur() and public.is_assigned_curator(task_id)));
create policy cd_update on public.curation_draft for update to authenticated
  using (public.is_base_owner(base_id) or (public.is_curateur() and public.is_assigned_curator(task_id)))
  with check (public.is_base_owner(base_id) or (public.is_curateur() and public.is_assigned_curator(task_id)));

-- curation_review : ecrite par un validateur (via la RPC) ou le proprietaire ; lue par
-- le proprietaire + le staff.
alter table public.curation_review enable row level security;
create policy cr_select on public.curation_review for select to authenticated
  using (public.is_base_owner(base_id) or public.is_curation_staff());
create policy cr_insert on public.curation_review for insert to authenticated
  with check (public.is_base_owner(base_id) or public.is_validateur());

-- =============================================================================
-- RPC : soumettre un brouillon pour validation (curateur affecte).
-- =============================================================================
create or replace function public.submit_curation_draft(p_draft_id uuid)
returns public.curation_draft
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  d      public.curation_draft;
  result public.curation_draft;
begin
  if auth.uid() is null then raise exception 'Authentification requise'; end if;
  select * into d from public.curation_draft where id = p_draft_id for update;
  if not found then raise exception 'Brouillon introuvable'; end if;

  if not (public.is_base_owner(d.base_id) or public.is_assigned_curator(d.task_id)) then
    raise exception 'Reserve au curateur ayant reserve le cas';
  end if;
  if d.status <> 'draft' then raise exception 'Le brouillon n''est pas modifiable (statut=%)', d.status; end if;

  update public.curation_draft set status = 'submitted', updated_at = now() where id = p_draft_id returning * into result;
  update public.curation_task set status = 'submitted', updated_at = now() where id = d.task_id;
  return result;
end $$;

grant execute on function public.submit_curation_draft(uuid) to authenticated;

-- =============================================================================
-- RPC : VALIDER (ou rejeter) un brouillon — operation ATOMIQUE et privilegiee.
-- Reserve a can_validate_data. En cas d'approbation : ecrit les donnees VERIFIEES
-- dans le patient cible (donnees permanentes fusionnees + rencontres creees), calcule
-- l'age depuis la DOB lue en interne (jamais exposee), journalise (field_change_log
-- source='curation_validation' + audit_log), et fait avancer tache/soumission.
-- =============================================================================
create or replace function public.validate_curation_draft(p_draft_id uuid, p_decision text, p_comment text default null)
returns public.curation_review
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  d        public.curation_draft;
  t        public.curation_task;
  s        public.raw_submission;
  v_pat    public.patient;
  v_base   uuid;
  v_dob    date;
  v_review public.curation_review;
  k        text;
  v_old    jsonb;
  v_new    jsonb;
  enc      jsonb;
  v_age    numeric;
  v_unit   text;
begin
  if auth.uid() is null then raise exception 'Authentification requise'; end if;
  if p_decision not in ('approved','rejected') then raise exception 'Decision invalide: %', p_decision; end if;

  select * into d from public.curation_draft where id = p_draft_id for update;
  if not found then raise exception 'Brouillon introuvable'; end if;
  v_base := d.base_id;

  if not (public.is_base_owner(v_base) or public.is_validateur()) then
    raise exception 'Reserve aux validateurs';
  end if;
  if d.status <> 'submitted' then raise exception 'Le brouillon doit etre soumis (statut=%)', d.status; end if;

  select * into t from public.curation_task where id = d.task_id for update;
  select * into s from public.raw_submission where id = t.submission_id for update;

  insert into public.curation_review (draft_id, base_id, decision, comment, reviewed_by)
  values (p_draft_id, v_base, p_decision, p_comment, auth.uid())
  returning * into v_review;

  if p_decision = 'rejected' then
    update public.curation_draft set status = 'rejected', updated_at = now() where id = p_draft_id;
    update public.curation_task  set status = 'rejected', updated_at = now() where id = t.id;
    insert into public.audit_log (user_id, action, entity, entity_id, base_id, metadata)
    values (auth.uid(), 'curation_rejected', 'curation_draft', p_draft_id, v_base,
            jsonb_build_object('task_id', t.id, 'submission_id', s.id));
    return v_review;
  end if;

  -- APPROUVE : ecriture VERIFIEE dans le patient cible (analytique).
  select * into v_pat from public.patient where id = s.target_patient_id for update;
  if not found then raise exception 'Patient cible introuvable'; end if;

  -- DOB lue en interne pour le calcul d'age (jamais renvoyee).
  select date_of_birth into v_dob from public.patient_identity
   where base_id = v_base and patient_code = v_pat.patient_code and deleted_at is null;

  -- 0) Re-validation SERVEUR (§5.4) : bornes / listes / type, comme la saisie directe.
  perform public.assert_data_valid(coalesce(s.template_version_id, v_pat.template_version_id), 'patient', d.patient_data);

  -- 1) Donnees permanentes : fusion + journal des champs reellement modifies.
  if d.patient_data <> '{}'::jsonb then
    for k in select jsonb_object_keys(d.patient_data) loop
      v_old := v_pat.data -> k;
      v_new := d.patient_data -> k;
      if v_old is distinct from v_new then
        insert into public.field_change_log (entity, entity_id, base_id, field_key, old_value, new_value, reason, changed_by, source)
        values ('patient', v_pat.id, v_base, k, v_old, v_new, 'Validation curation', auth.uid(), 'curation_validation');
      end if;
    end loop;
    update public.patient
       set data = data || d.patient_data, validation_status = 'verified', collection_mode = 'assisted', updated_at = now()
     where id = v_pat.id;
  else
    -- Portee 'rencontre' (aucune donnee permanente) : on ne re-verifie PAS le patient.
    update public.patient set updated_at = now() where id = v_pat.id;
  end if;

  -- 2) Rencontres proposees -> creees VERIFIEES (age calcule, hors data).
  for enc in select * from jsonb_array_elements(d.encounters) loop
    perform public.assert_data_valid(coalesce(s.template_version_id, v_pat.template_version_id), 'encounter', coalesce(enc -> 'data', '{}'::jsonb));
    v_unit := coalesce(enc ->> 'age_unit', 'years');
    v_age  := case
                when v_dob is not null and (enc ->> 'encounter_date') is not null
                then public.compute_age(v_dob, (enc ->> 'encounter_date')::date, v_unit)
                else null
              end;
    insert into public.encounter (patient_id, template_version_id, encounter_type, encounter_date,
                                  age_value, age_unit, data, collection_mode, validation_status, created_by)
    values (v_pat.id, v_pat.template_version_id,
            coalesce(enc ->> 'encounter_type', 'autre'),
            (enc ->> 'encounter_date')::date, v_age, v_unit,
            coalesce(enc -> 'data', '{}'::jsonb) - 'age_at_encounter',
            'assisted', 'verified', auth.uid());
  end loop;

  update public.curation_draft  set status = 'validated', updated_at = now() where id = p_draft_id;
  update public.curation_task   set status = 'validated', updated_at = now() where id = t.id;
  update public.raw_submission  set status = 'validated' where id = s.id;
  insert into public.audit_log (user_id, action, entity, entity_id, base_id, metadata)
  values (auth.uid(), 'curation_validated', 'curation_draft', p_draft_id, v_base,
          jsonb_build_object('task_id', t.id, 'submission_id', s.id, 'patient_id', v_pat.id));
  return v_review;
end $$;

grant execute on function public.validate_curation_draft(uuid, text, text) to authenticated;

-- =============================================================================
-- RPC : le MEDECIN soumet un cas au pool (atomique : soumission + tache OUVERTE +
-- code opaque). Il deposera ensuite les documents DEIDENTIFIES (raw_document).
-- =============================================================================
create or replace function public.create_curation_submission(p_base_id uuid, p_target_patient_id uuid, p_external_ref text default null, p_scope text default 'patient')
returns public.curation_task
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_sub  uuid;
  v_code text := 'CASE-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));
  v_task public.curation_task;
begin
  if auth.uid() is null then raise exception 'Authentification requise'; end if;
  if p_scope not in ('patient','encounter') then raise exception 'Portee invalide: %', p_scope; end if;
  if not public.is_base_owner(p_base_id) then raise exception 'Reserve au proprietaire de la base'; end if;
  if not exists (select 1 from public.patient where id = p_target_patient_id and base_id = p_base_id and deleted_at is null) then
    raise exception 'Patient cible introuvable dans cette base';
  end if;

  insert into public.raw_submission (base_id, target_patient_id, template_version_id, scope, case_code, external_ref, status, submitted_by)
  values (p_base_id, p_target_patient_id,
          (select current_template_version_id from public.base where id = p_base_id),
          p_scope, v_code, p_external_ref, 'in_curation', auth.uid())
  returning id into v_sub;

  insert into public.curation_task (base_id, submission_id, status, created_by)
  values (p_base_id, v_sub, 'open', auth.uid())
  returning * into v_task;

  return v_task;
end $$;
grant execute on function public.create_curation_submission(uuid, uuid, text, text) to authenticated;

-- =============================================================================
-- RPC : un CURATEUR reserve un cas OUVERT (anti-collision). Le `where status='open'
-- and assigned_to is null` garantit qu'un seul curateur l'obtient.
-- =============================================================================
create or replace function public.claim_curation_task(p_task_id uuid)
returns public.curation_task
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_task public.curation_task;
begin
  if auth.uid() is null then raise exception 'Authentification requise'; end if;
  if not public.is_curateur() then raise exception 'Reserve aux curateurs'; end if;

  update public.curation_task
     set assigned_to = auth.uid(), status = 'in_progress', updated_at = now()
   where id = p_task_id and status = 'open' and assigned_to is null
  returning * into v_task;

  if not found then raise exception 'Cas deja reserve ou indisponible'; end if;
  return v_task;
end $$;
grant execute on function public.claim_curation_task(uuid) to authenticated;

-- RPC : le curateur affecte LIBERE un cas (le remet au pool). Le brouillon est conserve.
create or replace function public.release_curation_task(p_task_id uuid)
returns public.curation_task
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_task public.curation_task;
begin
  if not public.is_assigned_curator(p_task_id) then raise exception 'Vous n''avez pas reserve ce cas'; end if;
  update public.curation_task
     set assigned_to = null, status = 'open', updated_at = now()
   where id = p_task_id and status in ('in_progress','assigned')
  returning * into v_task;
  if not found then raise exception 'Cas non liberable (statut)'; end if;
  return v_task;
end $$;
grant execute on function public.release_curation_task(uuid) to authenticated;
