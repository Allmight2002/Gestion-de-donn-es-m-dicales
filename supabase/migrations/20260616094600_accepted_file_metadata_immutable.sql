-- =============================================================================
-- 20260616094600_accepted_file_metadata_immutable.sql  (audit v12 §6.3)
-- Le garde-fou §4.2 empeche un utilisateur de POSER inspection_status='accepted', mais une fois la
-- ligne deja `accepted`, ses autres colonnes restaient modifiables : un proprietaire pouvait changer
-- storage_path / file_hash / file_size... -> le statut « accepte » ne garantissait plus que le fichier
-- consulte etait bien CELUI qui avait ete inspecte. On rend donc immuables, apres acceptation, les
-- colonnes qui definissent « le fichier inspecte » (octets, pointeur, liens, auteur, et le statut
-- lui-meme : `accepted` devient terminal cote utilisateur). Le contexte SERVEUR (auth.uid() null :
-- scanner / Edge) reste libre. La suppression logique (deleted_at) n'est pas verrouillee.
-- Concerne clinical_attachment ET raw_document (meme fonction trigger, colonnes comparees via jsonb
-- pour ignorer sans risque celles absentes d'une table). Migration ADDITIVE (redefinit la fonction ;
-- les triggers 093700 la referencent deja).
-- =============================================================================
create or replace function public.guard_inspection_status()
returns trigger language plpgsql set search_path = public, pg_temp as $$
declare
  col text;
  protected constant text[] := array[
    'inspection_status','storage_path','file_hash','file_size','mime_type','detected_mime_type',
    'patient_id','encounter_id','submission_id','base_id','created_by'
  ];
begin
  -- §4.2 : le verdict serveur ('accepted'/'quarantined') reste reserve au contexte serveur.
  if auth.uid() is not null
     and new.inspection_status in ('accepted','quarantined')
     and (TG_OP = 'INSERT' or new.inspection_status is distinct from old.inspection_status) then
    raise exception 'Statut d''inspection « % » reserve au serveur (scanner) ; cote client : pending / accepted_client', new.inspection_status;
  end if;

  -- §6.3 : apres acceptation, un utilisateur ne peut plus alterer les octets / le pointeur / les liens
  -- (le fichier consulte doit rester CELUI qui a ete inspecte). to_jsonb(...) ->> col compare chaque
  -- colonne en texte ; une colonne absente d'une table donne null des deux cotes -> jamais bloquante.
  if TG_OP = 'UPDATE' and old.inspection_status = 'accepted' and auth.uid() is not null then
    foreach col in array protected loop
      if (to_jsonb(new) ->> col) is distinct from (to_jsonb(old) ->> col) then
        raise exception 'Fichier deja inspecte (accepted) : la colonne « % » est immuable', col;
      end if;
    end loop;
  end if;

  return new;
end $$;
