-- =============================================================================
-- 20260616091800_import.sql
-- Importation par lots de patients + rencontres (1 element de p_rows = 1 RENCONTRE ; les
-- colonnes "patient" se repetent pour un meme patient_code). La RPC :
--   * eclate IDENTITE (nom / date de naissance -> zone restreinte) et ANALYTIQUE (donnees
--     structurees -> patient / encounter), conformement au cloisonnement ;
--   * calcule l'AGE depuis la date de naissance (lue en interne, jamais renvoyee) ;
--   * re-valide cote SERVEUR (bornes / listes / type via assert_data_valid ; completude des
--     champs requis si import en 'curated') ;
--   * ecrit (ou, en p_dry_run, ne fait que valider pour l'apercu) ;
--   * renvoie un RAPPORT ligne par ligne (cree / mis a jour / erreurs).
--
-- L'identite n'est ecrite que si l'utilisateur a la permission (can_write_identity) ET que
-- des colonnes d'identite sont fournies. Un patient existant (meme patient_code, non
-- supprime) est COMPLETE (fusion des donnees permanentes) ; les rencontres sont ajoutees.
--
-- Forme de p_rows :
--   [ { "patient_code": "NCH-001",
--       "identity": { "full_name": "...", "date_of_birth": "1980-01-01" } | null,
--       "patient_data": { "<field_key>": <val>, ... },
--       "encounter": { "encounter_type": "consultation", "encounter_date": "2024-01-05",
--                      "data": { "<field_key>": <val>, ... } } | null }, ... ]
-- =============================================================================
create or replace function public.import_records(
  p_base_id uuid,
  p_rows    jsonb,
  p_dry_run boolean default true,
  p_status  text default 'draft'
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_tv         uuid;
  r            jsonb;
  idx          int := 0;
  v_code       text;
  v_id         jsonb;
  v_pdata      jsonb;
  v_enc        jsonb;
  v_dob        date;
  v_pid        uuid;
  v_iid        uuid;
  v_existing   uuid;
  v_age        numeric;
  has_identity boolean;
  n_pat_new    int := 0;
  n_pat_upd    int := 0;
  n_enc        int := 0;
  errors       jsonb := '[]'::jsonb;
  seen_codes   text[] := array[]::text[];
begin
  if auth.uid() is null then raise exception 'Authentification requise'; end if;
  if not public.can_edit_structured_data(p_base_id) then raise exception 'Acces refuse'; end if;
  if p_status not in ('draft','complete','curated') then raise exception 'Statut invalide'; end if;
  select current_template_version_id into v_tv from public.base where id = p_base_id;
  if v_tv is null then raise exception 'Base introuvable'; end if;

  for r in select value from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    idx := idx + 1;
    begin
      v_code := nullif(btrim(r ->> 'patient_code'), '');
      if v_code is null then raise exception 'Code patient manquant'; end if;

      v_id := r -> 'identity';
      has_identity := v_id is not null and jsonb_typeof(v_id) = 'object'
                      and (coalesce(v_id ->> 'full_name', '') <> '' or coalesce(v_id ->> 'date_of_birth', '') <> '');
      if has_identity and not public.can_write_identity(p_base_id) then
        raise exception 'Identite presente mais permission manquante (nom / date de naissance)';
      end if;

      v_pdata := coalesce(r -> 'patient_data', '{}'::jsonb);
      v_enc   := r -> 'encounter';

      -- Validation SERVEUR (bornes / listes / type) ; completude si import 'curated'.
      perform public.assert_data_valid(v_tv, 'patient', v_pdata);
      if v_enc is not null and jsonb_typeof(v_enc) = 'object' then
        perform public.assert_data_valid(v_tv, 'encounter', coalesce(v_enc -> 'data', '{}'::jsonb));
      end if;
      if p_status = 'curated' then
        perform public.assert_required_complete(v_tv, 'patient', v_pdata);
        if v_enc is not null and jsonb_typeof(v_enc) = 'object' then
          perform public.assert_required_complete(v_tv, 'encounter', coalesce(v_enc -> 'data', '{}'::jsonb), v_enc ->> 'encounter_type');
        end if;
      end if;

      -- Patient deja present ? (pour le rapport ET le choix insert/merge).
      select id into v_existing from public.patient
       where base_id = p_base_id and patient_code = v_code and deleted_at is null;

      -- Comptage : une fois par patient_code, apres validation reussie.
      if not (v_code = any(seen_codes)) then
        seen_codes := seen_codes || v_code;
        if v_existing is null then n_pat_new := n_pat_new + 1; else n_pat_upd := n_pat_upd + 1; end if;
      end if;
      if v_enc is not null and jsonb_typeof(v_enc) = 'object' then n_enc := n_enc + 1; end if;

      -- Date de naissance : de la ligne si fournie, sinon de l'identite existante.
      if has_identity and coalesce(v_id ->> 'date_of_birth', '') <> '' then
        v_dob := (v_id ->> 'date_of_birth')::date;
      else
        select date_of_birth into v_dob from public.patient_identity
         where base_id = p_base_id and patient_code = v_code and deleted_at is null;
      end if;

      if not p_dry_run then
        -- IDENTITE (zone restreinte) : upsert manuel (index unique partiel sur non-supprimes).
        if has_identity then
          select id into v_iid from public.patient_identity
           where base_id = p_base_id and patient_code = v_code and deleted_at is null;
          if v_iid is null then
            insert into public.patient_identity (base_id, patient_code, full_name, date_of_birth, created_by)
            values (p_base_id, v_code, nullif(v_id ->> 'full_name', ''), nullif(v_id ->> 'date_of_birth', '')::date, auth.uid());
          else
            update public.patient_identity
               set full_name     = coalesce(nullif(v_id ->> 'full_name', ''), full_name),
                   date_of_birth = coalesce(nullif(v_id ->> 'date_of_birth', '')::date, date_of_birth)
             where id = v_iid;
          end if;
        end if;

        -- ANALYTIQUE : patient (insert ou fusion) puis rencontre.
        if v_existing is null then
          insert into public.patient (base_id, patient_code, template_version_id, data, collection_mode, validation_status, created_by)
          values (p_base_id, v_code, v_tv, v_pdata, 'direct', p_status, auth.uid())
          returning id into v_pid;
        else
          update public.patient set data = data || v_pdata, validation_status = p_status, updated_at = now()
           where id = v_existing returning id into v_pid;
        end if;

        if v_enc is not null and jsonb_typeof(v_enc) = 'object' then
          v_age := case
                     when v_dob is not null and coalesce(v_enc ->> 'encounter_date', '') <> ''
                     then public.compute_age(v_dob, (v_enc ->> 'encounter_date')::date, 'years')
                     else null
                   end;
          insert into public.encounter
            (patient_id, template_version_id, encounter_type, encounter_date, age_value, age_unit, data, collection_mode, validation_status, created_by)
          values
            (v_pid, v_tv, coalesce(v_enc ->> 'encounter_type', 'autre'),
             (v_enc ->> 'encounter_date')::date, v_age, case when v_age is not null then 'years' else null end,
             coalesce(v_enc -> 'data', '{}'::jsonb) - 'age_at_encounter', 'direct', p_status, auth.uid());
        end if;
      end if;

    exception when others then
      errors := errors || jsonb_build_object('row', idx, 'patient_code', coalesce(v_code, ''), 'message', sqlerrm);
    end;
  end loop;

  if not p_dry_run then
    -- Journalisation (audit) de l'import.
    perform public.log_audit('data_imported', 'base', p_base_id, p_base_id,
      jsonb_build_object('patients_new', n_pat_new, 'patients_updated', n_pat_upd,
                         'encounters', n_enc, 'status', p_status, 'errors', jsonb_array_length(errors)));
  end if;

  return jsonb_build_object(
    'dry_run', p_dry_run, 'status', p_status,
    'patients_new', n_pat_new, 'patients_updated', n_pat_upd, 'encounters', n_enc,
    'error_count', jsonb_array_length(errors), 'errors', errors
  );
end $$;

grant execute on function public.import_records(uuid, jsonb, boolean, text) to authenticated;
