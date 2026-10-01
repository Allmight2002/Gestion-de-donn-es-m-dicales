-- Codage CIM-11 assiste : les diagnostics restes en attente remontent dans « A faire ».
--
-- Une entree d'une variable `terminology` est EN ATTENTE quand le medecin n'a pas encore
-- tranche :
--   - `coding.status = 'unmatched'` : texte conserve sans code (aucune correspondance fiable,
--     plusieurs correspondances non choisies, ou analyse impossible hors connexion/en panne) ;
--   - `coding.status = 'suggested'` : code propose par l'analyse, jamais confirme.
-- `automatic`, `confirmed` et `manually_modified` sont des codes retenus ; une valeur sans
-- provenance (choix direct dans la recherche) ou une donnee manquante (`__missing__`) n'est
-- jamais en attente. Valeur unique (objet) et liste (`is_multiple`, tableau) sont lues de la
-- meme facon : chaque ENTREE compte.
--
-- Perimetre, identique a celui de `incomplete` (file « A completer ») :
--   - fiches et rencontres non supprimees, d'une base non supprimee ou la personne peut
--     modifier les donnees (`can_edit_structured_data` : proprietaire ou droit de
--     modification ; jamais un compte de mission ni une lectrice) ;
--   - les variables lues sont celles du jeu de variables DE LA LIGNE (`template_version_id`),
--     de la bonne portee, et pour une rencontre applicables a son type ;
--   - les dossiers `curated` sont EXCLUS : ils ont ete revus et finalises, toute correction y
--     exige un motif, et « A faire » ne montre que le travail en cours (meme regle que
--     `incomplete`). Le texte non code d'un dossier finalise reste visible dans sa fiche.
--
-- 1. `my_todo_counts()` gagne la cle `pendingCodings` (nombre d'entrees, arrete a 100 comme
--    `incomplete`). Une base apparait aussi quand seule cette cle est non nulle. Les anciens
--    clients ignorent la cle ajoutee ; aucune cle existante ne change.
-- 2. `list_pending_codings(base, limite)` liste ces entrees pour UNE base, la plus recemment
--    modifiee d'abord, pour rouvrir la fiche ou la rencontre concernee.
--
-- Exposition : rien de plus que la file « A completer » et la fiche elle-meme pour le meme
-- role. Le code patient est le pseudonyme de la table analytique `patient` (deja affiche par
-- la file) ; aucune colonne de `patient_identity` n'est lue. Le texte saisi et le libelle
-- propose viennent de `patient.data` / `encounter.data`, que l'appelant lit deja sous RLS.
--
-- SECURITY INVOKER : la RLS de l'appelant s'applique a chaque table lue ; la liste refuse en
-- plus explicitement une base que l'appelant ne peut pas modifier, et `anon` n'a pas le droit
-- d'execution. Lecture pure, aucune ecriture.
--
-- Cout : borne par la base (index `ix_patient_base`, `ix_encounter_patient`), filtre d'abord
-- sur les seules variables `terminology` presentes dans la ligne ; le compte s'arrete a 100
-- entrees, la liste a sa limite (200 au plus). Meme ordre de grandeur que la file.
--
-- Changement additif : aucune table ni donnee ne change. Retour arriere : une migration
-- suivante redefinit `my_todo_counts()` sans la cle et supprime `list_pending_codings` ; le
-- client, qui traite l'une et l'autre comme facultatives, n'affiche alors plus la rubrique.

-- 1. Compteurs « A faire » ------------------------------------------------------------------
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
          and exists (
            select 1 from public.template_field tf
            where tf.template_version_id = p.template_version_id
              and tf.scope = 'patient' and tf.required
              and tf.formula is null
              and not public.value_documented(p.data -> tf.field_key)
          )
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
          and exists (
            select 1 from public.template_field tf
            where tf.template_version_id = e.template_version_id
              and tf.scope = 'encounter' and tf.required
              and tf.formula is null
              and (tf.encounter_types is null or cardinality(tf.encounter_types) = 0
                   or e.encounter_type = any(tf.encounter_types))
              and not public.value_documented(e.data -> tf.field_key)
          )
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

-- `create or replace` conserve les droits ; on les reaffirme pour ne dependre de rien.
revoke all on function public.my_todo_counts() from public, anon;
grant execute on function public.my_todo_counts() to authenticated;

-- 2. Liste des diagnostics en attente d'une base ---------------------------------------------
create function public.list_pending_codings(p_base_id uuid, p_limit int default 100)
returns jsonb
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare
  v_limit int := greatest(1, least(coalesce(p_limit, 100), 200));
  v_items jsonb;
  v_found int;
begin
  -- Refus explicite, sans dire si la base existe : meme reponse pour une base inconnue,
  -- supprimee, ou seulement lisible par l'appelant.
  if auth.uid() is null or p_base_id is null or not public.can_edit_structured_data(p_base_id) then
    raise exception 'Acces refuse' using errcode = '42501';
  end if;

  with entries as (
    select p.id as patient_id, p.patient_code, null::uuid as encounter_id,
           null::text as encounter_type, null::date as encounter_date,
           tf.field_key, tf.label as field_label, tf.display_order,
           el.entry, el.ord, p.updated_at, 0 as rank, p.id as record_id,
           jsonb_typeof(p.data -> tf.field_key) = 'array' as is_list
    from public.patient p
    join public.template_field tf
      on tf.template_version_id = p.template_version_id
     and tf.scope = 'patient' and tf.type = 'terminology'
    cross join lateral jsonb_array_elements(
      case jsonb_typeof(p.data -> tf.field_key)
        when 'array' then p.data -> tf.field_key
        when 'object' then jsonb_build_array(p.data -> tf.field_key)
        else '[]'::jsonb
      end) with ordinality el(entry, ord)
    where p.base_id = p_base_id
      and p.deleted_at is null
      and p.validation_status <> 'curated'
      and p.data ? tf.field_key
      and (el.entry -> 'coding' ->> 'status') in ('unmatched', 'suggested')
    union all
    select p.id, p.patient_code, e.id, e.encounter_type, e.encounter_date,
           tf.field_key, tf.label, tf.display_order,
           el.entry, el.ord, e.updated_at, 1, e.id,
           jsonb_typeof(e.data -> tf.field_key) = 'array'
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
      end) with ordinality el(entry, ord)
    where p.base_id = p_base_id
      and p.deleted_at is null
      and e.deleted_at is null
      and e.validation_status <> 'curated'
      and e.data ? tf.field_key
      and (el.entry -> 'coding' ->> 'status') in ('unmatched', 'suggested')
  ),
  page as (
    select *, row_number() over (
             order by updated_at desc, rank, record_id, display_order, field_key, ord
           ) as n
    from entries
    order by updated_at desc, rank, record_id, display_order, field_key, ord
    limit v_limit + 1
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'patientId', patient_id,
           'patientCode', patient_code,
           'encounterId', encounter_id,
           'encounterType', encounter_type,
           'encounterDate', encounter_date,
           'fieldKey', field_key,
           'fieldLabel', field_label,
           -- Rang dans la liste (0 = diagnostic principal) ; absent pour une valeur unique.
           'position', case when is_list then (ord - 1)::int end,
           'raw', case when jsonb_typeof(entry -> 'raw') = 'string' then entry ->> 'raw' end,
           'proposedLabel', case when entry -> 'coding' ->> 'status' = 'suggested'
                                  and jsonb_typeof(entry -> 'label') = 'string'
                                 then entry ->> 'label' end,
           'status', entry -> 'coding' ->> 'status',
           'updatedAt', updated_at
         ) order by n) filter (where n <= v_limit), '[]'::jsonb),
         count(*)::int
    into v_items, v_found
  from page;

  return jsonb_build_object('items', v_items, 'hasMore', v_found > v_limit);
end $$;

comment on function public.list_pending_codings(uuid, int) is
  'Diagnostics (variables terminology) non codes ou a confirmer d''une base modifiable par l''appelant, hors dossiers finalises ; lecture sous RLS.';

revoke all on function public.list_pending_codings(uuid, int) from public, anon;
grant execute on function public.list_pending_codings(uuid, int) to authenticated;
