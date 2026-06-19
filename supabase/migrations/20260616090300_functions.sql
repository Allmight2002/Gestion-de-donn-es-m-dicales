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

-- Role STAFF (curateur / validateur / analyste) : attribue par l'admin systeme.
create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.global_role in ('curateur','validateur','analyste'))
$$;

-- Roles de curation (pool GLOBAL v3.0) : le curateur structure, le validateur valide.
create or replace function public.is_curateur()
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.global_role = 'curateur')
$$;

create or replace function public.is_validateur()
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.global_role = 'validateur')
$$;

-- Acteurs du pool de curation = curateur OU validateur (l'ANALYSTE en est EXCLU : il ne
-- doit jamais voir les documents bruts ni le pool).
create or replace function public.is_curation_staff()
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select public.is_curateur() or public.is_validateur()
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
                   and (a.can_edit_structured_data or a.can_export_data or a.access_role = 'analyst'))
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
