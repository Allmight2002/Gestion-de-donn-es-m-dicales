-- =============================================================================
-- 20260616094100_specialized_read_audit.sql  (audit v10 §5.5)
-- La fonction generique log_sensitive_read(action, entity, entity_id, base_id) faisait CONFIANCE
-- aux parametres du client : un curateur (is_curation_staff() = true) pouvait journaliser une
-- lecture 'raw_document_read' sur un UUID totalement fictif et une base arbitraire -> de fausses
-- lignes dans le journal de lecture. On la remplace par des fonctions SPECIALISEES qui DERIVENT
-- elles-memes l'entite, la base et l'autorisation a partir du seul identifiant (le client ne fournit
-- plus librement entity/base). Une entite inexistante ou un appelant sans acces -> AUCUNE ligne
-- (best-effort, jamais d'erreur). La generique est revoquee. Migration ADDITIVE.
-- =============================================================================

-- Lecture d'identite (fiche patient) : derive la base du patient, exige can_view_identity.
create or replace function public.log_identity_read(p_patient_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_base uuid;
begin
  if auth.uid() is null then return; end if;
  select base_id into v_base from public.patient where id = p_patient_id and deleted_at is null;
  if v_base is null or not public.can_view_identity(v_base) then return; end if;
  insert into public.audit_log (user_id, action, entity, entity_id, base_id, metadata)
  values (auth.uid(), 'identity_read', 'patient', p_patient_id, v_base, '{}'::jsonb);
end $$;
grant execute on function public.log_identity_read(uuid) to authenticated;

-- Lecture d'une image clinique : derive la base via le patient, exige can_view_identity.
create or replace function public.log_attachment_read(p_attachment_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_base uuid;
begin
  if auth.uid() is null then return; end if;
  select public.base_of_patient(ca.patient_id) into v_base
  from public.clinical_attachment ca where ca.id = p_attachment_id and ca.deleted_at is null;
  if v_base is null or not public.can_view_identity(v_base) then return; end if;
  insert into public.audit_log (user_id, action, entity, entity_id, base_id, metadata)
  values (auth.uid(), 'attachment_read', 'attachment', p_attachment_id, v_base, '{}'::jsonb);
end $$;
grant execute on function public.log_attachment_read(uuid) to authenticated;

-- Lecture d'un document du pool : derive base + soumission, exige proprietaire OU curateur AFFECTE.
create or replace function public.log_raw_document_read(p_document_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_base uuid; v_sub uuid;
begin
  if auth.uid() is null then return; end if;
  select rd.base_id, rd.submission_id into v_base, v_sub
  from public.raw_document rd where rd.id = p_document_id and rd.deleted_at is null;
  if v_base is null then return; end if;
  if not (public.is_base_owner(v_base) or public.is_assigned_to_submission(v_sub)) then return; end if;
  insert into public.audit_log (user_id, action, entity, entity_id, base_id, metadata)
  values (auth.uid(), 'raw_document_read', 'raw_document', p_document_id, v_base, '{}'::jsonb);
end $$;
grant execute on function public.log_raw_document_read(uuid) to authenticated;

-- Lecture d'un export : derive la base via la cohorte, exige l'acces a la base.
create or replace function public.log_export_read(p_export_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_base uuid;
begin
  if auth.uid() is null then return; end if;
  select c.base_id into v_base
  from public.export_log e join public.cohort c on c.id = e.cohort_id where e.id = p_export_id;
  if v_base is null or not public.has_base_access(v_base) then return; end if;
  insert into public.audit_log (user_id, action, entity, entity_id, base_id, metadata)
  values (auth.uid(), 'export_read', 'export', p_export_id, v_base, '{}'::jsonb);
end $$;
grant execute on function public.log_export_read(uuid) to authenticated;

-- La fonction generique n'est plus appelable par un utilisateur (entity/base fournis librement).
revoke execute on function public.log_sensitive_read(text, text, uuid, uuid) from public, authenticated;
