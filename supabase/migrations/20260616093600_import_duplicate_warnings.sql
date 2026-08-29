-- =============================================================================
-- 20260616093600_import_duplicate_warnings.sql  (audit v9 P1 §7.6)
-- Doublons probables ENTRE FICHIERS distincts : deux fichiers peuvent contenir la meme rencontre
-- (meme patient / date / type) et creer deux lignes. Une unicite clinique absolue serait fausse
-- (deux rencontres peuvent legitimement coincider). Le bon comportement = DETECTION DE SIMILARITE
-- -> AVERTISSEMENT -> DECISION HUMAINE. Cette RPC (lecture seule) signale, a l'apercu, les lignes
-- dont la rencontre RESSEMBLE a une rencontre DEJA enregistree dans la base. Elle ne bloque rien.
-- Migration ADDITIVE.
-- =============================================================================
create or replace function public.detect_import_duplicates(p_base_id uuid, p_rows jsonb)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r        jsonb;
  idx      int := 0;
  v_code   text;
  v_enc    jsonb;
  v_date   date;
  v_type   text;
  warnings jsonb := '[]'::jsonb;
begin
  if auth.uid() is null then raise exception 'Authentification requise'; end if;
  if not public.can_edit_structured_data(p_base_id) then raise exception 'Acces refuse'; end if;

  for r in select value from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    idx := idx + 1;
    begin
      v_code := nullif(btrim(r ->> 'patient_code'), '');
      v_enc  := r -> 'encounter';
      if v_code is null or v_enc is null or jsonb_typeof(v_enc) <> 'object'
         or coalesce(v_enc ->> 'encounter_date', '') = '' then
        continue; -- pas de rencontre datee -> rien a comparer
      end if;
      v_date := (v_enc ->> 'encounter_date')::date;       -- peut lever si date invalide -> ligne ignoree
      v_type := coalesce(v_enc ->> 'encounter_type', 'autre');

      -- Rencontre DEJA presente pour ce patient, ce jour, ce type ? -> doublon probable (avertissement).
      if exists (
        select 1
        from public.encounter e
        join public.patient p on p.id = e.patient_id
        where p.base_id = p_base_id and p.patient_code = v_code and p.deleted_at is null
          and e.deleted_at is null and e.encounter_date = v_date and e.encounter_type = v_type
      ) then
        warnings := warnings || jsonb_build_object(
          'row', idx, 'patient_code', v_code, 'encounter_date', to_char(v_date, 'YYYY-MM-DD'), 'encounter_type', v_type
        );
      end if;
    exception when others then
      continue; -- ligne illisible (ex. date invalide) : pas d'avertissement (elle echouera a l'import)
    end;
  end loop;

  return jsonb_build_object('count', jsonb_array_length(warnings), 'warnings', warnings);
end $$;
grant execute on function public.detect_import_duplicates(uuid, jsonb) to authenticated;
