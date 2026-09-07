-- =============================================================================
-- 20260906143000_diagnosis_followup.sql  (L56)
-- Suivi des cas non couverts : une file transversale, en LECTURE SEULE, reservee
-- au medecin proprietaire de la base (spec-collecte-diagnostique.md §4.2).
--
-- Ce lot n'ajoute AUCUN statut clinique, aucun drapeau et aucune table : la file
-- derive du calcul de couverture L55, applique a LA VERSION DE CHAQUE DOSSIER.
-- L'enregistrement d'un socle avec un diagnostic non couvert ne demande aucune
-- adaptation serveur : un bloc dont la condition est fausse est deja masque, et
-- `missing_required_fields` n'a jamais reclame une variable masquee (L32/L52).
-- Les droits des comptes de mission restent donc inchanges, comme exige au §4.1.
--
-- Migration ADDITIVE : aucune donnee reecrite, aucune signature existante changee.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Le calcul L55, avec son contexte resolu UNE FOIS pour toutes
-- -----------------------------------------------------------------------------
-- `get_diagnosis_context` transporte `recognizedCodes`, c'est-a-dire la publication
-- terminologique ENTIERE pour un pilote terminologique (cf. la note de charge de L55).
-- Le resoudre par dossier ferait payer ce volume autant de fois qu'il y a de fiches.
-- Le corps du calcul est donc extrait ici SANS aucune modification de sa semantique,
-- et `diagnosis_coverage` devient l'appel qui resout le contexte lui-meme : une seule
-- implementation, donc aucune derive possible entre la file et le formulaire.
create or replace function public.diagnosis_coverage_in_context(
  p_version_id uuid, p_scope text, p_data jsonb, p_context jsonb
)
returns jsonb language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare c jsonb; f public.template_field; codes jsonb := '[]'; val jsonb; item jsonb; code text;
  seen text[] := '{}'; blocks jsonb; status text; items jsonb := '[]';
  counts jsonb := '{"covered":0,"common_only":0,"uncovered":0,"unclassified":0}';
begin
  select e into c from jsonb_array_elements(coalesce(p_context, '[]'::jsonb)) e where e ->> 'scope' = p_scope;
  if c is not null then
    select * into f from public.template_field where template_version_id = p_version_id and scope = p_scope
      and field_key = c ->> 'diagnosisFieldKey';
    val := p_data -> f.field_key;
    if f.type = 'terminology' then
      if f.is_multiple then
        if jsonb_typeof(val) = 'array' and public.rule_apply_op('contains_any', val, c -> 'recognizedCodes') then
          select coalesce(jsonb_agg(e -> 'code'), '[]') into codes from jsonb_array_elements(val) e;
        end if;
      elsif jsonb_typeof(val) = 'object' and public.rule_apply_op('contains_any', val, c -> 'recognizedCodes') then codes := jsonb_build_array(val -> 'code'); end if;
    elsif f.type = 'multiselect' then
      if jsonb_typeof(val) = 'array' then
        if public.rule_apply_op('contains_any',val,c -> 'recognizedCodes') and jsonb_typeof(val -> 0) = 'string' then codes := val; end if;
      end if;
    elsif jsonb_typeof(val) = 'string' then codes := jsonb_build_array(val); end if;
    for item in select value from jsonb_array_elements(codes) loop
      code := item #>> '{}';
      continue when code = any(seen) or not (c -> 'recognizedCodes' @> jsonb_build_array(item));
      seen := array_append(seen, code);
      select coalesce(jsonb_agg(b.key order by b.key), '[]') into blocks from (
        select distinct rule -> 'then' ->> 'section' as key from public.validation_rule r
        where r.template_version_id = p_version_id and rule -> 'if' ->> 'field' = f.field_key
          and rule -> 'if' ->> 'operator' = 'contains_any' and rule -> 'then' ->> 'operator' = 'visible'
          and rule -> 'then' ? 'section' and rule -> 'if' -> 'value' @> jsonb_build_array(item)
          and coalesce(rule -> 'if' -> 'terminologyReleaseId','null'::jsonb) = c -> 'terminologyReleaseId'
          and exists (select 1 from public.template_section_field_keys(p_version_id,rule -> 'then' ->> 'section') k
            join public.template_field t on t.template_version_id = p_version_id and t.field_key = k.field_key
            where t.scope = p_scope and t.formula is null)
      ) b;
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
-- Aucune elevation : un contexte forge ne rend qu'un resultat faux A SON AUTEUR. Les
-- lectures restent celles de l'appelant (template_field / validation_rule sous RLS).
grant execute on function public.diagnosis_coverage_in_context(uuid,text,jsonb,jsonb) to authenticated;

create or replace function public.diagnosis_coverage(p_version_id uuid, p_scope text, p_data jsonb)
returns jsonb language sql stable security invoker set search_path = public, pg_temp as $$
  select public.diagnosis_coverage_in_context(
    p_version_id, p_scope, p_data, public.get_diagnosis_context(p_version_id));
$$;
revoke all on function public.diagnosis_coverage(uuid,text,jsonb) from public, anon;
grant execute on function public.diagnosis_coverage(uuid,text,jsonb) to authenticated;

-- -----------------------------------------------------------------------------
-- 2. La file des cas non couverts
-- -----------------------------------------------------------------------------
-- Ce que la file NE FAIT PAS, volontairement :
--   * elle ne rend ni identite, ni document, ni texte libre -- une proposition hors
--     liste est comptee, jamais citee ; elle reste consultable dans son parcours
--     autorise existant (`base_proposals`, fiche source) ;
--   * elle ne retire personne quand un bloc est publie : la couverture de la VERSION
--     SOURCE fait foi, l'evolution du gabarit est seulement SIGNALEE (reprise = L57) ;
--   * elle n'ecrit rien, ne notifie personne et ne cree aucun statut de completude.
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
  -- Base SUPPRIMEE exclue, et propriete verifiee DANS la RPC : la RLS seule ouvrirait
  -- cette vue transversale a tout collaborateur en lecture. v1 : medecin proprietaire
  -- uniquement -- ni saisisseur, ni collaborateur, ni administrateur systeme.
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
  -- Le contexte (dont la publication terminologique entiere) est resolu une fois par
  -- version presente, jamais par dossier. Une version sans configuration ne peut porter
  -- aucun cas non couvert : elle n'entre pas dans la file.
  versions as materialized (
    select v.id, v.version_number, public.get_diagnosis_context(v.id) as ctx
      from public.template_version v
     where v.diagnosis_configuration <> '[]'::jsonb
       and (v.id = v_current or v.id in (select template_version_id from records))
  ),
  flagged as (
    select r.*, v.version_number as source_version_number, x.cov,
           coalesce((select jsonb_agg(d ->> 'code' order by d ->> 'code')
                       from jsonb_array_elements(x.cov -> 'diagnostics') d
                      where d ->> 'status' = 'uncovered'), '[]'::jsonb) as uncovered_codes
      from records r
      join versions v on v.id = r.template_version_id
      cross join lateral (
        select public.diagnosis_coverage_in_context(r.template_version_id, r.scope, r.data, v.ctx) as cov
      ) x
     where (x.cov -> 'counts' ->> 'uncovered')::int > 0
        or (x.cov -> 'counts' ->> 'unclassified')::int > 0
  ),
  selected as (
    select f.* from flagged f
     where p_code is null or f.uncovered_codes @> jsonb_build_array(p_code)
  ),
  page_rows as (
    select s.* from selected s, params
     order by s.patient_code, s.rank, s.encounter_date nulls first, s.created_at, s.encounter_id nulls first
     limit (select lim from params)
    offset (select off from params)
  ),
  -- Version SOURCE et version COURANTE restent distinctes : publier un bloc ne retire
  -- rien de la file et n'annonce aucune reprise. Le signalement est calcule pour la
  -- page seule -- il informe, il ne filtre pas.
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

-- Sans rechargement du cache de schema, PostgREST ignorerait la nouvelle RPC.
notify pgrst, 'reload schema';
