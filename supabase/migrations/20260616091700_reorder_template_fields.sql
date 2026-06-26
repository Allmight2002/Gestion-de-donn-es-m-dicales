-- =============================================================================
-- 20260616091700_reorder_template_fields.sql
-- Reordonner les variables d'un gabarit (drag & drop cote interface). L'ordre est
-- porte par template_field.display_order ; cette RPC le reaffecte d'apres l'ordre
-- fourni. owns_template requis (medecin proprietaire / admin pour un modele global).
-- L'ajout d'une variable EN FIN de liste est gere cote application (repository).
-- =============================================================================
create or replace function public.reorder_template_fields(p_version_id uuid, p_field_ids uuid[])
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.owns_template(public.template_of_version(p_version_id)) then
    raise exception 'Modification du gabarit non autorisee';
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
