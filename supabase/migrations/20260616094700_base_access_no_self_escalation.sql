-- =============================================================================
-- 20260616094700_base_access_no_self_escalation.sql  (audit v12 §6.1)
-- La policy `ba_manage` (for all) laissait TOUT detenteur de can_manage_access ecrire n'importe
-- quelle ligne de base_access, y compris LA SIENNE : un delegue possedant seulement
-- can_manage_access pouvait faire `update base_access set can_view_identity=true,... where
-- user_id=auth.uid()` et s'auto-attribuer identite / documents / edition / export, puis lire
-- l'identite d'un patient. Meme voie via base_invitation (inviter un complice tout-puissant).
--
-- On ferme la voie par un trigger anti-escalade qui ne s'applique qu'aux ECRITURES DIRECTES d'un
-- utilisateur authentifie (current_user = 'authenticated'). Les contextes de CONFIANCE en sont
-- exemptes : RPC SECURITY DEFINER (ex. accept_invitation, qui s'execute sous le role PROPRIETAIRE de
-- la fonction -> current_user <> 'authenticated' ; l'invitation a deja ete validee a sa creation),
-- ainsi que le seed / l'admin. Le PROPRIETAIRE de la base garde une gouvernance libre.
--
-- Regles pour un DELEGATAIRE agissant en direct (cahier / recommandation §6.1) :
--   (2) jamais sa propre ligne ;
--   (4) ne peut pas accorder can_manage_access (proprietaire uniquement) ;
--   (5) ne peut pas accorder l'acces a l'identite (proprietaire uniquement) ;
--   (3) ne peut pas accorder une permission qu'il ne detient pas lui-meme.
-- Les regles (3)(4)(5) ne visent que les octrois NOUVEAUX (perm passant a true) : revoquer/mettre a
-- jour une ligne sans elever de droit reste possible.
-- Migration ADDITIVE (nouveau trigger ; la policy reste inchangee, le trigger la borne).
-- =============================================================================
create or replace function public.guard_access_escalation()
returns trigger language plpgsql set search_path = public, pg_temp as $$
declare
  v_base uuid := new.base_id;
begin
  -- Contexte de confiance (DEFINER / seed / admin) : la validation a lieu ailleurs.
  if current_user <> 'authenticated' then return new; end if;
  -- Le proprietaire de la base gouverne librement les partages / invitations.
  if public.is_base_owner(v_base) then return new; end if;

  -- Ici : un DELEGATAIRE (can_manage_access) ecrit DIRECTEMENT une ligne de partage/invitation.
  -- (2) jamais sa propre ligne (base_access porte user_id ; base_invitation non -> to_jsonb = null).
  if (to_jsonb(new) ->> 'user_id') = auth.uid()::text then
    raise exception 'Un delegue ne peut pas modifier sa propre ligne d''acces (anti-escalade)';
  end if;
  -- (4) can_manage_access : proprietaire uniquement.
  if new.can_manage_access and (TG_OP = 'INSERT' or not old.can_manage_access) then
    raise exception 'Seul le proprietaire de la base peut accorder la gestion des acces';
  end if;
  -- (5) acces a l'identite : proprietaire uniquement.
  if new.can_view_identity and (TG_OP = 'INSERT' or not old.can_view_identity) then
    raise exception 'Seul le proprietaire de la base peut accorder l''acces a l''identite';
  end if;
  -- (3) on ne peut accorder que des permissions qu'on detient soi-meme.
  if new.can_view_raw_documents and (TG_OP = 'INSERT' or not old.can_view_raw_documents)
     and not public.can_view_raw_documents(v_base) then
    raise exception 'Permission « documents » non detenue : impossible a accorder';
  end if;
  if new.can_edit_structured_data and (TG_OP = 'INSERT' or not old.can_edit_structured_data)
     and not public.can_edit_structured_data(v_base) then
    raise exception 'Permission « edition » non detenue : impossible a accorder';
  end if;
  if new.can_export_data and (TG_OP = 'INSERT' or not old.can_export_data)
     and not public.can_export_data(v_base) then
    raise exception 'Permission « export » non detenue : impossible a accorder';
  end if;
  return new;
end $$;

drop trigger if exists trg_base_access_escalation on public.base_access;
create trigger trg_base_access_escalation before insert or update on public.base_access
  for each row execute function public.guard_access_escalation();

drop trigger if exists trg_base_invitation_escalation on public.base_invitation;
create trigger trg_base_invitation_escalation before insert or update on public.base_invitation
  for each row execute function public.guard_access_escalation();
