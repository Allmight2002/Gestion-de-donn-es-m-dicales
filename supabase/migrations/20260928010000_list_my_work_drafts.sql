-- Audit UI mobile, lot 8 : la page « A faire » liste les brouillons serveur a reprendre, toutes
-- bases et tous contextes confondus, pour la personne connectee.
--
-- `list_work_drafts` exige la base, la nature ET la cible d'un brouillon : il sert l'ecran de
-- saisie, qui les connait. La page « A faire » doit au contraire retrouver des brouillons dont
-- elle ignore la cible. Cette lecture ne renvoie que des METADONNEES : jamais les reponses
-- (payload), jamais l'identite (qu'un brouillon ne contient pas), et le code patient
-- pseudonymise seulement pour mener a la bonne fiche.
--
-- SECURITY DEFINER : `work_draft` est revoquee pour `authenticated`, les brouillons ne se lisent
-- que par RPC. Le proprietaire est TOUJOURS auth.uid() ; un brouillon dont les droits ne sont
-- plus valides (`work_draft_allowed`, la regle de la reprise) est omis, sans etre purge : la
-- purge reste le fait des commandes existantes. Lecture pure, aucune ecriture.
--
-- Changement additif : aucune table, aucune donnee, aucune autre fonction ne change. Retour
-- arriere : une migration suivante supprime la fonction ; le client, qui la traite comme
-- facultative, n'affiche alors plus que les autres rubriques de la page.
create function public.list_my_work_drafts()
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then
    raise exception 'Authentification requise';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
        'id', d.id,
        'baseId', d.base_id,
        'kind', d.kind,
        'targetId', d.target_id,
        'patientId', coalesce(p.id, ep.id),
        'patientCode', coalesce(p.patient_code, ep.patient_code),
        'updatedAt', d.updated_at,
        'expiresAt', d.expires_at
      ) order by d.updated_at desc, d.id)
    from public.work_draft d
    left join public.patient p
      on d.kind in ('patient_update', 'encounter_create')
     and p.id = d.target_id and p.base_id = d.base_id and p.deleted_at is null
    left join public.encounter e
      on d.kind = 'encounter_update' and e.id = d.target_id and e.deleted_at is null
    left join public.patient ep
      on ep.id = e.patient_id and ep.base_id = d.base_id and ep.deleted_at is null
    where d.owner_id = auth.uid()
      and d.state = 'active'
      and d.expires_at > now()
      and public.work_draft_allowed(d.owner_id, d.base_id, d.kind, d.target_id)
  ), '[]'::jsonb);
end $$;

revoke all on function public.list_my_work_drafts() from public, anon;
grant execute on function public.list_my_work_drafts() to authenticated;
