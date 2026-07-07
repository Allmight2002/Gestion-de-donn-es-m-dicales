-- =============================================================================
-- 20260616097200_research_group_name_not_blank.sql
-- Audit v16 P2: le serveur ne doit pas accepter de groupe de recherche au nom vide
-- ou compose uniquement d'espaces. Le frontend nettoie deja, mais la DB reste la source
-- de verite face a un client personnalise.
-- =============================================================================

update public.research_group
set name = 'Groupe sans nom ' || left(id::text, 8)
where btrim(name) = '';

alter table public.research_group
  add constraint research_group_name_not_blank check (btrim(name) <> '');
