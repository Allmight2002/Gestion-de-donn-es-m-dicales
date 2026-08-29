-- =============================================================================
-- 20260616098500_server_generated_exports.sql
-- Audit v20 §7.6 : distinguer les exports produits par une Edge Function
-- serveur des anciens exports orchestres par le navigateur. Un client authentifie
-- ne peut pas forger generation_mode='server'.
-- =============================================================================

alter table public.export_log
  add column if not exists generation_mode text not null default 'client'
    check (generation_mode in ('client', 'server')),
  add column if not exists generated_by_function text,
  add column if not exists server_generated_at timestamptz;

create or replace function public.guard_export_generation_mode()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is not null then
    new.generation_mode := 'client';
    new.generated_by_function := null;
    new.server_generated_at := null;
  end if;
  if new.generation_mode = 'server' and new.server_generated_at is null then
    new.server_generated_at := now();
  end if;
  return new;
end $$;
revoke all on function public.guard_export_generation_mode() from public, anon, authenticated;

drop trigger if exists trg_export_generation_mode on public.export_log;
create trigger trg_export_generation_mode
  before insert or update of generation_mode, generated_by_function, server_generated_at
  on public.export_log
  for each row execute function public.guard_export_generation_mode();
