-- =============================================================================
-- 20260616095700_export_read_requires_export_permission.sql
-- P1 audit: reading export metadata and signed export files requires can_export_data.
-- =============================================================================

drop policy if exists el_select on public.export_log;
create policy el_select on public.export_log for select to authenticated
  using (public.can_export_data(public.base_of_cohort(cohort_id)));
