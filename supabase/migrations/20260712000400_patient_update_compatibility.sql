-- Backend-first compatibility window for PWA bundles that still call the
-- former four-argument update_patient signature. It must never overwrite a
-- patient without an optimistic-lock version.

create or replace function public.update_patient(
  p_patient_id uuid,
  p_data jsonb,
  p_validation_status text,
  p_reason text
) returns public.patient
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  raise exception 'CLIENT_UPDATE_REQUIRED: cette version de l application ne peut plus modifier un patient; rechargez-la'
    using errcode = 'P0001';
end $$;
revoke all on function public.update_patient(uuid, jsonb, text, text) from public, anon;
grant execute on function public.update_patient(uuid, jsonb, text, text) to authenticated;

comment on function public.update_patient(uuid, jsonb, text, text) is
  'Wrapper de compatibilite en echec ferme. Retrait apres deux cycles de release et extinction des bundles PWA anterieurs a 0.1.0.';
