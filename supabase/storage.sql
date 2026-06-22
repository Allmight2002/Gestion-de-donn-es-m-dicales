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

-- Chemin : <base_id>/<submission_id>/<uuid>.<ext>. Lecture = proprietaire OU curateur AYANT
-- RESERVE ce cas et TANT QUE la tache est active (submission_id = 2e dossier) — pas tout le
-- pool (§5.1), et l'acces se FERME apres finalisation/annulation (§7.3, via is_assigned_to_submission).
create policy "raw_documents_read" on storage.objects for select to authenticated
using (
  bucket_id = 'raw-documents'
  and (
    public.is_base_owner(((storage.foldername(name))[1])::uuid)
    or public.is_assigned_to_submission(((storage.foldername(name))[2])::uuid)
  )
);

create policy "raw_documents_insert" on storage.objects for insert to authenticated
with check (
  bucket_id = 'raw-documents'
  and public.is_base_owner(((storage.foldername(name))[1])::uuid)
);

create policy "raw_documents_delete" on storage.objects for delete to authenticated
using (
  bucket_id = 'raw-documents'
  and public.is_base_owner(((storage.foldername(name))[1])::uuid)
);

-- ---------------------------------------------------------------------------
-- 2) Pieces jointes cliniques (identite) — gouvernees par can_view/can_write_identity.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('clinical-attachments', 'clinical-attachments', false)
on conflict (id) do nothing;

drop policy if exists "clinical_attachments_read"   on storage.objects;
drop policy if exists "clinical_attachments_insert" on storage.objects;
drop policy if exists "clinical_attachments_delete" on storage.objects;

-- Lecture : seulement avec acces IDENTITE a la base (jamais system_admin, jamais analyste).
create policy "clinical_attachments_read" on storage.objects for select to authenticated
using (
  bucket_id = 'clinical-attachments'
  and public.can_view_identity(((storage.foldername(name))[1])::uuid)
);

-- Ecriture / suppression : acces ECRITURE identite (proprietaire ou editor+identite).
create policy "clinical_attachments_insert" on storage.objects for insert to authenticated
with check (
  bucket_id = 'clinical-attachments'
  and public.can_write_identity(((storage.foldername(name))[1])::uuid)
);

create policy "clinical_attachments_delete" on storage.objects for delete to authenticated
using (
  bucket_id = 'clinical-attachments'
  and public.can_write_identity(((storage.foldername(name))[1])::uuid)
);

-- ---------------------------------------------------------------------------
-- 3) Exports scientifiques conserves IMMUABLES (cahier §9.3). Chemin <base_id>/<cohort_id>/...
-- Insertion par can_export_data ; lecture par les personnes ayant acces a la base ;
-- AUCUNE politique update/delete => fichiers non modifiables (immuables).
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('scientific-exports', 'scientific-exports', false)
on conflict (id) do nothing;

drop policy if exists "scientific_exports_read"   on storage.objects;
drop policy if exists "scientific_exports_insert" on storage.objects;

create policy "scientific_exports_read" on storage.objects for select to authenticated
using (
  bucket_id = 'scientific-exports'
  and public.has_base_access(((storage.foldername(name))[1])::uuid)
);

create policy "scientific_exports_insert" on storage.objects for insert to authenticated
with check (
  bucket_id = 'scientific-exports'
  and public.can_export_data(((storage.foldername(name))[1])::uuid)
);
-- (pas de policy update/delete : conservation immuable)
