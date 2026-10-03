-- signed-read checks the caller through RLS, then reads the patient's base and
-- writes an audit event with its server client before issuing a Storage URL.
-- BYPASSRLS does not grant SQL privileges. Keep server access column-scoped;
-- no anonymous or authenticated privilege is added here.
grant select (id, base_id) on table public.patient to service_role;
grant insert (user_id, action, entity, entity_id, base_id)
  on table public.audit_log to service_role;
