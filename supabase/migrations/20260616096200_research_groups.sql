-- =============================================================================
-- 20260616096200_research_groups.sql  (feature C2 v1 — groupes de recherche : etiquette d'organisation)
-- Un groupe de recherche REGROUPE plusieurs bases d'un meme medecin (unite de recherche gerant
-- plusieurs registres). Cette 1re version est une COUCHE D'ORGANISATION : elle ne change RIEN au
-- modele d'acces (l'octroi d'acces reste per-base, via les RPC auditees). Le groupe et ses
-- rattachements sont strictement PRIVES a leur proprietaire.
-- =============================================================================

-- Groupe : possede par un medecin, prive.
create table public.research_group (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  owner_user_id uuid not null references public.profiles(id) on delete cascade,
  created_at    timestamptz not null default now()
);
-- Le grant global de 090400 ne couvre que les tables d'alors : privileges explicites ici (la RLS
-- ci-dessous cloisonne les LIGNES ; sans grant, `authenticated` n'a aucun acces table).
grant select, insert, update, delete on public.research_group to authenticated;
alter table public.research_group enable row level security;
create policy rg_select on public.research_group for select to authenticated using (owner_user_id = auth.uid());
create policy rg_insert on public.research_group for insert to authenticated with check (owner_user_id = auth.uid() and public.is_medecin());
create policy rg_update on public.research_group for update to authenticated using (owner_user_id = auth.uid()) with check (owner_user_id = auth.uid());
create policy rg_delete on public.research_group for delete to authenticated using (owner_user_id = auth.uid());

-- Rattachement d'une base a un groupe. base_id est CLE PRIMAIRE -> une base appartient a au plus
-- un groupe (« etiquette »). Rattacher/detacher exige d'etre proprietaire DU GROUPE ET DE LA BASE.
create table public.research_group_base (
  base_id   uuid primary key references public.base(id) on delete cascade,
  group_id  uuid not null references public.research_group(id) on delete cascade,
  added_at  timestamptz not null default now()
);
create index research_group_base_group_idx on public.research_group_base (group_id);
grant select, insert, update, delete on public.research_group_base to authenticated;
alter table public.research_group_base enable row level security;

create policy rgb_select on public.research_group_base for select to authenticated using (
  exists (select 1 from public.research_group g where g.id = group_id and g.owner_user_id = auth.uid())
);
create policy rgb_insert on public.research_group_base for insert to authenticated with check (
  exists (select 1 from public.research_group g where g.id = group_id and g.owner_user_id = auth.uid())
  and public.is_base_owner(base_id)
);
create policy rgb_delete on public.research_group_base for delete to authenticated using (
  exists (select 1 from public.research_group g where g.id = group_id and g.owner_user_id = auth.uid())
);
