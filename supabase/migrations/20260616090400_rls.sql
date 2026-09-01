-- =============================================================================
-- 20260616090400_rls.sql  (v3.0)
-- Activation RLS + privileges + politiques (cahier technique v3.0 §13).
-- Toute table de public a la RLS ACTIVEE ; une table sans policy = tout refuse.
-- service_role (cle serveur) contourne la RLS pour le seed/admin.
-- =============================================================================

grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant execute on all functions in schema public to authenticated;

-- profiles -----------------------------------------------------------------------
alter table public.profiles enable row level security;
create policy profiles_select_self  on public.profiles for select to authenticated using (id = auth.uid());
create policy profiles_select_admin on public.profiles for select to authenticated using (public.is_system_admin());
create policy profiles_update_self  on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- gabarits : lecture des versions publiees/archivees ; le gestionnaire (system_admin
-- au MVP) ecrit. NB : le gestionnaire de gabarits n'accede a aucune donnee patient.
-- template : lecture des modeles GLOBAUX + de ses propres gabarits (+ admin). On teste
-- les colonnes DIRECTEMENT (is_global / owner_user_id) pour ne pas casser un
-- INSERT ... RETURNING (cf. lecon base_select). Ecriture : proprietaire (admin = global).
alter table public.template enable row level security;
create policy template_read  on public.template for select to authenticated
  using (is_global or owner_user_id = auth.uid() or public.is_system_admin());
create policy template_insert on public.template for insert to authenticated
  with check (public.is_system_admin() or (public.is_medecin() and owner_user_id = auth.uid() and is_global = false));
create policy template_update on public.template for update to authenticated
  using (public.owns_template(id))
  with check (public.is_system_admin() or (owner_user_id = auth.uid() and is_global = false));
create policy template_delete on public.template for delete to authenticated using (public.owns_template(id));

alter table public.template_version enable row level security;
create policy tv_read  on public.template_version for select to authenticated using (public.can_read_template(template_id));
create policy tv_write on public.template_version for all    to authenticated
  using (public.owns_template(template_id)) with check (public.owns_template(template_id));

alter table public.template_field enable row level security;
create policy tf_read  on public.template_field for select to authenticated
  using (public.can_read_template(public.template_of_version(template_version_id)));
create policy tf_write on public.template_field for all to authenticated
  using (public.owns_template(public.template_of_version(template_version_id)))
  with check (public.owns_template(public.template_of_version(template_version_id)));

alter table public.validation_rule enable row level security;
create policy vr_read  on public.validation_rule for select to authenticated
  using (public.can_read_template(public.template_of_version(template_version_id)));
create policy vr_write on public.validation_rule for all to authenticated
  using (public.owns_template(public.template_of_version(template_version_id)))
  with check (public.owns_template(public.template_of_version(template_version_id)));

-- base : visible aux acces ; jamais au system_admin. Filtre suppression logique.
alter table public.base enable row level security;
-- IMPORTANT : on teste le proprietaire DIRECTEMENT sur la colonne (owner_user_id),
-- sans passer par is_base_owner()/has_base_access() qui re-interrogent la table base.
-- Sinon un INSERT ... RETURNING echoue : la ligne non encore committee n'est pas
-- visible par le sous-select de la fonction, et le RETURNING (soumis a la policy
-- SELECT) la masque -> "new row violates row-level security policy".
create policy base_select on public.base for select to authenticated using (
  deleted_at is null and (
    owner_user_id = auth.uid()
    or exists (
      select 1 from public.base_access ba
      where ba.base_id = base.id and ba.user_id = auth.uid() and ba.revoked_at is null
    )
  )
);
create policy base_insert on public.base for insert to authenticated with check (owner_user_id = auth.uid() and public.is_medecin());
create policy base_update on public.base for update to authenticated using (public.is_base_owner(id)) with check (public.is_base_owner(id));
create policy base_delete on public.base for delete to authenticated using (public.is_base_owner(id));

-- invitations & acces : geres par le proprietaire OU un detenteur de can_manage_access.
alter table public.base_invitation enable row level security;
create policy bi_manage on public.base_invitation for all to authenticated
  using (public.is_base_owner(base_id) or public.can_manage_access(base_id))
  with check (public.is_base_owner(base_id) or public.can_manage_access(base_id));

alter table public.base_access enable row level security;
create policy ba_select on public.base_access for select to authenticated
  using (user_id = auth.uid() or public.is_base_owner(base_id) or public.can_manage_access(base_id));
create policy ba_manage on public.base_access for all to authenticated
  using (public.is_base_owner(base_id) or public.can_manage_access(base_id))
  with check (public.is_base_owner(base_id) or public.can_manage_access(base_id));

-- patient_identity (ZONE RESTREINTE) : can_view_identity. Pas de DELETE (logique).
alter table public.patient_identity enable row level security;
create policy pi_select on public.patient_identity for select to authenticated using (public.can_view_identity(base_id) and deleted_at is null);
create policy pi_insert on public.patient_identity for insert to authenticated with check (public.can_write_identity(base_id));
create policy pi_update on public.patient_identity for update to authenticated using (public.can_write_identity(base_id)) with check (public.can_write_identity(base_id));

-- patient (ZONE ANALYTIQUE) : lecture tout acces ; ecriture can_edit_structured_data.
alter table public.patient enable row level security;
create policy p_select on public.patient for select to authenticated using (public.has_base_access(base_id) and deleted_at is null);
create policy p_insert on public.patient for insert to authenticated with check (public.can_edit_structured_data(base_id));
create policy p_update on public.patient for update to authenticated using (public.can_edit_structured_data(base_id)) with check (public.can_edit_structured_data(base_id));

-- encounter : scope par la base du patient.
alter table public.encounter enable row level security;
create policy e_select on public.encounter for select to authenticated using (public.has_base_access(public.base_of_patient(patient_id)) and deleted_at is null);
create policy e_insert on public.encounter for insert to authenticated with check (public.can_edit_structured_data(public.base_of_patient(patient_id)));
create policy e_update on public.encounter for update to authenticated using (public.can_edit_structured_data(public.base_of_patient(patient_id))) with check (public.can_edit_structured_data(public.base_of_patient(patient_id)));

-- pieces jointes cliniques (ZONE RESTREINTE) : meme regle que l'identite.
alter table public.clinical_attachment enable row level security;
create policy ca_select on public.clinical_attachment for select to authenticated using (public.can_view_identity(public.base_of_patient(patient_id)) and deleted_at is null);
create policy ca_insert on public.clinical_attachment for insert to authenticated with check (public.can_write_identity(public.base_of_patient(patient_id)));
create policy ca_update on public.clinical_attachment for update to authenticated using (public.can_write_identity(public.base_of_patient(patient_id))) with check (public.can_write_identity(public.base_of_patient(patient_id)));

-- historique des corrections.
alter table public.field_change_log enable row level security;
create policy fcl_select on public.field_change_log for select to authenticated using (public.has_base_access(base_id));
create policy fcl_insert on public.field_change_log for insert to authenticated with check (public.can_edit_structured_data(base_id));

-- cohortes + membres figes.
alter table public.cohort enable row level security;
create policy c_select on public.cohort for select to authenticated using (public.has_base_access(base_id));
create policy c_insert on public.cohort for insert to authenticated with check (public.can_curate(base_id));
create policy c_update on public.cohort for update to authenticated using (public.can_curate(base_id)) with check (public.can_curate(base_id));
create policy c_delete on public.cohort for delete to authenticated using (public.can_curate(base_id));

alter table public.cohort_member enable row level security;
create policy cm_select on public.cohort_member for select to authenticated using (public.has_base_access(public.base_of_cohort(cohort_id)));
create policy cm_insert on public.cohort_member for insert to authenticated with check (public.can_curate(public.base_of_cohort(cohort_id)));
create policy cm_delete on public.cohort_member for delete to authenticated using (public.can_curate(public.base_of_cohort(cohort_id)));

alter table public.cohort_encounter_member enable row level security;
create policy cem_select on public.cohort_encounter_member for select to authenticated using (public.has_base_access(public.base_of_cohort(cohort_id)));
create policy cem_insert on public.cohort_encounter_member for insert to authenticated with check (public.can_curate(public.base_of_cohort(cohort_id)));
create policy cem_delete on public.cohort_encounter_member for delete to authenticated using (public.can_curate(public.base_of_cohort(cohort_id)));

-- export_log : ajout seul ; ecriture reservee a can_export_data.
alter table public.export_log enable row level security;
create policy el_select on public.export_log for select to authenticated using (public.has_base_access(public.base_of_cohort(cohort_id)));
create policy el_insert on public.export_log for insert to authenticated with check (public.can_export_data(public.base_of_cohort(cohort_id)));

-- audit_log : ajout seul ; lecture ciblee.
alter table public.audit_log enable row level security;
create policy al_select on public.audit_log for select to authenticated using (
  user_id = auth.uid()
  or (base_id is not null and public.is_base_owner(base_id))
  or (public.is_system_admin() and base_id is null)
);
create policy al_insert on public.audit_log for insert to authenticated with check (user_id = auth.uid());
