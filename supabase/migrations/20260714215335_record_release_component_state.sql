-- Etat serveur minimal des composants appliques hors du flux db push.
-- storage.sql est execute separement car il cible le schema gere par Supabase Storage.
create table public.release_component_state (
  component text primary key
    check (component ~ '^[a-z0-9][a-z0-9._/-]{0,99}$'),
  sha256 text not null
    check (sha256 ~ '^[0-9a-f]{64}$'),
  applied_at timestamptz not null default now(),
  applied_by name not null default current_user
);

comment on table public.release_component_state is
  'Empreinte des composants de release appliques hors migrations; aucune donnee clinique.';

alter table public.release_component_state enable row level security;

-- Double fermeture : aucun privilege Data API et une policy explicitement deny-all.
revoke all on table public.release_component_state from public, anon, authenticated;
create policy release_component_state_no_client_access
  on public.release_component_state
  for all
  to anon, authenticated
  using (false)
  with check (false);
