-- UX-16 : rubriques communes renommables, placables librement parmi les blocs.
--
-- Une variable COMMUNE est une variable qui n'appartient a aucun bloc clinique : sa section
-- est nulle. Jusqu'ici, toutes ces variables etaient rendues dans un unique groupe intitule
-- « Tronc commun », toujours en tete du formulaire. Le besoin est de NOMMER ces regroupements
-- avec le vocabulaire de la collecte et de placer le diagnostic apres les premieres questions
-- utiles -- « Contexte de la consultation », « Evaluation initiale », « Diagnostics retenus »,
-- puis un bloc clinique, puis « Synthese ».
--
-- Ce qui est introduit ici est une METADONNEE DE PRESENTATION, et rien d'autre :
--   * une rubrique n'est pas une template_section : elle ne porte aucune condition, n'est
--     jamais cible d'un `then.section`, n'est pas une unite de projection ni d'import de bloc ;
--   * `section` et `section_id` des variables concernees RESTENT NULS. Rattacher le pilote a
--     une section changerait son appartenance clinique, sa projection d'export et son
--     eligibilite diagnostique -- exactement ce que ce lot doit eviter ;
--   * la couverture diagnostique et les colonnes communes de l'export ne lisent aucune de ces
--     colonnes : deplacer une variable ne deplace aucune donnee.
--
-- Sans rubrique, rien ne change : une version qui n'en declare aucune conserve son rendu
-- historique, « Tronc commun » en tete. C'est la valeur de repli, pas un titre impose.

-- ---------------------------------------------------------------------------------------
-- 1. Les rubriques
-- ---------------------------------------------------------------------------------------

-- `display_order` est le rang de la rubrique PARMI LES RUBRIQUES.
-- `anchor_order` est le nombre de blocs racines qui la precedent : 0 = avant tout bloc.
--
-- Ces deux rangs sont volontairement separes du `display_order` des sections. Celui-ci est
-- renumerote a chaque reordonnancement de blocs (normalize_template_section_order) : une
-- rubrique qui y puiserait son rang changerait de place toute seule des que le proprietaire
-- deplace un bloc. Une ancre exprimee en NOMBRE DE BLOCS survit a cette renumerotation, et
-- reordonner les blocs entre eux ne deplace aucune rubrique.
create table public.template_common_group (
  id uuid primary key default gen_random_uuid(),
  template_version_id uuid not null references public.template_version(id) on delete cascade,
  group_key text not null,
  label text not null,
  display_order int not null default 0,
  anchor_order int not null default 0,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  constraint template_common_group_key_unique unique (template_version_id, group_key),
  constraint template_common_group_id_version_key unique (id, template_version_id),
  constraint template_common_group_key_format check (group_key ~ '^[a-z][a-z0-9_]{0,62}$'),
  constraint template_common_group_label_present check (btrim(label) <> '' and char_length(label) <= 120),
  constraint template_common_group_ranks check (display_order >= 0 and anchor_order >= 0)
);

-- Une seule rubrique par defaut par version : c'est elle qui accueille une variable commune
-- creee apres coup, sans qu'aucune variable ne puisse se retrouver sans rubrique au rendu.
create unique index template_common_group_default_idx
  on public.template_common_group (template_version_id) where is_default;
create index template_common_group_order_idx
  on public.template_common_group (template_version_id, display_order, group_key);

alter table public.template_common_group enable row level security;
revoke all on table public.template_common_group from public, anon, authenticated;
-- Lecture seulement : l'ecriture passe par l'operation atomique, jamais par une requete
-- directe. Un client ancien ne peut donc pas effacer ces metadonnees en reecrivant une ligne.
grant select on table public.template_common_group to authenticated;
create policy tcg_read on public.template_common_group for select
  using (public.can_read_template(public.template_of_version(template_version_id)));

-- ---------------------------------------------------------------------------------------
-- 2. Le rattachement d'une variable commune
-- ---------------------------------------------------------------------------------------

alter table public.template_field add column common_group_id uuid;
alter table public.template_field add constraint template_field_common_group_fk
  foreign key (common_group_id, template_version_id)
  references public.template_common_group (id, template_version_id);
-- Structurellement : une variable rattachee a un bloc n'a pas de rubrique commune, et une
-- variable n'a jamais deux emplacements. « Une seule rubrique effective par variable » n'est
-- pas une precaution d'ecran, c'est une contrainte de table.
alter table public.template_field add constraint template_field_common_group_only_common
  check (common_group_id is null or (section is null and section_id is null));
create index template_field_common_group_idx
  on public.template_field (common_group_id) where common_group_id is not null;

-- Deplacer une variable commune VERS un bloc clinique reste possible : elle cesse alors
-- d'etre commune, donc elle perd sa rubrique. Ce detachement est fait ici, et non refuse,
-- pour que l'ecran de variable existant continue de fonctionner sans rien connaitre du lot.
-- Le nom du declencheur le place APRES `trg_template_field_section`, qui resout le miroir
-- section/section_id : c'est la valeur resolue qui decide.
create function public.enforce_template_field_common_group()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if new.section is not null or new.section_id is not null then
    new.common_group_id := null;
  -- Une variable qui REJOINT le tronc commun suit la rubrique par defaut. La seule
  -- exception est l'operation atomique UX-16 elle-meme : elle detache d'abord toutes les
  -- variables avant de supprimer/renommer les rubriques puis de les rattacher d'un coup.
  -- Sans ce marqueur transactionnel, le detachement serait aussitot re-ecrit vers l'ancien
  -- defaut et la suppression d'une rubrique echouerait a tort.
  elsif new.common_group_id is null
    and coalesce(current_setting('app.setting_common_layout', true), '') <> 'on' then
    select g.id into new.common_group_id
    from public.template_common_group g
    where g.template_version_id = new.template_version_id and g.is_default;
  elsif coalesce(current_setting('app.setting_common_layout', true), '') <> 'on'
    and (tg_op = 'INSERT' or new.common_group_id is distinct from old.common_group_id) then
    -- Le rattachement est une organisation COMPLETE, pas une colonne ecrite par un client.
    -- Sinon une mise a jour PostgREST isolee pourrait creer un doublon ou faire disparaitre
    -- une variable de la rubrique rendue, en contournant l'empreinte et l'idempotence.
    -- Cette garde est un trigger INVOKER : appeler `common_layout_error`, fonction interne
    -- revokee aux clients, transformerait le refus fonctionnel en « permission denied ».
    raise exception using errcode = 'P0001', message = 'COMMON_LAYOUT_DIRECT_WRITE_FORBIDDEN',
      detail = '{"code":"common_layout_direct_write_forbidden","action":"resolve_required"}';
  end if;
  return new;
end $$;
revoke all on function public.enforce_template_field_common_group() from public, anon, authenticated;
create trigger trg_zz_template_field_common_group
  before insert or update on public.template_field
  for each row execute function public.enforce_template_field_common_group();

-- ---------------------------------------------------------------------------------------
-- 3. Contrat d'ecriture atomique
-- ---------------------------------------------------------------------------------------

-- Recu d'operation : un enregistrement rejoue rend le meme resultat sans reecrire.
-- Aucun libelle clinique n'y entre, seulement des cles de presentation.
create table public.common_layout_operation (
  owner_id uuid not null references auth.users(id) on delete cascade,
  operation_id uuid not null,
  template_version_id uuid not null references public.template_version(id) on delete cascade,
  request_hash text not null,
  receipt jsonb not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key (owner_id, operation_id)
);
alter table public.common_layout_operation enable row level security;
revoke all on public.common_layout_operation from public, anon, authenticated;

-- Erreur structuree : un code fonctionnel et une action, jamais une erreur SQL brute.
create function public.common_layout_error(p_code text, p_details jsonb default '{}'::jsonb) returns void
language plpgsql set search_path = public, pg_temp as $$
begin
  raise exception using errcode = 'P0001', message = p_code,
    detail = (jsonb_build_object(
      'code', lower(p_code),
      'action', case when p_code in ('COMMON_LAYOUT_CONFLICT', 'COMMON_LAYOUT_VERSION_LOCKED',
                                     'COMMON_LAYOUT_VERSION_IN_USE')
                     then 'refresh_required' else 'resolve_required' end
    ) || coalesce(p_details, '{}'::jsonb))::text;
end $$;
revoke all on function public.common_layout_error(text, jsonb) from public, anon, authenticated;

-- L'ecriture reste reservee au proprietaire. La lecture d'etat, elle, suit exactement la
-- meme frontiere que les champs et les sections : un collaborateur d'une base ou le staff de
-- curation doit recevoir le rendu de la version qu'il peut deja lire, sans obtenir le droit de
-- la reorganiser.
create function public.assert_common_layout_read_access(p_version_id uuid) returns void
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_template uuid;
begin
  if auth.uid() is null then perform public.common_layout_error('COMMON_LAYOUT_FORBIDDEN'); end if;
  select template_id into v_template from public.template_version where id = p_version_id;
  -- Version absente et version interdite restent indistinguables pour ne pas devenir une sonde.
  if v_template is null or not public.can_read_template(v_template) then
    perform public.common_layout_error('COMMON_LAYOUT_FORBIDDEN');
  end if;
end $$;
revoke all on function public.assert_common_layout_read_access(uuid) from public, anon, authenticated;
grant execute on function public.assert_common_layout_read_access(uuid) to authenticated;

-- L'ecriture est plus etroite que la lecture : l'organisation modifie une version, donc seul
-- son proprietaire (ou l'administration deja couverte par owns_template) peut la commander.
create function public.assert_common_layout_access(p_version_id uuid) returns void
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_template uuid;
begin
  if auth.uid() is null then perform public.common_layout_error('COMMON_LAYOUT_FORBIDDEN'); end if;
  select template_id into v_template from public.template_version where id = p_version_id;
  -- Version absente et version interdite renvoient le meme refus : l'existence du gabarit
  -- d'autrui ne se deduit pas de la difference des messages.
  if v_template is null or not public.owns_template(v_template) then
    perform public.common_layout_error('COMMON_LAYOUT_FORBIDDEN');
  end if;
end $$;
revoke all on function public.assert_common_layout_access(uuid) from public, anon, authenticated;
grant execute on function public.assert_common_layout_access(uuid) to authenticated;

-- Empreinte de ce dont depend une organisation : le statut, les blocs racines DANS LEUR
-- ORDRE (les ancres comptent des blocs), l'ensemble des variables communes, et le
-- rattachement courant de chacune. Un enregistrement prepare sur un autre etat est refuse
-- au lieu d'ecraser une organisation qu'on n'a jamais vue.
create function public.template_version_layout_fingerprint(p_version_id uuid) returns text
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_status text; v_roots text; v_groups text; v_fields text;
begin
  -- La signature est inventoriee et executable par authenticated : ne jamais la laisser
  -- devenir une sonde de structure pour un appelant qui ne peut pas lire la version.
  perform public.assert_common_layout_read_access(p_version_id);
  select status into v_status from public.template_version where id = p_version_id;
  if v_status is null then return null; end if;
  select coalesce(string_agg(s.section_key, ',' order by s.display_order, s.section_key), '')
    into v_roots from public.template_section s
    where s.template_version_id = p_version_id and s.parent_section_id is null;
  select coalesce(string_agg(g.group_key || ':' || g.label || ':' || g.display_order
      || ':' || g.anchor_order || ':' || g.is_default::text, ',' order by g.group_key), '')
    into v_groups from public.template_common_group g where g.template_version_id = p_version_id;
  select coalesce(string_agg(f.field_key || ':' || coalesce(g.group_key, ''), ',' order by f.field_key), '')
    into v_fields from public.template_field f
    left join public.template_common_group g on g.id = f.common_group_id
    where f.template_version_id = p_version_id and f.section is null;
  return md5(v_status || '|' || v_roots || '|' || v_groups || '|' || v_fields);
end $$;
revoke all on function public.template_version_layout_fingerprint(uuid) from public, anon, authenticated;
grant execute on function public.template_version_layout_fingerprint(uuid) to authenticated;

-- Etat courant, tel que l'ecran doit le montrer : les rubriques dans l'ordre avec leurs
-- variables, les blocs racines qui servent de reperes aux ancres, les variables communes
-- encore sans rubrique, et l'empreinte que l'enregistrement devra presenter.
create function public.common_layout_state(p_version_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_result jsonb;
begin
  perform public.assert_common_layout_read_access(p_version_id);
  select jsonb_build_object(
    'fingerprint', public.template_version_layout_fingerprint(p_version_id),
    'locked', public.template_version_locked(p_version_id),
    'inUse', public.template_version_in_use(p_version_id),
    'defaultKey', (select g.group_key from public.template_common_group g
                    where g.template_version_id = p_version_id and g.is_default),
    'sections', coalesce((select jsonb_agg(jsonb_build_object('key', s.section_key, 'label', s.label)
                    order by s.display_order, s.section_key)
                  from public.template_section s
                  where s.template_version_id = p_version_id and s.parent_section_id is null), '[]'::jsonb),
    'groups', coalesce((select jsonb_agg(jsonb_build_object(
                    'id', g.id, 'key', g.group_key, 'label', g.label,
                    'anchor', g.anchor_order, 'isDefault', g.is_default,
                    'fields', coalesce((select jsonb_agg(f.field_key order by f.display_order, f.field_key)
                                from public.template_field f where f.common_group_id = g.id), '[]'::jsonb))
                    order by g.display_order, g.group_key)
                  from public.template_common_group g
                  where g.template_version_id = p_version_id), '[]'::jsonb),
    'unassigned', coalesce((select jsonb_agg(f.field_key order by f.display_order, f.field_key)
                  from public.template_field f
                  where f.template_version_id = p_version_id and f.section is null
                    and f.common_group_id is null), '[]'::jsonb)
  ) into v_result;
  return v_result;
end $$;
revoke all on function public.common_layout_state(uuid) from public, anon;
grant execute on function public.common_layout_state(uuid) to authenticated;

-- Enregistrement : tout ou rien.
--
-- La charge decrit l'organisation COMPLETE -- les rubriques dans l'ordre, leur ancre, et la
-- liste ordonnee de leurs variables. Un enregistrement partiel n'existe pas : c'est ce qui
-- permet de garantir, sans confiance envers l'ecran, qu'aucune variable commune n'est
-- dupliquee ni omise au rendu. Supprimer une rubrique se fait donc en la retirant de la
-- charge apres avoir place ses variables ailleurs ; ses variables ne sont jamais supprimees.
--
-- L'ordre des controles est volontaire : le recu d'une operation deja appliquee est rendu
-- AVANT le controle d'empreinte, sans quoi le rejeu d'une reponse perdue se heurterait au
-- changement que l'operation a elle-meme provoque.
create function public.set_common_layout(
  p_version_id uuid, p_operation_id uuid, p_payload jsonb, p_expected_fingerprint text
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_op public.common_layout_operation;
  v_hash text;
  v_groups jsonb;
  v_default text;
  v_roots int;
  v_count int;
  v_anchor int;
  v_previous int := -1;
  v_group jsonb;
  v_assign jsonb;
  v_receipt jsonb;
begin
  perform public.assert_common_layout_access(p_version_id);
  if p_operation_id is null or p_expected_fingerprint is null
     or p_payload is null or jsonb_typeof(p_payload) <> 'object'
     or jsonb_typeof(coalesce(p_payload -> 'groups', '[]'::jsonb)) <> 'array' then
    perform public.common_layout_error('COMMON_LAYOUT_INVALID');
  end if;
  v_groups := coalesce(p_payload -> 'groups', '[]'::jsonb);

  -- Serialise les cles d'operation d'un meme auteur avant tout verrou de version.
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text, 61213));
  v_hash := md5(jsonb_build_array('set_common_layout', p_version_id, p_payload)::text);
  select * into v_op from public.common_layout_operation
    where owner_id = auth.uid() and operation_id = p_operation_id;
  if found then
    if v_op.request_hash <> v_hash then perform public.common_layout_error('COMMON_LAYOUT_OPERATION_CONFLICT'); end if;
    return v_op.receipt;
  end if;

  perform 1 from public.template_version where id = p_version_id for update;
  if public.template_version_locked(p_version_id) then
    perform public.common_layout_error('COMMON_LAYOUT_VERSION_LOCKED');
  end if;
  -- Une version deja servie a des dossiers est figee : reorganiser sa presentation passe par
  -- une nouvelle version modifiable, comme pour un bloc.
  if public.template_version_in_use(p_version_id) then
    perform public.common_layout_error('COMMON_LAYOUT_VERSION_IN_USE');
  end if;
  if public.template_version_layout_fingerprint(p_version_id) is distinct from p_expected_fingerprint then
    perform public.common_layout_error('COMMON_LAYOUT_CONFLICT');
  end if;

  -- --- Validation complete AVANT toute ecriture -----------------------------------------
  select count(*) into v_roots from public.template_section
    where template_version_id = p_version_id and parent_section_id is null;

  if exists (select 1 from jsonb_array_elements(v_groups) g
             where jsonb_typeof(g.value) <> 'object'
                or coalesce(g.value ->> 'key', '') !~ '^[a-z][a-z0-9_]{0,62}$'
                or btrim(coalesce(g.value ->> 'label', '')) = ''
                or char_length(btrim(g.value ->> 'label')) > 120
                or jsonb_typeof(coalesce(g.value -> 'fields', '[]'::jsonb)) <> 'array'
                or exists (select 1 from jsonb_array_elements(case when jsonb_typeof(g.value -> 'fields') = 'array'
                           then g.value -> 'fields' else '[]'::jsonb end) f
                           where jsonb_typeof(f.value) <> 'string')
                -- Cast only after this check: a malicious `anchor: "x"` must be a
                -- structured functional refusal, never a raw PostgreSQL cast error.
                or (g.value ? 'anchor' and (jsonb_typeof(g.value -> 'anchor') <> 'number'
                    or (g.value ->> 'anchor') !~ '^-?[0-9]+$'))) then
    perform public.common_layout_error('COMMON_LAYOUT_INVALID_GROUP');
  end if;
  if (select count(distinct g.value ->> 'key') from jsonb_array_elements(v_groups) g)
     <> jsonb_array_length(v_groups) then
    perform public.common_layout_error('COMMON_LAYOUT_DUPLICATE_GROUP');
  end if;

  -- Une ancre compte les blocs qui precedent : hors de cet intervalle elle ne designe rien,
  -- et une suite decroissante decrirait deux ordres contradictoires.
  for v_group in select value from jsonb_array_elements(v_groups) loop
    v_anchor := coalesce((v_group ->> 'anchor')::int, 0);
    if v_anchor < 0 or v_anchor > v_roots or v_anchor < v_previous then
      perform public.common_layout_error('COMMON_LAYOUT_INVALID_ANCHOR',
        jsonb_build_object('group', v_group ->> 'key'));
    end if;
    v_previous := v_anchor;
  end loop;

  v_default := nullif(btrim(coalesce(p_payload ->> 'defaultKey', '')), '');
  if jsonb_array_length(v_groups) > 0 then
    if v_default is null then v_default := v_groups -> 0 ->> 'key'; end if;
    if not exists (select 1 from jsonb_array_elements(v_groups) g where g.value ->> 'key' = v_default) then
      perform public.common_layout_error('COMMON_LAYOUT_UNKNOWN_DEFAULT');
    end if;
  elsif v_default is not null then
    perform public.common_layout_error('COMMON_LAYOUT_UNKNOWN_DEFAULT');
  end if;

  -- La charge doit decrire EXACTEMENT les variables communes de la version. Une variable en
  -- trop viendrait d'un ecran perime ; une variable manquante disparaitrait de l'organisation
  -- sans que personne ne l'ait decide.
  select coalesce(jsonb_agg(jsonb_build_object('fieldKey', k.value #>> '{}', 'groupKey', g.value ->> 'key')
           order by g.ordinality, k.ordinality), '[]'::jsonb)
    into v_assign
  from jsonb_array_elements(v_groups) with ordinality as g(value, ordinality)
  left join lateral jsonb_array_elements(coalesce(g.value -> 'fields', '[]'::jsonb))
       with ordinality as k(value, ordinality) on true
  where k.value is not null;

  if (select count(distinct a.value ->> 'fieldKey') from jsonb_array_elements(v_assign) a)
     <> jsonb_array_length(v_assign) then
    perform public.common_layout_error('COMMON_LAYOUT_DUPLICATE_FIELD');
  end if;
  if exists (select 1 from jsonb_array_elements(v_assign) a where not exists (
               select 1 from public.template_field f
               where f.template_version_id = p_version_id and f.field_key = a.value ->> 'fieldKey'
                 and f.section is null)) then
    perform public.common_layout_error('COMMON_LAYOUT_UNKNOWN_FIELD');
  end if;
  select count(*) into v_count from public.template_field f
    where f.template_version_id = p_version_id and f.section is null;
  -- Revenir explicitement au rendu historique est valide : aucune rubrique, aucune
  -- affectation, toutes les variables communes restent accessibles sous le repli « Tronc
  -- commun ». Des qu'une rubrique existe, au contraire, la charge doit etre complete.
  if jsonb_array_length(v_groups) > 0 and v_count <> jsonb_array_length(v_assign) then
    perform public.common_layout_error('COMMON_LAYOUT_MISSING_FIELD');
  end if;

  -- --- Ecriture -------------------------------------------------------------------------
  -- Detacher d'abord : une rubrique retiree ne peut etre supprimee que vide, et ses variables
  -- ont deja recu leur nouvelle destination dans la charge.
  perform set_config('app.setting_common_layout', 'on', true);
  update public.template_field set common_group_id = null
    where template_version_id = p_version_id and common_group_id is not null;
  delete from public.template_common_group g
    where g.template_version_id = p_version_id
      and not exists (select 1 from jsonb_array_elements(v_groups) p where p.value ->> 'key' = g.group_key);

  -- La rubrique par defaut est posee en DEUX temps : l'index unique partiel refuserait deux
  -- valeurs vraies, meme transitoirement, si l'ancienne et la nouvelle se croisaient.
  update public.template_common_group set is_default = false
    where template_version_id = p_version_id and is_default;
  insert into public.template_common_group (template_version_id, group_key, label, display_order, anchor_order)
  select p_version_id, g.value ->> 'key', btrim(g.value ->> 'label'),
         (g.ordinality - 1)::int, coalesce((g.value ->> 'anchor')::int, 0)
  from jsonb_array_elements(v_groups) with ordinality as g(value, ordinality)
  on conflict (template_version_id, group_key) do update
    set label = excluded.label, display_order = excluded.display_order,
        anchor_order = excluded.anchor_order;
  update public.template_common_group set is_default = true
    where template_version_id = p_version_id and group_key = v_default;

  update public.template_field f set common_group_id = g.id
  from jsonb_array_elements(v_assign) a
  join public.template_common_group g
    on g.template_version_id = p_version_id and g.group_key = a.value ->> 'groupKey'
  where f.template_version_id = p_version_id and f.field_key = a.value ->> 'fieldKey';

  -- Reordonner DANS une rubrique ne renumerote pas tout le modele : les variables communes
  -- se repartissent, dans leur nouvel ordre, les rangs qu'elles occupaient deja.
  with wanted as (
    select a.value ->> 'fieldKey' as field_key, (a.ordinality)::int as rank
    from jsonb_array_elements(v_assign) with ordinality as a(value, ordinality)
  ), slots as (
    select f2.display_order, (row_number() over (order by f2.display_order, f2.field_key))::int as rank
    from public.template_field f2
    where f2.template_version_id = p_version_id and f2.section is null
  )
  update public.template_field f set display_order = s.display_order
  from wanted w join slots s on s.rank = w.rank
  where f.template_version_id = p_version_id and f.field_key = w.field_key
    and f.display_order is distinct from s.display_order;

  v_receipt := public.common_layout_state(p_version_id);
  insert into public.common_layout_operation (owner_id, operation_id, template_version_id, request_hash, receipt)
  values (auth.uid(), p_operation_id, p_version_id, v_hash, v_receipt);
  return v_receipt;
end $$;
revoke all on function public.set_common_layout(uuid, uuid, jsonb, text) from public, anon;
grant execute on function public.set_common_layout(uuid, uuid, jsonb, text) to authenticated;

-- ---------------------------------------------------------------------------------------
-- 4. Copies de version
-- ---------------------------------------------------------------------------------------

-- Une copie emporte l'organisation de la source et la rattache A LA COPIE : aucune reference
-- vivante ne subsiste vers la version d'origine, dont l'historique garde sa propre
-- presentation. Sans cela, dupliquer une version rendrait ses rubriques vides.
create or replace function public.copy_template_fields(
  p_source_version_id  uuid,
  p_target_version_id  uuid,
  p_force_patient_scope boolean default false
) returns void
language plpgsql security invoker set search_path = public, pg_temp as $$
declare config jsonb;
begin
  select diagnosis_configuration into config from public.template_version where id = p_source_version_id for update;
  if p_force_patient_scope and exists (select 1 from jsonb_array_elements(config) c where c ->> 'scope' = 'encounter') then
    raise exception 'DIAGNOSIS_SCOPE_COPY_CONFLICT';
  end if;
  insert into public.template_section
    (template_version_id, section_key, label, display_order,
     source_template_version_id, source_section_key)
  select p_target_version_id, ts.section_key, ts.label, ts.display_order,
         ts.source_template_version_id, ts.source_section_key
  from public.template_section ts
  where ts.template_version_id = p_source_version_id
  order by ts.display_order, ts.section_key
  on conflict (template_version_id, section_key) do nothing;

  -- Second pass: resolve the source parent by its stable key in the target version.
  update public.template_section target set parent_section_id = parent_target.id
  from public.template_section source
  join public.template_section parent_source on parent_source.id = source.parent_section_id
  join public.template_section parent_target on parent_target.template_version_id = p_target_version_id
    and parent_target.section_key = parent_source.section_key
  where source.template_version_id = p_source_version_id
    and target.template_version_id = p_target_version_id and target.section_key = source.section_key;

  -- UX-16 : les rubriques communes AVANT les variables, comme les sections, pour que le
  -- rattachement se resolve dans la foulee.
  insert into public.template_common_group
    (template_version_id, group_key, label, display_order, anchor_order, is_default)
  select p_target_version_id, g.group_key, g.label, g.display_order, g.anchor_order, g.is_default
  from public.template_common_group g
  where g.template_version_id = p_source_version_id
  order by g.display_order, g.group_key
  on conflict (template_version_id, group_key) do nothing;

  -- La recopie reconstruit les rattachements avec les identifiants de la CIBLE. Le marqueur
  -- interdit au trigger de prendre transitoirement le defaut source/cible avant cette passe.
  perform set_config('app.setting_common_layout', 'on', true);
  perform public.copy_template_field_rows(p_source_version_id, p_target_version_id, p_force_patient_scope, null);

  update public.template_field target set common_group_id = target_group.id
  from public.template_field source
  join public.template_common_group source_group on source_group.id = source.common_group_id
  join public.template_common_group target_group on target_group.template_version_id = p_target_version_id
    and target_group.group_key = source_group.group_key
  where source.template_version_id = p_source_version_id
    and target.template_version_id = p_target_version_id and target.field_key = source.field_key
    and target.section is null;

  update public.template_version set diagnosis_configuration = config where id = p_target_version_id;
end $$;
revoke all on function public.copy_template_fields(uuid, uuid, boolean) from public, anon, authenticated;
