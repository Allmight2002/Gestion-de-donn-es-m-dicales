-- =============================================================================
-- L31 — Sections personnalisables
-- =============================================================================
--
-- `section` etait un `check (section in ('clinique','biologie','paraclinique'))`. Un
-- registre de traumatisme cranien ne se structure pas ainsi : il lui faut
-- « identification / circonstances / examen initial / imagerie / prise en charge /
-- evolution », creees, renommees et reordonnees par le proprietaire de la base.
--
-- DECISIONS DU LOT (arbitrees avec le porteur du besoin le 2026-08-15) :
--
--  1. UNE SEULE NOTION. La section est le regroupement VISUEL du formulaire, propre a
--     chaque base. Aucune « categorie de donnee » separee n'est introduite : rien dans
--     le produit ne la lirait aujourd'hui, et l'ajouter resterait additif plus tard.
--
--  2. LA SECTION SUIT LA VERSION, pas la base. C'est une structure de gabarit, comme
--     les variables : elle est recopiee d'une version a l'autre et GELEE des que la
--     version est publiee. Le gel n'est pas une regle ajoutee ici, c'est celui de
--     `template_version_locked` dont la table herite mecaniquement.
--
--  3. LE CODE INTERNE EST STABLE, le libelle est corrigeable — lecon de L30. Un
--     renommage ne doit jamais rompre le lien avec les variables ni avec les
--     instantanes hors-ligne deja telecharges.
--
--  4. `section` EST CONSERVEE EN MIROIR du code, comme `allowed_values` a L30 et
--     `allow_missing_codes` a L33. Une PWA non rafraichie et un instantane hors-ligne
--     deja telecharge ne connaitront jamais cette table : ils lisent la colonne texte.
--     Elle reste donc alimentee, et le `check` devient un controle de FORME.
--
--  5. LE FILET EST PRESERVE. `section_id` est NULLABLE et `on delete set null` : une
--     variable dont la section est inconnue ou detachee ne disparait pas du
--     formulaire, elle retombe sur la section de secours « Autre ». C'est un filet,
--     pas un detail.
--
-- REPLI : toute base existante conserve ses trois sections actuelles, devenues des
-- sections ordinaires, dans leur ordre actuel. Aucune variable ne change de section,
-- aucun formulaire ne change d'apparence au deploiement.
--
-- Migration ADDITIVE : aucune colonne supprimee, aucune donnee clinique touchee.

-- =============================================================================
-- 1. La table
-- =============================================================================

create table if not exists public.template_section (
  id                  uuid primary key default gen_random_uuid(),
  template_version_id uuid not null references public.template_version(id) on delete cascade,
  -- Code interne STABLE : jamais reecrit, c'est lui que porte le miroir `section` et
  -- que lisent les clients non rafraichis. Meme forme qu'une cle de variable.
  section_key         text not null check (section_key ~ '^[a-z][a-z0-9_]{0,62}$'),
  label               text not null check (btrim(label) <> '' and char_length(label) <= 160),
  display_order       int  not null default 0,
  created_at          timestamptz not null default now(),
  unique (template_version_id, section_key)
);

-- Lecture par version : c'est le seul acces reel (rendu d'un formulaire, recopie).
create index if not exists template_section_version_order_idx
  on public.template_section (template_version_id, display_order, section_key);

alter table public.template_section enable row level security;

-- Le `grant ... on all tables` de 20260616090400_rls.sql ne couvre QUE les tables
-- existantes a cette date : une table creee ensuite doit poser ses privileges elle-meme,
-- sinon la RLS n'est jamais atteinte et tout client recoit « permission denied ».
-- `anon` reste exclu : un jeu de variables n'a rien a montrer a un visiteur non connecte.
revoke all on table public.template_section from public, anon;
grant select, insert, update, delete on table public.template_section to authenticated;

-- Memes regles que `template_field` : lisible par qui peut lire le gabarit, ecrivable
-- par son proprietaire. Le gel de version est porte par les declencheurs ci-dessous,
-- qui couvrent AUSSI la voie directe (une policy ne sait pas dire « publiee »).
drop policy if exists ts_read on public.template_section;
create policy ts_read on public.template_section for select to authenticated
  using (public.can_read_template(public.template_of_version(template_version_id)));

drop policy if exists ts_write on public.template_section;
create policy ts_write on public.template_section for all to authenticated
  using (public.owns_template(public.template_of_version(template_version_id)))
  with check (public.owns_template(public.template_of_version(template_version_id)));

-- =============================================================================
-- 2. Rattachement des variables
-- =============================================================================

alter table public.template_field
  add column if not exists section_id uuid references public.template_section(id) on delete set null;

create index if not exists template_field_section_idx
  on public.template_field (section_id) where section_id is not null;

-- Le `check` d'origine enumerait les trois valeurs. Il devient un controle de FORME :
-- le miroir doit rester un code exploitable, il n'a plus a etre l'un des trois.
do $$
declare c_name text;
begin
  select con.conname into c_name
    from pg_constraint con
    join pg_class cls on cls.oid = con.conrelid
    join pg_namespace ns on ns.oid = cls.relnamespace
   where ns.nspname = 'public'
     and cls.relname = 'template_field'
     and con.contype = 'c'
     and pg_get_constraintdef(con.oid) ilike '%section%'
     and pg_get_constraintdef(con.oid) ilike '%clinique%';
  if c_name is not null then
    execute format('alter table public.template_field drop constraint %I', c_name);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.template_field'::regclass
       and conname = 'template_field_section_format_check'
  ) then
    alter table public.template_field
      add constraint template_field_section_format_check
      check (section ~ '^[a-z][a-z0-9_]{0,62}$');
  end if;
end $$;

-- =============================================================================
-- 3. Miroir : les deux sens
-- =============================================================================

-- Deux familles de clients ecrivent cette table, et la bascule ne doit avoir aucune
-- fenetre :
--   * un client A JOUR envoie `section_id` -> le miroir texte en est deduit ;
--   * un client NON RAFRAICHI (ou une RPC ancienne) n'envoie que `section` -> le lien
--     est retrouve par le code, dans la meme version.
-- Un code non rapprochable ne fait PAS echouer l'ecriture : `section_id` reste nul et
-- la variable retombe sur le filet. Refuser ici ferait disparaitre la variable, ce que
-- ce lot doit precisement empecher.
create or replace function public.sync_template_field_section()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_key   text;
  v_id    uuid;
  v_by_id boolean;
begin
  if tg_op = 'INSERT' then
    v_by_id := new.section_id is not null;
  else
    v_by_id := new.section_id is distinct from old.section_id;
    -- Ni le lien ni le code n'ont bouge : il n'y a rien a arbitrer, et surtout rien a
    -- reecrire (une variable detachee doit le rester).
    if not v_by_id and new.section is not distinct from old.section then
      return new;
    end if;
  end if;

  if v_by_id then
    -- Detachement explicite : la variable garde son code et tombe sur le filet.
    if new.section_id is null then
      return new;
    end if;
    select ts.section_key into v_key
      from public.template_section ts
     where ts.id = new.section_id
       and ts.template_version_id = new.template_version_id;
    if v_key is null then
      raise exception 'Section inconnue pour cette version du jeu de variables';
    end if;
    new.section := v_key;
    return new;
  end if;

  -- Voie ancienne : seul le code texte a ete fourni.
  select ts.id into v_id
    from public.template_section ts
   where ts.template_version_id = new.template_version_id
     and ts.section_key = new.section;
  new.section_id := v_id;
  return new;
end $$;
revoke all on function public.sync_template_field_section() from public, anon, authenticated;

drop trigger if exists trg_template_field_section on public.template_field;
create trigger trg_template_field_section
  before insert or update of section, section_id, template_version_id
  on public.template_field
  for each row execute function public.sync_template_field_section();

-- =============================================================================
-- 4. Gel de version, code immuable, suppression sure
-- =============================================================================

-- Le gel total est ce qu'on obtient en ne faisant rien de special : la section pend a
-- `template_version`, elle herite du verrou. Ce declencheur ne fait que l'appliquer au
-- meme endroit que pour les variables, et il couvre la voie directe autant que la RPC.
create or replace function public.guard_template_section_write()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_version uuid := coalesce(new.template_version_id, old.template_version_id);
begin
  if auth.uid() is not null and public.template_version_locked(v_version) then
    raise exception 'Version publiee/archivee immuable : creez une nouvelle version du jeu de variables';
  end if;

  if tg_op = 'UPDATE' then
    -- Leçon de L30 : le code est la reference stable. Le renommer romprait le lien avec
    -- les variables ET avec les instantanes hors-ligne deja telecharges.
    if new.section_key is distinct from old.section_key then
      raise exception 'Le code interne d''une section ne se modifie pas : renommez son libelle.';
    end if;
    if new.template_version_id is distinct from old.template_version_id then
      raise exception 'Une section ne change pas de version de jeu de variables';
    end if;
  end if;

  if tg_op = 'DELETE' then
    -- Supprimer une section peuplee ferait basculer ses variables sur le filet, donc
    -- changerait l'apparence d'un formulaire sans que personne ne l'ait decide.
    if exists (select 1 from public.template_field tf where tf.section_id = old.id) then
      raise exception 'Section non vide : deplacez d''abord ses variables.';
    end if;
    return old;
  end if;

  return new;
end $$;
revoke all on function public.guard_template_section_write() from public, anon, authenticated;

drop trigger if exists trg_template_section_write on public.template_section;
create trigger trg_template_section_write
  before insert or update or delete on public.template_section
  for each row execute function public.guard_template_section_write();

-- =============================================================================
-- 5. Repli : les trois sections actuelles deviennent des sections ordinaires
-- =============================================================================

-- Elles gardent leurs CODES : un client non rafraichi et un instantane deja telecharge
-- continuent de voir exactement ce qu'ils voient aujourd'hui. Le libelle stocke est le
-- libelle francais ; le front prefere la traduction pour ces trois codes historiques,
-- de sorte qu'un utilisateur anglophone garde « Clinical » et non « Clinique ».
insert into public.template_section (template_version_id, section_key, label, display_order)
select tv.id, s.key, s.label, s.ord
  from public.template_version tv
 cross join (values
   ('clinique',     'Clinique',     0),
   ('biologie',     'Biologie',     1),
   ('paraclinique', 'Paraclinique', 2)
 ) as s(key, label, ord)
on conflict (template_version_id, section_key) do nothing;

-- Chaque variable est rattachee a la section de MEME code, dans SA version. Le
-- declencheur de miroir ne touche pas au texte (le code ne change pas), et le garde de
-- version laisse passer parce que `auth.uid()` est nul en migration — meme mecanique
-- que la reprise de L30.
update public.template_field tf
   set section_id = ts.id
  from public.template_section ts
 where ts.template_version_id = tf.template_version_id
   and ts.section_key = tf.section
   and tf.section_id is null;

-- =============================================================================
-- 6. Recopie d'une version a l'autre
-- =============================================================================

-- Meme lecon qu'a L28, L30 et L33 : une structure oubliee ici se perd EN SILENCE a la
-- duplication d'un gabarit. Les sections passent AVANT les variables, sans quoi le
-- rattachement n'aurait rien a viser.
create or replace function public.copy_template_fields(
  p_source_version_id  uuid,
  p_target_version_id  uuid,
  p_force_patient_scope boolean default false
) returns void
language sql security invoker set search_path = public, pg_temp as $$
  insert into public.template_section
    (template_version_id, section_key, label, display_order)
  select p_target_version_id, ts.section_key, ts.label, ts.display_order
  from public.template_section ts
  where ts.template_version_id = p_source_version_id
  order by ts.display_order, ts.section_key
  on conflict (template_version_id, section_key) do nothing;

  insert into public.template_field
    (template_version_id, field_key, label, description, default_value, scope, section, section_id, type,
     unit, allowed_values, allowed_options, required, min_value, max_value, allow_missing_codes,
     missing_reasons, display_order, encounter_types)
  select p_target_version_id, src.field_key, src.label, src.description, src.default_value,
         case when p_force_patient_scope then 'patient' else src.scope end,
         src.section, tgt.id, src.type, src.unit, src.allowed_values, src.allowed_options,
         src.required, src.min_value, src.max_value, src.allow_missing_codes,
         src.missing_reasons, src.display_order,
         case when p_force_patient_scope then null else src.encounter_types end
  from public.template_field src
  left join public.template_section src_s on src_s.id = src.section_id
  left join public.template_section tgt
         on tgt.template_version_id = p_target_version_id
        and tgt.section_key = src_s.section_key
  where src.template_version_id = p_source_version_id
  order by src.display_order, src.id;
$$;
revoke all on function public.copy_template_fields(uuid, uuid, boolean) from public, anon, authenticated;

-- =============================================================================
-- 7. Reordonnancement
-- =============================================================================

-- Copie conforme de `reorder_template_fields` : la liste doit contenir EXACTEMENT les
-- sections de la version, une fois chacune, sinon l'ordre obtenu serait partiel ou
-- melange a une autre version.
create or replace function public.reorder_template_sections(p_version_id uuid, p_section_ids uuid[])
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare n_given int; n_distinct int; n_real int; n_match int;
begin
  if not public.owns_template(public.template_of_version(p_version_id)) then
    raise exception 'Modification du jeu de variables non autorisee';
  end if;
  if auth.uid() is not null and public.template_version_locked(p_version_id) then
    raise exception 'Version publiee/archivee immuable : creez une nouvelle version du jeu de variables';
  end if;

  n_given    := cardinality(p_section_ids);
  n_distinct := (select count(distinct x) from unnest(p_section_ids) x);
  n_real     := (select count(*) from public.template_section where template_version_id = p_version_id);
  n_match    := (select count(*) from public.template_section
                  where template_version_id = p_version_id and id = any(p_section_ids));
  if n_given <> n_distinct or n_given <> n_real or n_match <> n_real then
    raise exception 'Liste de reordonnancement invalide : elle doit contenir exactement les % sections de la version, une fois chacune', n_real;
  end if;

  update public.template_section ts
     set display_order = pos.ord
    from (
      select id, (ordinality - 1)::int as ord
      from unnest(p_section_ids) with ordinality as u(id, ordinality)
    ) pos
   where ts.id = pos.id and ts.template_version_id = p_version_id;
end $$;
revoke all on function public.reorder_template_sections(uuid, uuid[]) from public, anon;
grant execute on function public.reorder_template_sections(uuid, uuid[]) to authenticated;

-- =============================================================================
-- 8. Creation d'un jeu de variables complet
-- =============================================================================

-- Deux changements, et deux seulement :
--   * la section d'un champ n'est plus validee contre les trois valeurs mais contre la
--     FORME d'un code ;
--   * les sections sont creees AVANT les champs, depuis `sections` si le payload en
--     porte, sinon deduites des codes presents dans les champs.
-- Un payload ancien ne porte pas `sections` et n'emploie que les trois codes : il
-- retombe exactement sur le comportement d'avant.
create or replace function public.create_template_bundle(p_payload jsonb, p_operation_key uuid)
returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_hash text;
  v_existing public.template_operation;
  v_name text;
  v_specialty text;
  v_is_global boolean;
  v_source_version_id uuid;
  v_source_template public.template;
  v_source_version public.template_version;
  v_with_base boolean;
  v_base_name text;
  v_template_id uuid;
  v_version_id uuid;
  v_base public.base;
  v_fields jsonb;
  v_sections jsonb;
  v_count int;
  v_result jsonb;
begin
  if v_uid is null then
    raise exception using errcode = 'P0001', message = '{"code":"UNAUTHENTICATED"}';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' or p_operation_key is null then
    raise exception using errcode = 'P0001', message = '{"code":"INVALID_REQUEST"}';
  end if;

  v_name := btrim(coalesce(p_payload ->> 'name', ''));
  v_specialty := nullif(btrim(coalesce(p_payload ->> 'specialty', '')), '');
  v_is_global := coalesce((p_payload ->> 'isGlobal')::boolean, false);
  v_with_base := coalesce((p_payload ->> 'withBase')::boolean, false);
  v_base_name := btrim(coalesce(p_payload ->> 'baseName', ''));
  v_fields := coalesce(p_payload -> 'fields', '[]'::jsonb);
  v_sections := coalesce(p_payload -> 'sections', '[]'::jsonb);
  v_source_version_id := nullif(p_payload ->> 'sourceVersionId', '')::uuid;

  -- Validation complete avant toute ecriture persistante.
  if v_name = '' or char_length(v_name) > 120 then
    raise exception using errcode = 'P0001', message = '{"code":"INVALID_TEMPLATE_NAME","field":"name"}';
  end if;
  if v_specialty is not null and char_length(v_specialty) > 120 then
    raise exception using errcode = 'P0001', message = '{"code":"INVALID_SPECIALTY","field":"specialty"}';
  end if;
  if jsonb_typeof(v_fields) <> 'array' then
    raise exception using errcode = 'P0001', message = '{"code":"INVALID_FIELDS","field":"fields"}';
  end if;
  if jsonb_typeof(v_sections) <> 'array' then
    raise exception using errcode = 'P0001', message = '{"code":"INVALID_SECTIONS","field":"sections"}';
  end if;
  v_count := jsonb_array_length(v_fields);
  if v_count > 500 then
    raise exception using errcode = 'P0001', message = '{"code":"FIELD_LIMIT_EXCEEDED","field":"fields"}';
  end if;
  if jsonb_array_length(v_sections) > 60 then
    raise exception using errcode = 'P0001', message = '{"code":"SECTION_LIMIT_EXCEEDED","field":"sections"}';
  end if;
  if exists (
    select 1 from jsonb_array_elements(v_sections) s
    where jsonb_typeof(s) <> 'object'
       or btrim(coalesce(s ->> 'key', '')) !~ '^[a-z][a-z0-9_]{0,62}$'
       or btrim(coalesce(s ->> 'label', '')) = ''
       or char_length(btrim(coalesce(s ->> 'label', ''))) > 160
  ) then
    raise exception using errcode = 'P0001', message = '{"code":"INVALID_SECTION","field":"sections"}';
  end if;
  if exists (
    select 1 from jsonb_array_elements(v_sections) s
    group by btrim(s ->> 'key') having count(*) > 1
  ) then
    raise exception using errcode = 'P0001', message = '{"code":"DUPLICATE_SECTION_KEY","field":"sections"}';
  end if;
  if v_source_version_id is not null and jsonb_array_length(v_sections) <> 0 then
    raise exception using errcode = 'P0001', message = '{"code":"SOURCE_AND_SECTIONS_CONFLICT"}';
  end if;
  if exists (
    select 1 from jsonb_array_elements(v_fields) f
    where jsonb_typeof(f) <> 'object'
       or btrim(coalesce(f ->> 'fieldKey', '')) !~ '^[a-z][a-z0-9_]{0,62}$'
       or btrim(coalesce(f ->> 'label', '')) = '' or char_length(btrim(coalesce(f ->> 'label', ''))) > 160
       or coalesce(f ->> 'scope', '') not in ('patient', 'encounter')
       -- L31 : la section n'est plus l'une des trois, c'est un CODE. Sa forme est
       -- verifiee ici ; son existence l'est par la creation ci-dessous.
       or btrim(coalesce(f ->> 'section', '')) !~ '^[a-z][a-z0-9_]{0,62}$'
       or coalesce(f ->> 'type', '') not in ('number','integer','text','date','datetime','boolean','select','multiselect')
       or (f ? 'defaultValue' and f -> 'defaultValue' <> 'null'::jsonb)
  ) then
    raise exception using errcode = 'P0001', message = '{"code":"INVALID_FIELD","field":"fields"}';
  end if;
  if exists (select 1 from jsonb_array_elements(v_fields) f group by lower(btrim(f ->> 'fieldKey')) having count(*) > 1) then
    raise exception using errcode = 'P0001', message = '{"code":"DUPLICATE_FIELD_KEY","field":"fields"}';
  end if;
  if exists (select 1 from jsonb_array_elements(v_fields) f group by lower(btrim(f ->> 'label')) having count(*) > 1) then
    raise exception using errcode = 'P0001', message = '{"code":"DUPLICATE_FIELD_LABEL","field":"fields"}';
  end if;
  if exists (
    select 1 from jsonb_array_elements(v_fields) f
    where ((f ->> 'type') in ('select', 'multiselect') and (not (f ? 'allowedValues') or jsonb_typeof(f -> 'allowedValues') <> 'array'))
       or ((f ->> 'type') not in ('select', 'multiselect') and f ? 'allowedValues' and f -> 'allowedValues' <> 'null'::jsonb)
       or (f ? 'minValue' and f -> 'minValue' <> 'null'::jsonb and jsonb_typeof(f -> 'minValue') <> 'number')
       or (f ? 'maxValue' and f -> 'maxValue' <> 'null'::jsonb and jsonb_typeof(f -> 'maxValue') <> 'number')
       or (f ? 'minValue' and f ? 'maxValue' and (f ->> 'minValue')::numeric > (f ->> 'maxValue')::numeric)
       or ((f ->> 'scope') = 'patient' and f ? 'encounterTypes' and f -> 'encounterTypes' <> 'null'::jsonb)
       or ((f ->> 'scope') = 'encounter' and f ? 'encounterTypes' and f -> 'encounterTypes' <> 'null'::jsonb
           and (jsonb_typeof(f -> 'encounterTypes') <> 'array' or exists (
             select 1 from jsonb_array_elements_text(f -> 'encounterTypes') et
             where et not in ('consultation', 'hospitalisation', 'suivi', 'autre')
           )))
  ) then
    raise exception using errcode = 'P0001', message = '{"code":"INVALID_FIELD_CONSTRAINT","field":"fields"}';
  end if;

  -- Hash apres validation : une meme cle ne peut jamais etre reutilisee avec un autre payload.
  v_hash := encode(digest(p_payload::text, 'sha256'), 'hex');
  insert into public.template_operation(owner_user_id, operation_key, payload_hash, result)
  values (v_uid, p_operation_key, v_hash, '{}'::jsonb)
  on conflict do nothing;
  select * into v_existing from public.template_operation
   where owner_user_id = v_uid and operation_key = p_operation_key for update;
  if v_existing.result <> '{}'::jsonb then
    if v_existing.payload_hash <> v_hash then
      raise exception using errcode = 'P0001', message = '{"code":"IDEMPOTENCY_KEY_REUSED"}';
    end if;
    return v_existing.result;
  end if;

  if v_source_version_id is not null then
    select * into v_source_version from public.template_version where id = v_source_version_id for share;
    if not found then raise exception using errcode = 'P0001', message = '{"code":"SOURCE_NOT_FOUND"}'; end if;
    select * into v_source_template from public.template where id = v_source_version.template_id for share;
    if not (v_source_template.is_global or v_source_template.owner_user_id = v_uid or public.is_system_admin()) then
      raise exception using errcode = 'P0001', message = '{"code":"SOURCE_FORBIDDEN"}';
    end if;
    if v_count <> 0 then raise exception using errcode = 'P0001', message = '{"code":"SOURCE_AND_FIELDS_CONFLICT"}'; end if;
  end if;

  insert into public.template(name, specialty, owner_user_id, is_global)
  values (v_name, v_specialty, case when v_is_global then null else v_uid end, v_is_global)
  returning id into v_template_id;
  insert into public.template_version(template_id, version_number, status, created_by)
  values (v_template_id, 1, 'draft', v_uid) returning id into v_version_id;

  if v_source_version_id is not null then
    -- FOR SHARE ci-dessus garantit un snapshot coherent des attributs copies.
    -- `copy_template_fields` recopie les sections AVANT les champs.
    perform public.copy_template_fields(v_source_version_id, v_version_id);
    insert into public.validation_rule(template_version_id, rule, message, severity)
    select v_version_id, rule, message, severity from public.validation_rule where template_version_id = v_source_version_id order by id;
  else
    -- Sections EXPLICITES si le payload en porte, sinon DEDUITES des codes employes
    -- par les champs, dans l'ordre de leur premiere apparition. Un jeu de variables
    -- sans champ ni section demarre sur les trois sections historiques : une base
    -- neuve n'ouvre jamais un constructeur sans aucun regroupement.
    if jsonb_array_length(v_sections) > 0 then
      insert into public.template_section(template_version_id, section_key, label, display_order)
      select v_version_id, btrim(s.value ->> 'key'), btrim(s.value ->> 'label'), s.ordinality - 1
      from jsonb_array_elements(v_sections) with ordinality as s(value, ordinality)
      order by s.ordinality;
    elsif v_count > 0 then
      insert into public.template_section(template_version_id, section_key, label, display_order)
      select v_version_id, k.section_key, initcap(replace(k.section_key, '_', ' ')), k.ord - 1
      from (
        select btrim(f.value ->> 'section') as section_key,
               row_number() over (order by min(f.ordinality)) as ord
        from jsonb_array_elements(v_fields) with ordinality as f(value, ordinality)
        group by btrim(f.value ->> 'section')
      ) k
      order by k.ord;
    else
      insert into public.template_section(template_version_id, section_key, label, display_order)
      values (v_version_id, 'clinique', 'Clinique', 0),
             (v_version_id, 'biologie', 'Biologie', 1),
             (v_version_id, 'paraclinique', 'Paraclinique', 2);
    end if;

    -- `section_id` est resolu par le declencheur de miroir depuis le code : les
    -- sections existent deja a cet instant.
    insert into public.template_field(template_version_id, field_key, label, scope, section, type, unit, allowed_values, required, min_value, max_value, allow_missing_codes, display_order, encounter_types)
    select v_version_id, btrim(f.value ->> 'fieldKey'), btrim(f.value ->> 'label'), f.value ->> 'scope', btrim(f.value ->> 'section'), f.value ->> 'type',
      nullif(btrim(coalesce(f.value ->> 'unit', '')), ''), f.value -> 'allowedValues', coalesce((f.value ->> 'required')::boolean, false),
      nullif(f.value ->> 'minValue', '')::numeric, nullif(f.value ->> 'maxValue', '')::numeric, coalesce((f.value ->> 'allowMissingCodes')::boolean, false), f.ordinality - 1,
      case when f.value ->> 'scope' = 'encounter' then array(select jsonb_array_elements_text(coalesce(f.value -> 'encounterTypes', '[]'::jsonb))) else null end
    from jsonb_array_elements(v_fields) with ordinality as f(value, ordinality)
    order by f.ordinality;
  end if;
  if v_with_base then
    insert into public.base(name, specialty, owner_user_id, current_template_version_id)
    values (v_base_name, v_specialty, v_uid, v_version_id) returning * into v_base;
  end if;
  v_result := jsonb_build_object('templateId', v_template_id, 'versionId', v_version_id, 'baseId', case when v_with_base then v_base.id else null end);
  update public.template_operation set result = v_result where owner_user_id = v_uid and operation_key = p_operation_key;
  return v_result;
end $$;

-- =============================================================================
-- 9. Instantane hors-ligne
-- =============================================================================

-- L'instantane emet DESORMAIS les sections, par version comme les champs. Sans
-- `sectionsByVersion`, une rencontre ancienne relue hors-ligne perdrait le libelle de
-- sa section et retomberait sur « Autre » : le filet jouerait, mais pour rien.
-- `section` reste emis tel quel sur chaque champ : c'est ce que lisent les copies deja
-- telechargees.
create or replace function public.download_base_snapshot(p_base_id uuid)
returns jsonb
language sql stable security invoker set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'base', (
      select jsonb_build_object('id', b.id, 'name', b.name, 'templateVersionId', b.current_template_version_id)
      from public.base b where b.id = p_base_id
    ),
    'fields', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', tf.id, 'fieldKey', tf.field_key, 'label', tf.label,
        'description', tf.description, 'defaultValue', tf.default_value,
        'scope', tf.scope, 'type', tf.type, 'displayOrder', tf.display_order,
        'section', tf.section, 'unit', tf.unit, 'allowedValues', tf.allowed_values,
        'allowedOptions', tf.allowed_options,
        'required', tf.required, 'minValue', tf.min_value, 'maxValue', tf.max_value,
        'allowMissingCodes', tf.allow_missing_codes, 'missingReasons', to_jsonb(tf.missing_reasons),
        'encounterTypes', to_jsonb(tf.encounter_types)
      ) order by tf.display_order, tf.field_key)
      from public.template_field tf
      where tf.template_version_id = (select current_template_version_id from public.base where id = p_base_id)
    ), '[]'::jsonb),
    'sections', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', ts.id, 'sectionKey', ts.section_key, 'label', ts.label, 'displayOrder', ts.display_order
      ) order by ts.display_order, ts.section_key)
      from public.template_section ts
      where ts.template_version_id = (select current_template_version_id from public.base where id = p_base_id)
    ), '[]'::jsonb),
    'sectionsByVersion', coalesce((
      select jsonb_object_agg(v.tvid::text, v.sections)
      from (
        select ts.template_version_id as tvid,
               jsonb_agg(jsonb_build_object(
                 'id', ts.id, 'sectionKey', ts.section_key, 'label', ts.label, 'displayOrder', ts.display_order
               ) order by ts.display_order, ts.section_key) as sections
        from public.template_section ts
        where ts.template_version_id in (
          select b.current_template_version_id from public.base b
            where b.id = p_base_id and b.current_template_version_id is not null
          union
          select p.template_version_id from public.patient p
            where p.base_id = p_base_id and p.deleted_at is null
          union
          select e.template_version_id from public.encounter e
            join public.patient p on p.id = e.patient_id
            where p.base_id = p_base_id and p.deleted_at is null and e.deleted_at is null
        )
        group by ts.template_version_id
      ) v
    ), '{}'::jsonb),
    'fieldsByVersion', coalesce((
      select jsonb_object_agg(v.tvid::text, v.fields)
      from (
        select tf.template_version_id as tvid,
               jsonb_agg(jsonb_build_object(
                 'id', tf.id, 'fieldKey', tf.field_key, 'label', tf.label,
                 'description', tf.description, 'defaultValue', tf.default_value,
                 'scope', tf.scope, 'type', tf.type, 'displayOrder', tf.display_order,
                 'section', tf.section, 'unit', tf.unit, 'allowedValues', tf.allowed_values,
                 'allowedOptions', tf.allowed_options,
                 'required', tf.required, 'minValue', tf.min_value, 'maxValue', tf.max_value,
                 'allowMissingCodes', tf.allow_missing_codes, 'missingReasons', to_jsonb(tf.missing_reasons),
                 'encounterTypes', to_jsonb(tf.encounter_types)
               ) order by tf.display_order, tf.field_key) as fields
        from public.template_field tf
        where tf.template_version_id in (
          select p.template_version_id from public.patient p
            where p.base_id = p_base_id and p.deleted_at is null
          union
          select e.template_version_id from public.encounter e
            join public.patient p on p.id = e.patient_id
            where p.base_id = p_base_id and p.deleted_at is null and e.deleted_at is null
        )
        group by tf.template_version_id
      ) v
    ), '{}'::jsonb),
    'rulesByVersion', coalesce((
      select jsonb_object_agg(v.tvid::text, v.rules)
      from (
        select vr.template_version_id as tvid,
               jsonb_agg(jsonb_build_object(
                 'id', vr.id,
                 'rule', vr.rule,
                 'message', vr.message,
                 'severity', vr.severity
               ) order by vr.id) as rules
        from public.validation_rule vr
        where vr.template_version_id in (
          select b.current_template_version_id from public.base b
            where b.id = p_base_id and b.current_template_version_id is not null
          union
          select p.template_version_id from public.patient p
            where p.base_id = p_base_id and p.deleted_at is null
          union
          select e.template_version_id from public.encounter e
            join public.patient p on p.id = e.patient_id
            where p.base_id = p_base_id and p.deleted_at is null and e.deleted_at is null
        )
        group by vr.template_version_id
      ) v
    ), '{}'::jsonb),
    'patients', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id, 'code', p.patient_code, 'templateVersionId', p.template_version_id,
        'data', p.data, 'validationStatus', p.validation_status,
        'encounters', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', e.id, 'encounterType', e.encounter_type, 'encounterDate', e.encounter_date,
            'validationStatus', e.validation_status, 'ageValue', e.age_value, 'ageUnit', e.age_unit,
            'data', e.data, 'updatedAt', e.updated_at, 'templateVersionId', e.template_version_id
          ) order by e.encounter_date)
          from public.encounter e where e.patient_id = p.id and e.deleted_at is null
        ), '[]'::jsonb)
      ) order by p.created_at)
      from public.patient p where p.base_id = p_base_id and p.deleted_at is null
    ), '[]'::jsonb)
  );
$$;
revoke all on function public.download_base_snapshot(uuid) from public, anon, authenticated;
grant execute on function public.download_base_snapshot(uuid) to authenticated;
