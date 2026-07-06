-- =============================================================================
-- 20260616096900_inclusion_stats.sql  (feature D2 — courbe d'inclusion + objectif)
-- LE graphique de reunion d'etude : inclusions cumulees vs objectif date. L'objectif est porte
-- par la base (2 colonnes, modifiables par le PROPRIETAIRE via la RLS base_update existante).
-- La RPC d'agregats est SECURITY INVOKER : la RLS s'applique naturellement (pas d'acces a la
-- base -> patients invisibles -> serie vide et total 0 ; base invisible -> objectif null).
-- Donnees 100 % ANALYTIQUES (comptes par mois d'inclusion) : aucune identite. Additive.
-- =============================================================================

alter table public.base
  add column if not exists inclusion_target int check (inclusion_target is null or inclusion_target > 0),
  add column if not exists inclusion_target_date date;

create or replace function public.base_inclusion_stats(p_base_id uuid)
returns jsonb
language sql stable security invoker set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'total', (select count(*)::int from public.patient p where p.base_id = p_base_id and p.deleted_at is null),
    'target', (select b.inclusion_target from public.base b where b.id = p_base_id),
    'targetDate', (select b.inclusion_target_date from public.base b where b.id = p_base_id),
    'monthly', coalesce((
      select jsonb_agg(jsonb_build_object('month', m.month, 'count', m.n) order by m.month)
      from (
        select to_char(date_trunc('month', p.created_at), 'YYYY-MM') as month, count(*)::int as n
        from public.patient p
        where p.base_id = p_base_id and p.deleted_at is null
        group by 1
      ) m
    ), '[]'::jsonb)
  );
$$;
grant execute on function public.base_inclusion_stats(uuid) to authenticated;
