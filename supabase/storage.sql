-- =============================================================================
-- storage.sql  —  *** A APPLIQUER SUR UN VRAI PROJET SUPABASE (Storage) ***  (v3.0)
--
-- Le harness de test embarque ne fournit pas le service Storage : ce fichier
-- configure les buckets en PRODUCTION/local-CLI. La RLS des tables (deja dans les
-- migrations, testee) cloisonne les LIGNES ; ces politiques cloisonnent les OCTETS
-- (les buckets) avec les MEMES regles d'acces. Buckets prives -> acces uniquement
-- par URL signees temporaires.
--
-- Trois zones de stockage (cahier v3.0 §13) :
--   * raw-documents        : documents bruts (zone restreinte) -> can_view_raw_documents
--   * clinical-attachments : images / pieces cliniques (identite) -> can_view/can_write_identity
--   * scientific-exports   : exports figes IMMUABLES -> lecture base, ecriture can_export_data
--
-- Convention de chemin (cf. src/data/*) : <base_id>/<...>/<uuid>.<ext>
-- => le 1er dossier du chemin est la base ; on en deduit le controle d'acces.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1) Documents bruts du POOL (v3.0) — deposes par le medecin proprietaire, lus par lui
-- et par le staff de curation (curateur/validateur). Memes regles que la table raw_document.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('raw-documents', 'raw-documents', false)
on conflict (id) do nothing;

drop policy if exists "raw_documents_read"   on storage.objects;
drop policy if exists "raw_documents_insert" on storage.objects;
drop policy if exists "raw_documents_delete" on storage.objects;

-- §4.1 (audit v10) : AUCUNE policy SELECT pour `authenticated`. La lecture des octets passe
-- DESORMAIS uniquement par l'Edge Function `signed-read` (service_role, qui contourne la RLS et
-- JOURNALISE avant de signer). Un JWT utilisateur ne peut donc plus appeler `createSignedUrl()`
-- directement pour contourner l'audit. L'autorisation metier (proprietaire / curateur affecte) est
-- verifiee DANS l'Edge contre raw_document. [NB dev local sans Edge : lecture de fichiers indisponible.]

create policy "raw_documents_insert" on storage.objects for insert to authenticated
with check (
  bucket_id = 'raw-documents'
  and public.is_base_owner(((storage.foldername(name))[1])::uuid)
);

-- Pas de policy DELETE : les octets acceptes restent immuables. Toute suppression
-- documentaire passe par les RPC de soft delete des lignes metier.

-- ---------------------------------------------------------------------------
-- 2) Pieces jointes cliniques (identite) — gouvernees par can_view/can_write_identity.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('clinical-attachments', 'clinical-attachments', false)
on conflict (id) do nothing;

drop policy if exists "clinical_attachments_read"   on storage.objects;
drop policy if exists "clinical_attachments_insert" on storage.objects;
drop policy if exists "clinical_attachments_delete" on storage.objects;

-- §4.1 (audit v10) : AUCUNE policy SELECT pour `authenticated` (cf. raw-documents). La lecture des
-- images cliniques passe uniquement par l'Edge `signed-read` (service_role + audit). L'autorisation
-- (can_view_identity) est verifiee DANS l'Edge contre clinical_attachment.

-- Ecriture : acces ECRITURE identite (proprietaire ou editor+identite).
create policy "clinical_attachments_insert" on storage.objects for insert to authenticated
with check (
  bucket_id = 'clinical-attachments'
  and public.can_write_identity(((storage.foldername(name))[1])::uuid)
);

-- Pas de policy DELETE : les octets acceptes restent immuables. Toute suppression
-- documentaire passe par les RPC de soft delete des lignes metier.

-- ---------------------------------------------------------------------------
-- 3) Exports scientifiques conserves IMMUABLES (cahier §9.3). Chemin <base_id>/<cohort_id>/...
-- Insertion par can_export_data ; lecture uniquement via Edge `signed-read`
-- (audit avant signature). AUCUNE politique update/delete => fichiers immuables.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('scientific-exports', 'scientific-exports', false)
on conflict (id) do nothing;

drop policy if exists "scientific_exports_read"   on storage.objects;
drop policy if exists "scientific_exports_insert" on storage.objects;

create policy "scientific_exports_insert" on storage.objects for insert to authenticated
with check (
  bucket_id = 'scientific-exports'
  and public.can_export_data(((storage.foldername(name))[1])::uuid)
);
-- (pas de policy update/delete : conservation immuable)
