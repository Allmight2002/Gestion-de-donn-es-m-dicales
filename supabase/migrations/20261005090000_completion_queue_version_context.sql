-- =============================================================================
-- 20261005090000_completion_queue_version_context.sql
--
-- File « A completer » (`base_completion_queue_page`) et compteur `incomplete` de
-- `my_todo_counts` : la page depassait le delai serveur (8 s) sur un formulaire de la
-- taille signalee en production (402 variables, 62 sections, 238 regles de visibilite).
--
-- Cause : `record_completion_summary` recalculait, POUR CHAQUE DOSSIER, tout ce qui ne
-- depend que de la version, et la page multipliait encore ces appels :
--   * `visibility_hidden_fields` rejouait le point fixe des 238 regles, une passe par
--     niveau de cascade, en relancant `template_section_field_keys` (lent sous RLS) pour
--     chaque regle de bloc a chaque passe ;
--   * le filtre des groupes repetables relancait `template_section_field_keys` pour chaque
--     couple variable x groupe repetable ;
--   * `value_documented` (non inlinable : clause `search_path`) etait appele pour chaque
--     variable de chaque dossier ;
--   * dans la page, le resume de chaque dossier etait recalcule pour chaque cle lue ;
--   * les donnees du dossier, stockees compressees, etaient decompressees a chaque cle lue.
-- Mesure locale (400 patients, 400 rencontres, utilisateur sous RLS, delai 8 s) : la file
-- et le compteur depassaient tous deux le delai.
--
-- Correction : `completion_version_context` calcule une fois par version :
--   * la PORTEE de chaque regle de visibilite : toutes les variables qu'elle masque quand
--     elle se declenche, cascade comprise (cibles de bloc deployees, puis regles pilotees
--     par ces cibles, etc.) ;
--   * les variables candidates par portee (libelle, obligation, types de rencontre, blocs
--     qui les contiennent, appartenance a un groupe repetable) et, pour chacune, le masque
--     de bits des regles dont la portee la contient (`hiders`).
-- Par dossier restent : une requete qui evalue les conditions sur ses valeurs et rend le
-- masque des regles declenchees, puis le comptage, ou une variable est masquee si son
-- masque `hiders` croise celui des regles declenchees. La page materialise chaque resume.
--
-- Resultat inchange : memes variables affichees, memes obligatoires manquantes, meme ordre
-- des libelles, meme seuil. Le point fixe precedent masque les cibles d'une regle des que
-- son pilote est masque ou que sa condition est fausse ; sa limite de passes (regles + 1)
-- n'est jamais atteinte, chaque passe utile declenchant au moins une regle. Son resultat
-- est la plus petite fermeture, c'est-a-dire la reunion des portees des regles dont la
-- condition est fausse sur le dossier.
--
-- Migration ADDITIVE : aucune table, aucune donnee, aucune signature existante ne change.
-- `record_completion_summary` garde sa signature et delegue a la nouvelle definition.
-- Fonctions SECURITY INVOKER : la RLS de l'appelant s'applique. Un contexte forge ne rend
-- qu'un resultat faux A SON AUTEUR (aucune elevation).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Contexte de completion d'une version (calcule une fois par version)
-- -----------------------------------------------------------------------------
create or replace function public.completion_version_context(p_version uuid)
returns jsonb language sql stable security invoker set search_path = public, pg_temp as $$
  -- Variables de chaque bloc : meme definition que `template_section_field_keys` (le bloc
  -- et ses sous-sections non repetables, par `section_id` ou par cle `section`), calculee
  -- pour tous les blocs en une jointure. Sous RLS, un appel par bloc coutait ~20 ms.
  with recursive sections as materialized (
    select s.id, s.section_key, s.parent_section_id, s.is_repeatable
      from public.template_section s
     where s.template_version_id = p_version
  ),
  version_fields as materialized (
    select tf.field_key, tf.section_id, tf.section
      from public.template_field tf
     where tf.template_version_id = p_version
  ),
  section_fields as materialized (
    select distinct t.section_key, t.is_repeatable, f.field_key
      from sections t
      join sections m on m.id = t.id or (m.parent_section_id = t.id and not m.is_repeatable)
      join version_fields f on f.section_id = m.id or f.section = m.section_key
  ),
  -- Memes regles que `visibility_hidden_fields`.
  rules as materialized (
    select (row_number() over (order by vr.id))::int as idx, vr.rule
      from public.validation_rule vr
     where vr.template_version_id = p_version
       and vr.rule ? 'if' and vr.rule ? 'then'
       and (vr.rule -> 'then' ->> 'operator') = 'visible'
       and (vr.rule -> 'if' ->> 'field') is not null
       and ((vr.rule -> 'then' ->> 'field') is not null
            or (vr.rule -> 'then' ->> 'section') is not null)
  ),
  -- Cibles directes : la variable visee, ou les variables du bloc vise.
  rule_targets as materialized (
    select r.idx, r.rule -> 'if' ->> 'field' as driver, r.rule -> 'then' ->> 'field' as field_key
      from rules r
     where (r.rule -> 'then' ->> 'field') is not null
    union
    select r.idx, r.rule -> 'if' ->> 'field', sf.field_key
      from rules r
      join section_fields sf on sf.section_key = r.rule -> 'then' ->> 'section'
     where (r.rule -> 'then' ->> 'field') is null
  ),
  -- Portee : une variable masquee masque a son tour les cibles des regles qu'elle pilote
  -- (un pilote masque vaut absent). Paires dedupliquees : termine meme sur un cycle.
  reach(idx, field_key) as (
    select rt.idx, rt.field_key from rule_targets rt
    union
    select re.idx, rt.field_key
      from reach re
      join rule_targets rt on rt.driver = re.field_key
  ),
  -- Masque de bits des regles dont la portee contient la variable (bit i = regle `idx` i).
  field_hiders as materialized (
    select h.field_key,
           (select string_agg(case when i = any(h.idxs) then '1' else '0' end, '' order by i)
              from generate_series(1, (select count(*)::int from rules)) i) as hiders
      from (select re.field_key, array_agg(re.idx) as idxs from reach re group by re.field_key) h
  )
  select jsonb_build_object(
    'rules', coalesce((
      select jsonb_agg(jsonb_build_object(
          'driver', r.rule -> 'if' ->> 'field',
          'op', r.rule -> 'if' ->> 'operator',
          'value', r.rule -> 'if' -> 'value',
          'valid', case when (r.rule -> 'if' ->> 'operator') = 'contains_any'
                        then public.rule_contains_any_target_valid(r.rule -> 'if' -> 'value') end
        ) order by r.idx)
        from rules r
    ), '[]'::jsonb),
    -- Variables saisissables par portee, dans l'ordre d'affichage des libelles manquants.
    'fieldsByScope', coalesce((
      select jsonb_object_agg(f.scope, f.fields) from (
      select tf.scope, jsonb_agg(jsonb_build_object(
          'key', tf.field_key,
          'label', coalesce(tf.label, tf.field_key),
          'required', tf.required,
          'encounterTypes', to_jsonb(tf.encounter_types),
          'sections', coalesce((select jsonb_agg(distinct sf.section_key)
                                  from section_fields sf where sf.field_key = tf.field_key), '[]'::jsonb),
          'inRepeatable', exists (select 1 from section_fields sf
                                   where sf.field_key = tf.field_key and sf.is_repeatable)
        ) || coalesce((select jsonb_build_object('hiders', fh.hiders)
                         from field_hiders fh where fh.field_key = tf.field_key), '{}'::jsonb)
        order by tf.display_order, tf.field_key) as fields
        from public.template_field tf
       where tf.template_version_id = p_version
         and tf.formula is null
       group by tf.scope) f
    ), '{}'::jsonb)
  );
$$;
revoke all on function public.completion_version_context(uuid) from public, anon;
grant execute on function public.completion_version_context(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 2. Regles declenchees par un dossier
-- -----------------------------------------------------------------------------
-- Rend le masque de bits des regles (dans l'ordre du contexte) qui se declenchent sur ce
-- dossier : pilote absent, ou condition fausse sur la valeur saisie. Memes tests que
-- `visibility_hidden_fields` ; `rule_value_present` est ecrit en expression pour eviter un
-- appel de fonction par regle et par dossier, et l'operateur n'est evalue que sur un
-- pilote present.
create or replace function public.visibility_fired_rules_in_context(p_rules jsonb, p_data jsonb)
returns varbit language sql stable security invoker set search_path = public, pg_temp as $$
  select coalesce(string_agg(case
           when d.v is null then '1'
           when jsonb_typeof(d.v) = 'null' then '1'
           when jsonb_typeof(d.v) = 'object' and d.v ? '__missing__' then '1'
           when jsonb_typeof(d.v) = 'string' and (d.v #>> '{}') = '' then '1'
           when jsonb_typeof(d.v) = 'array' and jsonb_array_length(d.v) = 0 then '1'
           when (x.e ->> 'op') = 'contains_any' then
             case when coalesce(not (coalesce((x.e ->> 'valid')::boolean, false)
                                     and public.rule_contains_any_hit(d.v, x.e -> 'value')), false)
                  then '1' else '0' end
           when coalesce(not public.rule_apply_op(x.e ->> 'op', d.v, x.e -> 'value'), false) then '1'
           else '0'
         end, '' order by x.n), '')::varbit
    from jsonb_array_elements(case when jsonb_typeof(p_rules) = 'array' then p_rules else '[]'::jsonb end)
           with ordinality as x(e, n)
    cross join lateral (select p_data -> (x.e ->> 'driver') as v) d;
$$;
revoke all on function public.visibility_fired_rules_in_context(jsonb, jsonb) from public, anon;
grant execute on function public.visibility_fired_rules_in_context(jsonb, jsonb) to authenticated;

-- -----------------------------------------------------------------------------
-- 3. Etat de completion d'un dossier, contexte de version fourni
-- -----------------------------------------------------------------------------
-- Meme resultat que `record_completion_summary` (20261003230000) : variables de la portee,
-- non calculees, non masquees ; pour une rencontre, celles du groupe pour une occurrence,
-- sinon hors groupes repetables et applicables au type de rencontre.
create or replace function public.record_completion_summary_in_context(
  p_context jsonb, p_scope text, p_data jsonb,
  p_encounter_type text default null, p_group_section_key text default null
)
returns jsonb language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare
  -- Les donnees d'un dossier sont souvent stockees compressees (TOAST) : chaque lecture
  -- `p_data -> cle` les decompresserait de nouveau, soit des centaines de fois par
  -- dossier. `|| '{}'` rend une copie decompressee, lue ensuite autant que necessaire.
  v_data      jsonb := coalesce(p_data, '{}'::jsonb) || '{}'::jsonb;
  v_fired     varbit;
  v_missing   jsonb;
  v_displayed int;
  v_filled    int;
begin
  if jsonb_typeof(p_context -> 'rules') = 'array' and jsonb_array_length(p_context -> 'rules') > 0 then
    v_fired := public.visibility_fired_rules_in_context(p_context -> 'rules', v_data);
    -- Aucune regle declenchee : rien n'est masque.
    if bit_count(v_fired) = 0 then v_fired := null; end if;
  end if;

  select coalesce(jsonb_agg(f.label order by f.n) filter (where f.required and not f.documented), '[]'::jsonb),
         count(*)::int,
         count(*) filter (where f.documented)::int
    into v_missing, v_displayed, v_filled
    from (
      select x.n, x.e ->> 'label' as label, (x.e ->> 'required')::boolean as required,
             -- Meme sens que `value_documented` (valeur presente, ou donnee manquante codee
             -- `non_fait` / `inconnu` / `non_applicable`), ecrit en expression : la
             -- fonction, non inlinable a cause de sa clause `search_path`, coutait ~25 us
             -- par variable, soit l'essentiel de la page. Equivalence verifiee par test.
             case jsonb_typeof(v_data -> (x.e ->> 'key'))
               when 'object' then not ((v_data -> (x.e ->> 'key')) ? '__missing__')
                 or ((v_data -> (x.e ->> 'key')) ->> '__missing__') in ('non_fait', 'inconnu', 'non_applicable')
               when 'string' then ((v_data -> (x.e ->> 'key')) #>> '{}') <> ''
               when 'array' then jsonb_array_length(v_data -> (x.e ->> 'key')) > 0
               when 'number' then true
               when 'boolean' then true
               else false
             end as documented
        from jsonb_array_elements(case when jsonb_typeof(p_context -> 'fieldsByScope' -> p_scope) = 'array'
                                       then p_context -> 'fieldsByScope' -> p_scope else '[]'::jsonb end)
               with ordinality as x(e, n)
       -- Masquee : une regle declenchee a la variable dans sa portee.
       where not (v_fired is not null and x.e ? 'hiders'
                  and bit_count(v_fired & (x.e ->> 'hiders')::varbit) > 0)
         and (p_scope <> 'encounter' or (
             (p_group_section_key is not null and (x.e -> 'sections') ? p_group_section_key)
             or (p_group_section_key is null
                 and not coalesce((x.e ->> 'inRepeatable')::boolean, false)
                 and (p_encounter_type is null
                      or jsonb_typeof(x.e -> 'encounterTypes') is distinct from 'array'
                      or jsonb_array_length(x.e -> 'encounterTypes') = 0
                      or (x.e -> 'encounterTypes') ? p_encounter_type))
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
revoke all on function public.record_completion_summary_in_context(jsonb, text, jsonb, text, text) from public, anon;
grant execute on function public.record_completion_summary_in_context(jsonb, text, jsonb, text, text) to authenticated;

-- Signature conservee : une seule definition, appelee pour un dossier isole.
create or replace function public.record_completion_summary(
  p_version uuid, p_scope text, p_data jsonb,
  p_encounter_type text default null, p_group_section_key text default null
)
returns jsonb language sql stable security invoker set search_path = public, pg_temp as $$
  select public.record_completion_summary_in_context(
    public.completion_version_context(p_version), p_scope, p_data, p_encounter_type, p_group_section_key);
$$;
revoke all on function public.record_completion_summary(uuid, text, jsonb, text, text) from public, anon;
grant execute on function public.record_completion_summary(uuid, text, jsonb, text, text) to authenticated;


-- -----------------------------------------------------------------------------
-- 4. File « A completer » paginee : meme contrat, contexte calcule une fois par version
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
  patients as materialized (
    select p.id, p.patient_code, p.validation_status, p.template_version_id, p.data, p.created_at
      from public.patient p
     where p.base_id = p_base_id and p.deleted_at is null
  ),
  encounters as materialized (
    select e.id, e.patient_id, p.patient_code, e.encounter_type, e.encounter_date, e.group_section_key,
           e.validation_status, e.template_version_id, e.data, e.created_at
      from public.encounter e
      join patients p on p.id = e.patient_id
     where e.deleted_at is null and e.validation_status <> 'curated'
  ),
  versions as materialized (
    select v.id, public.completion_version_context(v.id) as ctx
      from (select template_version_id as id from patients where validation_status <> 'curated'
            union
            select template_version_id from encounters) v
  ),
  -- Materialise : sinon l'appel est recopie dans chaque expression qui lit le resume, et
  -- le resume de chaque dossier est calcule plusieurs fois.
  pat_summaries as materialized (
    select p.id, p.patient_code, p.validation_status, p.created_at,
           public.record_completion_summary_in_context(v.ctx, 'patient', p.data) as v
      from patients p
      left join versions v on v.id = p.template_version_id
     where p.validation_status <> 'curated'
  ),
  enc_summaries as materialized (
    select e.id, e.patient_id, e.patient_code, e.encounter_type, e.encounter_date,
           e.validation_status, e.created_at,
           public.record_completion_summary_in_context(
             v.ctx, 'encounter', e.data, e.encounter_type, e.group_section_key) as v
      from encounters e
      left join versions v on v.id = e.template_version_id
  ),
  pat_items as (
    select jsonb_build_object(
        'kind', 'patient', 'patientId', p.id, 'code', p.patient_code, 'status', p.validation_status,
        'missing', p.v -> 'missing', 'filledFields', p.v -> 'filled', 'displayedFields', p.v -> 'displayed'
      ) as item,
      p.patient_code as code, 0 as rank, p.created_at
    from pat_summaries p
    where (p.v ->> 'needsCompletion')::boolean
  ),
  enc_items as (
    select jsonb_build_object(
        'kind', 'encounter', 'patientId', e.patient_id, 'encounterId', e.id, 'code', e.patient_code,
        'encounterType', e.encounter_type, 'encounterDate', e.encounter_date, 'status', e.validation_status,
        'missing', e.v -> 'missing', 'filledFields', e.v -> 'filled', 'displayedFields', e.v -> 'displayed'
      ) as item,
      e.patient_code as code, 1 as rank, e.created_at
    from enc_summaries e
    where (e.v ->> 'needsCompletion')::boolean
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
-- 5. Compteurs « A faire » : copie de 20261003230000, contexte calcule une fois par version
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
  versions as materialized (
    select v.id, public.completion_version_context(v.id) as ctx
      from (
        select p.template_version_id as id
          from public.patient p
          join editable ed on ed.base_id = p.base_id
         where p.deleted_at is null and p.validation_status <> 'curated'
        union
        select e.template_version_id
          from public.encounter e
          join public.patient p on p.id = e.patient_id
          join editable ed on ed.base_id = p.base_id
         where p.deleted_at is null and e.deleted_at is null and e.validation_status <> 'curated'
      ) v
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
        left join versions v on v.id = p.template_version_id
        where p.base_id = ed.base_id
          and p.deleted_at is null
          and p.validation_status <> 'curated'
          and (public.record_completion_summary_in_context(v.ctx, 'patient', p.data)
                 ->> 'needsCompletion')::boolean
        limit 100
      ) found
    ) incomplete_patients
    cross join lateral (
      select count(*)::int as n from (
        select 1
        from public.encounter e
        join public.patient p on p.id = e.patient_id
        left join versions v on v.id = e.template_version_id
        where p.base_id = ed.base_id
          and p.deleted_at is null
          and e.deleted_at is null
          and e.validation_status <> 'curated'
          and (public.record_completion_summary_in_context(
                 v.ctx, 'encounter', e.data, e.encounter_type, e.group_section_key)
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
