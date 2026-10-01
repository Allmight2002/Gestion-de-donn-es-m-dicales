-- =============================================================================
-- 20261001140000_terminology_candidates_acronyms.sql  (codage assiste : sigles courts)
--
-- POURQUOI. « Pneumonie ... sur terrain HIV » : la recherche de candidats ecartait tout mot de
-- moins de quatre lettres, donc les sigles de trois lettres (VIH, HIV, AVC, IRC...) que portent
-- aussi les intitules (« Maladie due au VIH stade clinique 1 ... »). Les mots de trois
-- lettres sont desormais retenus, sauf les mots-outils, et ne sont pas reduits a une racine.
--
-- ADDITIVE. Redefinition de `match_terminology_candidates` (20261001120000) a l'identique
-- hors ce filtre. Signature, SECURITY INVOKER et droits inchanges. Retour arriere : restaurer
-- la definition de 20261001120000.
-- =============================================================================

create or replace function public.match_terminology_candidates(p_terms text[], p_limit integer default 40)
returns table (id uuid, code text, label text, uri text, release_version text, hits integer)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with active as (
    select r.id, r.version from public.terminology_release r where r.is_active limit 1
  ),
  terms as (
    select t.term
    from unnest(coalesce(p_terms, '{}'::text[])) with ordinality t(term, n)
    where t.term is not null and length(t.term) <= 200 and t.n <= 8
  ),
  words as (
    -- Les sigles de trois lettres (VIH, HIV, AVC, IRC…) comptent desormais : ils ne sont pas
    -- reduits a une racine, et les mots-outils de trois lettres restent ecartes.
    select distinct case when length(w) >= 4 then regexp_replace(w, '(es|e|s)$', '') else w end as stem
    from terms,
         lateral regexp_split_to_table(
           replace(replace(public.terminology_normalize(terms.term), '-', ''), 'oe', 'o'), '[^a-z0-9]+') w
    where (length(w) >= 4
           or (length(w) = 3 and w ~ '^[a-z]+$'
               and w not in ('des', 'les', 'une', 'par', 'sur', 'aux', 'non', 'est', 'pas', 'que',
                             'qui', 'son', 'ses', 'due', 'dus', 'ans', 'tel', 'peu')))
      and w not in ('avec', 'sans', 'dans', 'pour', 'autre', 'autres', 'precision', 'precise',
                    'precisee', 'specifie', 'specifiee', 'type', 'cause', 'suite', 'droit',
                    'droite', 'gauche', 'bilateral', 'bilaterale')
    limit 24
  ),
  concepts as (
    -- « oe » saisi et « œ » des intitules (ramene a « o » par terminology_normalize) se rejoignent.
    select c.id, c.code, c.label, c.uri, a.version, replace(replace(c.search_text, '-', ''), 'oe', 'o') as m
    from public.terminology_concept c
    join active a on a.id = c.release_id
    where c.is_selectable
  )
  select c.id, c.code, c.label, c.uri, c.version, count(*)::integer as hits
  from concepts c
  join words w on c.m like '%' || w.stem || '%'
  group by c.id, c.code, c.label, c.uri, c.version
  order by count(*) desc, length(c.label), c.label
  limit least(greatest(coalesce(p_limit, 40), 1), 80)
$$;

comment on function public.match_terminology_candidates(text[], integer) is
  'Candidats du referentiel actif pour des termes cliniques normalises (8 termes, 80 resultats au plus). Pre-tri par mots retrouves ; le score final est calcule par l''appelant.';

revoke all on function public.match_terminology_candidates(text[], integer) from public, anon;
grant execute on function public.match_terminology_candidates(text[], integer) to authenticated;
