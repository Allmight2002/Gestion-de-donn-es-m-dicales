-- =============================================================================
-- 20260616093800_no_unknown_fields_all_statuses.sql  (audit v10 §4.5)
-- Les cles JSON ETRANGERES au gabarit n'etaient refusees qu'au passage en `curated`
-- (assert_no_unknown_fields dans le trigger, branche curated uniquement). Une donnee `draft` ou
-- `complete` pouvait donc etre polluee par des cles hors dictionnaire (ex. {"unknown_secret":"x"}),
-- car assert_data_valid ne valide que les champs CONNUS (bornes/types) sans rejeter les inconnues.
-- On etend le controle des cles inconnues a TOUS les statuts. La COMPLETUDE des champs requis et
-- les regles `block` restent, elles, exigees uniquement en `curated`. Migration ADDITIVE.
-- =============================================================================
create or replace function public.assert_curated_complete()
returns trigger language plpgsql set search_path = public, pg_temp as $$
declare v_scope text := case when tg_table_name = 'patient' then 'patient' else 'encounter' end;
begin
  -- §4.5 : aucune cle inconnue du gabarit, QUEL QUE SOIT le statut (draft / complete / curated).
  perform public.assert_no_unknown_fields(new.template_version_id, v_scope, new.data);

  -- Validation complete (bornes/types deja portees par les RPC ; ici en defense) + completude +
  -- regles : uniquement a la FINALISATION (curated).
  if new.validation_status = 'curated' then
    perform public.assert_data_valid(new.template_version_id, v_scope, new.data);
    if v_scope = 'patient' then
      perform public.assert_required_complete(new.template_version_id, 'patient', new.data);
    else
      perform public.assert_required_complete(new.template_version_id, 'encounter', new.data, new.encounter_type);
    end if;
    perform public.assert_validation_rules(new.template_version_id, new.data);
  end if;
  return new;
end $$;
