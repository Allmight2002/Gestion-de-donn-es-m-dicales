-- =============================================================================
-- 20260616093300_rpc_only_writes_complete.sql  (audit v9 §5.1 / §5.2 / §5.3 / §5.4)
-- L'audit precedent avait retire les UPDATE directs ; il restait des INSERT directs et la
-- fonction d'audit generique. On termine le principe "ecritures cliniques par RPC seulement".
--   §5.1 : retrait des INSERT directs sur patient / encounter / patient_identity. Toute creation
--          passe par create_patient / create_encounter / import_records / finalize_curation_task
--          (SECURITY DEFINER : created_by=auth.uid(), version coherente, validation, pas de cle
--          inconnue). Le frontend ne fait deja que des RPC.
--   §5.2 : revocation de log_audit(...) a `authenticated` -> un utilisateur ne peut plus
--          fabriquer un evenement d'audit arbitraire. Les fonctions internes (definer) gardent
--          l'acces (elles s'executent en tant que proprietaire).
--   §5.3 : la RPC update_template_field/delete_template_field protege les variables, mais la RLS
--          tf_write laissait modifier/supprimer DIRECTEMENT un champ. On ajoute des TRIGGERS de
--          table (memes gardes) -> la voie directe est fermee aussi. (validation_rule est deja
--          protege par triggers depuis 093100.)
--   §5.4 : retrait des INSERT directs sur raw_submission / curation_task -> le workflow de
--          curation passe uniquement par create_curation_submission + submit_curation_request
--          (qui exige >= 1 document), plus de tache 'open' sans document fabriquee a la main.
-- Migration ADDITIVE.
-- =============================================================================

-- §5.1 : creation clinique par RPC uniquement.
-- create_encounter est DEJA security definer + controle d'acces -> OK. create_patient etait
-- security INVOKER (il s'appuyait sur la RLS d'insertion) : on le passe en DEFINER avec une
-- AUTORISATION EXPLICITE (sinon retirer p_insert/pi_insert casserait la creation legitime).
create or replace function public.create_patient(
  p_base_id             uuid,
  p_patient_code        text,
  p_full_name           text,
  p_date_of_birth       date,
  p_phone               text,
  p_address             text,
  p_external_identifier text,
  p_permanent_data      jsonb
) returns public.patient
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_tv uuid; v_patient public.patient;
begin
  if p_patient_code is null or btrim(p_patient_code) = '' then raise exception 'Code patient requis'; end if;
  -- Autorisation EXPLICITE (la fonction est DEFINER : elle ne s'appuie plus sur la RLS).
  if not public.can_edit_structured_data(p_base_id) then raise exception 'Acces refuse'; end if;
  if not public.can_write_identity(p_base_id) then raise exception 'Acces identite requis pour creer un patient'; end if;

  select current_template_version_id into v_tv from public.base where id = p_base_id;
  if v_tv is null then raise exception 'La base n''a pas de version de gabarit courante'; end if;

  perform public.assert_data_valid(v_tv, 'patient', coalesce(p_permanent_data, '{}'::jsonb));

  insert into public.patient_identity
    (base_id, patient_code, full_name, date_of_birth, phone, address, external_identifier, created_by)
  values
    (p_base_id, btrim(p_patient_code), p_full_name, p_date_of_birth, p_phone, p_address, p_external_identifier, auth.uid());

  insert into public.patient
    (base_id, patient_code, template_version_id, data, collection_mode, validation_status, created_by)
  values
    (p_base_id, btrim(p_patient_code), v_tv, coalesce(p_permanent_data, '{}'::jsonb), 'direct', 'draft', auth.uid())
  returning * into v_patient;

  return v_patient;
end $$;

drop policy if exists p_insert  on public.patient;
drop policy if exists e_insert  on public.encounter;
drop policy if exists pi_insert on public.patient_identity;

-- §5.4 : workflow de curation par RPC uniquement (creation).
drop policy if exists rs_insert on public.raw_submission;
drop policy if exists ct_insert on public.curation_task;

-- §5.2 : journal d'audit non falsifiable -> l'utilisateur ne peut plus appeler log_audit.
-- NB : une fonction est executable par PUBLIC par defaut -> il faut revoquer de PUBLIC aussi
-- (sinon `authenticated` garde l'acces via PUBLIC). Les fonctions DEFINER internes (proprietaire
-- postgres) gardent l'acces et continuent d'appeler log_audit.
revoke execute on function public.log_audit(text, text, uuid, uuid, jsonb) from public, authenticated;

-- §5.3 : gardes de table sur template_field (memes regles que les RPC), pour fermer la voie directe.
create or replace function public.guard_template_field_update()
returns trigger language plpgsql set search_path = public, pg_temp as $$
declare semantic boolean;
begin
  -- Changement SEMANTIQUE (altere le sens/la validation d'une variable) interdit si elle est utilisee.
  semantic := (new.field_key is distinct from old.field_key)
           or (new.type      is distinct from old.type)
           or (new.scope     is distinct from old.scope)
           or (new.required  is distinct from old.required)
           or (new.encounter_types is distinct from old.encounter_types)
           or (coalesce(new.allowed_values, 'null'::jsonb) is distinct from coalesce(old.allowed_values, 'null'::jsonb))
           or (new.min_value is distinct from old.min_value)
           or (new.max_value is distinct from old.max_value)
           or (new.allow_missing_codes is distinct from old.allow_missing_codes);
  if semantic and public.template_field_in_use(old.id) then
    raise exception 'Variable deja utilisee : seuls le libelle, la section et l''unite sont modifiables. Pour changer son comportement, creez une nouvelle version du gabarit.';
  end if;
  return new;
end $$;
create trigger trg_tf_update
  before update on public.template_field
  for each row execute function public.guard_template_field_update();

create or replace function public.guard_template_field_delete()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if public.template_field_in_use(old.id) then
    raise exception 'Variable deja utilisee : suppression impossible. Creez une nouvelle version du gabarit pour la retirer.';
  end if;
  return old;
end $$;
create trigger trg_tf_delete
  before delete on public.template_field
  for each row execute function public.guard_template_field_delete();
