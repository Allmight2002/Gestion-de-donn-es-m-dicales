-- =============================================================================
-- 20260616092200_encounter_optimistic_lock.sql  (v3.0)
-- Hors-ligne §13 (Phases 2/3) : verrou optimiste sur la correction d'une rencontre.
-- Quand une modification preparee HORS-LIGNE est synchronisee, on doit refuser de
-- l'appliquer si la rencontre a change cote serveur entre-temps (sinon on ecraserait
-- silencieusement une autre correction). On ajoute un parametre OPTIONNEL
-- p_expected_updated_at : si fourni et != updated_at courant -> exception CONFLIT_VERSION.
-- La synchronisation passe ainsi par la MEME RPC validee (aucune voie d'ecriture parallele).
-- Migration NOUVELLE (ne modifie pas d'ancien fichier).
-- =============================================================================

-- On remplace la signature 4-arg par une 5-arg (5e parametre a defaut) : les appels
-- positionnels a 4 arguments restent valides (le defaut comble le 5e).
drop function if exists public.update_encounter(uuid, jsonb, text, text);

create or replace function public.update_encounter(
  p_encounter_id      uuid,
  p_data              jsonb,
  p_validation_status text,
  p_reason            text,
  p_expected_updated_at timestamptz default null
) returns public.encounter
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_enc public.encounter; v_base uuid; v_code text; v_dob date; v_age numeric;
  v_old jsonb; v_new jsonb; v_key text;
begin
  select * into v_enc from public.encounter where id = p_encounter_id and deleted_at is null;
  if not found then raise exception 'Rencontre introuvable'; end if;

  select base_id, patient_code into v_base, v_code from public.patient where id = v_enc.patient_id;
  if not public.can_edit_structured_data(v_base) then raise exception 'Acces refuse'; end if;

  -- §13 : verrou optimiste. Si l'appelant indique la version sur laquelle il a travaille
  -- (hors-ligne) et qu'elle ne correspond plus a la version serveur -> conflit a resoudre.
  -- Comparaison a la milliseconde : les pilotes (node-pg vs supabase-js) n'exposent pas la
  -- meme precision (ms vs us) ; tronquer des deux cotes evite les faux conflits.
  if p_expected_updated_at is not null
     and date_trunc('milliseconds', v_enc.updated_at) is distinct from date_trunc('milliseconds', p_expected_updated_at) then
    raise exception 'CONFLIT_VERSION : la rencontre a ete modifiee entre-temps' using errcode = 'P0001';
  end if;

  -- Re-validation SERVEUR (§5.4/§5.5) : bornes / listes / type.
  perform public.assert_data_valid(v_enc.template_version_id, 'encounter', coalesce(p_data, '{}'::jsonb) - 'age_at_encounter');

  select date_of_birth into v_dob
  from public.patient_identity where base_id = v_base and patient_code = v_code and deleted_at is null;
  v_age := public.compute_age(v_dob, v_enc.encounter_date, coalesce(v_enc.age_unit, 'years'));

  v_old := v_enc.data;
  v_new := coalesce(p_data, '{}'::jsonb) - 'age_at_encounter';

  for v_key in
    select key from (
      select jsonb_object_keys(v_old) as key
      union
      select jsonb_object_keys(v_new) as key
    ) keys
  loop
    if (v_old -> v_key) is distinct from (v_new -> v_key) then
      insert into public.field_change_log
        (base_id, entity, entity_id, field_key, old_value, new_value, changed_by, reason, source)
      values
        (v_base, 'encounter', p_encounter_id, v_key, v_old -> v_key, v_new -> v_key, auth.uid(), p_reason, 'manual_correction');
    end if;
  end loop;

  update public.encounter
  set data = v_new,
      validation_status = coalesce(p_validation_status, v_enc.validation_status),
      age_value = v_age,
      updated_at = now()
  where id = p_encounter_id
  returning * into v_enc;

  return v_enc;
end $$;

grant execute on function public.update_encounter(uuid, jsonb, text, text, timestamptz) to authenticated;
