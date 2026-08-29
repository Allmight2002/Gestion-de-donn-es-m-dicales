-- =============================================================================
-- 20260819103000_export_completeness_filter.sql
-- L'export cesse d'exiger des fiches FINALISEES (decision du 2026-08-17, §1-§2).
-- La porte de l'export devient la COMPLETUDE des champs obligatoires, pas le
-- statut de validation : une fiche `draft` ou `complete` s'exporte des lors
-- qu'elle porte ses champs requis.
--
-- Cette migration ne change AUCUNE regle de saisie : elle expose la definition
-- de completude deja en vigueur (`assert_required_complete`) sous une forme
-- INTERROGEABLE, pour que l'export puisse ecarter et COMPTER au lieu de refuser.
--
-- 1. `missing_required_fields` : la definition unique de « champ requis manquant ».
-- 2. `assert_required_complete` : redefinie POUR L'UTILISER (meme message, meme
--    regle) -- une seule definition, donc aucune derive possible entre la porte
--    de l'export et la porte de la saisie.
-- 3. `export_incomplete_records` : les fiches d'une cohorte a ecarter de l'export.
--
-- Migration ADDITIVE : redefinit des fonctions, n'ecrit aucune donnee.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. La definition unique : quels champs requis manquent a cette fiche ?
-- -----------------------------------------------------------------------------
-- Rappel de la regle, inchangee :
--   * manquant = cle absente, `null` JSON, ou chaine vide ;
--   * une valeur manquante CODIFIEE ({"__missing__": ...}) est un objet : elle ne
--     satisfait aucun de ces tests, donc elle compte comme RENSEIGNEE ;
--   * un champ de rencontre restreint a certains types n'est requis que pour eux ;
--   * un champ MASQUE par une regle d'affichage n'est jamais reclame (L32).
--
-- Le masquage est evalue SEULEMENT si quelque chose manque deja en surface : il
-- ne peut qu'alleger l'exigence, jamais l'ajouter. Une fiche complete ne paie
-- donc pas le cout du calcul de visibilite -- ce qui rend le filtre d'export
-- tenable sur des dizaines de milliers de rencontres.
create or replace function public.missing_required_fields(
  p_version uuid, p_scope text, p_data jsonb, p_encounter_type text default null
)
returns setof text language plpgsql stable set search_path = public, pg_temp as $$
declare
  v_keys   text[];
  v_labels text[];
  v_hidden text[];
begin
  select array_agg(f.field_key order by f.display_order, f.field_key),
         array_agg(coalesce(f.label, f.field_key) order by f.display_order, f.field_key)
    into v_keys, v_labels
    from public.template_field f
   where f.template_version_id = p_version
     and f.scope = p_scope
     and f.required = true
     -- Champ de rencontre restreint a certains types : requis SEULEMENT pour ces
     -- types. Type inconnu (null) -> on n'allege pas (conservateur).
     and (
       p_scope <> 'encounter'
       or p_encounter_type is null
       or f.encounter_types is null
       or cardinality(f.encounter_types) = 0
       or p_encounter_type = any(f.encounter_types)
     )
     and (
       p_data is null
       or not (p_data ? f.field_key)
       or (p_data -> f.field_key) is null
       or jsonb_typeof(p_data -> f.field_key) = 'null'
       or (jsonb_typeof(p_data -> f.field_key) = 'string' and ((p_data -> f.field_key) #>> '{}') = '')
     );

  if v_keys is null then return; end if;

  -- L32 : masque -> pas obligatoire. Sinon la fiche devient invalidable a l'aveugle.
  v_hidden := public.visibility_hidden_fields(p_version, p_data);
  return query
    select v_labels[i]
      from generate_subscripts(v_keys, 1) as i
     where not (v_keys[i] = any(v_hidden));
end $$;

-- La saisie (trigger `assert_curated_complete`, RPC, import) appelle cette
-- fonction avec les droits de l'appelant : `authenticated` doit pouvoir
-- l'executer, comme `visibility_hidden_fields` qu'elle utilise.
grant execute on function public.missing_required_fields(uuid, text, jsonb, text) to authenticated;

-- -----------------------------------------------------------------------------
-- 2. La porte de la SAISIE, redefinie sur la meme definition
-- -----------------------------------------------------------------------------
-- Comportement identique : meme regle, meme message. Seule difference, le champ
-- nomme quand plusieurs manquent est desormais DETERMINISTE (ordre du gabarit).
create or replace function public.assert_required_complete(
  p_version uuid, p_scope text, p_data jsonb, p_encounter_type text default null
)
returns void language plpgsql stable set search_path = public, pg_temp as $$
declare v_label text;
begin
  select m into v_label
    from public.missing_required_fields(p_version, p_scope, p_data, p_encounter_type) as m
   limit 1;
  if v_label is not null then
    raise exception 'Champ requis manquant : %', v_label;
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 3. Les fiches d'une cohorte a ecarter de l'export
-- -----------------------------------------------------------------------------
-- Renvoie un SUR-ENSEMBLE volontaire : tous les patients membres, et toutes les
-- rencontres que l'export peut atteindre (membres de cohorte de rencontres OU
-- rencontres des patients membres), sans tenir compte de l'option de portee.
-- L'Edge Function croise ce resultat avec CE QU'ELLE A REELLEMENT LU : une fiche
-- listee ici qu'elle n'exporte pas est ignoree, mais aucune fiche exportee ne
-- peut echapper au filtre. La portee n'est donc definie qu'a UN seul endroit.
--
-- SECURITY INVOKER : aucune elevation. Appelee par l'Edge avec `service_role`,
-- apres que celle-ci a verifie `can_export_data` pour l'utilisateur.
create or replace function public.export_incomplete_records(p_cohort_id uuid)
returns table (record_kind text, record_id uuid)
language sql stable set search_path = public, pg_temp as $$
  select 'patient'::text, p.id
    from public.cohort_member cm
    join public.patient p on p.id = cm.patient_id
   where cm.cohort_id = p_cohort_id
     and p.deleted_at is null
     and exists (
       select 1 from public.missing_required_fields(p.template_version_id, 'patient', p.data)
     )
  union
  select 'encounter'::text, e.id
    from public.encounter e
   where e.deleted_at is null
     and (
       e.id in (
         select cem.encounter_id from public.cohort_encounter_member cem
          where cem.cohort_id = p_cohort_id
       )
       or e.patient_id in (
         select cm.patient_id from public.cohort_member cm where cm.cohort_id = p_cohort_id
       )
     )
     and exists (
       select 1 from public.missing_required_fields(
         e.template_version_id, 'encounter', e.data, e.encounter_type
       )
     );
$$;

revoke execute on function public.export_incomplete_records(uuid) from public, anon, authenticated;
grant execute on function public.export_incomplete_records(uuid) to service_role;

-- L'Edge Function appelle `export_incomplete_records` via PostgREST : sans rechargement du
-- cache de schema, l'appel echouerait (et l'export refuserait, fail-closed).
notify pgrst, 'reload schema';
