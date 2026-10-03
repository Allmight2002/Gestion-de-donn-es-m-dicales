-- Recherche patient GLOBALE : un seul champ, sans choisir au prealable « code » ou « identite ».
--
-- Le terme est compare au code patient ET, quand l'appelant y a droit, au nom. Les garanties de
-- `search_patient_ids_by_identity` (20260912160000) sont reprises a l'identique :
--   - l'operation ne rend que des IDENTIFIANTS et un total, jamais un nom ; la ligne affichee
--     est ensuite relue par le chemin analytique habituel, sous la RLS (RG-9) ;
--   - la partie nominative exige le ROLE (`is_medecin`) ET la PERMISSION sur CETTE base
--     (`can_view_identity`), et un terme d'au moins deux caracteres ;
--   - l'acces nominatif est journalise sans le terme saisi ;
--   - l'ordre est celui du code, jamais celui du nom.
-- Sans droit d'identite, la recherche reste celle du code, avec exactement la visibilite de la
-- policy `p_select` sur `patient` (`has_base_access` et ligne non supprimee) : un appelant sans
-- acces a la base ne recoit rien, comme une recherche sans resultat.
--
-- Migration additive : `search_patient_ids_by_identity` reste en place pour les clients deja
-- deployes.

/**
 * Identifiants des patients d'une base dont le code, ou le nom si l'appelant y a droit,
 * contient le terme cherche. `p_term` est du TEXTE, jamais un motif.
 */
create function public.search_patient_ids(
  p_base_id uuid, p_term text, p_limit int default 20, p_offset int default 0
) returns table (patient_id uuid, total bigint)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_term text;
  v_code_pattern text;
  v_name_pattern text;
  v_identity boolean;
  v_limit int;
  v_offset int;
begin
  if auth.uid() is null then raise exception 'Authentification requise'; end if;

  v_term := btrim(coalesce(p_term, ''));
  if v_term = '' then return; end if;

  -- Meme visibilite que la policy de lecture de `patient` : sans acces, rien.
  if not public.has_base_access(p_base_id) then return; end if;

  v_limit := least(greatest(coalesce(p_limit, 20), 1), 50);
  v_offset := greatest(coalesce(p_offset, 0), 0);
  v_code_pattern := '%' || replace(replace(replace(v_term, '\', '\\'), '%', '\%'), '_', '\_') || '%';

  -- Partie nominative : role ET permission sur cette base, terme suffisamment long.
  v_identity := char_length(v_term) >= 2
    and public.is_medecin()
    and public.can_view_identity(p_base_id);

  if v_identity then
    v_name_pattern := '%' || replace(replace(replace(
      public.identity_search_normalize(v_term), '\', '\\'), '%', '\%'), '_', '\_') || '%';
    -- Journalisation de l'ACCES nominatif, jamais du terme ni de ce qu'il a revele.
    insert into public.audit_log (user_id, action, entity, entity_id, base_id, metadata)
    values (auth.uid(), 'identity_search', 'base', p_base_id, p_base_id, '{}'::jsonb);
  end if;

  return query
    with correspondances as (
      select p.id, p.patient_code
      from public.patient p
      where p.base_id = p_base_id
        and p.deleted_at is null
        and (
          p.patient_code ilike v_code_pattern
          or (v_identity and exists (
            select 1 from public.patient_identity pi
            where pi.base_id = p.base_id and pi.patient_code = p.patient_code
              and pi.deleted_at is null
              and public.identity_search_normalize(pi.full_name) like v_name_pattern
          ))
        )
    )
    select c.id, count(*) over ()::bigint
    from correspondances c
    order by c.patient_code, c.id
    limit v_limit offset v_offset;
end $$;
revoke all on function public.search_patient_ids(uuid, text, int, int) from public, anon;
grant execute on function public.search_patient_ids(uuid, text, int, int) to authenticated;
