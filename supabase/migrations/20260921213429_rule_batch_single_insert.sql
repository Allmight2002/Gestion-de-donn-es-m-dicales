-- Un lot multiple de regles doit rester une seule instruction SQL. Le trigger
-- d'invariants est AFTER STATEMENT : une instruction par cible relancerait la
-- validation de toute la version autant de fois qu'il y a de regles creees.
create or replace function public.create_rule_batch(
  p_version_id uuid, p_operation_id uuid, p_payload jsonb, p_expected_fingerprint text
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_op public.rule_batch_operation;
  v_hash text;
  v_plan jsonb;
  v_created jsonb := '[]'::jsonb;
  v_receipt jsonb;
  v_message text;
  v_severity text;
  v_error_details jsonb;
begin
  perform public.assert_rule_batch_access(p_version_id);
  if p_operation_id is null or p_expected_fingerprint is null then
    perform public.rule_batch_error('RULE_BATCH_INVALID');
  end if;
  -- Serialise les cles d'operation d'un meme auteur avant tout verrou de version.
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text, 94517));
  v_hash := md5(jsonb_build_array('create_rule_batch', p_version_id, p_payload)::text);
  select * into v_op from public.rule_batch_operation
    where owner_id = auth.uid() and operation_id = p_operation_id;
  if found then
    if v_op.request_hash <> v_hash then perform public.rule_batch_error('RULE_BATCH_OPERATION_CONFLICT'); end if;
    return v_op.receipt;
  end if;

  -- Verrou de version : deux lots concurrents ne peuvent pas s'entrelacer, et le declencheur
  -- d'invariants voit un etat stable.
  perform 1 from public.template_version where id = p_version_id for update;
  if public.template_version_locked(p_version_id) then
    perform public.rule_batch_error('RULE_BATCH_VERSION_LOCKED');
  end if;
  -- Une version deja servie a des dossiers est figee par le garde existant. Le refus est
  -- rendu ici comme un etat compris, et non comme une exception de declencheur.
  if public.template_version_in_use(p_version_id) then
    perform public.rule_batch_error('RULE_BATCH_VERSION_IN_USE');
  end if;
  if public.template_version_rule_fingerprint(p_version_id) is distinct from p_expected_fingerprint then
    perform public.rule_batch_error('RULE_BATCH_CONFLICT');
  end if;

  v_plan := public.rule_batch_plan(p_version_id, p_payload);
  if jsonb_array_length(v_plan -> 'invalid') > 0 then
    -- Une seule cible refusee suffit a tout refuser : il n'existe pas de reussite partielle
    -- cachee, et l'ecran garde sa condition et ses cibles pour correction.
    perform public.rule_batch_error('RULE_BATCH_INVALID_TARGET', jsonb_build_object('targets', v_plan -> 'invalid'));
  end if;

  v_message := nullif(p_payload ->> 'message', '');
  v_severity := v_plan ->> 'severity';
  if jsonb_array_length(v_plan -> 'create') > 0 then
    begin
      -- Les cibles du plan sont dedupliquees. On insere toutes les regles en un seul
      -- statement, puis on associe chaque identifiant a sa cible et on preserve l'ordre
      -- d'origine dans le recu d'idempotence.
      with planned as materialized (
        select e.item ->> 'target' as target,
               e.item -> 'rule' as rule,
               e.ordinality
          from jsonb_array_elements(v_plan -> 'create') with ordinality as e(item, ordinality)
      ),
      inserted as (
        insert into public.validation_rule (template_version_id, rule, message, severity)
        select p_version_id, p.rule, v_message, v_severity
          from planned p
         order by p.ordinality
        returning id, rule
      )
      select coalesce(
        jsonb_agg(jsonb_build_object('id', i.id, 'target', p.target) order by p.ordinality),
        '[]'::jsonb
      )
        into v_created
        from inserted i
        join planned p on p.rule = i.rule;
    exception when others then
      -- Le statement est atomique : toute erreur d'une cible annule les insertions du lot.
      -- Conserver `target` pour un lot d'une seule cible; un lot multiple expose la liste,
      -- puisqu'une erreur de statement ne permet pas d'attribuer le refus a une seule ligne.
      v_error_details := jsonb_build_object('targets', (
          select coalesce(jsonb_agg(e.item ->> 'target' order by e.ordinality), '[]'::jsonb)
            from jsonb_array_elements(v_plan -> 'create') with ordinality as e(item, ordinality)
        ));
      if jsonb_array_length(v_plan -> 'create') = 1 then
        v_error_details := v_error_details || jsonb_build_object(
          'target', v_plan -> 'create' -> 0 ->> 'target'
        );
      end if;
      v_error_details := v_error_details || jsonb_build_object('reason', sqlerrm);
      perform public.rule_batch_error('RULE_BATCH_REFUSED', v_error_details);
    end;
  end if;

  v_receipt := jsonb_build_object(
    'created', v_created,
    'duplicates', v_plan -> 'duplicates',
    'fingerprint', public.template_version_rule_fingerprint(p_version_id));
  insert into public.rule_batch_operation (owner_id, operation_id, template_version_id, request_hash, receipt)
  values (auth.uid(), p_operation_id, p_version_id, v_hash, v_receipt);
  return v_receipt;
end $$;
revoke all on function public.create_rule_batch(uuid, uuid, jsonb, text) from public, anon;
grant execute on function public.create_rule_batch(uuid, uuid, jsonb, text) to authenticated;
