-- =============================================================================
-- 20260616094800_base_template_version_same_template.sql  (audit v12 §6.2)
-- Le frontend change la version du gabarit d'une base par un UPDATE direct de
-- base.current_template_version_id, et la RLS ne verifie QUE la propriete de la base. Une proprietaire
-- pouvait donc rattacher SA base a une version d'un gabarit PRIVE d'autrui : `can_read_template` la
-- considerait alors autorisee (sa base pointe vers cette version) et elle lisait les champs prives du
-- gabarit etranger (fuite de structure + validation contre un dictionnaire etranger).
--
-- Invariant retabli : une base ne peut pointer que vers une version de SON PROPRE gabarit. Le seul
-- flux legitime est le passage d'une version a la suivante DU MEME gabarit (createNextVersion puis
-- setTemplateVersion) -> on impose que l'ancienne et la nouvelle version partagent le meme template_id.
-- Trigger BEFORE UPDATE (la creation initiale passe par une RPC de confiance, pas par cet UPDATE).
-- Migration ADDITIVE.
-- =============================================================================
-- SECURITY DEFINER : le trigger doit lire template_version SANS la RLS de l'appelant, sinon une
-- version d'un gabarit PRIVE etranger est invisible et le controle degenere en « introuvable »
-- (et pire, ne pourrait pas comparer les template_id). Il ne renvoie aucune donnee : il compare et
-- accepte / rejette.
create or replace function public.guard_base_template_version()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_new_tpl uuid;
  v_old_tpl uuid;
begin
  if new.current_template_version_id is not distinct from old.current_template_version_id then
    return new; -- pas de changement de version
  end if;
  if new.current_template_version_id is null then
    return new; -- detachement (cas theorique)
  end if;

  select template_id into v_new_tpl from public.template_version where id = new.current_template_version_id;
  if v_new_tpl is null then
    raise exception 'Version de gabarit introuvable';
  end if;

  if old.current_template_version_id is not null then
    select template_id into v_old_tpl from public.template_version where id = old.current_template_version_id;
    if v_old_tpl is not null and v_new_tpl is distinct from v_old_tpl then
      raise exception 'Une base ne peut pointer que vers une version de SON propre gabarit (rattachement a un gabarit etranger interdit)';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_base_template_version on public.base;
create trigger trg_base_template_version before update on public.base
  for each row execute function public.guard_base_template_version();
