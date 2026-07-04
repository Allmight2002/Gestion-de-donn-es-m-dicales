-- =============================================================================
-- 20260616096100_base_activity_log.sql  (feature C3 — journal d'activite lisible)
-- Rend l'activite d'une base LISIBLE par ses collaborateurs (medecins ayant acces) : imports,
-- octrois/retraits d'acces, invitations, suppressions, exports, publications de gabarit... La donnee
-- existe deja dans audit_log ; il manquait une vue humaine avec le NOM de l'auteur.
--
-- SECURITY DEFINER : resout le nom de l'auteur (profiles, non lisible en direct) — legitime pour un
-- collaborateur de la base. Borne a has_base_access. Les LECTURES sensibles (identite/documents/
-- exports) sont EXCLUES ici : elles ont leur propre vue dediee (E1, reservee au proprietaire).
-- Lecture seule, additive. 50 evenements les plus recents.
-- =============================================================================
create or replace function public.base_activity_log(p_base_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare result jsonb;
begin
  if auth.uid() is null then raise exception 'Authentification requise'; end if;
  if not public.has_base_access(p_base_id) then raise exception 'Acces refuse'; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'at', a.created_at,
    'action', a.action,
    -- Auteur : nom du profil, sinon un identifiant court, sinon « Systeme » (evenement automatique
    -- sans auth.uid() -> user_id NULL, ex. une action passee en contexte serveur/seed).
    'actorName', coalesce(nullif(pr.full_name, ''), 'Compte ' || left(a.user_id::text, 8), 'Systeme'),
    'metadata', a.metadata
  ) order by a.created_at desc), '[]'::jsonb) into result
  from (
    select user_id, action, metadata, created_at
    from public.audit_log
    where base_id = p_base_id
      -- les LECTURES sensibles ont leur vue dediee (E1) -> pas de bruit ici.
      and action not in ('identity_read', 'attachment_read', 'raw_document_read', 'export_read')
    order by created_at desc
    limit 50
  ) a
  left join public.profiles pr on pr.id = a.user_id;

  return result;
end $$;
grant execute on function public.base_activity_log(uuid) to authenticated;
