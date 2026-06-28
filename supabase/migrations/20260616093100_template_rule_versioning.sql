-- =============================================================================
-- 20260616093100_template_rule_versioning.sql  (audit 3 §8.2 / §8.3)
--   §8.2 : le medecin etait BLOQUE quand une variable utilisee devait evoluer
--          (duplicate_template_version reserve a l'admin). On ajoute une RPC accessible au
--          PROPRIETAIRE de son gabarit personnel pour creer la version suivante (copie
--          editable), sans toucher aux donnees historiques.
--   §8.3 : les regles de validation pouvaient etre ajoutees/supprimees/modifiees librement,
--          changeant retroactivement le sens d'une version DEJA UTILISEE ; et un client direct
--          pouvait inserer une regle MAL FORMEE (ignoree silencieusement par le moteur).
--          -> trigger : interdit toute ecriture de regle sur une version utilisee (creez une
--             nouvelle version) ; trigger : valide la STRUCTURE (liste blanche d'operateurs,
--             champs references existants) a l'insert/update.
-- Migration ADDITIVE.
-- =============================================================================

-- §8.2 : version suivante d'un gabarit PERSONNEL, par le proprietaire (copie editable en draft).
create or replace function public.create_next_personal_template_version(p_template_id uuid)
returns public.template_version
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_tpl public.template; v_src uuid; v_next int; v_new uuid; result public.template_version;
begin
  if auth.uid() is null then raise exception 'Authentification requise'; end if;
  select * into v_tpl from public.template where id = p_template_id;
  if not found then raise exception 'Gabarit introuvable'; end if;
  -- Modeles GLOBAUX -> reserves a l'admin (duplicate_template_version). Ici : gabarit personnel.
  if v_tpl.is_global or v_tpl.owner_user_id is distinct from auth.uid() then
    raise exception 'Reserve au proprietaire de son gabarit personnel';
  end if;

  select id, version_number into v_src, v_next from public.template_version
   where template_id = p_template_id order by version_number desc limit 1;
  if v_src is null then raise exception 'Aucune version a dupliquer'; end if;

  insert into public.template_version (template_id, version_number, status, created_by)
  values (p_template_id, v_next + 1, 'draft', auth.uid())
  returning id into v_new;

  -- Champs PUIS regles (les regles referencent des champs qui doivent deja exister).
  insert into public.template_field
    (template_version_id, field_key, label, scope, section, type, unit, allowed_values,
     required, min_value, max_value, allow_missing_codes, display_order, encounter_types)
  select v_new, field_key, label, scope, section, type, unit, allowed_values,
         required, min_value, max_value, allow_missing_codes, display_order, encounter_types
  from public.template_field where template_version_id = v_src;

  insert into public.validation_rule (template_version_id, rule, message, severity)
  select v_new, rule, message, severity
  from public.validation_rule where template_version_id = v_src;

  select * into result from public.template_version where id = v_new;
  return result;
end $$;
grant execute on function public.create_next_personal_template_version(uuid) to authenticated;

-- §8.3 : une version est "utilisee" des qu'elle porte des donnees (patient/rencontre).
create or replace function public.template_version_in_use(p_version_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.patient   where template_version_id = p_version_id and deleted_at is null)
      or exists (select 1 from public.encounter where template_version_id = p_version_id and deleted_at is null)
$$;
grant execute on function public.template_version_in_use(uuid) to authenticated;

-- Interdit d'ajouter/supprimer/modifier une regle sur une version DEJA UTILISEE (sens retroactif).
create or replace function public.guard_validation_rule_inuse()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if public.template_version_in_use(coalesce(new.template_version_id, old.template_version_id)) then
    raise exception 'Version de gabarit deja utilisee : creez une nouvelle version pour modifier les regles';
  end if;
  return coalesce(new, old);
end $$;
create trigger trg_vr_inuse
  before insert or update or delete on public.validation_rule
  for each row execute function public.guard_validation_rule_inuse();

-- Valide la STRUCTURE d'une regle : forme attendue + operateurs en liste blanche + champs existants.
create or replace function public.assert_rule_structure(p_version_id uuid, p_rule jsonb)
returns void language plpgsql stable set search_path = public, pg_temp as $$
declare
  op text; lf text; rf text; cf text; tf text;
  ok_ops    text[] := array['equals','not_equals','greater_than','greater_or_equal','less_than','less_or_equal'];
  ok_if_ops text[] := array['equals','not_equals','greater_than','greater_or_equal','less_than','less_or_equal','in'];
begin
  if p_rule ? 'operator' and p_rule ? 'left_field' and p_rule ? 'right_field' then
    op := p_rule ->> 'operator';
    if not (op = any(ok_ops)) then raise exception 'Operateur de regle invalide : %', op; end if;
    lf := p_rule ->> 'left_field'; rf := p_rule ->> 'right_field';
    if not exists (select 1 from public.template_field where template_version_id = p_version_id and field_key = lf) then
      raise exception 'Champ inconnu dans la regle : %', lf; end if;
    if not exists (select 1 from public.template_field where template_version_id = p_version_id and field_key = rf) then
      raise exception 'Champ inconnu dans la regle : %', rf; end if;
  elsif p_rule ? 'if' and p_rule ? 'then' then
    op := p_rule -> 'if' ->> 'operator'; cf := p_rule -> 'if' ->> 'field'; tf := p_rule -> 'then' ->> 'field';
    if not (op = any(ok_if_ops)) then raise exception 'Operateur conditionnel invalide : %', op; end if;
    if (p_rule -> 'then' ->> 'operator') is distinct from 'required' then
      raise exception 'La clause then doit etre operator=required'; end if;
    if cf is null or not exists (select 1 from public.template_field where template_version_id = p_version_id and field_key = cf) then
      raise exception 'Champ inconnu dans la regle (if) : %', coalesce(cf, '?'); end if;
    if tf is null or not exists (select 1 from public.template_field where template_version_id = p_version_id and field_key = tf) then
      raise exception 'Champ inconnu dans la regle (then) : %', coalesce(tf, '?'); end if;
  else
    raise exception 'Structure de regle invalide (attendu {operator,left_field,right_field} ou {if,then})';
  end if;
end $$;

create or replace function public.guard_validation_rule_structure()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  perform public.assert_rule_structure(new.template_version_id, new.rule);
  return new;
end $$;
create trigger trg_vr_structure
  before insert or update on public.validation_rule
  for each row execute function public.guard_validation_rule_structure();
