-- =============================================================================
-- 20260616091700_reorder_template_fields.sql
-- Reordonner les variables d'un gabarit (drag & drop cote interface). L'ordre est
-- porte par template_field.display_order ; cette RPC le reaffecte d'apres l'ordre
-- fourni. owns_template requis (medecin proprietaire / admin pour un modele global).
-- L'ajout d'une variable EN FIN de liste est gere cote application (repository).
-- =============================================================================
create or replace function public.reorder_template_fields(p_version_id uuid, p_field_ids uuid[])
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare n_given int; n_distinct int; n_real int; n_match int;
begin
  if not public.owns_template(public.template_of_version(p_version_id)) then
    raise exception 'Modification du gabarit non autorisee';
  end if;

  -- La liste doit contenir EXACTEMENT les champs de la version, chacun une seule fois
  -- (audit §8.3) : sinon un display_order incoherent (partiel / doublon / champ etranger).
  n_given    := cardinality(p_field_ids);
  n_distinct := (select count(distinct x) from unnest(p_field_ids) x);
  n_real     := (select count(*) from public.template_field where template_version_id = p_version_id);
  n_match    := (select count(*) from public.template_field
                  where template_version_id = p_version_id and id = any(p_field_ids));
  if n_given <> n_distinct or n_given <> n_real or n_match <> n_real then
    raise exception 'Liste de reordonnancement invalide : elle doit contenir exactement les % champs de la version, une fois chacun', n_real;
  end if;

  update public.template_field tf
     set display_order = pos.ord
    from (
      select id, (ordinality - 1)::int as ord
      from unnest(p_field_ids) with ordinality as u(id, ordinality)
    ) pos
   where tf.id = pos.id and tf.template_version_id = p_version_id;
end $$;

grant execute on function public.reorder_template_fields(uuid, uuid[]) to authenticated;
