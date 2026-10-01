-- =============================================================================
-- 20261001090000_terminology_assisted_coding.sql  (codage terminologique assiste)
--
-- POURQUOI. Le medecin ecrit son diagnostic en langage clinique (« HSD chronique spontane
-- droit ») ; MedData le rapproche du referentiel CIM-11 actif. Ce lot pose le socle
-- PostgreSQL de ce codage assiste, sans rien changer au contrat analytique existant.
--
-- CE QUI EST STOCKE. Une valeur terminologique reste un couple {code, label} verifie
-- contre le referentiel. Deux cles FACULTATIVES s'y ajoutent :
--   * `raw`    : le texte reellement ecrit par le medecin, jamais remplace ;
--   * `coding` : la provenance du codage (methode, statut, terme normalise, publication,
--                URI CIM-11, langue, score de confiance).
-- Une entree NON CODEE est admise : {raw, coding:{status:'unmatched', ...}} sans code ni
-- libelle. Le diagnostic en texte libre reste donc enregistrable quand le codage echoue ;
-- il ne compte dans aucune statistique par code, puisqu'il n'en porte pas.
--
-- CE QUI NE CHANGE PAS.
--   * Le code est toujours verifie contre le referentiel (publication active ou conservee) :
--     un LLM ne peut pas faire entrer un code invente, le serveur reste juge.
--   * Les valeurs existantes {code, label} restent valides octet pour octet.
--   * La provenance est DECLARATIVE : elle documente comment le client a obtenu le code ;
--     seuls sa forme et sa coherence avec le concept (URI) sont verifiees.
--
-- ADDITIVE. Une colonne nullable (`terminology_concept.uri`, sans reecriture de table),
-- une fonction d'aide, une RPC de recherche de candidats en lecture seule, et la
-- redefinition de `assert_data_valid` et `rule_apply_op` a partir de leurs versions les
-- plus recentes (20260818045033 et 20260905133549), seules leurs branches terminologiques
-- etant elargies. Retour arriere : restaurer ces deux definitions ; les valeurs enrichies
-- deja saisies seraient alors refusees a la prochaine modification de la fiche, d'ou la
-- preference pour une correction en avant.
-- =============================================================================

-- 1. URI CIM-11 des concepts -------------------------------------------------------------
-- Facultative : l'export tabulaire actuellement importe n'en porte pas. Le script d'import
-- la renseigne lorsque le fichier source fournit une colonne d'URI de linearisation.
alter table public.terminology_concept
  add column if not exists uri text;

alter table public.terminology_concept
  add constraint terminology_concept_uri_format
  check (uri is null or (uri ~ '^https?://[^[:space:]]+$' and length(uri) <= 300));

comment on column public.terminology_concept.uri is
  'URI officielle du concept dans la classification (ex. linearisation CIM-11 MMS), si la source la fournit.';

-- 2. Forme d'une entree terminologique ------------------------------------------------------
-- Renvoie NULL si l'entree est valide, sinon un motif court qui choisit le message :
--   shape      -> l'entree n'est pas un objet
--   unexpected -> cle surnumeraire
--   required   -> code/libelle absents ou vides (entree codee)
--   provenance -> `raw` ou `coding` mal formes, ou statut incoherent avec la presence du code
--   unknown    -> concept inconnu, non proposable, libelle ou URI non conformes
-- Les messages finaux ne recopient jamais la valeur clinique.
create or replace function public.terminology_entry_problem(p_entry jsonb)
returns text language plpgsql stable set search_path = public, pg_temp as $$
declare
  c        jsonb;
  coded    boolean;
  v_status text;
begin
  if p_entry is null or jsonb_typeof(p_entry) <> 'object' then return 'shape'; end if;
  if exists (select 1 from jsonb_object_keys(p_entry) k where k not in ('code', 'label', 'raw', 'coding')) then
    return 'unexpected';
  end if;

  -- Une entree est codee des qu'elle porte `code` ou `label` : `{code}` seul reste une entree
  -- codee incomplete, jamais une entree non codee.
  coded := (p_entry ? 'code') or (p_entry ? 'label');
  if coded then
    if jsonb_typeof(p_entry -> 'code') is distinct from 'string'
       or jsonb_typeof(p_entry -> 'label') is distinct from 'string'
       or btrim(coalesce(p_entry ->> 'code', '')) = '' or btrim(coalesce(p_entry ->> 'label', '')) = '' then
      return 'required';
    end if;
  elsif not (p_entry ? 'raw') or not (p_entry ? 'coding') then
    -- Ni code ni texte : rien a enregistrer. Le message historique reste « requis ».
    return 'required';
  end if;

  if p_entry ? 'raw' then
    if jsonb_typeof(p_entry -> 'raw') is distinct from 'string'
       or btrim(p_entry ->> 'raw') = '' or length(p_entry ->> 'raw') > 500 then
      return 'provenance';
    end if;
  end if;

  if p_entry ? 'coding' then
    c := p_entry -> 'coding';
    if jsonb_typeof(c) is distinct from 'object' then return 'provenance'; end if;
    if exists (select 1 from jsonb_object_keys(c) k
               where k not in ('method', 'status', 'normalized', 'release', 'uri', 'language', 'score')) then
      return 'provenance';
    end if;
    if jsonb_typeof(c -> 'method') is distinct from 'string'
       or (c ->> 'method') not in ('ai_assisted', 'lexical') then
      return 'provenance';
    end if;
    v_status := case when jsonb_typeof(c -> 'status') = 'string' then c ->> 'status' end;
    if v_status is null
       or v_status not in ('automatic', 'suggested', 'confirmed', 'unmatched', 'manually_modified') then
      return 'provenance';
    end if;
    -- Le statut dit si un code a ete retenu : il ne peut pas contredire la presence du code.
    if (v_status = 'unmatched') = coded then return 'provenance'; end if;
    if c ? 'normalized' and (jsonb_typeof(c -> 'normalized') is distinct from 'string'
       or btrim(c ->> 'normalized') = '' or length(c ->> 'normalized') > 300) then
      return 'provenance';
    end if;
    if c ? 'release' and (jsonb_typeof(c -> 'release') is distinct from 'string'
       or btrim(c ->> 'release') = '' or length(c ->> 'release') > 64) then
      return 'provenance';
    end if;
    if c ? 'language' and (jsonb_typeof(c -> 'language') is distinct from 'string'
       or (c ->> 'language') !~ '^[a-z]{2}(-[A-Z]{2})?$') then
      return 'provenance';
    end if;
    if c ? 'uri' and (jsonb_typeof(c -> 'uri') is distinct from 'string'
       or (c ->> 'uri') !~ '^https?://[^[:space:]]+$' or length(c ->> 'uri') > 300 or not coded) then
      return 'provenance';
    end if;
    if c ? 'score' and (jsonb_typeof(c -> 'score') is distinct from 'number'
       or (c ->> 'score')::numeric < 0 or (c ->> 'score')::numeric > 1) then
      return 'provenance';
    end if;
  end if;

  if not coded then return null; end if;

  -- Meme regle qu'avant : un couple selectionnable de toute publication conservee. Une URI
  -- declaree doit etre celle du concept, sinon la fiche mentirait sur sa provenance.
  if not exists (
    select 1
    from public.terminology_concept tc
    where tc.code = (p_entry ->> 'code')
      and tc.is_selectable
      and tc.label = (p_entry ->> 'label')
      and (not (coalesce(p_entry -> 'coding', '{}'::jsonb) ? 'uri') or tc.uri = (p_entry -> 'coding' ->> 'uri'))
  ) then
    return 'unknown';
  end if;
  return null;
end $$;

comment on function public.terminology_entry_problem(jsonb) is
  'Motif de refus d''une entree terminologique (couple code/libelle avec provenance facultative, ou texte non code), NULL si valide.';

-- 3. Validation des valeurs saisies ---------------------------------------------------------
-- Copie de 20260818045033 ; seules les deux branches `terminology` delegant a
-- `terminology_entry_problem` changent. Les messages historiques sont conserves.
create or replace function public.assert_data_valid(p_version uuid, p_scope text, p_data jsonb)
returns void language plpgsql stable set search_path = public, pg_temp as $$
declare
  f       record;
  v       jsonb;
  n       numeric;
  txt     text;
  problem text;
begin
  if p_data is null then return; end if;
  for f in
    select field_key, label, type, is_multiple, unit, allowed_values, min_value, max_value,
           missing_reasons
    from public.template_field
    where template_version_id = p_version and scope = p_scope
  loop
    if not (p_data ? f.field_key) then continue; end if;
    v := p_data -> f.field_key;
    if v is null or jsonb_typeof(v) = 'null' then continue; end if;

    if jsonb_typeof(v) = 'object' and (v ? '__missing__') then
      if cardinality(f.missing_reasons) = 0 then
        raise exception 'Valeur manquante non autorisee pour "%"', f.label;
      end if;
      if (v ->> '__missing__') is null
         or (v ->> '__missing__') not in ('non_fait', 'inconnu', 'non_applicable', 'refus', 'non_documente') then
        raise exception 'Code de donnee manquante invalide pour "%"', f.label;
      end if;
      if not (f.missing_reasons @> array[v ->> '__missing__']) then
        raise exception 'Raison de valeur manquante non autorisee pour "%"', f.label;
      end if;
      continue;
    end if;

    if f.type = 'terminology' and f.is_multiple then
      if jsonb_typeof(v) <> 'array' then
        raise exception 'Liste de diagnostics attendue pour "%"', f.label;
      end if;
      if jsonb_array_length(v) = 0 then
        raise exception 'Liste vide : retirez la variable ou indiquez une donnee manquante pour "%"', f.label;
      end if;
      if jsonb_array_length(v) > 50 then
        raise exception 'La liste de diagnostics depasse 50 valeurs pour "%"', f.label;
      end if;
      -- Le motif le plus structurel l'emporte, dans l'ordre historique des controles.
      select p into problem
      from (select public.terminology_entry_problem(el.value) as p from jsonb_array_elements(v) el(value)) x
      where p is not null
      order by array_position(array['shape', 'unexpected', 'required', 'provenance', 'unknown'], p)
      limit 1;
      if problem = 'shape' then
        raise exception 'Code et libelle attendus dans la liste pour "%"', f.label;
      elsif problem = 'unexpected' then
        raise exception 'Contenu inattendu dans la liste pour "%"', f.label;
      elsif problem = 'required' then
        raise exception 'Code et libelle requis dans la liste pour "%"', f.label;
      elsif problem = 'provenance' then
        raise exception 'Provenance du codage invalide dans la liste pour "%"', f.label;
      end if;
      -- Les doublons portent sur les CODES : deux textes non codes identiques ne sont pas
      -- un meme diagnostic certifie, ils restent a coder.
      if exists (
        select 1
        from jsonb_array_elements(v) el(value)
        where el.value ? 'code'
        group by el.value ->> 'code'
        having count(*) > 1
      ) then
        raise exception 'Diagnostic en double dans la liste pour "%"', f.label;
      end if;
      if problem = 'unknown' then
        raise exception 'Diagnostic inconnu ou libelle non conforme pour "%"', f.label;
      end if;
      continue;
    end if;

    if f.type = 'terminology' then
      problem := public.terminology_entry_problem(v);
      if problem = 'shape' then
        raise exception 'Code et libelle attendus pour "%"', f.label;
      elsif problem = 'unexpected' then
        raise exception 'Contenu inattendu pour "%"', f.label;
      elsif problem = 'required' then
        raise exception 'Code et libelle requis pour "%"', f.label;
      elsif problem = 'provenance' then
        raise exception 'Provenance du codage invalide pour "%"', f.label;
      elsif problem = 'unknown' then
        raise exception 'Diagnostic inconnu ou libelle non conforme pour "%"', f.label;
      end if;
      continue;
    end if;

    if f.type = 'multiselect' then
      if jsonb_typeof(v) <> 'array' then
        raise exception 'Liste (tableau) attendue pour "%"', f.label;
      end if;
      if exists (select 1 from jsonb_array_elements(v) el(value) where jsonb_typeof(el.value) <> 'string') then
        raise exception 'Liste de textes attendue pour "%"', f.label;
      end if;
      if f.allowed_values is not null
         and exists (select 1 from jsonb_array_elements_text(v) el where not (f.allowed_values @> jsonb_build_array(el))) then
        raise exception 'Valeur non autorisee pour "%"', f.label;
      end if;
      continue;
    end if;

    if f.type in ('number','integer') then
      if jsonb_typeof(v) <> 'number' then
        raise exception 'Valeur numerique JSON attendue pour "%"', f.label;
      end if;
      n := (v #>> '{}')::numeric;
      if f.type = 'integer' and n <> trunc(n) then
        raise exception 'Entier attendu pour "%"', f.label;
      end if;
      if f.min_value is not null and n < f.min_value then
        raise exception '"%" en dessous du minimum autorise (%)', f.label, f.min_value;
      end if;
      if f.max_value is not null and n > f.max_value then
        raise exception '"%" au dessus du maximum autorise (%)', f.label, f.max_value;
      end if;
      continue;
    end if;

    if f.type = 'boolean' then
      if jsonb_typeof(v) <> 'boolean' then
        raise exception 'Booleen JSON attendu pour "%"', f.label;
      end if;
      continue;
    end if;

    if jsonb_typeof(v) <> 'string' then
      raise exception 'Texte JSON attendu pour "%"', f.label;
    end if;
    txt := v #>> '{}';
    if txt is null or txt = '' then continue; end if;

    if f.type = 'select' then
      if f.allowed_values is not null and not (f.allowed_values @> jsonb_build_array(txt)) then
        raise exception 'Valeur non autorisee pour "%"', f.label;
      end if;
    elsif f.type = 'date' then
      if not public.is_strict_date_text(txt) then
        raise exception 'Date invalide pour "%" (format AAAA-MM-JJ attendu)', f.label;
      end if;
    elsif f.type = 'datetime' then
      if not public.is_strict_datetime_text(txt) then
        raise exception 'Date/heure invalide pour "%" (format ISO AAAA-MM-JJTHH:MM attendu)', f.label;
      end if;
    end if;
  end loop;
end $$;

comment on function public.assert_data_valid(uuid, text, jsonb) is
  'Valide types, bornes, terminologies unitaires ou multivaluees (avec texte d''origine et provenance du codage facultatifs, ou texte non code) et raisons manquantes.';

-- 4. Operateur contains_any -------------------------------------------------------------------
-- Copie de 20260905133549. Deux elargissements, rien d'autre :
--   * une entree codee peut porter `raw` et `coding` ;
--   * une entree NON codee (sans `code` ni `label`, statut unmatched) est ignoree : elle ne
--     declenche aucune regle, et n'invalide pas non plus le reste de la liste.
-- Toute autre forme continue d'echouer en bloc, comme avant.
create or replace function public.rule_apply_op(op text, a jsonb, b jsonb)
returns boolean language plpgsql immutable set search_path = public, pg_temp as $$
declare ta text := a #>> '{}'; c int; vals jsonb; el jsonb; code text; codes text[] := '{}'; kind text; hit boolean := false;
begin
  if op = 'contains_any' then
    -- All shape checks precede set-returning functions. Never coerce a JSON value to a code.
    if jsonb_typeof(b) is distinct from 'array' then return false; end if;
    if jsonb_array_length(b) = 0 then return false; end if;
    if exists (select 1 from jsonb_array_elements(b) e
      where jsonb_typeof(e) <> 'string' or btrim(e #>> '{}', U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF') = '') then return false; end if;
    if (select count(distinct e) from jsonb_array_elements(b) e) <> jsonb_array_length(b) then return false; end if;
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

-- 5. Candidats pour le codage assiste ------------------------------------------------------------
-- Recherche par MOTS, et non par sous-chaine entiere comme `search_terminology` : « hemorragie
-- sous-durale non traumatique » doit retrouver « Hemorragie sousdurale non traumatique ». Les
-- termes sont normalises comme les libelles, les tirets sont retires des deux cotes, et chaque
-- mot significatif est reduit a une racine simple (pluriel et feminin). Le classement par
-- nombre de mots retrouves n'est qu'un PRE-TRI : le score de confiance est calcule ensuite par
-- l'appelant, qui recoit les libelles complets.
--
-- SECURITY INVOKER : le referentiel est deja lisible par tout compte authentifie. Aucune
-- donnee patient n'est lue ni ecrite ; seuls des termes cliniques courts sont recus.
create or replace function public.match_terminology_candidates(p_terms text[], p_limit integer default 40)
returns table (id uuid, code text, label text, uri text, release_version text, hits integer)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with active as (
    select r.id, r.version from public.terminology_release r where r.is_active limit 1
  ),
  terms as (
    select t.term
    from unnest(coalesce(p_terms, '{}'::text[])) with ordinality t(term, n)
    where t.term is not null and length(t.term) <= 200 and t.n <= 8
  ),
  words as (
    select distinct regexp_replace(w, '(es|e|s)$', '') as stem
    from terms,
         lateral regexp_split_to_table(
           replace(public.terminology_normalize(terms.term), '-', ''), '[^a-z0-9]+') w
    where length(w) >= 4
      and w not in ('avec', 'sans', 'dans', 'pour', 'autre', 'autres', 'precision', 'precise',
                    'precisee', 'specifie', 'specifiee', 'type', 'cause', 'suite', 'droit',
                    'droite', 'gauche', 'bilateral', 'bilaterale')
    limit 24
  ),
  concepts as (
    select c.id, c.code, c.label, c.uri, a.version, replace(c.search_text, '-', '') as m
    from public.terminology_concept c
    join active a on a.id = c.release_id
    where c.is_selectable
  )
  select c.id, c.code, c.label, c.uri, c.version, count(*)::integer as hits
  from concepts c
  join words w on c.m like '%' || w.stem || '%'
  group by c.id, c.code, c.label, c.uri, c.version
  order by count(*) desc, length(c.label), c.label
  limit least(greatest(coalesce(p_limit, 40), 1), 80)
$$;

comment on function public.match_terminology_candidates(text[], integer) is
  'Candidats du referentiel actif pour des termes cliniques normalises (8 termes, 80 resultats au plus). Pre-tri par mots retrouves ; le score final est calcule par l''appelant.';

revoke all on function public.match_terminology_candidates(text[], integer) from public, anon;
grant execute on function public.match_terminology_candidates(text[], integer) to authenticated;
