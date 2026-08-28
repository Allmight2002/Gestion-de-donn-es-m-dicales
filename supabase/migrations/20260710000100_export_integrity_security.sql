-- Exports conserves : seule l'Edge Function (service_role) peut produire octets et trace.
-- Les anciens objets/tickets restent intacts pour lecture signee et nettoyage eventuel.

drop policy if exists el_insert on public.export_log;
create policy el_insert on public.export_log for insert to authenticated with check (false);

create or replace function public.upload_ticket_authorized(p_base_id uuid, p_bucket text)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select case p_bucket
    when 'clinical-attachments' then public.can_write_identity(p_base_id)
    when 'raw-documents' then public.is_base_owner(p_base_id)
    -- Les exports sont produits et televerses par service_role dans generate-export.
    when 'scientific-exports' then false
    else false
  end
$$;
revoke all on function public.upload_ticket_authorized(uuid, text) from public, anon, authenticated;

-- Le schema storage n'est pas present dans le harness PostgreSQL; en production cette
-- suppression retire la derniere voie JWT vers les octets d'export conserves.
do $$ begin
  if to_regclass('storage.objects') is not null then
    execute 'drop policy if exists scientific_exports_insert on storage.objects';
  end if;
end $$;

-- Une insertion service_role n'a pas de JWT : l'audit doit alors garder l'auteur
-- authentifie transmis par l'Edge Function dans exported_by.
create or replace function public.trg_audit_export_fn()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.audit_log (user_id, action, entity, entity_id, base_id, metadata)
  values (coalesce(auth.uid(), new.exported_by), 'export_created', 'export_log', new.id,
    public.base_of_cohort(new.cohort_id),
    jsonb_build_object('cohort_id', new.cohort_id, 'format', new.format,
                       'patient_count', new.patient_count, 'encounter_count', new.encounter_count));
  return new;
end $$;
revoke all on function public.trg_audit_export_fn() from public, anon, authenticated;
