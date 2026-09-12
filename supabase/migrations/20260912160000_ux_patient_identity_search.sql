-- UX-12(c) / L64 — retrouver un patient par son NOM, dans une base, sans exposer l'identite.
--
-- Ce que cette operation rend, et ce qu'elle ne rend pas. Elle rend des IDENTIFIANTS de
-- patients ; jamais un nom, une date de naissance, ni aucune autre donnee d'identite. La ligne
-- affichee ensuite est la ligne analytique habituelle, lue par le client sous la RLS existante :
-- le contrat UX-0 exige que les resultats soient presentes par code et par donnee analytique
-- (RG-9), et c'est cette separation qui le garantit — pas une precaution d'ecran.
--
-- Pourquoi une fonction privilegiee. `patient_identity` a la RLS activee et AUCUNE policy :
-- aucun client ne la lit directement, par construction. Resoudre un nom en identifiants demande
-- donc de traverser cette frontiere, une fois, dans une fonction qui verifie elle-meme
-- l'autorisation, journalise l'acces, et ne laisse rien filtrer d'autre que des identifiants.
--
-- Deux verrous, pas un seul, conformement a la decision du 2026-08-20 : le ROLE gouverne
-- l'affichage du champ (`is_medecin`), la PERMISSION gouverne les donnees qu'il peut faire
-- remonter (`can_view_identity` sur CETTE base). Un medecin editeur de la base d'un confrere,
-- sans droit d'identite sur celle-ci, ne retrouve donc personne par son nom.
--
-- Non-divulgation : un appelant sans droit recoit exactement ce que recoit une recherche sans
-- resultat — aucune ligne, aucun total, aucun message distinctif. C'est la convention deja
-- suivie par `get_patient_identity`, et elle vaut mieux qu'une erreur qui confirmerait
-- l'existence de la base ou du patient.

-- Comparaison insensible a la casse ET aux accents. `ilike` seul ne rapproche pas « Andre » et
-- « André », ce qui rend la recherche inutilisable sur des noms francais des la premiere faute
-- de frappe. La table de correspondance est explicite plutot que dependante d'une extension
-- (`unaccent`) dont la presence n'est pas garantie sur la cible.
create function public.identity_search_normalize(p_value text) returns text
language sql immutable set search_path = public, pg_temp as $$
  select lower(translate(coalesce(p_value, ''),
    'àáâãäåçèéêëìíîïñòóôõöùúûüýÿÀÁÂÃÄÅÇÈÉÊËÌÍÎÏÑÒÓÔÕÖÙÚÛÜÝ',
    'aaaaaaceeeeiiiinooooouuuuyyaaaaaaceeeeiiiinooooouuuuy'));
$$;
revoke all on function public.identity_search_normalize(text) from public, anon, authenticated;

/**
 * Identifiants des patients d'une base dont le nom contient le terme cherche.
 *
 * `p_term` est traite comme du TEXTE, jamais comme un motif : les caracteres speciaux de
 * `like` y sont echappes. Aucun SQL n'est construit dynamiquement.
 */
create function public.search_patient_ids_by_identity(
  p_base_id uuid, p_term text, p_limit int default 20, p_offset int default 0
) returns table (patient_id uuid, total bigint)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_term text;
  v_pattern text;
  v_limit int;
  v_offset int;
begin
  if auth.uid() is null then raise exception 'Authentification requise'; end if;

  -- Un terme trop court ramenerait la base entiere : ce n'est pas une recherche, et ce n'est
  -- pas non plus un refus — l'ecran demande simplement d'en saisir davantage.
  v_term := btrim(coalesce(p_term, ''));
  if char_length(v_term) < 2 then return; end if;

  -- Role ET permission sur CETTE base. L'absence de base et l'absence de droit rendent la
  -- meme chose : rien.
  if not public.is_medecin() then return; end if;
  if not exists (select 1 from public.base b where b.id = p_base_id) then return; end if;
  if not public.can_view_identity(p_base_id) then return; end if;

  v_limit := least(greatest(coalesce(p_limit, 20), 1), 50);
  v_offset := greatest(coalesce(p_offset, 0), 0);
  v_pattern := '%' || replace(replace(replace(
    public.identity_search_normalize(v_term), '\', '\\'), '%', '\%'), '_', '\_') || '%';

  -- Journalisation de l'ACCES, jamais du terme saisi ni de ce qu'il a revele : le journal ne
  -- doit pas devenir l'endroit ou l'identite recherchee reste lisible.
  insert into public.audit_log (user_id, action, entity, entity_id, base_id, metadata)
  values (auth.uid(), 'identity_search', 'base', p_base_id, p_base_id, '{}'::jsonb);

  -- L'ordre est celui du CODE patient, pas celui du nom : trier par nom ferait de la position
  -- d'une ligne un indice alphabetique sur une donnee que l'appel ne rend pas.
  return query
    with correspondances as (
      select p.id, p.patient_code
      from public.patient p
      join public.patient_identity pi
        on pi.base_id = p.base_id and pi.patient_code = p.patient_code and pi.deleted_at is null
      where p.base_id = p_base_id
        and p.deleted_at is null
        and public.identity_search_normalize(pi.full_name) like v_pattern
    )
    select c.id, count(*) over ()::bigint
    from correspondances c
    order by c.patient_code, c.id
    limit v_limit offset v_offset;
end $$;
revoke all on function public.search_patient_ids_by_identity(uuid, text, int, int) from public, anon;
grant execute on function public.search_patient_ids_by_identity(uuid, text, int, int) to authenticated;
