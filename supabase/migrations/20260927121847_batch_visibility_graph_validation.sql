-- L73 : la validation de cycle ne reconstruit plus le graphe une fois par règle.
-- Les contrôles de structure et d'opérandes restent individuels ; le graphe complet
-- est construit une seule fois par version et par instruction. À 402 variables,
-- 62 sections et 238 règles, le déplacement d'une section et la création d'une règle
-- dépassaient la limite de 8 s du rôle authenticated (docs/correction-timeout-graphe-visibilite.md).

create or replace function public.validate_template_version_invariants(p_version_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare r record; config jsonb; v_cycle_node text;
begin
  select diagnosis_configuration into config
    from public.template_version where id = p_version_id for update;
  if not found then return; end if;

  for r in
    select id, rule from public.validation_rule
    where template_version_id = p_version_id order by id
  loop
    perform public.assert_rule_structure(p_version_id, r.rule);
    perform public.assert_rule_calculated_operands(p_version_id, r.rule);
  end loop;

  -- Une arête (cible, pilote) signifie « la cible dépend du pilote ». Les cibles de
  -- section sont développées une seule fois, puis la fermeture transitive est calculée
  -- sur des PAIRES dédupliquées par `union` (au plus variables², comme l'aperçu d'import
  -- de bloc) : énumérer les chemins serait exponentiel sur des règles en losange. Une
  -- variable qui dépend d'elle-même ferme un cycle et annule toute la transaction.
  with recursive edges(child, parent) as (
    select vr.rule -> 'then' ->> 'field', vr.rule -> 'if' ->> 'field'
      from public.validation_rule vr
     where vr.template_version_id = p_version_id
       and vr.rule -> 'then' ->> 'operator' = 'visible'
       and vr.rule -> 'then' ->> 'field' is not null
    union
    select sf.field_key, vr.rule -> 'if' ->> 'field'
      from public.validation_rule vr
      cross join lateral public.template_section_field_keys(
        p_version_id, vr.rule -> 'then' ->> 'section') sf
     where vr.template_version_id = p_version_id
       and vr.rule -> 'then' ->> 'operator' = 'visible'
       and vr.rule -> 'then' ->> 'section' is not null
  ),
  reach(child, parent) as (
    select child, parent from edges where child is not null and parent is not null
    union
    -- Alias `rc` : `r` désigne déjà l'enregistrement de la boucle PL/pgSQL ci-dessus.
    select rc.child, e.parent from reach rc join edges e on e.child = rc.parent
  )
  select child into v_cycle_node from reach where child = parent order by child limit 1;
  if v_cycle_node is not null then
    raise exception 'Regle d''affichage circulaire : % finirait par dependre de lui-meme', v_cycle_node;
  end if;

  perform public.assert_diagnosis_configuration(p_version_id, config);
end $$;

revoke all on function public.validate_template_version_invariants(uuid)
  from public, anon, authenticated;

-- La garde BEFORE ROW s'exécute avec les droits de la personne, donc sous RLS : y rejouer
-- le graphe coûtait, à 402 variables, bien plus que la limite de 8 s à chaque création ou
-- modification directe d'une règle. Le trigger AFTER STATEMENT de la même instruction
-- appelle le validateur ci-dessus, qui refuse tout cycle sur le graphe complet et annule
-- l'instruction : la garde ne conserve que les contrôles propres à la ligne.
create or replace function public.guard_validation_rule_structure()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  perform public.assert_rule_structure(new.template_version_id, new.rule);
  perform public.assert_rule_calculated_operands(new.template_version_id, new.rule);
  return new;
end $$;

-- Même ensemble que 20260923120000_repeatable_group_subsection.sql. La jointure OR entre
-- variables et sections imposait une boucle imbriquée : sous RLS, la politique de lecture
-- était évaluée pour chaque couple variable × section. Chaque table n'est plus lue qu'une
-- fois ; les sections retenues restent le bloc et ses sous-sections non répétables.
create or replace function public.template_section_field_keys(
  p_version_id uuid,
  p_section_key text
) returns table(field_key text)
language sql stable security invoker set search_path = public, pg_temp as $$
  with target as (
    select id
      from public.template_section
     where template_version_id = p_version_id
       and section_key = p_section_key
  ), members as (
    select s.id, s.section_key
      from public.template_section s
     where s.template_version_id = p_version_id
       and (s.id in (select id from target)
            or (s.parent_section_id in (select id from target) and not s.is_repeatable))
  )
  select distinct tf.field_key
    from public.template_field tf
   where tf.template_version_id = p_version_id
     and (tf.section_id in (select id from members)
          or tf.section in (select section_key from members));
$$;

-- Le RPC de déplacement est déjà protégé par le verrou de version et les contrôles
-- d'accès. Le trigger statement-level appelle désormais le validateur global ; il ne
-- faut donc pas parcourir les 238 règles une seconde fois ici.
create or replace function public.move_template_section(
  p_version_id uuid, p_section_id uuid, p_parent_key text
) returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_parent uuid;
begin
  perform public.lock_template_section_version(p_version_id);
  if public.template_version_in_use(p_version_id) then
    raise exception 'Version deja utilisee : creez une nouvelle version';
  end if;
  if p_parent_key is not null then
    select id into v_parent from public.template_section
    where template_version_id = p_version_id
      and section_key = p_parent_key and parent_section_id is null;
    if not found then raise exception 'Bloc parent introuvable'; end if;
  end if;
  update public.template_section
     set parent_section_id = v_parent,
         display_order = (select coalesce(max(display_order), -1) + 1
                          from public.template_section
                          where template_version_id = p_version_id)
   where id = p_section_id and template_version_id = p_version_id;
  if not found then raise exception 'Section introuvable'; end if;
  perform public.normalize_template_section_order(p_version_id);
  perform public.validate_template_version_invariants(p_version_id);
end $$;

revoke all on function public.move_template_section(uuid, uuid, text)
  from public, anon;
grant execute on function public.move_template_section(uuid, uuid, text)
  to authenticated;
