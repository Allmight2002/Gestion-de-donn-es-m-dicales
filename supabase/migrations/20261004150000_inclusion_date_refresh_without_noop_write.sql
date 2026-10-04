-- Date d'inclusion : ne reecrire la fiche patient que si la date change.
--
-- `refresh_patient_inclusion_date` (20260616097800) est appelee par le declencheur
-- `trg_refresh_patient_inclusion_date` a chaque insertion de rencontre (et a chaque
-- changement de date, de patient ou de suppression). Elle faisait un UPDATE de la fiche
-- meme quand la date calculee etait identique. Cet UPDATE vide declenchait
-- `trg_patient_row_version` : la revision de la fiche avancait sans aucun changement.
--
-- Consequence visible : une occurrence de groupe repetable (rencontre sans date) ajoutee
-- depuis l'ecran de modification de la fiche faisait avancer la revision de cette fiche.
-- L'enregistrement de la fiche ouverte etait alors refuse (FORM_RECORD_CONFLICT /
-- CONFLIT_VERSION) et demandait un rechargement, alors que personne ne l'avait modifiee.
--
-- Seule la condition d'ecriture change : la valeur calculee est la meme qu'avant, et une
-- date qui change reellement fait toujours avancer la revision. Signature, droits et
-- declencheur sont inchanges.
--
-- Retour arriere : recreer la fonction de 20260616097800 (sans la condition).

begin;

create or replace function public.refresh_patient_inclusion_date(p_patient_id uuid)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  with computed as (
    select p.id, coalesce(
      (select min(e.encounter_date) from public.encounter e where e.patient_id = p.id and e.deleted_at is null),
      p.inclusion_date,
      p.created_at::date
    ) as inclusion_date
    from public.patient p
    where p.id = p_patient_id
  )
  update public.patient p
     set inclusion_date = computed.inclusion_date
    from computed
   where p.id = computed.id
     and p.inclusion_date is distinct from computed.inclusion_date;
$$;
revoke all on function public.refresh_patient_inclusion_date(uuid) from public, anon, authenticated;

commit;
