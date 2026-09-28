-- Audit UI mobile, lot 4 (decision 8) : le journal d'activite affiche « Vous » pour les
-- actions de la personne connectee.
--
-- Le client ne recoit pas l'identifiant de l'auteur, et il ne doit pas le deduire du nom
-- affiche : deux homonymes d'une meme base seraient confondus dans un journal d'audit. Le
-- serveur, qui connait auth.uid(), l'indique donc par un booleen `actorIsSelf`.
--
-- Changement additif, rien d'autre ne bouge : meme signature, memes controles (session,
-- acces a la base), memes lectures sensibles exclues, meme pagination, meme nom d'auteur pour
-- les autres, memes metadonnees minimisees et memes droits d'execution. Un client ancien
-- ignore le champ ; un client recent face a un serveur ancien garde le nom affiche.
--
-- Retour arriere : une migration suivante recree la definition de
-- 20260616096800_inspection_activity_template_hardening.sql, sans le champ.
create or replace function public.base_activity_log(
  p_base_id uuid,
  p_before timestamptz default null,
  p_limit integer default 50,
  p_action_filter text default null,
  p_before_id uuid default null
)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  result jsonb;
  v_uid uuid := auth.uid();
  v_is_owner boolean;
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_action_filter text := nullif(btrim(p_action_filter), '');
begin
  if v_uid is null then raise exception 'Authentification requise'; end if;
  if not public.has_base_access(p_base_id) then raise exception 'Acces refuse'; end if;

  v_is_owner := public.is_base_owner(p_base_id);

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', a.id,
    'at', a.created_at,
    'action', a.action,
    'actorName', coalesce(nullif(pr.full_name, ''), 'Compte ' || left(a.user_id::text, 8), 'Systeme'),
    -- Une action systeme (sans auteur) n'est jamais « Vous ».
    'actorIsSelf', a.user_id is not distinct from v_uid,
    'metadata', public.activity_public_metadata(a.action, coalesce(a.metadata, '{}'::jsonb), v_is_owner)
  ) order by a.created_at desc, a.id desc), '[]'::jsonb) into result
  from (
    select id, user_id, action, metadata, created_at
    from public.audit_log
    where base_id = p_base_id
      and action not in ('identity_read', 'attachment_read', 'raw_document_read', 'export_read')
      and (
        p_before is null
        or (p_before_id is null and created_at < p_before)
        or (p_before_id is not null and (created_at < p_before or (created_at = p_before and id < p_before_id)))
      )
      and (v_action_filter is null or action = v_action_filter)
    order by created_at desc, id desc
    limit v_limit
  ) a
  left join public.profiles pr on pr.id = a.user_id;

  return result;
end $$;

-- `create or replace` conserve les droits ; ils sont reaffirmes ici, conformement a la regle
-- de 20260714213326_harden_function_execution_privileges.sql (RPC cliente : authenticated seul).
revoke all on function public.base_activity_log(uuid, timestamptz, integer, text, uuid) from public, anon;
grant execute on function public.base_activity_log(uuid, timestamptz, integer, text, uuid) to authenticated;
