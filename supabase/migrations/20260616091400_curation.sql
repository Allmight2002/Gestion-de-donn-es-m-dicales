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
  status            text not null default 'received' check (status in ('received','in_curation','completed','cancelled')),
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
  -- Cycle de vie (synthese produit §4.1) : 'preparing' (medecin prepare, hors pool) ->
  -- 'open' (dans le pool) -> 'in_progress' (curateur a reserve) -> 'clarification_requested'
  -- (en attente d'une reponse du medecin) -> 'completed' (curation finalisee) | 'cancelled'.
  status        text not null default 'preparing'
    check (status in ('preparing','open','in_progress','clarification_requested','completed','cancelled')),
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
  status       text not null default 'draft' check (status in ('draft','finalized')),
  created_by   uuid references public.profiles(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index on public.curation_draft (task_id);
create index on public.curation_draft (base_id);

-- 6) Clarification (synthese §4.3) : echange Q/R entre le curateur AFFECTE et le medecin
--    PROPRIETAIRE. Le curateur pose une question (doc illisible, date absente, valeur
--    improbable...) -> la tache passe en 'clarification_requested' ; le medecin repond ->
--    la tache repasse en 'in_progress'. Une seule clarification ouverte a la fois.
create table public.curation_clarification (
  id          uuid primary key default gen_random_uuid(),
  task_id     uuid not null references public.curation_task(id) on delete cascade,
  base_id     uuid not null references public.base(id) on delete cascade,
  question    text not null,
  asked_by    uuid references public.profiles(id),
  asked_at    timestamptz not null default now(),
  answer      text,
  answered_by uuid references public.profiles(id),
  answered_at timestamptz,
  status      text not null default 'open' check (status in ('open','answered'))
);
create index on public.curation_clarification (task_id);
create index on public.curation_clarification (base_id);

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

-- Le curateur courant a-t-il une tache ACTIVE sur cette soumission ? Sert a ne donner acces
-- aux DOCUMENTS qu'apres reservation, et UNIQUEMENT tant que la tache est en cours (synthese
-- §7.3 : l'acces est ferme apres 'completed'/'cancelled' ; l'identite reste dans les journaux).
create or replace function public.is_assigned_to_submission(p_submission_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.curation_task t
    where t.submission_id = p_submission_id and t.assigned_to = auth.uid()
      and t.status in ('in_progress','clarification_requested')
  )
$$;

-- Curateur AFFECTE *et* tache encore ACTIVE (in_progress / clarification_requested). Sert a
-- n'autoriser l'ecriture du brouillon QUE pendant la curation : apres finalisation
-- ('completed') ou annulation, le brouillon devient non modifiable (preuve preservee).
create or replace function public.is_active_assigned_curator(p_task_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.curation_task t
    where t.id = p_task_id and t.assigned_to = auth.uid()
      and t.status in ('in_progress','clarification_requested')
  )
$$;

-- =============================================================================
-- Privileges + RLS (chaque table : RLS activee ; sans policy = tout refuse).
-- =============================================================================
grant select, insert, update, delete on
  public.raw_submission, public.raw_document, public.curation_task,
  public.curation_draft, public.curation_clarification to authenticated;
grant execute on function public.is_assigned_curator(uuid) to authenticated;
grant execute on function public.is_assigned_to_submission(uuid) to authenticated;
grant execute on function public.is_active_assigned_curator(uuid) to authenticated;

-- POOL GLOBAL : lecture par le medecin PROPRIETAIRE du cas (suivi) OU par le staff de
-- curation (curateur/validateur — l'ANALYSTE est exclu) ; role GLOBAL, sans acces base,
-- donc jamais l'identite. Ecriture des cas + documents reservee au medecin proprietaire
-- (il deidentifie au depot).

alter table public.raw_submission enable row level security;
create policy rs_select on public.raw_submission for select to authenticated
  using (public.is_base_owner(base_id) or public.is_curation_staff());
create policy rs_insert on public.raw_submission for insert to authenticated
  with check (public.is_base_owner(base_id));
-- Mise a jour reservee au PROPRIETAIRE (preparation avant soumission). Toutes les
-- transitions de statut du cycle passent par des RPC SECURITY DEFINER (submit / claim /
-- finalize / delete) ; un curateur ne modifie donc JAMAIS une soumission directement.
create policy rs_update on public.raw_submission for update to authenticated
  using (public.is_base_owner(base_id))
  with check (public.is_base_owner(base_id));

-- raw_document : documents (deidentifies) du cas. Lus par le PROPRIETAIRE ou le curateur
-- AYANT RESERVE ce cas (et tant que sa tache est active). Un curateur NON affecte ne voit PAS
-- les documents (il voit seulement la liste du pool) -> acces apres reservation (§5.1).
-- Deposes par le proprietaire. Jamais l'admin systeme.
alter table public.raw_document enable row level security;
create policy rd_select on public.raw_document for select to authenticated
  using (
    (public.is_base_owner(base_id) or public.is_assigned_to_submission(submission_id))
    and deleted_at is null
  );
create policy rd_insert on public.raw_document for insert to authenticated
  with check (public.is_base_owner(base_id));
create policy rd_update on public.raw_document for update to authenticated
  using (public.is_base_owner(base_id)) with check (public.is_base_owner(base_id));

-- curation_task : le pool. Visible proprietaire + staff. Creee par le proprietaire ;
-- mise a jour par le proprietaire ou le curateur AFFECTE (transitions du cycle).
alter table public.curation_task enable row level security;
create policy ct_select on public.curation_task for select to authenticated
  using (public.is_base_owner(base_id) or public.is_curation_staff());
create policy ct_insert on public.curation_task for insert to authenticated
  with check (public.is_base_owner(base_id));
create policy ct_update on public.curation_task for update to authenticated
  using (public.is_base_owner(base_id) or public.is_assigned_curator(id))
  with check (public.is_base_owner(base_id) or public.is_assigned_curator(id));

-- curation_draft : ecrit ET lu par le SEUL curateur AFFECTE (qui a reserve le cas) et par
-- le proprietaire. Un autre curateur du pool ne voit PAS le brouillon (isolation des donnees
-- deja extraites entre curateurs), meme s'il voit la liste des taches.
alter table public.curation_draft enable row level security;
create policy cd_select on public.curation_draft for select to authenticated
  using (public.is_base_owner(base_id) or public.is_assigned_curator(task_id));
-- Ecriture du brouillon : curateur affecte ET tache ENCORE ACTIVE (is_active_assigned_curator).
-- Une fois la tache 'completed'/'cancelled', plus aucune ecriture (la preuve est figee).
create policy cd_insert on public.curation_draft for insert to authenticated
  with check (public.is_base_owner(base_id) or (public.is_curateur() and public.is_active_assigned_curator(task_id)));
create policy cd_update on public.curation_draft for update to authenticated
  using (public.is_base_owner(base_id) or (public.is_curateur() and public.is_active_assigned_curator(task_id)))
  with check (public.is_base_owner(base_id) or (public.is_curateur() and public.is_active_assigned_curator(task_id)));

-- Defense en profondeur : un brouillon FINALISE est immuable (meme pour le proprietaire,
-- meme par appel direct). La transition draft -> finalized (par finalize_curation_task)
-- reste permise car OLD.status vaut alors 'draft'.
create or replace function public.guard_finalized_draft()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if old.status = 'finalized' then
    raise exception 'Brouillon de curation finalise : modification interdite (provenance preservee)';
  end if;
  return new;
end $$;
drop trigger if exists trg_guard_finalized_draft on public.curation_draft;
create trigger trg_guard_finalized_draft
  before update on public.curation_draft
  for each row execute function public.guard_finalized_draft();

-- curation_clarification : lue par le proprietaire et le SEUL curateur affecte (meme isolation
-- que le brouillon). Les ECRITURES passent par des RPC (request/answer) ; pas de policy directe.
alter table public.curation_clarification enable row level security;
create policy ccl_select on public.curation_clarification for select to authenticated
  using (public.is_base_owner(base_id) or public.is_assigned_curator(task_id));

-- =============================================================================
-- RPC : FINALISER une curation (synthese produit §4.4). Le CURATEUR affecte (ou le medecin
-- proprietaire) finalise directement, en une transaction ATOMIQUE : re-validation SERVEUR
-- (bornes/listes/type via assert_data_valid), ecriture des donnees CUREES dans le patient
-- cible (permanentes fusionnees + rencontres creees, age calcule depuis la DOB lue en
-- interne, jamais exposee), journalisation (field_change_log source='curation_finalization'
-- + audit_log 'curation_finalized'), et avancement tache/soumission -> 'completed'. Le role
-- `validateur` est supprime : plus de soumission/validation en deux temps.
-- =============================================================================
create or replace function public.finalize_curation_task(p_task_id uuid)
returns public.curation_task
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  t      public.curation_task;
  d      public.curation_draft;
  s      public.raw_submission;
  v_pat  public.patient;
  v_base uuid;
  v_dob  date;
  k      text;
  v_old  jsonb;
  v_new  jsonb;
  enc    jsonb;
  v_age  numeric;
  v_unit text;
  v_tv   uuid;
begin
  if auth.uid() is null then raise exception 'Authentification requise'; end if;

  select * into t from public.curation_task where id = p_task_id and deleted_at is null for update;
  if not found then raise exception 'Cas introuvable'; end if;
  v_base := t.base_id;

  -- Autorisation : le curateur AFFECTE ou le medecin proprietaire (§6).
  if not (public.is_assigned_curator(t.id) or public.is_base_owner(v_base)) then
    raise exception 'Reserve au curateur affecte (ou au proprietaire)';
  end if;
  if t.status <> 'in_progress' then
    raise exception 'Le cas doit etre en cours (statut=%)', t.status;
  end if;

  select * into d from public.curation_draft where task_id = t.id order by updated_at desc limit 1 for update;
  if not found then raise exception 'Aucun brouillon a finaliser'; end if;

  select * into s     from public.raw_submission where id = t.submission_id for update;
  select * into v_pat from public.patient where id = s.target_patient_id for update;
  if not found then raise exception 'Patient cible introuvable'; end if;

  -- §8.1 : UNE seule version pour TOUTE la finalisation -> la version qui VALIDE est aussi
  -- celle ENREGISTREE avec la rencontre creee (pas de validation version B / stockage version A).
  v_tv := coalesce(s.template_version_id, v_pat.template_version_id);

  -- DOB lue en interne pour le calcul d'age (jamais renvoyee).
  select date_of_birth into v_dob from public.patient_identity
   where base_id = v_base and patient_code = v_pat.patient_code and deleted_at is null;

  -- Re-validation SERVEUR (bornes / listes / type). A la finalisation, on impose AUSSI la
  -- COMPLETUDE des champs requis (synthese §6) — contrairement a un brouillon partiel.
  perform public.assert_data_valid(v_tv, 'patient', d.patient_data);

  -- 1) Donnees permanentes : fusion + journal des champs reellement modifies.
  if d.patient_data <> '{}'::jsonb then
    -- Completude sur l'etat FINAL du patient (donnees existantes + proposees), pas le seul delta.
    perform public.assert_required_complete(v_tv, 'patient', v_pat.data || d.patient_data);
    for k in select jsonb_object_keys(d.patient_data) loop
      v_old := v_pat.data -> k;
      v_new := d.patient_data -> k;
      if v_old is distinct from v_new then
        insert into public.field_change_log (entity, entity_id, base_id, field_key, old_value, new_value, reason, changed_by, source)
        values ('patient', v_pat.id, v_base, k, v_old, v_new, 'Finalisation curation', auth.uid(), 'curation_finalization');
      end if;
    end loop;
    update public.patient
       set data = data || d.patient_data, validation_status = 'curated', collection_mode = 'assisted', updated_at = now()
     where id = v_pat.id;
  else
    -- Portee 'rencontre' (aucune donnee permanente) : on ne re-verifie PAS le patient.
    update public.patient set updated_at = now() where id = v_pat.id;
  end if;

  -- 2) Rencontres proposees -> creees CUREES (age calcule, hors data).
  for enc in select * from jsonb_array_elements(d.encounters) loop
    perform public.assert_data_valid(v_tv, 'encounter', coalesce(enc -> 'data', '{}'::jsonb));
    perform public.assert_required_complete(v_tv, 'encounter', coalesce(enc -> 'data', '{}'::jsonb), coalesce(enc ->> 'encounter_type', 'autre'));
    v_unit := coalesce(enc ->> 'age_unit', 'years');
    v_age  := case
                when v_dob is not null and (enc ->> 'encounter_date') is not null
                then public.compute_age(v_dob, (enc ->> 'encounter_date')::date, v_unit)
                else null
              end;
    insert into public.encounter (patient_id, template_version_id, encounter_type, encounter_date,
                                  age_value, age_unit, data, collection_mode, validation_status, created_by)
    values (v_pat.id, v_tv,
            coalesce(enc ->> 'encounter_type', 'autre'),
            (enc ->> 'encounter_date')::date, v_age, v_unit,
            coalesce(enc -> 'data', '{}'::jsonb) - 'age_at_encounter',
            'assisted', 'curated', auth.uid());
  end loop;

  update public.curation_draft  set status = 'finalized', updated_at = now() where id = d.id;
  update public.curation_task   set status = 'completed', updated_at = now() where id = t.id returning * into t;
  update public.raw_submission  set status = 'completed' where id = s.id;
  insert into public.audit_log (user_id, action, entity, entity_id, base_id, metadata)
  values (auth.uid(), 'curation_finalized', 'curation_task', t.id, v_base,
          jsonb_build_object('submission_id', s.id, 'patient_id', v_pat.id, 'draft_id', d.id));
  return t;
end $$;
grant execute on function public.finalize_curation_task(uuid) to authenticated;

-- =============================================================================
-- RPC : le CURATEUR affecte DEMANDE une clarification (synthese §4.3). La tache passe en
-- 'clarification_requested' (le curateur ne peut plus finaliser tant que le medecin n'a pas
-- repondu). Reserve au curateur affecte ; le cas doit etre 'in_progress'.
-- =============================================================================
create or replace function public.request_clarification(p_task_id uuid, p_question text)
returns public.curation_clarification
language plpgsql security definer set search_path = public, pg_temp as $$
declare t public.curation_task; c public.curation_clarification;
begin
  if auth.uid() is null then raise exception 'Authentification requise'; end if;
  if coalesce(btrim(p_question), '') = '' then raise exception 'La question est requise'; end if;
  select * into t from public.curation_task where id = p_task_id and deleted_at is null for update;
  if not found then raise exception 'Cas introuvable'; end if;
  if not public.is_assigned_curator(t.id) then raise exception 'Reserve au curateur affecte'; end if;
  if t.status <> 'in_progress' then raise exception 'Le cas doit etre en cours (statut=%)', t.status; end if;

  insert into public.curation_clarification (task_id, base_id, question, asked_by)
  values (t.id, t.base_id, btrim(p_question), auth.uid())
  returning * into c;
  update public.curation_task set status = 'clarification_requested', updated_at = now() where id = t.id;
  insert into public.audit_log (user_id, action, entity, entity_id, base_id, metadata)
  values (auth.uid(), 'curation_clarification_requested', 'curation_task', t.id, t.base_id, jsonb_build_object('clarification_id', c.id));
  return c;
end $$;
grant execute on function public.request_clarification(uuid, text) to authenticated;

-- =============================================================================
-- RPC : le MEDECIN proprietaire REPOND a une clarification. La tache repasse en 'in_progress'
-- pour que le curateur poursuive. Reserve au proprietaire ; la clarification doit etre ouverte.
-- =============================================================================
create or replace function public.answer_clarification(p_clarification_id uuid, p_answer text)
returns public.curation_clarification
language plpgsql security definer set search_path = public, pg_temp as $$
declare c public.curation_clarification; result public.curation_clarification;
begin
  if auth.uid() is null then raise exception 'Authentification requise'; end if;
  if coalesce(btrim(p_answer), '') = '' then raise exception 'La reponse est requise'; end if;
  select * into c from public.curation_clarification where id = p_clarification_id for update;
  if not found then raise exception 'Clarification introuvable'; end if;
  if not public.is_base_owner(c.base_id) then raise exception 'Reserve au medecin proprietaire'; end if;
  if c.status <> 'open' then raise exception 'Cette clarification est deja resolue'; end if;

  update public.curation_clarification
     set answer = btrim(p_answer), answered_by = auth.uid(), answered_at = now(), status = 'answered'
   where id = p_clarification_id returning * into result;
  update public.curation_task set status = 'in_progress', updated_at = now() where id = c.task_id;
  insert into public.audit_log (user_id, action, entity, entity_id, base_id, metadata)
  values (auth.uid(), 'curation_clarification_answered', 'curation_clarification', result.id, c.base_id, jsonb_build_object('task_id', c.task_id));
  return result;
end $$;
grant execute on function public.answer_clarification(uuid, text) to authenticated;

-- =============================================================================
-- RPC : le MEDECIN cree un cas (atomique : soumission + tache + code opaque). Le cas naît
-- en 'preparing' : il n'est PAS encore dans le pool. Le medecin depose ensuite les documents
-- DEIDENTIFIES (raw_document) puis appelle submit_curation_request pour l'envoyer au pool.
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

  -- 'received' cote soumission = cas en preparation (pas encore confie au staff).
  insert into public.raw_submission (base_id, target_patient_id, template_version_id, scope, case_code, external_ref, status, submitted_by)
  values (p_base_id, p_target_patient_id,
          (select current_template_version_id from public.base where id = p_base_id),
          p_scope, v_code, p_external_ref, 'received', auth.uid())
  returning id into v_sub;

  -- Tache en 'preparing' : invisible du pool tant que le medecin n'a pas soumis.
  insert into public.curation_task (base_id, submission_id, status, created_by)
  values (p_base_id, v_sub, 'preparing', auth.uid())
  returning * into v_task;

  return v_task;
end $$;
grant execute on function public.create_curation_submission(uuid, uuid, text, text) to authenticated;

-- =============================================================================
-- RPC : le MEDECIN SOUMET sa demande au pool. Condition de SON cote : au moins un document
-- deidentifie depose. Le cas passe alors de 'preparing' a 'open' (entre dans le pool, devient
-- reservable par un curateur). Sans document, on refuse (le staff n'aurait rien a traiter).
-- =============================================================================
create or replace function public.submit_curation_request(p_task_id uuid)
returns public.curation_task
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  t      public.curation_task;
  v_task public.curation_task;
  v_docs int;
begin
  if auth.uid() is null then raise exception 'Authentification requise'; end if;
  select * into t from public.curation_task where id = p_task_id for update;
  if not found then raise exception 'Cas introuvable'; end if;
  if not public.is_base_owner(t.base_id) then raise exception 'Reserve au proprietaire de la base'; end if;
  if t.status <> 'preparing' then raise exception 'La demande est deja envoyee (statut=%)', t.status; end if;

  select count(*) into v_docs from public.raw_document where submission_id = t.submission_id and deleted_at is null;
  if v_docs = 0 then raise exception 'Au moins un document est requis avant de soumettre au staff'; end if;

  update public.curation_task  set status = 'open', updated_at = now() where id = p_task_id returning * into v_task;
  update public.raw_submission set status = 'in_curation' where id = t.submission_id;
  return v_task;
end $$;
grant execute on function public.submit_curation_request(uuid) to authenticated;

-- =============================================================================
-- RPC : le MEDECIN SUPPRIME une de ses demandes (erreur de saisie, etc.). Suppression
-- LOGIQUE : la tache et les documents sont marques supprimes (deleted_at) -> la demande
-- disparait du Suivi et du pool, les documents ne sont plus lisibles. Option p_delete_patient :
-- supprimer AUSSI le patient cible (cascade identite/rencontres/images via soft_delete_patient)
-- — utile quand le patient avait ete cree juste pour cette demande. Une demande deja VALIDEE
-- n'est pas supprimable (ses donnees sont publiees et tracees : on garde la provenance).
-- =============================================================================
create or replace function public.delete_curation_request(p_task_id uuid, p_reason text default null, p_delete_patient boolean default false)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  t     public.curation_task;
  v_pat uuid;
begin
  if auth.uid() is null then raise exception 'Authentification requise'; end if;
  select * into t from public.curation_task where id = p_task_id and deleted_at is null for update;
  if not found then raise exception 'Demande introuvable'; end if;
  if not public.is_base_owner(t.base_id) then raise exception 'Reserve au proprietaire de la base'; end if;
  if t.status = 'completed' then
    raise exception 'Une demande finalisee ne peut pas etre supprimee (les donnees sont deja publiees)';
  end if;

  update public.curation_task set deleted_at = now(), updated_at = now() where id = p_task_id;
  update public.raw_document
     set deleted_at = now(), deletion_reason = coalesce(nullif(btrim(p_reason), ''), 'Demande supprimee')
   where submission_id = t.submission_id and deleted_at is null;

  insert into public.audit_log (user_id, action, entity, entity_id, base_id, metadata)
  values (auth.uid(), 'curation_request_deleted', 'curation_task', p_task_id, t.base_id,
          jsonb_build_object('submission_id', t.submission_id, 'reason', p_reason, 'previous_status', t.status, 'patient_deleted', p_delete_patient));

  -- Option : supprimer aussi le patient cible (s'il existe encore). soft_delete_patient
  -- re-verifie les droits (can_edit_structured_data) et cascade identite/rencontres/images.
  if p_delete_patient then
    select target_patient_id into v_pat from public.raw_submission where id = t.submission_id;
    if v_pat is not null and exists (select 1 from public.patient where id = v_pat and deleted_at is null) then
      perform public.soft_delete_patient(v_pat, coalesce(nullif(btrim(p_reason), ''), 'Demande supprimee'));
    end if;
  end if;
end $$;
grant execute on function public.delete_curation_request(uuid, text, boolean) to authenticated;

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
   where id = p_task_id and status = 'in_progress'
  returning * into v_task;
  if not found then raise exception 'Cas non liberable (statut)'; end if;
  return v_task;
end $$;
grant execute on function public.release_curation_task(uuid) to authenticated;
