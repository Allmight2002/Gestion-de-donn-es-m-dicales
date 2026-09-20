-- =============================================================================
-- 20260920170000_template_editor_in_use_scan.sql
-- Deplacer une variable ou une section ne doit pas dependre du VOLUME du registre.
--
-- Symptome : « canceling statement due to statement timeout » quelques secondes
-- apres un glisser-deposer (ou une fleche « monter / descendre ») dans l'editeur
-- de jeu de variables. Le reordonnancement lui-meme est court ; c'est le
-- RECHARGEMENT qui suit chaque deplacement qui expire. L'ordre est bien enregistre
-- cote base, mais l'ecran ne se rafraichit jamais : vu de l'utilisateur, la
-- variable ou la section « refuse de bouger ».
--
-- Cause. Ce rechargement appelle `template_version_fields_in_use`, qui appelle
-- `template_field_in_use` UNE FOIS PAR VARIABLE ; chaque appel teste
-- `data ? field_key` sur `patient` ou `encounter`. Or :
--   * ni `patient.template_version_id` ni `encounter.template_version_id`
--     n'etaient indexes ;
--   * l'index GIN existant sur `data` est en `jsonb_path_ops`, qui ne repond
--     PAS a l'operateur `?` (il ne sert que `@>`).
-- Chaque variable declenchait donc un parcours COMPLET de la table. Le cout etait
-- O(variables x lignes du registre) a chaque rechargement, et une version
-- brouillon -- qui ne porte aucune donnee -- est le cas le PLUS defavorable :
-- aucun `exists` ne peut s'arreter avant la fin de la table.
--
-- Mesure sur PostgreSQL local, 200 variables (test/harness/db.ts) :
--   * version editee sans donnee, 20 000 patients + 20 000 rencontres ailleurs
--     dans le registre : 2 854 ms  ->  188 ms ;
--   * version editee portant 10 000 patients + 10 000 rencontres :
--     1 675 ms  ->  324 ms.
--
-- Deux changements, aucune donnee reecrite, aucune signature ni interface modifiee.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Scoper la recherche a la version concernee
-- -----------------------------------------------------------------------------
-- « Cette version porte-t-elle des donnees ? » est pose partout : par
-- `template_version_in_use` (garde de modification des regles, deplacement d'un
-- bloc, etat de la mise en page commune), par les instantanes hors-ligne, par la
-- suppression d'un gabarit. Sans index, chacune de ces questions parcourt tout le
-- registre. Le predicat partiel reprend celui des appelants (`deleted_at is null`)
-- et suit la convention des index de navigation (20260616094300).
create index if not exists ix_patient_version_active
  on public.patient (template_version_id)
  where deleted_at is null;

create index if not exists ix_encounter_version_active
  on public.encounter (template_version_id)
  where deleted_at is null;

-- -----------------------------------------------------------------------------
-- 2. Un seul parcours pour toutes les variables
-- -----------------------------------------------------------------------------
-- Les cles reellement saisies sous cette version sont relevees UNE FOIS, puis
-- confrontees aux variables. L'index ci-dessus borne ce releve aux lignes de la
-- version : sur une version brouillon il ne lit rien du tout.
--
-- Portee de cette fonction : elle alimente l'AFFICHAGE de l'editeur (griser le nom
-- et le type d'une variable deja renseignee). La garde qui FAIT AUTORITE reste
-- `template_field_in_use`, inchangee, appelee par `update_template_field` avant
-- tout changement semantique : la securite ne depend pas de cette reecriture.
--
-- `jsonb_object_keys` exige un objet. Le `case` le garantit ligne a ligne plutot
-- que de s'en remettre a l'ordre d'evaluation choisi par le planificateur ; toutes
-- les ecritures passent par des RPC qui imposent deja un objet.
create or replace function public.template_version_fields_in_use(p_version_id uuid)
returns setof uuid language sql stable security definer set search_path = public, pg_temp as $$
  with saisi as (
    select 'patient'::text as scope, k.key as field_key
      from public.patient p,
           lateral jsonb_object_keys(
             case when jsonb_typeof(p.data) = 'object' then p.data else '{}'::jsonb end
           ) k(key)
     where p.template_version_id = p_version_id and p.deleted_at is null
    union
    select 'encounter'::text, k.key
      from public.encounter e,
           lateral jsonb_object_keys(
             case when jsonb_typeof(e.data) = 'object' then e.data else '{}'::jsonb end
           ) k(key)
     where e.template_version_id = p_version_id and e.deleted_at is null
  )
  select tf.id
    from public.template_field tf
   where tf.template_version_id = p_version_id
     and exists (
       select 1 from saisi s
        where s.scope = tf.scope and s.field_key = tf.field_key
     )
$$;

revoke all on function public.template_version_fields_in_use(uuid) from public, anon;
grant execute on function public.template_version_fields_in_use(uuid) to authenticated;
