-- UX-14(c) : appliquer une meme condition a plusieurs variables en UNE operation serveur.
--
-- Les regles produites sont des regles ORDINAIRES : aucun langage multicible n'est introduit,
-- et l'evaluation des dossiers reste inchangee. Ce qui change, c'est le CONTRAT d'ecriture :
-- une boucle d'insertions depuis le navigateur laisserait la moitie des regles creees apres un
-- refus sur la troisieme cible. Ici, le lot est valide puis ecrit en une transaction, rejouable
-- avec la meme cle d'operation, et refuse en bloc si la version a change depuis l'apercu.
--
-- Les invariants de regle existants ne sont PAS reecrits : assert_rule_structure,
-- assert_rule_calculated_operands et assert_visibility_acyclic restent la seule definition de
-- ce qu'est une regle valide, et le declencheur de version continue de verifier l'ensemble
-- apres chaque insertion -- ce qui couvre les cycles formes par les nouvelles regles entre elles.

-- Recu d'operation : porte le resultat exact d'un lot deja applique. Aucun libelle clinique,
-- seulement des cles de variables et des identifiants de regles.
create table public.rule_batch_operation (
  owner_id uuid not null references auth.users(id) on delete cascade,
  operation_id uuid not null,
  template_version_id uuid not null references public.template_version(id) on delete cascade,
  request_hash text not null,
  receipt jsonb not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key (owner_id, operation_id)
);
alter table public.rule_batch_operation enable row level security;
revoke all on public.rule_batch_operation from public, anon, authenticated;

-- Erreur structuree : un code fonctionnel et une action, jamais une erreur SQL brute cote client.
create function public.rule_batch_error(p_code text, p_details jsonb default '{}'::jsonb) returns void
language plpgsql set search_path = public, pg_temp as $$
begin
  raise exception using errcode = 'P0001', message = p_code,
    detail = (jsonb_build_object(
      'code', lower(p_code),
      'action', case when p_code in ('RULE_BATCH_CONFLICT', 'RULE_BATCH_VERSION_LOCKED', 'RULE_BATCH_VERSION_IN_USE')
                     then 'refresh_required' else 'resolve_required' end
    ) || coalesce(p_details, '{}'::jsonb))::text;
end $$;
revoke all on function public.rule_batch_error(text, jsonb) from public, anon, authenticated;

-- Empreinte de ce dont depend un lot : le statut de la version, ses variables (cible possible,
-- portee, type, options) et ses regles. Un apercu confirme avec une empreinte perimee est refuse
-- au lieu d'ecrire dans un modele qui n'est plus celui qu'on a montre. md5 suffit : il s'agit de
-- detecter un changement, pas de resister a un adversaire -- la decision reste serveur.
create function public.template_version_rule_fingerprint(p_version_id uuid) returns text
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_status text; v_fields text; v_rules text;
begin
  select status into v_status from public.template_version where id = p_version_id;
  if v_status is null then return null; end if;
  select coalesce(string_agg(
    f.field_key || ':' || f.scope || ':' || f.type || ':' || f.required::text
      || ':' || coalesce(f.section, '') || ':' || coalesce(f.allowed_values::text, ''),
    ',' order by f.field_key), '')
    into v_fields
    from public.template_field f where f.template_version_id = p_version_id;
  select coalesce(string_agg(r.id::text || ':' || r.rule::text || ':' || r.severity, ',' order by r.id), '')
    into v_rules
    from public.validation_rule r where r.template_version_id = p_version_id;
  return md5(v_status || '|' || v_fields || '|' || v_rules);
end $$;
revoke all on function public.template_version_rule_fingerprint(uuid) from public, anon, authenticated;

-- Autorisation commune a l'apercu et a la creation : sans prologue partage, les deux chemins
-- finiraient par diverger et l'apercu promettrait ce que l'ecriture refuse.
create function public.assert_rule_batch_access(p_version_id uuid) returns void
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_template uuid;
begin
  if auth.uid() is null then perform public.rule_batch_error('RULE_BATCH_FORBIDDEN'); end if;
  select template_id into v_template from public.template_version where id = p_version_id;
  -- Version absente et version interdite renvoient le meme refus : l'existence d'un gabarit
  -- d'autrui ne se deduit pas de la difference des messages.
  if v_template is null or not public.owns_template(v_template) then
    perform public.rule_batch_error('RULE_BATCH_FORBIDDEN');
  end if;
end $$;
revoke all on function public.assert_rule_batch_access(uuid) from public, anon, authenticated;

-- Plan du lot : ce qui serait cree, ce qui existe deja a l'identique, ce qui est refuse et
-- pourquoi. La raison d'un refus vient des assertions existantes, pas d'une seconde definition.
create function public.rule_batch_plan(p_version_id uuid, p_payload jsonb) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
-- `stable` : cette fonction ne fait que lire et signaler ; c'est la creation qui ecrit.
declare
  v_effect text := p_payload ->> 'effect';
  v_condition jsonb := p_payload -> 'condition';
  v_severity text := coalesce(p_payload ->> 'severity', 'block');
  v_targets jsonb;
  v_target text;
  v_rule jsonb;
  v_existing uuid;
  v_create jsonb := '[]'::jsonb;
  v_duplicates jsonb := '[]'::jsonb;
  v_invalid jsonb := '[]'::jsonb;
  v_reason text;
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object'
     or octet_length(p_payload::text) > 65536
     or jsonb_typeof(v_condition) <> 'object'
     or v_effect is null or v_effect not in ('required', 'visible')
     or v_severity not in ('block', 'warn')
     or (p_payload ? 'message' and jsonb_typeof(p_payload -> 'message') not in ('string', 'null'))
     or jsonb_typeof(p_payload -> 'targets') <> 'array'
     or jsonb_array_length(p_payload -> 'targets') = 0
     or jsonb_array_length(p_payload -> 'targets') > 50
     or exists (select 1 from jsonb_array_elements(p_payload -> 'targets') e where jsonb_typeof(e) <> 'string')
     or exists (select 1 from jsonb_object_keys(p_payload) k
                 where k not in ('condition', 'effect', 'targets', 'message', 'severity')) then
    perform public.rule_batch_error('RULE_BATCH_INVALID');
  end if;

  -- Cibles dedupliquees, ordre d'origine conserve : la liste recapitulative de l'ecran et le
  -- resultat serveur doivent parler des memes elements, dans le meme ordre.
  select jsonb_agg(t.value order by t.ordinality) into v_targets
    from (select distinct on (value) value, ordinality
            from jsonb_array_elements_text(p_payload -> 'targets') with ordinality as x(value, ordinality)
           order by value, ordinality) t;

  for v_target in select value from jsonb_array_elements_text(v_targets) loop
    v_rule := jsonb_build_object('if', v_condition,
      'then', jsonb_build_object('field', v_target, 'operator', v_effect));
    v_reason := null;
    begin
      perform public.assert_rule_structure(p_version_id, v_rule);
      perform public.assert_rule_calculated_operands(p_version_id, v_rule);
      perform public.assert_visibility_acyclic(p_version_id, v_rule, null);
    exception when others then
      v_reason := sqlerrm;
    end;
    if v_reason is not null then
      v_invalid := v_invalid || jsonb_build_object('target', v_target, 'reason', v_reason);
    else
      -- Doublon EXACT : meme condition, meme effet, meme cible. Il est signale et laisse tel
      -- quel ; une regle differente sur la meme cible n'est jamais ecrasee.
      select id into v_existing from public.validation_rule
        where template_version_id = p_version_id and rule = v_rule
        order by id limit 1;
      if v_existing is not null then
        v_duplicates := v_duplicates || jsonb_build_object('target', v_target, 'ruleId', v_existing);
      else
        v_create := v_create || jsonb_build_object('target', v_target, 'rule', v_rule);
      end if;
    end if;
  end loop;

  return jsonb_build_object(
    'fingerprint', public.template_version_rule_fingerprint(p_version_id),
    'severity', v_severity,
    'create', v_create, 'duplicates', v_duplicates, 'invalid', v_invalid);
end $$;
revoke all on function public.rule_batch_plan(uuid, jsonb) from public, anon, authenticated;

-- Apercu : lecture seule. Il donne l'empreinte que la confirmation devra presenter.
create function public.preview_rule_batch(p_version_id uuid, p_payload jsonb) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform public.assert_rule_batch_access(p_version_id);
  -- Une version gelee ou deja utilisee n'accepte aucune regle : l'apercu le dit AVANT de
  -- laisser composer un lot que la confirmation refuserait.
  return public.rule_batch_plan(p_version_id, p_payload)
    || jsonb_build_object(
      'locked', public.template_version_locked(p_version_id),
      'inUse', public.template_version_in_use(p_version_id));
end $$;
revoke all on function public.preview_rule_batch(uuid, jsonb) from public, anon;
grant execute on function public.preview_rule_batch(uuid, jsonb) to authenticated;

-- Creation : tout ou rien. L'ordre des controles est volontaire -- le recu d'un lot deja
-- applique est rendu AVANT le controle d'empreinte, sans quoi le rejeu d'une reponse perdue
-- se heurterait au changement que l'operation a elle-meme provoque.
create function public.create_rule_batch(
  p_version_id uuid, p_operation_id uuid, p_payload jsonb, p_expected_fingerprint text
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_op public.rule_batch_operation;
  v_hash text;
  v_plan jsonb;
  v_item jsonb;
  v_created jsonb := '[]'::jsonb;
  v_receipt jsonb;
  v_id uuid;
  v_message text;
  v_severity text;
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
  for v_item in select value from jsonb_array_elements(v_plan -> 'create') loop
    begin
      insert into public.validation_rule (template_version_id, rule, message, severity)
      values (p_version_id, v_item -> 'rule', v_message, v_severity)
      returning id into v_id;
    exception when others then
      -- Cycle forme par les nouvelles regles entre elles, ou invariant de version : le refus
      -- porte sur tout le lot. Le motif reel du moteur est transmis, jamais un code SQL brut.
      perform public.rule_batch_error('RULE_BATCH_REFUSED',
        jsonb_build_object('target', v_item ->> 'target', 'reason', sqlerrm));
    end;
    v_created := v_created || jsonb_build_object('id', v_id, 'target', v_item ->> 'target');
  end loop;

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
