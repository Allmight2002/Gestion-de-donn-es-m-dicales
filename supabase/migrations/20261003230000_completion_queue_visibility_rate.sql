-- =============================================================================
-- 20261003230000_completion_queue_visibility_rate.sql
--
-- 1. File « A completer » (`base_completion_queue_page`) et compteur `incomplete` de
--    `my_todo_counts` : une seule definition, `record_completion_summary`.
--    a. Visibilite conditionnelle : une variable masquee par une regle `visible` (champ ou
--       bloc, cascade comprise) n'est ni reclamee ni comptee. Avant ce lot, la file
--       reclamait une variable obligatoire masquee, que le formulaire ne montre pas et que
--       `missing_required_fields` n'exige pas : le dossier restait dans la file sans
--       aucun moyen d'en sortir.
--    b. Occurrence de groupe repetable : memes variables que `missing_required_fields`
--       (celles du groupe pour une occurrence, hors groupes pour une rencontre ordinaire).
--    c. Taux de completion : un dossier non finalise entre aussi dans la file quand moins
--       de 75 % des variables AFFICHEES sont documentees. Variables affichees = celles de
--       la version du dossier, de sa portee, applicables a son type de rencontre ou a son
--       groupe, non calculees (rien n'y est saisi) et non masquees par la visibilite
--       conditionnelle. Documentee = meme sens que la file : valeur presente ou donnee
--       manquante codee (`non_fait`, `inconnu`, `non_applicable`).
--
-- 2. Suivi des diagnostics (`diagnosis_followup`) : la page depassait le delai serveur.
--    `rule_apply_op('contains_any', valeur, codes reconnus)` revalidait a CHAQUE dossier la
--    liste entiere des codes reconnus (toute la publication terminologique : unicite par
--    tri, chaines vides). Mesure locale, 40 000 codes : ~100 ms par dossier, 300 dossiers =
--    29 s. La file calcule maintenant une fois par version la validite de la liste, reduit
--    la liste aux codes reellement saisis, calcule une fois par code les blocs associes et
--    n'evalue la couverture qu'une fois par dossier. Meme mesure : 6 000 dossiers ~2 s,
--    dont ~0,9 s pour `get_diagnosis_context` (inchange). `rule_apply_op` est decoupe en
--    deux fonctions sans changer son resultat, pour que la file et l'operateur partagent
--    le meme code.
--
-- Migration ADDITIVE : aucune table, aucune donnee, aucune signature existante ne change.
-- Les cles ajoutees aux reponses JSON (`filledFields`, `displayedFields`) sont ignorees par
-- les anciens clients. Fonctions SECURITY INVOKER : la RLS de l'appelant s'applique.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Operateur contains_any, en deux moities reutilisables
-- -----------------------------------------------------------------------------

-- Moitie « cible » : la liste de codes recherches est-elle exploitable ? (non vide, que
-- des chaines non blanches, sans doublon). Ne depend pas du dossier.
create or replace function public.rule_contains_any_target_valid(b jsonb)
returns boolean language plpgsql immutable set search_path = public, pg_temp as $$
begin
  if jsonb_typeof(b) is distinct from 'array' then return false; end if;
  if jsonb_array_length(b) = 0 then return false; end if;
  if exists (select 1 from jsonb_array_elements(b) e
    where jsonb_typeof(e) <> 'string' or btrim(e #>> '{}', U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF') = '') then return false; end if;
  if (select count(distinct e) from jsonb_array_elements(b) e) <> jsonb_array_length(b) then return false; end if;
  return true;
end $$;

-- Moitie « valeur » : la valeur saisie a-t-elle une forme valide et contient-elle au moins
-- un code de `b` ? Suppose `b` deja valide (cf. `rule_contains_any_target_valid`).
create or replace function public.rule_contains_any_hit(a jsonb, b jsonb)
returns boolean language plpgsql immutable set search_path = public, pg_temp as $$
declare vals jsonb; el jsonb; code text; codes text[] := '{}'; kind text; hit boolean := false;
begin
  if a is null or jsonb_typeof(a) = 'null' then return false; end if;
  vals := case when jsonb_typeof(a) = 'array' then a else jsonb_build_array(a) end;
  if jsonb_array_length(vals) = 0 then return false; end if;
  kind := jsonb_typeof(vals -> 0);
  if kind not in ('string', 'object') then return false; end if;
  if kind = 'object' and jsonb_array_length(vals) > 50 then return false; end if;
  for el in select value from jsonb_array_elements(vals) loop
    if jsonb_typeof(el) is distinct from kind then return false; end if;
    if kind = 'object' then
      if exists (select 1 from jsonb_object_keys(el) k where k not in ('code', 'label', 'raw', 'coding')) then return false; end if;
      -- Texte non code : aucun code a comparer, l'entree est sautee.
      if not (el ? 'code') and not (el ? 'label')
         and jsonb_typeof(el -> 'raw') = 'string'
         and btrim(el ->> 'raw', U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF') <> ''
         and jsonb_typeof(el -> 'coding') = 'object'
         and (el -> 'coding' ->> 'status') = 'unmatched' then
        continue;
      end if;
      if jsonb_typeof(el -> 'code') is distinct from 'string'
        or jsonb_typeof(el -> 'label') is distinct from 'string' then return false; end if;
      if btrim(el ->> 'label', U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF') = '' then return false; end if;
      code := el ->> 'code';
      if code = any(codes) then return false; end if;
    else
      code := el #>> '{}';
    end if;
    if btrim(code, U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF') = '' then return false; end if;
    codes := array_append(codes, code);
    hit := hit or b @> jsonb_build_array(code);
  end loop;
  return hit;
end $$;

-- Copie de 20261001090000 ; seule la branche contains_any delegue aux deux moities
-- ci-dessus, dans le meme ordre (cible d'abord), donc avec le meme resultat.
create or replace function public.rule_apply_op(op text, a jsonb, b jsonb)
returns boolean language plpgsql immutable set search_path = public, pg_temp as $$
declare ta text := a #>> '{}'; c int;
begin
  if op = 'contains_any' then
    if not public.rule_contains_any_target_valid(b) then return false; end if;
    return public.rule_contains_any_hit(a, b);
  elsif op = 'equals' then
    return coalesce(ta,'') = coalesce(b #>> '{}','');
  elsif op = 'not_equals' then
    return coalesce(ta,'') <> coalesce(b #>> '{}','');
  elsif op = 'in' then
    return jsonb_typeof(b) = 'array'
       and exists (select 1 from jsonb_array_elements_text(b) e where e = ta);
  else
    c := public.rule_cmp(a, b);
    if c is null then return false; end if;
    return case op
             when 'greater_than'     then c > 0
             when 'greater_or_equal' then c >= 0
             when 'less_than'        then c < 0
             when 'less_or_equal'    then c <= 0
             else false
           end;
  end if;
end $$;

revoke all on function public.rule_contains_any_target_valid(jsonb) from public, anon;
grant execute on function public.rule_contains_any_target_valid(jsonb) to authenticated;
revoke all on function public.rule_contains_any_hit(jsonb, jsonb) from public, anon;
grant execute on function public.rule_contains_any_hit(jsonb, jsonb) to authenticated;

-- -----------------------------------------------------------------------------
-- 2. Couverture diagnostique : validite des codes reconnus calculee une fois
-- -----------------------------------------------------------------------------
-- Blocs associes a un code : ne depend que de la version, de la portee et du code. Corps
-- extrait tel quel de `diagnosis_coverage_in_context` pour etre calcule une fois par code.
create or replace function public.diagnosis_code_blocks(
  p_version_id uuid, p_scope text, p_field_key text, p_release jsonb, p_item jsonb
)
returns jsonb language sql stable security invoker set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(b.key order by b.key), '[]') from (
    select distinct rule -> 'then' ->> 'section' as key from public.validation_rule r
    where r.template_version_id = p_version_id and rule -> 'if' ->> 'field' = p_field_key
      and rule -> 'if' ->> 'operator' = 'contains_any' and rule -> 'then' ->> 'operator' = 'visible'
      and rule -> 'then' ? 'section' and rule -> 'if' -> 'value' @> jsonb_build_array(p_item)
      and coalesce(rule -> 'if' -> 'terminologyReleaseId','null'::jsonb) = p_release
      and exists (select 1 from public.template_section_field_keys(p_version_id,rule -> 'then' ->> 'section') k
        join public.template_field t on t.template_version_id = p_version_id and t.field_key = k.field_key
        where t.scope = p_scope and t.formula is null)
  ) b;
$$;
revoke all on function public.diagnosis_code_blocks(uuid, text, text, jsonb, jsonb) from public, anon;
grant execute on function public.diagnosis_code_blocks(uuid, text, text, jsonb, jsonb) to authenticated;

-- Copie de 20260906143000. Changements : les codes reconnus sont extraits une fois ; leur
-- validite (`recognizedCodesValid`) et les blocs de chaque code (`blocksByCode`) viennent
-- du contexte quand `diagnosis_followup` les y a calcules une fois par version, sinon ils
-- sont calcules ici, par les memes fonctions.
-- Un contexte forge ne rend toujours qu'un resultat faux A SON AUTEUR (aucune elevation).
create or replace function public.diagnosis_coverage_in_context(
  p_version_id uuid, p_scope text, p_data jsonb, p_context jsonb
)
returns jsonb language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare c jsonb; f public.template_field; codes jsonb := '[]'; val jsonb; item jsonb; code text;
  seen text[] := '{}'; blocks jsonb; status text; items jsonb := '[]';
  counts jsonb := '{"covered":0,"common_only":0,"uncovered":0,"unclassified":0}';
  recognized jsonb; recognized_valid boolean;
begin
  select e into c from jsonb_array_elements(coalesce(p_context, '[]'::jsonb)) e where e ->> 'scope' = p_scope;
  if c is not null then
    select * into f from public.template_field where template_version_id = p_version_id and scope = p_scope
      and field_key = c ->> 'diagnosisFieldKey';
    recognized := c -> 'recognizedCodes';
    val := p_data -> f.field_key;
    if f.type in ('terminology', 'multiselect') then
      recognized_valid := case when jsonb_typeof(c -> 'recognizedCodesValid') = 'boolean'
        then (c -> 'recognizedCodesValid')::boolean
        else public.rule_contains_any_target_valid(recognized) end;
    end if;
    if f.type = 'terminology' then
      if f.is_multiple then
        if jsonb_typeof(val) = 'array' and recognized_valid and public.rule_contains_any_hit(val, recognized) then
          select coalesce(jsonb_agg(e -> 'code'), '[]') into codes from jsonb_array_elements(val) e;
        end if;
      elsif jsonb_typeof(val) = 'object' and recognized_valid and public.rule_contains_any_hit(val, recognized) then codes := jsonb_build_array(val -> 'code'); end if;
    elsif f.type = 'multiselect' then
      if jsonb_typeof(val) = 'array' then
        if recognized_valid and public.rule_contains_any_hit(val, recognized) and jsonb_typeof(val -> 0) = 'string' then codes := val; end if;
      end if;
    elsif jsonb_typeof(val) = 'string' then codes := jsonb_build_array(val); end if;
    for item in select value from jsonb_array_elements(codes) loop
      code := item #>> '{}';
      continue when code = any(seen) or not (recognized @> jsonb_build_array(item));
      seen := array_append(seen, code);
      blocks := case when jsonb_typeof(c -> 'blocksByCode') = 'object' and (c -> 'blocksByCode') ? code
        then c -> 'blocksByCode' -> code
        else public.diagnosis_code_blocks(p_version_id, p_scope, f.field_key, c -> 'terminologyReleaseId', item) end;
      status := case when jsonb_array_length(blocks) > 0 then 'covered'
        when c -> 'commonOnlyCodes' @> jsonb_build_array(item) then 'common_only' else 'uncovered' end;
      items := items || jsonb_build_array(jsonb_build_object('code',code,'status',status,'blockKeys',blocks));
      counts := jsonb_set(counts,array[status],to_jsonb((counts ->> status)::int + 1));
    end loop;
    val := p_data -> (c ->> 'proposalFieldKey');
    if jsonb_typeof(val) = 'string' and btrim(val #>> '{}', U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF') <> '' then
      items := items || '[{"code":null,"status":"unclassified","blockKeys":[]}]'::jsonb;
      counts := jsonb_set(counts,'{unclassified}','1');
    end if;
  end if;
  return jsonb_build_object('versionId',p_version_id,'scope',p_scope,'diagnostics',items,'counts',counts);
end $$;
revoke all on function public.diagnosis_coverage_in_context(uuid,text,jsonb,jsonb) from public, anon;
grant execute on function public.diagnosis_coverage_in_context(uuid,text,jsonb,jsonb) to authenticated;

-- -----------------------------------------------------------------------------
-- 3. File des cas non couverts : copie de 20260906143000, seul le contexte change
-- -----------------------------------------------------------------------------
create or replace function public.diagnosis_followup(
  p_base_id    uuid,
  p_scope      text default null,
  p_version_id uuid default null,
  p_code       text default null,
  p_limit      int  default 50,
  p_offset     int  default 0
)
returns jsonb
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare
  v_current uuid;
  v_result  jsonb;
begin
  if auth.uid() is null then raise exception 'Authentification requise'; end if;
  if p_scope is not null and p_scope not in ('patient','encounter') then
    raise exception 'Portee de suivi inconnue';
  end if;
  select b.current_template_version_id into v_current
    from public.base b
   where b.id = p_base_id and b.deleted_at is null and b.owner_user_id = auth.uid();
  if not found or not public.is_medecin() then
    raise exception 'Reserve au medecin proprietaire de la base';
  end if;

  with params as (
    select greatest(1, least(coalesce(p_limit, 50), 200))::int as lim,
           greatest(0, coalesce(p_offset, 0))::int as off
  ),
  records as (
    select 'patient'::text as scope, 0 as rank, p.id as patient_id, p.patient_code,
           null::uuid as encounter_id, null::text as encounter_type, null::date as encounter_date,
           p.validation_status, p.template_version_id, p.data, p.created_at
      from public.patient p
     where p.base_id = p_base_id and p.deleted_at is null
       and (p_scope is null or p_scope = 'patient')
       and (p_version_id is null or p.template_version_id = p_version_id)
    union all
    select 'encounter', 1, p.id, p.patient_code, e.id, e.encounter_type, e.encounter_date,
           e.validation_status, e.template_version_id, e.data, e.created_at
      from public.encounter e
      join public.patient p on p.id = e.patient_id
     where p.base_id = p_base_id and p.deleted_at is null and e.deleted_at is null
       and (p_scope is null or p_scope = 'encounter')
       and (p_version_id is null or e.template_version_id = p_version_id)
  ),
  -- Contexte ET validite des codes reconnus resolus une fois par version, jamais par dossier.
  checked_versions as materialized (
    select v.id, v.version_number, public.get_diagnosis_context(v.id) as ctx
      from public.template_version v
     where v.diagnosis_configuration <> '[]'::jsonb
       and (v.id = v_current or v.id in (select template_version_id from records))
  ),
  -- Codes effectivement saisis dans les dossiers lus, par portee et variable pilote.
  used_codes as materialized (
    select distinct cfg.scope, cfg.field_key, x.code
      from (select distinct e ->> 'scope' as scope, e ->> 'diagnosisFieldKey' as field_key
              from checked_versions cv, jsonb_array_elements(cv.ctx) e) cfg
      join records r on r.scope = cfg.scope
      cross join lateral (
        select case jsonb_typeof(el) when 'string' then el #>> '{}' when 'object' then el ->> 'code' end as code
          from jsonb_array_elements(case jsonb_typeof(r.data -> cfg.field_key)
                                      when 'array' then r.data -> cfg.field_key
                                      else jsonb_build_array(r.data -> cfg.field_key) end) el
      ) x
     where x.code is not null
  ),
  -- Les codes reconnus sont reduits a ceux reellement saisis. La validite de la liste est
  -- calculee sur la liste COMPLETE et transmise (`recognizedCodesValid`), et les blocs de
  -- chaque code saisi sont calcules une fois (`blocksByCode`) : le resultat de chaque
  -- dossier est inchange, mais rien de proportionnel a la publication n'est refait par
  -- dossier. L'entree est reconstruite cle par cle (`jsonb_each`) : `||` re-deroulerait la
  -- grande liste.
  reduced as materialized (
    select cv.id, cv.version_number, x.n, x.e,
           coalesce((select jsonb_object_agg(kv.key, kv.value) from jsonb_each(x.e) kv
                      where kv.key not in ('recognizedCodes', 'recognizedCodesValid', 'blocksByCode')), '{}'::jsonb)
             as head,
           public.rule_contains_any_target_valid(x.e -> 'recognizedCodes') as recognized_valid,
           case when jsonb_typeof(x.e -> 'recognizedCodes') = 'array' then coalesce((
               select jsonb_agg(rc order by n2)
                 from jsonb_array_elements(x.e -> 'recognizedCodes') with ordinality as y(rc, n2)
                where (rc #>> '{}') in (select u.code from used_codes u
                                         where u.scope = x.e ->> 'scope'
                                           and u.field_key = x.e ->> 'diagnosisFieldKey')),
               '[]'::jsonb)
           end as recognized
      from checked_versions cv
      cross join lateral jsonb_array_elements(cv.ctx) with ordinality as x(e, n)
  ),
  versions as materialized (
    select cv.id, cv.version_number,
           coalesce((select jsonb_agg(r.head || jsonb_build_object(
                       'recognizedCodesValid', r.recognized_valid,
                       'recognizedCodes', coalesce(r.recognized, r.e -> 'recognizedCodes'),
                       'blocksByCode', case when r.recognized is not null then (
                          select coalesce(jsonb_object_agg(code, public.diagnosis_code_blocks(
                                   r.id, r.e ->> 'scope', r.e ->> 'diagnosisFieldKey',
                                   r.e -> 'terminologyReleaseId', to_jsonb(code))), '{}'::jsonb)
                            from jsonb_array_elements_text(r.recognized) as z(code)) end)
                     order by r.n)
                       from reduced r where r.id = cv.id), '[]'::jsonb) as ctx
      from checked_versions cv
  ),
  -- Materialise : sinon le planificateur recopie l'appel dans chaque expression qui lit
  -- `cov`, et la couverture de chaque dossier est calculee plusieurs fois.
  covered as materialized (
    select r.*, v.version_number as source_version_number,
           public.diagnosis_coverage_in_context(r.template_version_id, r.scope, r.data, v.ctx) as cov
      from records r
      join versions v on v.id = r.template_version_id
  ),
  flagged as (
    select x.*,
           coalesce((select jsonb_agg(d ->> 'code' order by d ->> 'code')
                       from jsonb_array_elements(x.cov -> 'diagnostics') d
                      where d ->> 'status' = 'uncovered'), '[]'::jsonb) as uncovered_codes
      from covered x
     where (x.cov -> 'counts' ->> 'uncovered')::int > 0
        or (x.cov -> 'counts' ->> 'unclassified')::int > 0
  ),
  selected as materialized (
    select f.* from flagged f
     where p_code is null or f.uncovered_codes @> jsonb_build_array(p_code)
  ),
  page_rows as (
    select s.* from selected s, params
     order by s.patient_code, s.rank, s.encounter_date nulls first, s.created_at, s.encounter_id nulls first
     limit (select lim from params)
    offset (select off from params)
  ),
  enriched as (
    select pr.*,
           coalesce((select jsonb_agg(t.code order by t.code)
                       from jsonb_array_elements_text(pr.uncovered_codes) as t(code)
                      where exists (select 1 from jsonb_array_elements(cur.cov -> 'diagnostics') d
                                     where d ->> 'code' = t.code and d ->> 'status' = 'covered')),
                    '[]'::jsonb) as now_covered
      from page_rows pr
      left join lateral (
        select public.diagnosis_coverage_in_context(v.id, pr.scope, pr.data, v.ctx) as cov
          from versions v
         where v.id = v_current and v.id is distinct from pr.template_version_id
      ) cur on true
  ),
  by_code as (
    select t.code, count(*)::int as records
      from selected s, lateral jsonb_array_elements_text(s.uncovered_codes) as t(code)
     group by t.code
  )
  select jsonb_build_object(
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'scope', e.scope,
        'patientId', e.patient_id,
        'patientCode', e.patient_code,
        'encounterId', e.encounter_id,
        'encounterType', e.encounter_type,
        'encounterDate', e.encounter_date,
        'status', e.validation_status,
        'sourceVersionId', e.template_version_id,
        'sourceVersionNumber', e.source_version_number,
        'onCurrentVersion', coalesce(e.template_version_id = v_current, false),
        'counts', e.cov -> 'counts',
        'uncoveredCodes', e.uncovered_codes,
        'codesCoveredInCurrentVersion', e.now_covered
      ) order by e.patient_code, e.rank, e.encounter_date nulls first, e.created_at, e.encounter_id nulls first)
      from enriched e), '[]'::jsonb),
    'total', (select count(*)::int from selected),
    'limit', (select lim from params),
    'offset', (select off from params),
    'hasMore', ((select off from params) + (select lim from params) < (select count(*) from selected)),
    'unclassifiedRecords', (
      select count(*)::int from selected s where (s.cov -> 'counts' ->> 'unclassified')::int > 0),
    'byCode', coalesce((
      select jsonb_agg(jsonb_build_object('code', b.code, 'records', b.records)
             order by b.records desc, b.code)
      from by_code b), '[]'::jsonb),
    'currentVersionId', v_current
  ) into v_result;

  return v_result;
end $$;
revoke all on function public.diagnosis_followup(uuid,text,uuid,text,int,int) from public, anon;
grant execute on function public.diagnosis_followup(uuid,text,uuid,text,int,int) to authenticated;

-- -----------------------------------------------------------------------------
-- 4. Etat de completion d'un dossier : definition unique de la file « A completer »
-- -----------------------------------------------------------------------------
-- Rend `missing` (libelles des obligatoires non documentees), `displayed` (variables
-- affichees), `filled` (affichees et documentees) et `needsCompletion`. Les variables
-- retenues suivent exactement `missing_required_fields` (portee, type de rencontre, groupe
-- repetable, variables calculees exclues, visibilite conditionnelle).
create or replace function public.record_completion_summary(
  p_version uuid, p_scope text, p_data jsonb,
  p_encounter_type text default null, p_group_section_key text default null
)
returns jsonb language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare
  v_hidden    text[];
  v_missing   jsonb;
  v_displayed int;
  v_filled    int;
begin
  -- Cout : les regles de visibilite ne sont evaluees que si la version en porte.
  if exists (select 1 from public.validation_rule vr
              where vr.template_version_id = p_version
                and (vr.rule -> 'then' ->> 'operator') = 'visible') then
    v_hidden := public.visibility_hidden_fields(p_version, p_data);
  else
    v_hidden := '{}';
  end if;

  select coalesce(jsonb_agg(coalesce(f.label, f.field_key) order by f.display_order, f.field_key)
                    filter (where f.required and not f.documented), '[]'::jsonb),
         count(*)::int,
         count(*) filter (where f.documented)::int
    into v_missing, v_displayed, v_filled
    from (
      select tf.field_key, tf.label, tf.required, tf.display_order,
             public.value_documented(p_data -> tf.field_key) as documented
        from public.template_field tf
       where tf.template_version_id = p_version
         and tf.scope = p_scope
         and tf.formula is null
         and not (tf.field_key = any(v_hidden))
         and (p_scope <> 'encounter' or (
             (p_group_section_key is not null and exists (
               select 1 from public.template_section_field_keys(p_version, p_group_section_key) k
                where k.field_key = tf.field_key
             ))
             or (p_group_section_key is null and not exists (
               select 1 from public.template_section s
               cross join lateral public.template_section_field_keys(p_version, s.section_key) k
               where s.template_version_id = p_version and s.is_repeatable and k.field_key = tf.field_key
             ) and (p_encounter_type is null or tf.encounter_types is null
                    or cardinality(tf.encounter_types) = 0 or p_encounter_type = any(tf.encounter_types)))
           ))
    ) f;

  return jsonb_build_object(
    'missing', v_missing,
    'displayed', v_displayed,
    'filled', v_filled,
    -- Seuil : moins de 75 % des variables affichees documentees (calcul entier exact).
    'needsCompletion', jsonb_array_length(v_missing) > 0 or (v_displayed > 0 and v_filled * 4 < v_displayed * 3)
  );
end $$;
revoke all on function public.record_completion_summary(uuid, text, jsonb, text, text) from public, anon;
grant execute on function public.record_completion_summary(uuid, text, jsonb, text, text) to authenticated;

-- -----------------------------------------------------------------------------
-- 5. File « A completer » paginee : meme contrat, nouvelle definition
-- -----------------------------------------------------------------------------
create or replace function public.base_completion_queue_page(
  p_base_id uuid,
  p_limit int default 50,
  p_offset int default 0
)
returns jsonb
language sql stable security invoker set search_path = public, pg_temp as $$
  with params as (
    select greatest(1, least(coalesce(p_limit, 50), 500))::int as lim,
           greatest(0, coalesce(p_offset, 0))::int as off
  ),
  pat_items as (
    select jsonb_build_object(
        'kind', 'patient', 'patientId', p.id, 'code', p.patient_code, 'status', p.validation_status,
        'missing', s.v -> 'missing', 'filledFields', s.v -> 'filled', 'displayedFields', s.v -> 'displayed'
      ) as item,
      p.patient_code as code, 0 as rank, p.created_at
    from public.patient p
    cross join lateral (
      select public.record_completion_summary(p.template_version_id, 'patient', p.data) as v
    ) s
    where p.base_id = p_base_id and p.deleted_at is null and p.validation_status <> 'curated'
      and (s.v ->> 'needsCompletion')::boolean
  ),
  enc_items as (
    select jsonb_build_object(
        'kind', 'encounter', 'patientId', p.id, 'encounterId', e.id, 'code', p.patient_code,
        'encounterType', e.encounter_type, 'encounterDate', e.encounter_date, 'status', e.validation_status,
        'missing', s.v -> 'missing', 'filledFields', s.v -> 'filled', 'displayedFields', s.v -> 'displayed'
      ) as item,
      p.patient_code as code, 1 as rank, e.created_at
    from public.encounter e
    join public.patient p on p.id = e.patient_id
    cross join lateral (
      select public.record_completion_summary(
        e.template_version_id, 'encounter', e.data, e.encounter_type, e.group_section_key) as v
    ) s
    where p.base_id = p_base_id and p.deleted_at is null and e.deleted_at is null
      and e.validation_status <> 'curated'
      and (s.v ->> 'needsCompletion')::boolean
  ),
  all_items as materialized (
    select * from pat_items
    union all
    select * from enc_items
  ),
  page_items as (
    select a.*
      from all_items a, params
     order by a.code, a.rank, a.created_at
     limit (select lim from params)
     offset (select off from params)
  ),
  total_count as (
    select count(*)::int as n from all_items
  )
  select jsonb_build_object(
    'items', coalesce((select jsonb_agg(p.item order by p.code, p.rank, p.created_at) from page_items p), '[]'::jsonb),
    'total', (select n from total_count),
    'limit', (select lim from params),
    'offset', (select off from params),
    'hasMore', ((select off from params) + (select lim from params) < (select n from total_count))
  );
$$;
revoke all on function public.base_completion_queue_page(uuid, int, int) from public, anon;
grant execute on function public.base_completion_queue_page(uuid, int, int) to authenticated;

-- -----------------------------------------------------------------------------
-- 6. Compteurs « A faire » : copie de 20261001200000, `incomplete` suit la file
-- -----------------------------------------------------------------------------
create or replace function public.my_todo_counts()
returns jsonb
language sql stable security invoker set search_path = public, pg_temp as $$
  with editable as (
    select b.id as base_id, b.owner_user_id = auth.uid() as is_owner
    from public.base b
    where b.deleted_at is null
      and public.can_edit_structured_data(b.id)
  ),
  counts as (
    select ed.base_id,
           least(incomplete_patients.n + incomplete_encounters.n, 100) as incomplete,
           clarifications.n as clarifications,
           least(pending_patients.n + pending_encounters.n, 100) as pending_codings
    from editable ed
    cross join lateral (
      select count(*)::int as n from (
        select 1
        from public.patient p
        where p.base_id = ed.base_id
          and p.deleted_at is null
          and p.validation_status <> 'curated'
          and (public.record_completion_summary(p.template_version_id, 'patient', p.data)
                 ->> 'needsCompletion')::boolean
        limit 100
      ) found
    ) incomplete_patients
    cross join lateral (
      select count(*)::int as n from (
        select 1
        from public.encounter e
        join public.patient p on p.id = e.patient_id
        where p.base_id = ed.base_id
          and p.deleted_at is null
          and e.deleted_at is null
          and e.validation_status <> 'curated'
          and (public.record_completion_summary(
                 e.template_version_id, 'encounter', e.data, e.encounter_type, e.group_section_key)
                 ->> 'needsCompletion')::boolean
        limit 100
      ) found
    ) incomplete_encounters
    cross join lateral (
      select count(*)::int as n
      from public.curation_task t
      where ed.is_owner
        and t.base_id = ed.base_id
        and t.deleted_at is null
        and t.status = 'clarification_requested'
    ) clarifications
    cross join lateral (
      select count(*)::int as n from (
        select 1
        from public.patient p
        join public.template_field tf
          on tf.template_version_id = p.template_version_id
         and tf.scope = 'patient' and tf.type = 'terminology'
        cross join lateral jsonb_array_elements(
          case jsonb_typeof(p.data -> tf.field_key)
            when 'array' then p.data -> tf.field_key
            when 'object' then jsonb_build_array(p.data -> tf.field_key)
            else '[]'::jsonb
          end) el(entry)
        where p.base_id = ed.base_id
          and p.deleted_at is null
          and p.validation_status <> 'curated'
          and p.data ? tf.field_key
          and (el.entry -> 'coding' ->> 'status') in ('unmatched', 'suggested')
        limit 100
      ) found
    ) pending_patients
    cross join lateral (
      select count(*)::int as n from (
        select 1
        from public.encounter e
        join public.patient p on p.id = e.patient_id
        join public.template_field tf
          on tf.template_version_id = e.template_version_id
         and tf.scope = 'encounter' and tf.type = 'terminology'
         and (tf.encounter_types is null or cardinality(tf.encounter_types) = 0
              or e.encounter_type = any(tf.encounter_types))
        cross join lateral jsonb_array_elements(
          case jsonb_typeof(e.data -> tf.field_key)
            when 'array' then e.data -> tf.field_key
            when 'object' then jsonb_build_array(e.data -> tf.field_key)
            else '[]'::jsonb
          end) el(entry)
        where p.base_id = ed.base_id
          and p.deleted_at is null
          and e.deleted_at is null
          and e.validation_status <> 'curated'
          and e.data ? tf.field_key
          and (el.entry -> 'coding' ->> 'status') in ('unmatched', 'suggested')
        limit 100
      ) found
    ) pending_encounters
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'baseId', base_id,
      'incomplete', incomplete,
      'clarifications', clarifications,
      'pendingCodings', pending_codings
    ) order by base_id), '[]'::jsonb)
  from counts
  where incomplete > 0 or clarifications > 0 or pending_codings > 0;
$$;
revoke all on function public.my_todo_counts() from public, anon;
grant execute on function public.my_todo_counts() to authenticated;

notify pgrst, 'reload schema';
