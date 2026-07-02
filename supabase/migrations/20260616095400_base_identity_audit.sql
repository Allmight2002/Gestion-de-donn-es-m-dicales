-- =============================================================================
-- 20260616095400_base_identity_audit.sql  (feature E1 / audit interne F-4)
-- « Qui accède à mes bases » : rendre VISIBLE au proprietaire (ou detenteur de can_manage_access)
-- l'activite de consultation d'IDENTITE de sa base, pour reperer une sur-consultation (signal
-- d'exfiltration). La donnee existe deja (audit_log 'identity_read', ecrit par get_patient_identity
-- / find_identity_matches) ; il manquait une vue lisible.
--
-- SECURITY DEFINER : la fonction resout le NOM du lecteur (profiles) et le CODE patient — le
-- proprietaire ne peut pas lire ces profils en direct (RLS profiles = self/admin), mais connaitre
-- QUI de son equipe consulte QUOI est legitime et attendu. Strictement borne au proprietaire /
-- gestionnaire de la base. Lecture seule, additive. Fenetre : 30 jours.
-- =============================================================================
create or replace function public.base_identity_audit(p_base_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  result jsonb;
begin
  if auth.uid() is null then raise exception 'Authentification requise'; end if;
  if not (public.is_base_owner(p_base_id) or public.can_manage_access(p_base_id)) then
    raise exception 'Acces refuse';
  end if;

  select jsonb_build_object(
    -- Synthese PAR LECTEUR sur 30 jours (le signal de sur-consultation : un compteur anormalement haut).
    'byReader', coalesce((
      select jsonb_agg(jsonb_build_object(
        'readerName', coalesce(nullif(pr.full_name, ''), 'Compte ' || left(x.user_id::text, 8)),
        'count', x.n,
        'lastAt', x.last_at
      ) order by x.n desc)
      from (
        select user_id, count(*)::int as n, max(created_at) as last_at
        from public.audit_log
        where base_id = p_base_id and action = 'identity_read'
          and created_at > now() - interval '30 days'
        group by user_id
      ) x
      left join public.profiles pr on pr.id = x.user_id
    ), '[]'::jsonb),
    -- Journal DETAILLE des 50 dernieres consultations (qui, quel patient pseudonymise, quand).
    'reads', coalesce((
      select jsonb_agg(jsonb_build_object(
        'at', a.created_at,
        'readerName', coalesce(nullif(pr.full_name, ''), 'Compte ' || left(a.user_id::text, 8)),
        'patientCode', p.patient_code
      ) order by a.created_at desc)
      from (
        select user_id, entity_id, created_at
        from public.audit_log
        where base_id = p_base_id and action = 'identity_read'
          and created_at > now() - interval '30 days'
        order by created_at desc
        limit 50
      ) a
      left join public.profiles pr on pr.id = a.user_id
      left join public.patient p on p.id = a.entity_id
    ), '[]'::jsonb)
  ) into result;

  return result;
end $$;
grant execute on function public.base_identity_audit(uuid) to authenticated;
