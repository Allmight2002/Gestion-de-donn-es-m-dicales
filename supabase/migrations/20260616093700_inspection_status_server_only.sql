-- =============================================================================
-- 20260616093700_inspection_status_server_only.sql  (audit v10 §4.2)
-- Le verdict d'inspection SERVEUR ('accepted' / 'quarantined') doit etre reserve au contexte
-- serveur (scanner / future Edge inspect-upload). La RLS d'UPDATE (ca_update / rd_update) laissait
-- un utilisateur authentifie s'auto-attribuer le statut : `update clinical_attachment set
-- inspection_status='accepted'` reussissait. On ferme cette voie par un trigger : un utilisateur
-- (auth.uid() non null) ne peut poser/atteindre QUE 'pending' ou 'accepted_client'. Seul le contexte
-- serveur (service_role / Edge, auth.uid() null ; ou une RPC interne) peut passer a
-- 'accepted' / 'quarantined'. Migration ADDITIVE.
-- =============================================================================
create or replace function public.guard_inspection_status()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if auth.uid() is not null
     and new.inspection_status in ('accepted','quarantined')
     and (TG_OP = 'INSERT' or new.inspection_status is distinct from old.inspection_status) then
    raise exception 'Statut d''inspection « % » reserve au serveur (scanner) ; cote client : pending / accepted_client', new.inspection_status;
  end if;
  return new;
end $$;

drop trigger if exists trg_ca_inspection_guard on public.clinical_attachment;
create trigger trg_ca_inspection_guard before insert or update on public.clinical_attachment
  for each row execute function public.guard_inspection_status();

drop trigger if exists trg_rd_inspection_guard on public.raw_document;
create trigger trg_rd_inspection_guard before insert or update on public.raw_document
  for each row execute function public.guard_inspection_status();
