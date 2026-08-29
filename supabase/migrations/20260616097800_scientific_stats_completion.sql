-- =============================================================================
-- 20260616097800_scientific_stats_completion.sql
-- P1 metier :
--   - date scientifique d'inclusion distincte de patient.created_at ;
--   - completude historique evaluee sur la version de chaque dossier ;
--   - distinction valeur observee / code manquant documente ;
--   - file de completion paginee et limitee aux vrais manquants requis.
-- =============================================================================

alter table public.patient
  add column if not exists inclusion_date date;

update public.patient p
   set inclusion_date = coalesce(
     (select min(e.encounter_date) from public.encounter e where e.patient_id = p.id and e.deleted_at is null),
     p.created_at::date
   )
 where p.inclusion_date is null;

alter table public.patient
  alter column inclusion_date set default current_date;

create index if not exists ix_patient_base_inclusion_date
  on public.patient (base_id, inclusion_date)
  where deleted_at is null;

create or replace function public.refresh_patient_inclusion_date(p_patient_id uuid)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.patient p
     set inclusion_date = coalesce(
       (select min(e.encounter_date) from public.encounter e where e.patient_id = p.id and e.deleted_at is null),
       p.inclusion_date,
       p.created_at::date
     )
   where p.id = p_patient_id;
$$;
revoke all on function public.refresh_patient_inclusion_date(uuid) from public, anon, authenticated;

create or replace function public.trg_refresh_patient_inclusion_date()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if TG_OP in ('INSERT', 'UPDATE') then
    perform public.refresh_patient_inclusion_date(new.patient_id);
  end if;
  if TG_OP = 'UPDATE' and old.patient_id is distinct from new.patient_id then
    perform public.refresh_patient_inclusion_date(old.patient_id);
  end if;
  return coalesce(new, old);
end $$;
revoke all on function public.trg_refresh_patient_inclusion_date() from public, anon, authenticated;

drop trigger if exists trg_refresh_patient_inclusion_date on public.encounter;
create trigger trg_refresh_patient_inclusion_date
  after insert or update of patient_id, encounter_date, deleted_at on public.encounter
  for each row execute function public.trg_refresh_patient_inclusion_date();

create or replace function public.value_missing_code(v jsonb)
returns boolean
language sql immutable set search_path = public, pg_temp as $$
  select coalesce(jsonb_typeof(v) = 'object'
     and (v ? '__missing__')
     and (v ->> '__missing__') in ('non_fait','inconnu','non_applicable'), false)
$$;

create or replace function public.value_documented(v jsonb)
returns boolean
language sql immutable set search_path = public, pg_temp as $$
  select coalesce(public.rule_value_present(v), false) or public.value_missing_code(v)
$$;

create or replace function public.base_inclusion_stats(p_base_id uuid)
returns jsonb
language sql stable security invoker set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'total', (select count(*)::int from public.patient p where p.base_id = p_base_id and p.deleted_at is null),
    'target', (select b.inclusion_target from public.base b where b.id = p_base_id),
    'targetDate', (select b.inclusion_target_date from public.base b where b.id = p_base_id),
    'dateField', 'patient.inclusion_date',
    'monthly', coalesce((
      select jsonb_agg(jsonb_build_object('month', m.month, 'count', m.n) order by m.month)
      from (
        select to_char(date_trunc('month', p.inclusion_date::timestamp), 'YYYY-MM') as month, count(*)::int as n
        from public.patient p
        where p.base_id = p_base_id and p.deleted_at is null and p.inclusion_date is not null
        group by 1
      ) m
    ), '[]'::jsonb)
  );
$$;
grant execute on function public.base_inclusion_stats(uuid) to authenticated;

drop function if exists public.base_completeness_stats(uuid);

create or replace function public.base_completeness_stats(p_base_id uuid, p_mode text default 'historical')
returns jsonb
language sql stable security invoker set search_path = public, pg_temp as $$
  with current_tv as (
    select current_template_version_id as id from public.base where id = p_base_id
  ),
  values_by_field as (
    -- Historique : chaque patient est evalue contre SA version de gabarit.
    select 'historical'::text as mode, tf.template_version_id, tv.version_number,
           tf.field_key, tf.label, tf.scope, p.data -> tf.field_key as value
      from public.patient p
      join public.template_field tf on tf.template_version_id = p.template_version_id and tf.scope = 'patient'
      join public.template_version tv on tv.id = tf.template_version_id
     where p_mode in ('historical', 'both')
       and p.base_id = p_base_id and p.deleted_at is null

    union all

    select 'historical'::text as mode, tf.template_version_id, tv.version_number,
           tf.field_key, tf.label, tf.scope, e.data -> tf.field_key as value
      from public.encounter e
      join public.patient p on p.id = e.patient_id
      join public.template_field tf on tf.template_version_id = e.template_version_id and tf.scope = 'encounter'
      join public.template_version tv on tv.id = tf.template_version_id
     where p_mode in ('historical', 'both')
       and p.base_id = p_base_id and p.deleted_at is null and e.deleted_at is null
       and (tf.encounter_types is null or cardinality(tf.encounter_types) = 0 or e.encounter_type = any(tf.encounter_types))

    union all

    -- Courant : vue d'harmonisation volontaire, appliquee au gabarit courant de la base.
    select 'current'::text as mode, tf.template_version_id, tv.version_number,
           tf.field_key, tf.label, tf.scope, p.data -> tf.field_key as value
      from current_tv c
      join public.template_version tv on tv.id = c.id
      join public.template_field tf on tf.template_version_id = c.id and tf.scope = 'patient'
      join public.patient p on p.base_id = p_base_id and p.deleted_at is null
     where p_mode in ('current', 'both')

    union all

    select 'current'::text as mode, tf.template_version_id, tv.version_number,
           tf.field_key, tf.label, tf.scope, e.data -> tf.field_key as value
      from current_tv c
      join public.template_version tv on tv.id = c.id
      join public.template_field tf on tf.template_version_id = c.id and tf.scope = 'encounter'
      join public.patient p on p.base_id = p_base_id and p.deleted_at is null
      join public.encounter e on e.patient_id = p.id and e.deleted_at is null
     where p_mode in ('current', 'both')
       and (tf.encounter_types is null or cardinality(tf.encounter_types) = 0 or e.encounter_type = any(tf.encounter_types))
  ),
  grouped as (
    select mode, template_version_id, version_number, field_key, label, scope,
           count(*)::int as total,
           count(*) filter (where public.rule_value_present(value))::int as observed,
           count(*) filter (where public.value_missing_code(value))::int as missing_coded
      from values_by_field
     group by mode, template_version_id, version_number, field_key, label, scope
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'mode', mode,
      'templateVersionId', template_version_id,
      'versionNumber', version_number,
      'fieldKey', field_key,
      'label', label,
      'scope', scope,
      'observed', observed,
      'missingCoded', missing_coded,
      'filled', observed + missing_coded,
      'total', total
    ) order by
      case mode when 'historical' then 0 else 1 end,
      case when total = 0 then 2 else (observed + missing_coded)::numeric / total end,
      label,
      version_number), '[]'::jsonb)
  from grouped;
$$;
grant execute on function public.base_completeness_stats(uuid, text) to authenticated;

create or replace function public.base_completion_queue_page(
  p_base_id uuid,
  p_limit int default 50,
  p_offset int default 0
)
returns jsonb
language sql stable security invoker set search_path = public, pg_temp as $$
  with params as (
    select greatest(1, least(coalesce(p_limit, 50), 500))::int as lim,
           greatest(0, coalesce(p_offset, 0))::int as off
  ),
  pat_items as (
    select jsonb_build_object(
        'kind', 'patient', 'patientId', p.id, 'code', p.patient_code, 'status', p.validation_status,
        'missing', m.missing
      ) as item,
      p.patient_code as code, 0 as rank, p.created_at
    from public.patient p
    cross join lateral (
      select coalesce(jsonb_agg(tf.label order by tf.display_order, tf.field_key), '[]'::jsonb) as missing
      from public.template_field tf
      where tf.template_version_id = p.template_version_id
        and tf.scope = 'patient' and tf.required
        and not public.value_documented(p.data -> tf.field_key)
    ) m
    where p.base_id = p_base_id and p.deleted_at is null and p.validation_status <> 'curated'
      and jsonb_array_length(m.missing) > 0
  ),
  enc_items as (
    select jsonb_build_object(
        'kind', 'encounter', 'patientId', p.id, 'encounterId', e.id, 'code', p.patient_code,
        'encounterType', e.encounter_type, 'encounterDate', e.encounter_date, 'status', e.validation_status,
        'missing', m.missing
      ) as item,
      p.patient_code as code, 1 as rank, e.created_at
    from public.encounter e
    join public.patient p on p.id = e.patient_id
    cross join lateral (
      select coalesce(jsonb_agg(tf.label order by tf.display_order, tf.field_key), '[]'::jsonb) as missing
      from public.template_field tf
      where tf.template_version_id = e.template_version_id
        and tf.scope = 'encounter' and tf.required
        and (tf.encounter_types is null or cardinality(tf.encounter_types) = 0 or e.encounter_type = any(tf.encounter_types))
        and not public.value_documented(e.data -> tf.field_key)
    ) m
    where p.base_id = p_base_id and p.deleted_at is null and e.deleted_at is null
      and e.validation_status <> 'curated'
      and jsonb_array_length(m.missing) > 0
  ),
  all_items as (
    select * from pat_items
    union all
    select * from enc_items
  ),
  page_items as (
    select a.*
      from all_items a, params
     order by a.code, a.rank, a.created_at
     limit (select lim from params)
     offset (select off from params)
  ),
  total_count as (
    select count(*)::int as n from all_items
  )
  select jsonb_build_object(
    'items', coalesce((select jsonb_agg(p.item order by p.code, p.rank, p.created_at) from page_items p), '[]'::jsonb),
    'total', (select n from total_count),
    'limit', (select lim from params),
    'offset', (select off from params),
    'hasMore', ((select off from params) + (select lim from params) < (select n from total_count))
  );
$$;
grant execute on function public.base_completion_queue_page(uuid, int, int) to authenticated;

create or replace function public.base_completion_queue(p_base_id uuid, p_limit int default 200)
returns jsonb
language sql stable security invoker set search_path = public, pg_temp as $$
  select coalesce(public.base_completion_queue_page(p_base_id, p_limit, 0) -> 'items', '[]'::jsonb);
$$;
grant execute on function public.base_completion_queue(uuid, int) to authenticated;
