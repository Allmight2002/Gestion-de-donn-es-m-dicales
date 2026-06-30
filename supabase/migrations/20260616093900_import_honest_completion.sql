-- =============================================================================
-- 20260616093900_import_honest_completion.sql  (audit v10 §4.6 / §4.7)
-- §4.6 : un lot d'import contenant des lignes en ERREUR pouvait etre marque 'completed' (succes
--        plein implicite). On introduit un statut HONNETE : si error_count > 0, le lot devient
--        'completed_with_errors' (et NE bloque PAS la reimportation -> on peut corriger + rejouer
--        les lignes en erreur ; seul 'completed' verrouille l'empreinte du fichier).
-- §4.7 : la cloture exigeait row_count >= expected_rows (un DEPASSEMENT — chunk envoye deux fois —
--        passait). On exige desormais l'EGALITE stricte row_count = expected_rows.
-- Migration ADDITIVE.
-- =============================================================================

-- §4.6 : nouveau statut de lot.
alter table public.import_batch drop constraint if exists import_batch_status_check;
alter table public.import_batch add constraint import_batch_status_check
  check (status in ('processing','completed','completed_with_errors','cancelled','failed'));

create or replace function public.complete_import_batch(p_batch_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_batch public.import_batch;
begin
  select * into v_batch from public.import_batch where id = p_batch_id for update;
  if not found then raise exception 'Lot d''import introuvable'; end if;
  if not public.can_edit_structured_data(v_batch.base_id) then raise exception 'Acces refuse'; end if;
  if v_batch.imported_by is distinct from auth.uid() then raise exception 'Lot d''import d''un autre utilisateur'; end if;
  if v_batch.status <> 'processing' then raise exception 'Lot deja cloture (statut=%)', v_batch.status; end if;
  -- §4.7 : autant de lignes recues qu'annonce, NI MOINS (chunk manquant) NI PLUS (chunk en double).
  if v_batch.expected_rows is not null and v_batch.row_count <> v_batch.expected_rows then
    raise exception 'Lot incomplet ou incoherent : % ligne(s) recue(s) pour % attendue(s) ; clture refusee.',
      v_batch.row_count, v_batch.expected_rows;
  end if;
  -- §4.6 : statut HONNETE selon la presence d'erreurs (pas de « termine » trompeur).
  update public.import_batch
     set status = case when v_batch.error_count > 0 then 'completed_with_errors' else 'completed' end,
         completed_at = now(), updated_at = now()
   where id = p_batch_id;
end $$;
grant execute on function public.complete_import_batch(uuid) to authenticated;
