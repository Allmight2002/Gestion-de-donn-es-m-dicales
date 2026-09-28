-- Audit UI mobile, lot 8 : compteurs de la page « A faire », en UNE lecture pour toutes les
-- bases de la personne connectee, au lieu d'une requete par base.
--
-- - `incomplete` : dossiers (fiches et rencontres non curees) auxquels manque une variable
--   obligatoire. Meme definition que la file « A completer » (base_completion_queue_page),
--   mais sans construire la liste : un EXISTS s'arrete au premier manque, et le compte
--   s'arrete a 100 (la page affiche alors « 100+ » ; la file donne le compte exact). Seulement
--   pour les bases ou la personne peut completer (proprietaire ou droit de modification), comme
--   l'onglet « A completer ».
-- - `clarifications` : questions du curateur qui attendent la reponse du medecin
--   proprietaire (tache `clarification_requested`), comme le sous-onglet « Curation ».
--
-- Cout, mesure sur une base jetable de 3 000 patients et 6 000 rencontres fictifs, la RLS etant
-- evaluee pour chaque ligne lue : sans plafond ~0,5 s (la file d'une seule base : ~0,37 s). Avec
-- le plafond : ~20 ms quand les dossiers incomplets abondent, ~0,13 s quand presque toutes les
-- fiches sont completes. Le pire cas reste borne par une lecture de la base, comme la file.
--
-- SECURITY INVOKER : la RLS de l'appelant s'applique a chaque table lue (base, patient,
-- rencontre, variable, tache de curation) ; la fonction ne peut rien reveler de plus que ce
-- que l'appelant lit deja. Elle ne renvoie que des identifiants de base et des nombres, et
-- n'omet que les bases sans rien a faire. Lecture pure, aucune ecriture.
--
-- Changement additif : aucune table, aucune donnee, aucune autre fonction ne change. Retour
-- arriere : une migration suivante supprime la fonction ; le client, qui la traite comme
-- facultative, n'affiche alors plus ces deux rubriques.
create function public.my_todo_counts()
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
           clarifications.n as clarifications
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
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'baseId', base_id,
      'incomplete', incomplete,
      'clarifications', clarifications
    ) order by base_id), '[]'::jsonb)
  from counts
  where incomplete > 0 or clarifications > 0;
$$;

revoke all on function public.my_todo_counts() from public, anon;
grant execute on function public.my_todo_counts() to authenticated;
