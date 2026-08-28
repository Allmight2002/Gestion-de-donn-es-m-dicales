-- =============================================================================
-- 20260616091500_audit.sql  (v3.0)
-- Audit renforce (§14) : trace AUTOMATIQUE et inalterable des actions sensibles dans
-- audit_log (ajout seul ; lecture ciblee proprietaire/admin, deja en place en RLS).
-- Les triggers sont SECURITY DEFINER -> la trace ne peut pas etre contournee cote
-- application. La curation journalise deja via ses RPC (validate/reject).
-- =============================================================================

create or replace function public.log_audit(p_action text, p_entity text, p_entity_id uuid, p_base_id uuid, p_metadata jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.audit_log (user_id, action, entity, entity_id, base_id, metadata)
  values (auth.uid(), p_action, p_entity, p_entity_id, p_base_id, p_metadata);
end $$;
grant execute on function public.log_audit(text, text, uuid, uuid, jsonb) to authenticated;

-- Export genere -> trace (qui, quelle cohorte, volumes). ------------------------------
create or replace function public.trg_audit_export_fn()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.log_audit('export_created', 'export_log', new.id, public.base_of_cohort(new.cohort_id),
    jsonb_build_object('cohort_id', new.cohort_id, 'format', new.format,
                       'patient_count', new.patient_count, 'encounter_count', new.encounter_count));
  return new;
end $$;
create trigger trg_audit_export after insert on public.export_log
  for each row execute function public.trg_audit_export_fn();

-- Acces accorde / modifie / revoque -> trace. ----------------------------------------
create or replace function public.trg_audit_access_fn()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' then
    perform public.log_audit('access_granted', 'base_access', new.id, new.base_id,
      jsonb_build_object('user_id', new.user_id, 'access_role', new.access_role));
  elsif new.revoked_at is not null and old.revoked_at is null then
    perform public.log_audit('access_revoked', 'base_access', new.id, new.base_id,
      jsonb_build_object('user_id', new.user_id));
  else
    perform public.log_audit('access_changed', 'base_access', new.id, new.base_id,
      jsonb_build_object('user_id', new.user_id, 'access_role', new.access_role));
  end if;
  return new;
end $$;
create trigger trg_audit_access after insert or update on public.base_access
  for each row execute function public.trg_audit_access_fn();

-- Invitation creee -> trace. ----------------------------------------------------------
create or replace function public.trg_audit_invitation_fn()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.log_audit('invitation_created', 'base_invitation', new.id, new.base_id,
    jsonb_build_object('invited_email', new.invited_email, 'access_role', new.access_role));
  return new;
end $$;
create trigger trg_audit_invitation after insert on public.base_invitation
  for each row execute function public.trg_audit_invitation_fn();

-- Gabarit publie -> trace (base_id NULL : action du gestionnaire de gabarits). --------
create or replace function public.trg_audit_template_publish_fn()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.status = 'published' and old.status is distinct from 'published' then
    perform public.log_audit('template_published', 'template_version', new.id, null,
      jsonb_build_object('template_id', new.template_id, 'version_number', new.version_number));
  end if;
  return new;
end $$;
create trigger trg_audit_template_publish after update on public.template_version
  for each row execute function public.trg_audit_template_publish_fn();

-- =============================================================================
-- §7.1 — Tracage des LECTURES sensibles. Une lecture (consultation d'identite, ouverture
-- d'un document brut, etc.) ne peut pas etre tracee par trigger ; l'UI appelle donc cette
-- RPC au moment de reveler la donnee. Garde-fous : action whitelistee, et l'appelant doit
-- avoir un lien LEGITIME avec la base (proprietaire, acces partage, ou staff de curation) —
-- sinon on ignore silencieusement (pas d'erreur, pas de bruit dans le journal).
-- =============================================================================
create or replace function public.log_sensitive_read(p_action text, p_entity text, p_entity_id uuid, p_base_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then return; end if;
  if p_action not in ('identity_read','raw_document_read','attachment_read','export_read') then
    raise exception 'Action de lecture invalide: %', p_action;
  end if;
  if not (public.is_base_owner(p_base_id) or public.has_base_access(p_base_id) or public.is_curation_staff()) then
    return;
  end if;
  insert into public.audit_log (user_id, action, entity, entity_id, base_id, metadata)
  values (auth.uid(), p_action, p_entity, p_entity_id, p_base_id, '{}'::jsonb);
end $$;
grant execute on function public.log_sensitive_read(text, text, uuid, uuid) to authenticated;
