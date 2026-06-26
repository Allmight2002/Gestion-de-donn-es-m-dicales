-- =============================================================================
-- 20260616090300_functions.sql  (v3.0)
-- Fonctions d'aide RLS (cahier technique v3.0 §13). SECURITY DEFINER + STABLE +
-- search_path verrouille : elles lisent base / base_access sans declencher leur
-- propre RLS (pas de recursion) et ne renvoient que des booleens sur auth.uid().
--
-- Permissions granulaires (§4.3) portees par base_access (acces NON revoque).
-- =============================================================================

create or replace function public.is_system_admin()
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.global_role = 'system_admin')
$$;

-- Role global MEDECIN : seul a pouvoir creer/posseder des bases (cahier v3.0).
create or replace function public.is_medecin()
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.global_role = 'medecin')
$$;

-- Role STAFF de curation = curateur (le role `validateur` est SUPPRIME : le curateur
-- structure ET finalise — synthese produit §2.2). Attribue par l'admin systeme.
create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.global_role = 'curateur')
$$;

create or replace function public.is_curateur()
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.global_role = 'curateur')
$$;

-- Role `validateur` SUPPRIME : la fonction est conservee (renvoie toujours faux) pour ne pas
-- casser d'eventuelles references de policies historiques ; plus aucun compte ne l'obtient.
create or replace function public.is_validateur()
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select false
$$;

-- Acteurs du pool de curation = curateur uniquement.
create or replace function public.is_curation_staff()
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select public.is_curateur()
$$;

-- Gabarits (v3.0) : un gabarit est gere par l'admin (global) ou par son proprietaire medecin.
create or replace function public.owns_template(p_template uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select public.is_system_admin()
      or exists (select 1 from public.template t where t.id = p_template and t.owner_user_id = auth.uid())
$$;

-- can_read_template est defini PLUS BAS (apres has_base_access, qu'il appelle) : en
-- language sql, le corps est valide a la creation -> la dependance doit exister d'abord.

create or replace function public.template_of_version(p_version uuid)
returns uuid language sql stable security definer set search_path = public, pg_temp as $$
  select template_id from public.template_version where id = p_version
$$;

create or replace function public.is_base_owner(p_base uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.base b where b.id = p_base and b.owner_user_id = auth.uid())
$$;

create or replace function public.has_base_access(p_base uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select public.is_base_owner(p_base)
      or exists (select 1 from public.base_access a
                 where a.base_id = p_base and a.user_id = auth.uid() and a.revoked_at is null)
$$;

-- Lisible : modele global, son propre gabarit, admin, OU le gabarit d'une base a laquelle
-- on a acces (un medecin collaborateur doit voir le gabarit de la base partagee, sans en
-- etre proprietaire). Defini ici car il appelle has_base_access (ci-dessus).
create or replace function public.can_read_template(p_template uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
           select 1 from public.template t
           where t.id = p_template and (t.is_global or t.owner_user_id = auth.uid())
         )
      or public.is_system_admin()
      -- le staff de curation lit les DEFINITIONS de champs (pas des donnees patient) pour
      -- structurer les cas du pool ; les libelles de champs ne sont pas identifiants.
      or public.is_curation_staff()
      or exists (
           select 1
           from public.template_version tv
           join public.base b on b.current_template_version_id = tv.id
           where tv.template_id = p_template and public.has_base_access(b.id)
         )
$$;

-- Generateur de verificateurs de permission : owner OR base_access actif avec le flag.
create or replace function public.can_view_identity(p_base uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select public.is_base_owner(p_base)
      or exists (select 1 from public.base_access a
                 where a.base_id = p_base and a.user_id = auth.uid() and a.revoked_at is null and a.can_view_identity)
$$;

create or replace function public.can_view_raw_documents(p_base uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select public.is_base_owner(p_base)
      or exists (select 1 from public.base_access a
                 where a.base_id = p_base and a.user_id = auth.uid() and a.revoked_at is null and a.can_view_raw_documents)
$$;

create or replace function public.can_edit_structured_data(p_base uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select public.is_base_owner(p_base)
      or exists (select 1 from public.base_access a
                 where a.base_id = p_base and a.user_id = auth.uid() and a.revoked_at is null and a.can_edit_structured_data)
$$;

create or replace function public.can_validate_data(p_base uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select public.is_base_owner(p_base)
      or exists (select 1 from public.base_access a
                 where a.base_id = p_base and a.user_id = auth.uid() and a.revoked_at is null and a.can_validate_data)
$$;

create or replace function public.can_export_data(p_base uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select public.is_base_owner(p_base)
      or exists (select 1 from public.base_access a
                 where a.base_id = p_base and a.user_id = auth.uid() and a.revoked_at is null and a.can_export_data)
$$;

create or replace function public.can_manage_access(p_base uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select public.is_base_owner(p_base)
      or exists (select 1 from public.base_access a
                 where a.base_id = p_base and a.user_id = auth.uid() and a.revoked_at is null and a.can_manage_access)
$$;

-- Ecriture de la zone restreinte (identite + pieces jointes cliniques) :
-- voir l'identite ET pouvoir editer.
create or replace function public.can_write_identity(p_base uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select public.is_base_owner(p_base)
      or exists (select 1 from public.base_access a
                 where a.base_id = p_base and a.user_id = auth.uid() and a.revoked_at is null
                   and a.can_view_identity and a.can_edit_structured_data)
$$;

-- Constitution de cohortes : proprietaire, contributeur analytique ou exportateur.
create or replace function public.can_curate(p_base uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select public.is_base_owner(p_base)
      or exists (select 1 from public.base_access a
                 where a.base_id = p_base and a.user_id = auth.uid() and a.revoked_at is null
                   and (a.can_edit_structured_data or a.can_export_data))
$$;

-- Resolution base_id depuis patient / cohorte (scoper encounter, attachments, etc.).
create or replace function public.base_of_patient(p_patient uuid)
returns uuid language sql stable security definer set search_path = public, pg_temp as $$
  select base_id from public.patient where id = p_patient
$$;

create or replace function public.base_of_cohort(p_cohort uuid)
returns uuid language sql stable security definer set search_path = public, pg_temp as $$
  select base_id from public.cohort where id = p_cohort
$$;

-- Age calcule (§5.2) : a partir de la date de naissance (zone restreinte) et de la
-- date de rencontre. Seul le resultat entre dans la zone analytique.
create or replace function public.compute_age(p_dob date, p_at date, p_unit text default 'years')
returns numeric language sql immutable as $$
  select case
    when p_dob is null or p_at is null then null
    when p_unit = 'days'   then (p_at - p_dob)::numeric
    when p_unit = 'months' then ((extract(year from age(p_at, p_dob)) * 12) + extract(month from age(p_at, p_dob)))::numeric
    else extract(year from age(p_at, p_dob))::numeric
  end
$$;

-- =============================================================================
-- Validation SERVEUR des donnees (§5.4/§5.5) : memes contraintes que le moteur React,
-- re-appliquees cote base pour la saisie directe ET la curation. Verifie, pour chaque
-- champ du gabarit (scope donne) present dans p_data : le TYPE (numerique), les BORNES
-- (min/max) et les VALEURS AUTORISEES (select/multiselect). Les valeurs manquantes
-- codifiees {"__missing__":...} ne sont permises que si allow_missing_codes. La
-- completude (champs requis) reste geree par l'UI (saisie directe) et la revue
-- (curation), pour ne pas bloquer un brouillon partiel.
-- =============================================================================
create or replace function public.assert_data_valid(p_version uuid, p_scope text, p_data jsonb)
returns void language plpgsql stable set search_path = public, pg_temp as $$
declare
  f   record;
  v   jsonb;
  n   numeric;
  txt text;
begin
  if p_data is null then return; end if;
  for f in
    select field_key, label, type, unit, allowed_values, min_value, max_value, allow_missing_codes
    from public.template_field
    where template_version_id = p_version and scope = p_scope
  loop
    if not (p_data ? f.field_key) then continue; end if;
    v := p_data -> f.field_key;
    if v is null or jsonb_typeof(v) = 'null' then continue; end if;

    -- valeur manquante codifiee : {"__missing__":"code"}
    if jsonb_typeof(v) = 'object' and (v ? '__missing__') then
      if not f.allow_missing_codes then
        raise exception 'Valeur manquante non autorisee pour "%"', f.label;
      end if;
      continue;
    end if;

    txt := v #>> '{}';
    if txt is null or txt = '' then continue; end if;

    if f.type in ('number','integer') then
      begin
        n := txt::numeric;
      exception when others then
        raise exception 'Valeur non numerique pour "%"', f.label;
      end;
      if f.min_value is not null and n < f.min_value then
        raise exception '"%" en dessous du minimum autorise (%)', f.label, f.min_value;
      end if;
      if f.max_value is not null and n > f.max_value then
        raise exception '"%" au dessus du maximum autorise (%)', f.label, f.max_value;
      end if;
    elsif f.type = 'select' then
      if f.allowed_values is not null and not (f.allowed_values @> jsonb_build_array(txt)) then
        raise exception 'Valeur non autorisee pour "%"', f.label;
      end if;
    elsif f.type = 'multiselect' then
      if f.allowed_values is not null and jsonb_typeof(v) = 'array'
         and exists (select 1 from jsonb_array_elements_text(v) el where not (f.allowed_values @> jsonb_build_array(el))) then
        raise exception 'Valeur non autorisee pour "%"', f.label;
      end if;
    end if;
  end loop;
end $$;

-- =============================================================================
-- assert_required_complete : COMPLETUDE des champs requis (synthese produit §6). Pour chaque
-- champ `required` du scope donne, la valeur doit etre PRESENTE (valeur reelle OU code de
-- donnee manquante {"__missing__":...}). Absente / null / vide => exception. Utilise A LA
-- FINALISATION (pas a la saisie directe, qui autorise un brouillon partiel).
-- =============================================================================
create or replace function public.assert_required_complete(p_version uuid, p_scope text, p_data jsonb)
returns void language plpgsql stable set search_path = public, pg_temp as $$
declare f record; v jsonb;
begin
  for f in
    select field_key, label from public.template_field
    where template_version_id = p_version and scope = p_scope and required = true
  loop
    v := p_data -> f.field_key;
    if (p_data is null) or (not (p_data ? f.field_key)) or (v is null) or (jsonb_typeof(v) = 'null')
       or (jsonb_typeof(v) = 'string' and (v #>> '{}') = '') then
      raise exception 'Champ requis manquant : %', coalesce(f.label, f.field_key);
    end if;
  end loop;
end $$;
