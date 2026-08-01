-- L9 : un modele d'observation est explicite pour chaque base. Les bases existantes
-- restent longitudinales, donc leur comportement et leurs donnees sont preserves.
alter table public.base
  add column observation_model text not null default 'longitudinal'
  check (observation_model in ('cross_sectional', 'longitudinal', 'event_registry'));

-- Creation atomique pour les nouveaux clients. La RPC historique a trois arguments est
-- conservee pour les anciens clients et continue a creer une base longitudinale.
create function public.create_base_from_model_observation(
  p_name text,
  p_specialty text,
  p_source_version_id uuid,
  p_observation_model text
)
returns public.base
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  src_v public.template_version;
  src_t public.template;
  v_tpl uuid;
  v_ver uuid;
  v_base public.base;
begin
  if auth.uid() is null then raise exception 'Authentification requise'; end if;
  if not public.is_medecin() then raise exception 'Seul un medecin peut creer une base'; end if;
  if p_observation_model not in ('cross_sectional', 'longitudinal', 'event_registry') then
    raise exception 'Modele d''observation invalide';
  end if;
  select * into src_v from public.template_version where id = p_source_version_id;
  if not found then raise exception 'Modele source introuvable'; end if;
  select * into src_t from public.template where id = src_v.template_id;
  if not (src_t.is_global or src_t.owner_user_id = auth.uid()) then raise exception 'Modele non accessible'; end if;
  insert into public.template (name, specialty, owner_user_id, is_global)
  values (src_t.name, src_t.specialty, auth.uid(), false) returning id into v_tpl;
  insert into public.template_version (template_id, version_number, status, created_by)
  values (v_tpl, 1, 'draft', auth.uid()) returning id into v_ver;
  insert into public.template_field
    (template_version_id, field_key, label, scope, section, type, unit, allowed_values,
     required, min_value, max_value, allow_missing_codes, display_order, encounter_types)
  select v_ver, field_key, label,
         case when p_observation_model = 'cross_sectional' then 'patient' else scope end,
         section, type, unit, allowed_values, required, min_value, max_value, allow_missing_codes,
         display_order,
         case when p_observation_model = 'cross_sectional' then null else encounter_types end
  from public.template_field where template_version_id = p_source_version_id;
  insert into public.validation_rule (template_version_id, rule, message, severity)
  select v_ver, rule, message, severity from public.validation_rule where template_version_id = p_source_version_id;
  insert into public.base (name, specialty, owner_user_id, current_template_version_id, observation_model)
  values (p_name, nullif(p_specialty, ''), auth.uid(), v_ver, p_observation_model) returning * into v_base;
  return v_base;
end;
$$;

create function public.set_base_observation_model(p_base_id uuid, p_observation_model text)
returns public.base
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_base public.base;
begin
  if auth.uid() is null then raise exception 'Authentification requise'; end if;
  if p_observation_model not in ('cross_sectional', 'longitudinal', 'event_registry') then raise exception 'Modele d''observation invalide'; end if;
  select * into v_base from public.base where id = p_base_id for update;
  if not found or v_base.owner_user_id <> auth.uid() then raise exception 'Reserve au proprietaire'; end if;
  if v_base.deleted_at is not null then raise exception 'Base supprimee'; end if;
  if v_base.observation_model = p_observation_model then return v_base; end if;
  if exists (select 1 from public.patient where base_id = p_base_id)
     or exists (select 1 from public.patient_identity where base_id = p_base_id)
     or exists (select 1 from public.raw_submission where base_id = p_base_id) then
    raise exception 'Le modele d''observation ne peut plus changer apres la premiere saisie';
  end if;
  if p_observation_model = 'cross_sectional' then
    update public.template_field set scope = 'patient', encounter_types = null
     where template_version_id = v_base.current_template_version_id;
  end if;
  update public.base set observation_model = p_observation_model where id = p_base_id returning * into v_base;
  return v_base;
end;
$$;

-- Les gardes s'appliquent aussi aux imports, RPC et retries hors-ligne : l'UI ne suffit pas.
create function public.enforce_observation_model_on_base()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'UPDATE' and new.observation_model is distinct from old.observation_model
     and (exists (select 1 from public.patient where base_id = new.id)
          or exists (select 1 from public.patient_identity where base_id = new.id)
          or exists (select 1 from public.raw_submission where base_id = new.id)) then
    raise exception 'Le modele d''observation ne peut plus changer apres la premiere saisie';
  end if;
  if new.observation_model = 'cross_sectional' and exists (
    select 1 from public.template_field where template_version_id = new.current_template_version_id
      and (scope <> 'patient' or encounter_types is not null)
  ) then raise exception 'Une base transversale ne peut contenir que des variables participant'; end if;
  return new;
end;
$$;
create trigger trg_base_observation_model before insert or update of observation_model, current_template_version_id on public.base
for each row execute function public.enforce_observation_model_on_base();

create function public.enforce_observation_model_on_template_field()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if exists (select 1 from public.base where current_template_version_id = new.template_version_id
       and observation_model = 'cross_sectional' and deleted_at is null)
     and (new.scope <> 'patient' or new.encounter_types is not null) then
    raise exception 'Une base transversale ne peut contenir que des variables participant';
  end if;
  return new;
end;
$$;
create trigger trg_template_field_observation_model before insert or update of template_version_id, scope, encounter_types on public.template_field
for each row execute function public.enforce_observation_model_on_template_field();

create function public.reject_cross_sectional_encounter()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if exists (select 1 from public.patient p join public.base b on b.id = p.base_id
     where p.id = new.patient_id and b.observation_model = 'cross_sectional') then
    raise exception 'Une base transversale n''accepte pas de rencontre';
  end if;
  return new;
end;
$$;
create trigger trg_encounter_cross_sectional_rejected before insert on public.encounter
for each row execute function public.reject_cross_sectional_encounter();

create function public.reject_cross_sectional_encounter_submission()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.scope = 'encounter' and exists (select 1 from public.base where id = new.base_id and observation_model = 'cross_sectional') then
    raise exception 'Une base transversale n''accepte pas de rencontre';
  end if;
  return new;
end;
$$;
create trigger trg_raw_submission_cross_sectional_rejected before insert or update of base_id, scope on public.raw_submission
for each row execute function public.reject_cross_sectional_encounter_submission();

revoke all on function public.create_base_from_model_observation(text, text, uuid, text) from public, anon;
revoke all on function public.set_base_observation_model(uuid, text) from public, anon;
revoke all on function public.enforce_observation_model_on_base() from public, anon, authenticated;
revoke all on function public.enforce_observation_model_on_template_field() from public, anon, authenticated;
revoke all on function public.reject_cross_sectional_encounter() from public, anon, authenticated;
revoke all on function public.reject_cross_sectional_encounter_submission() from public, anon, authenticated;
grant execute on function public.create_base_from_model_observation(text, text, uuid, text) to authenticated;
grant execute on function public.set_base_observation_model(uuid, text) to authenticated;
