-- =============================================================================
-- 20261005010000_in_use_field_and_rule_edits.sql
--
-- Decision produit : sur un jeu de variables DEJA UTILISE par des dossiers, le responsable
-- doit pouvoir
--   1. renommer la cle technique d'une variable renseignee ;
--   2. supprimer une variable renseignee ;
--   3. retirer une option de liste deja choisie dans des dossiers ;
--   4. ajouter, modifier et supprimer les regles d'une version utilisee.
--
-- Avant, ces gestes etaient refuses (« creez une nouvelle version »). Les lever SANS
-- traiter les valeurs existantes rendrait les dossiers inecrivables : chaque
-- enregistrement revalide la fiche ENTIERE (`form_record_assert_known_data` refuse une
-- cle inconnue, `assert_data_valid` une option absente de la liste). Chaque geste emporte
-- donc ses valeurs, dans la MEME transaction :
--
--   * renommage de cle : les valeurs SUIVENT la cle (dossiers, provenance, brouillons de
--     curation en cours, formulaires de saisie et colonnes affichees de la base). Aucune
--     valeur n'est perdue ni reinterpretee ; le journal `field_change_log` reste tel qu'il
--     a ete ecrit (trace historique immuable), le renommage est trace dans `audit_log` ;
--   * suppression : les valeurs sont RETIREES des dossiers ; chaque valeur retiree est
--     journalisee dans `field_change_log` (ancienne valeur, auteur, date, source dediee
--     `field_deletion`) ;
--   * retrait d'option : l'appelant designe, pour chaque option retiree encore portee par
--     des dossiers, une option de remplacement ou le vidage (`null`). Sans designation, refus
--     structure `OPTION_REPLACEMENT_REQUIRED`. Chaque valeur changee est journalisee (source
--     `option_retirement`). La garde du declencheur devient une garde d'INTEGRITE : une
--     option ne peut disparaitre de la liste tant qu'un dossier la porte encore ;
--   * regles : la garde `trg_vr_inuse` est retiree. Les dossiers existants ne sont pas
--     revalides retroactivement ; une regle s'applique au prochain enregistrement.
--
-- Dossiers concernes par une variable F (version V, cle k, portee s) : ceux de V qui
-- portent k, et ceux d'une base dont V est la version courante, rattaches a une version
-- plus ancienne, qui portent k sans que leur propre version definisse k (valeurs saisies
-- par complement E3 sous la definition courante). Les dossiers en corbeille sont inclus :
-- une restauration ne doit pas ramener une cle inecrivable.
--
-- Concurrence : la variable est verrouillee (`for update`) ; chaque dossier reecrit voit sa
-- revision incrementee par ses declencheurs existants, donc un editeur concurrent recoit un
-- conflit au lieu d'ecraser la reecriture. Idempotence : rejouer une suppression trouve la
-- variable absente et ne fait rien ; rejouer un retrait d'option ne trouve plus de valeur a
-- remplacer ; rejouer un renommage ne change pas la cle.
--
-- Additive : une contrainte `check` elargie (surensemble), des fonctions nouvelles, une
-- nouvelle surcharge de `update_template_field` ; les anciennes surcharges restent en
-- service pour les clients non rafraichis (elles refusent toujours le renommage d'une
-- variable utilisee, comme avant). Retour arriere : recreer `trg_vr_inuse`, restaurer les
-- definitions precedentes des fonctions remplacees et supprimer les fonctions ajoutees ;
-- les valeurs deja deplacees ou retirees restent tracees dans `field_change_log`.
-- =============================================================================

-- =============================================================================
-- 1. Sources de journal dediees
-- =============================================================================
-- Surensemble de la liste precedente : aucune ligne existante ne peut la violer.
alter table public.field_change_log drop constraint if exists field_change_log_source_check;
alter table public.field_change_log
  add constraint field_change_log_source_check
  check (source in ('direct_entry', 'curation_validation', 'curation_finalization',
                    'manual_correction', 'import', 'option_key_repair',
                    'field_deletion', 'option_retirement'))
  not valid;
alter table public.field_change_log validate constraint field_change_log_source_check;

-- =============================================================================
-- 2. Fonctions pures de reecriture d'un objet `data`
-- =============================================================================

-- Une valeur porte-t-elle l'option `p_key` ? Liste simple (texte) ou multiple (tableau).
create function public.field_value_has_option(p_value jsonb, p_key text)
returns boolean language sql immutable set search_path = pg_catalog, pg_temp as $$
  select coalesce(
    (jsonb_typeof(p_value) = 'string' and p_value #>> '{}' = p_key)
    or (jsonb_typeof(p_value) = 'array' and p_value @> jsonb_build_array(p_key)),
    false)
$$;

-- Remplace les options retirees d'une valeur. `p_replacements` : { cle_retiree: cle | null }.
-- Liste simple : la valeur est remplacee, ou la cle retiree de `data` si le remplacement
-- est `null` (valeur videe). Liste multiple : chaque element est remplace ou retire, les
-- doublons crees par un remplacement sont fusionnes (premier rang conserve) ; une liste
-- devenue vide retire la cle. Une valeur manquante codee (`__missing__`) n'est pas touchee.
create function public.field_data_option_replaced(p_data jsonb, p_key text, p_replacements jsonb)
returns jsonb language plpgsql immutable set search_path = pg_catalog, pg_temp as $$
declare
  v     jsonb;
  v_out jsonb;
begin
  if p_data is null or jsonb_typeof(p_data) <> 'object' or not (p_data ? p_key)
     or p_replacements is null or jsonb_typeof(p_replacements) <> 'object' then
    return p_data;
  end if;
  v := p_data -> p_key;
  if jsonb_typeof(v) = 'string' then
    if not (p_replacements ? (v #>> '{}')) then return p_data; end if;
    if jsonb_typeof(p_replacements -> (v #>> '{}')) = 'string' then
      return jsonb_set(p_data, array[p_key], p_replacements -> (v #>> '{}'));
    end if;
    return p_data - p_key;
  elsif jsonb_typeof(v) = 'array' then
    if not exists (select 1 from jsonb_array_elements(v) e
                    where jsonb_typeof(e.value) = 'string' and p_replacements ? (e.value #>> '{}')) then
      return p_data;
    end if;
    select coalesce(jsonb_agg(x.value order by x.first_pos), '[]'::jsonb) into v_out
      from (
        select r.value, min(r.pos) as first_pos
          from (
            select case when jsonb_typeof(e.value) = 'string' and p_replacements ? (e.value #>> '{}')
                        then p_replacements -> (e.value #>> '{}')
                        else e.value end as value,
                   e.pos
              from jsonb_array_elements(v) with ordinality as e(value, pos)
          ) r
         where jsonb_typeof(r.value) is distinct from 'null'
         group by r.value
      ) x;
    if jsonb_array_length(v_out) = 0 then return p_data - p_key; end if;
    return jsonb_set(p_data, array[p_key], v_out);
  end if;
  return p_data;
end $$;

-- Une seule fonction de reecriture pour les trois gestes, afin que dossiers et brouillons
-- subissent EXACTEMENT la meme transformation.
--   'rename'          : la valeur passe de p_key a p_new_key ;
--   'remove'          : la cle est retiree ;
--   'replace_options' : voir `field_data_option_replaced`.
create function public.field_data_rewrite(
  p_data jsonb, p_op text, p_key text, p_new_key text, p_replacements jsonb
)
returns jsonb language plpgsql immutable set search_path = public, pg_temp as $$
begin
  if p_data is null or jsonb_typeof(p_data) <> 'object' or not (p_data ? p_key) then
    return p_data;
  end if;
  if p_op = 'rename' then
    return (p_data - p_key) || jsonb_build_object(p_new_key, p_data -> p_key);
  elsif p_op = 'remove' then
    return p_data - p_key;
  elsif p_op = 'replace_options' then
    return public.field_data_option_replaced(p_data, p_key, p_replacements);
  end if;
  raise exception 'Reecriture de donnees inconnue';
end $$;

-- Remplace une cle dans une liste de cles (formulaire de saisie, colonnes affichees) en
-- conservant l'ordre et sans creer de doublon.
create function public.text_array_key_renamed(p_keys text[], p_old text, p_new text)
returns text[] language sql immutable set search_path = pg_catalog, pg_temp as $$
  select coalesce(array_agg(x.k order by x.first_pos), '{}'::text[])
    from (
      select case when u.k = p_old then p_new else u.k end as k, min(u.pos) as first_pos
        from unnest(p_keys) with ordinality as u(k, pos)
       group by 1
    ) x
$$;

revoke all on function public.field_value_has_option(jsonb, text) from public, anon, authenticated;
revoke all on function public.field_data_option_replaced(jsonb, text, jsonb) from public, anon, authenticated;
revoke all on function public.field_data_rewrite(jsonb, text, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.text_array_key_renamed(text[], text, text) from public, anon, authenticated;

-- =============================================================================
-- 3. Dossiers concernes par une variable
-- =============================================================================
-- `security invoker`, revoquee des clients : seules les fonctions privilegiees de ce lot
-- l'appellent, apres leur propre controle d'autorisation. `p_include_shadowed` : inclure
-- aussi les dossiers anciens dont la version definit la meme cle (utile au retrait
-- d'option, car l'enregistrement d'un tel dossier valide aussi la definition courante).
-- La valeur est rendue pour eviter une seconde lecture de la fiche.
create function public.template_field_value_holders(
  p_version_id uuid, p_scope text, p_field_key text, p_include_shadowed boolean
)
returns table (entity text, entity_id uuid, base_id uuid, value jsonb)
language sql stable security invoker set search_path = public, pg_temp as $$
  select 'patient'::text, p.id, p.base_id, p.data -> p_field_key
    from public.patient p
   where p_scope = 'patient' and p.template_version_id = p_version_id and p.data ? p_field_key
  union all
  select 'patient'::text, p.id, p.base_id, p.data -> p_field_key
    from public.base b
    join public.patient p on p.base_id = b.id
   where p_scope = 'patient' and b.current_template_version_id = p_version_id
     and p.template_version_id <> p_version_id and p.data ? p_field_key
     and (p_include_shadowed or not exists (
           select 1 from public.template_field f
            where f.template_version_id = p.template_version_id
              and f.field_key = p_field_key and f.scope = 'patient'))
  union all
  select 'encounter'::text, e.id, p.base_id, e.data -> p_field_key
    from public.encounter e
    join public.patient p on p.id = e.patient_id
   where p_scope = 'encounter' and e.template_version_id = p_version_id and e.data ? p_field_key
  union all
  select 'encounter'::text, e.id, p.base_id, e.data -> p_field_key
    from public.base b
    join public.patient p on p.base_id = b.id
    join public.encounter e on e.patient_id = p.id
   where p_scope = 'encounter' and b.current_template_version_id = p_version_id
     and e.template_version_id <> p_version_id and e.data ? p_field_key
     and (p_include_shadowed or not exists (
           select 1 from public.template_field f
            where f.template_version_id = e.template_version_id
              and f.field_key = p_field_key and f.scope = 'encounter'))
$$;
revoke all on function public.template_field_value_holders(uuid, text, text, boolean)
  from public, anon, authenticated;

-- Brouillons de curation en cours des bases servies par V : leurs valeurs seront inserees
-- dans des fiches a la finalisation, elles doivent donc suivre la meme reecriture.
create function public.rewrite_curation_drafts_for_field(
  p_version_id uuid, p_scope text, p_op text, p_key text, p_new_key text, p_replacements jsonb
)
returns void language plpgsql security invoker set search_path = public, pg_temp as $$
begin
  if p_scope = 'patient' then
    update public.curation_draft d
       set patient_data = public.field_data_rewrite(d.patient_data, p_op, p_key, p_new_key, p_replacements)
     where d.status = 'draft' and d.superseded_at is null
       and d.patient_data ? p_key
       and d.base_id in (select b.id from public.base b where b.current_template_version_id = p_version_id
                         union
                         select p.base_id from public.patient p where p.template_version_id = p_version_id);
  else
    update public.curation_draft d
       set encounters = (
         select coalesce(jsonb_agg(
                  case when jsonb_typeof(el.value) = 'object' and jsonb_typeof(el.value -> 'data') = 'object'
                       then jsonb_set(el.value, '{data}',
                              public.field_data_rewrite(el.value -> 'data', p_op, p_key, p_new_key, p_replacements))
                       else el.value end
                  order by el.ord), '[]'::jsonb)
           from jsonb_array_elements(d.encounters) with ordinality as el(value, ord))
     where d.status = 'draft' and d.superseded_at is null
       and jsonb_typeof(d.encounters) = 'array'
       and exists (select 1 from jsonb_array_elements(d.encounters) el
                    where jsonb_typeof(el.value) = 'object' and (el.value -> 'data') ? p_key)
       and d.base_id in (select b.id from public.base b where b.current_template_version_id = p_version_id
                         union
                         select p.base_id from public.patient p where p.template_version_id = p_version_id);
  end if;
end $$;
revoke all on function public.rewrite_curation_drafts_for_field(uuid, text, text, text, text, jsonb)
  from public, anon, authenticated;

-- =============================================================================
-- 4. Lecture pour l'editeur : combien de dossiers une suppression ou un retrait toucherait
-- =============================================================================
-- Ne rend que des COMPTES, jamais une valeur ni un identifiant de dossier. Reservee au
-- proprietaire du gabarit ; une variable absente recoit le meme refus qu'une variable
-- d'autrui, pour ne pas reveler son existence.
create function public.template_field_usage(p_field_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  cur       public.template_field;
  v_records integer;
  v_options jsonb;
begin
  select * into cur from public.template_field where id = p_field_id;
  if not found or not public.owns_template(public.template_of_version(cur.template_version_id)) then
    raise exception 'Modification du jeu de variables non autorisee';
  end if;
  select count(*)::integer into v_records
    from public.template_field_value_holders(cur.template_version_id, cur.scope, cur.field_key, false);
  select coalesce(jsonb_object_agg(x.option_key, x.records), '{}'::jsonb) into v_options
    from (
      select k.value as option_key, count(*)::integer as records
        from jsonb_array_elements_text(coalesce(cur.allowed_values, '[]'::jsonb)) k
        join public.template_field_value_holders(cur.template_version_id, cur.scope, cur.field_key, true) h
          on public.field_value_has_option(h.value, k.value)
       group by k.value
    ) x;
  return jsonb_build_object('records', v_records, 'options', v_options);
end $$;
revoke all on function public.template_field_usage(uuid) from public, anon;
grant execute on function public.template_field_usage(uuid) to authenticated;
comment on function public.template_field_usage(uuid) is
  'Nombre de dossiers portant une valeur pour la variable, et par option de liste. Comptes seuls, proprietaire du gabarit.';

-- =============================================================================
-- 5. Renommage de cle : les valeurs suivent
-- =============================================================================
-- La garde de comportement ne compte plus la cle parmi les changements interdits sur une
-- variable utilisee. Type, cardinalite, portee, caractere requis, types de rencontre,
-- bornes et formule restent figes.
create or replace function public.guard_template_field_update()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  semantic boolean;
begin
  if auth.uid() is not null and public.template_version_locked(old.template_version_id) then
    raise exception 'Version publiee/archivee immuable : creez une nouvelle version du jeu de variables';
  end if;

  semantic := (new.type is distinct from old.type)
           or (new.is_multiple is distinct from old.is_multiple)
           or (new.scope is distinct from old.scope)
           or (new.required is distinct from old.required)
           or (new.encounter_types is distinct from old.encounter_types)
           or (new.min_value is distinct from old.min_value)
           or (new.max_value is distinct from old.max_value)
           or (new.formula is distinct from old.formula);
  if semantic and public.template_field_in_use(old.id) then
    raise exception 'Variable deja utilisee : son type, sa portee, son caractere requis, ses types de rencontre, ses bornes et sa formule ne sont plus modifiables. Pour les changer, creez une nouvelle version du jeu de variables.';
  end if;
  return new;
end $$;
revoke all on function public.guard_template_field_update() from public, anon, authenticated;

-- AFTER ROW, nomme pour s'executer APRES `trg_template_field_key_rename_follows` (ordre
-- alphabetique) : regles et formules portent deja le nouveau code quand les dossiers sont
-- reecrits, donc leurs declencheurs de validation voient un etat coherent. Tout refus d'un
-- dossier annule le renommage entier.
create function public.follow_template_field_key_rename_values()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_patients   uuid[];
  v_encounters uuid[];
  v_records    integer;
begin
  if new.field_key is not distinct from old.field_key
     or new.template_version_id is distinct from old.template_version_id then
    return null;
  end if;

  select coalesce(array_agg(h.entity_id) filter (where h.entity = 'patient'), '{}'::uuid[]),
         coalesce(array_agg(h.entity_id) filter (where h.entity = 'encounter'), '{}'::uuid[])
    into v_patients, v_encounters
    from public.template_field_value_holders(old.template_version_id, old.scope, old.field_key, false) h;
  v_records := cardinality(v_patients) + cardinality(v_encounters);

  if v_records > 0 and new.scope is distinct from old.scope then
    -- Garde de comportement deja en amont ; defense en profondeur.
    raise exception 'Variable deja utilisee : sa portee ne peut pas changer.';
  end if;

  -- Un dossier portant deja le nouveau code (valeur d'une autre definition) : refus plutot
  -- qu'ecrasement d'une valeur par une autre.
  if exists (select 1 from public.patient where id = any(v_patients) and data ? new.field_key)
     or exists (select 1 from public.encounter where id = any(v_encounters) and data ? new.field_key) then
    raise exception using errcode = 'P0001', message = 'FIELD_KEY_RENAME_CONFLICT',
      detail = '{"code":"FIELD_KEY_RENAME_CONFLICT"}';
  end if;

  if cardinality(v_patients) > 0 then
    update public.patient
       set data = public.field_data_rewrite(data, 'rename', old.field_key, new.field_key, null)
     where id = any(v_patients);
    update public.record_field_provenance
       set field_key = new.field_key
     where record_kind = 'patient' and record_id = any(v_patients) and field_key = old.field_key;
  end if;
  if cardinality(v_encounters) > 0 then
    update public.encounter
       set data = public.field_data_rewrite(data, 'rename', old.field_key, new.field_key, null)
     where id = any(v_encounters);
    update public.record_field_provenance
       set field_key = new.field_key
     where record_kind = 'encounter' and record_id = any(v_encounters) and field_key = old.field_key;
  end if;

  perform public.rewrite_curation_drafts_for_field(
    old.template_version_id, old.scope, 'rename', old.field_key, new.field_key, null);

  -- Vues de saisie et colonnes affichees des bases servies par V : sans ce suivi, la
  -- variable renommee disparaitrait silencieusement de ces listes (cle ignoree a la lecture).
  update public.base_entry_form f
     set field_keys = public.text_array_key_renamed(f.field_keys, old.field_key, new.field_key),
         required_keys = public.text_array_key_renamed(f.required_keys, old.field_key, new.field_key)
   where old.field_key = any(f.field_keys)
     and f.base_id in (select b.id from public.base b where b.current_template_version_id = old.template_version_id);
  update public.base_view_preference p
     set visible_patient_field_keys = public.text_array_key_renamed(p.visible_patient_field_keys, old.field_key, new.field_key)
   where old.scope = 'patient' and old.field_key = any(p.visible_patient_field_keys)
     and p.base_id in (select b.id from public.base b where b.current_template_version_id = old.template_version_id);

  if v_records > 0 then
    perform public.log_audit('template_field_key_renamed', 'template_field', new.id, null,
      jsonb_build_object('from', old.field_key, 'to', new.field_key, 'records', v_records));
  end if;
  return null;
end $$;
revoke all on function public.follow_template_field_key_rename_values() from public, anon, authenticated;

create trigger trg_template_field_key_rename_values
  after update of field_key on public.template_field
  for each row execute function public.follow_template_field_key_rename_values();

-- =============================================================================
-- 6. Suppression d'une variable renseignee : valeurs retirees et journalisees
-- =============================================================================
-- Meme signature qu'avant. Les regles et formules qui citent la variable continuent de
-- refuser sa suppression (revalidation de fin d'instruction) : il faut les retirer d'abord,
-- ce qui est desormais possible sur une version utilisee.
create or replace function public.delete_template_field(p_field_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  cur          public.template_field;
  v_patients   uuid[];
  v_encounters uuid[];
begin
  select * into cur from public.template_field where id = p_field_id for update;
  if not found then return; end if;
  if not public.owns_template(public.template_of_version(cur.template_version_id)) then
    raise exception 'Modification du jeu de variables non autorisee';
  end if;
  if public.template_version_locked(cur.template_version_id) then
    raise exception 'Version publiee/archivee immuable : creez une nouvelle version du jeu de variables';
  end if;

  -- Journal AVANT effacement : l'ancienne valeur est lue dans la meme instruction.
  with logged as (
    insert into public.field_change_log
      (base_id, entity, entity_id, field_key, old_value, new_value, changed_by, reason, source)
    select h.base_id, h.entity, h.entity_id, cur.field_key, h.value, null, auth.uid(),
           'Variable supprimee du jeu de variables : ' || cur.label, 'field_deletion'
      from public.template_field_value_holders(cur.template_version_id, cur.scope, cur.field_key, false) h
    returning entity, entity_id
  )
  select coalesce(array_agg(entity_id) filter (where entity = 'patient'), '{}'::uuid[]),
         coalesce(array_agg(entity_id) filter (where entity = 'encounter'), '{}'::uuid[])
    into v_patients, v_encounters
    from logged;

  if cardinality(v_patients) > 0 then
    update public.patient
       set data = public.field_data_rewrite(data, 'remove', cur.field_key, null, null)
     where id = any(v_patients);
  end if;
  if cardinality(v_encounters) > 0 then
    update public.encounter
       set data = public.field_data_rewrite(data, 'remove', cur.field_key, null, null)
     where id = any(v_encounters);
  end if;
  perform public.rewrite_curation_drafts_for_field(
    cur.template_version_id, cur.scope, 'remove', cur.field_key, null, null);

  delete from public.template_field where id = p_field_id;

  if cardinality(v_patients) + cardinality(v_encounters) > 0 then
    perform public.log_audit('template_field_deleted_with_values', 'template_field', p_field_id, null,
      jsonb_build_object('field_key', cur.field_key,
                         'records', cardinality(v_patients) + cardinality(v_encounters)));
  end if;
end $$;
revoke all on function public.delete_template_field(uuid) from public, anon;
grant execute on function public.delete_template_field(uuid) to authenticated;

-- =============================================================================
-- 7. Retrait d'une option portee par des dossiers
-- =============================================================================
create or replace function public.enforce_template_field_allowed_options()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_options jsonb;
  v_values  jsonb;
  v_removed text[];
begin
  -- --- Quelle colonne fait foi pour CETTE ecriture ? ------------------------------------
  if tg_op = 'UPDATE' and new.allowed_options is distinct from old.allowed_options then
    -- Client conscient des options : elles font foi, et le miroir est recalcule.
    v_options := new.allowed_options;
  elsif tg_op = 'INSERT' and new.allowed_options is not null then
    v_options := new.allowed_options;
  else
    -- Client anterieur au lot : il n'envoie que les cles. Les libelles deja corriges et
    -- les desactivations sont conserves pour les cles qu'il reconduit.
    -- Type verifie AVANT la conversion : `jsonb_array_elements` sur un scalaire leve une
    -- erreur brute, qui ne dirait rien a l'utilisateur.
    if new.allowed_values is not null and jsonb_typeof(new.allowed_values) <> 'array' then
      raise exception 'Liste de valeurs invalide pour "%" : une liste est attendue', new.label;
    end if;
    -- Une liste de cles contenant autre chose qu'un texte non vide ne peut pas etre
    -- convertie sans PERDRE une valeur autorisee, donc sans invalider une fiche qui la
    -- porte. Refus explicite plutot que retrecissement silencieux.
    if new.allowed_values is not null
       and (tg_op = 'INSERT' or new.allowed_values is distinct from old.allowed_values)
       and exists (
         select 1 from jsonb_array_elements(new.allowed_values) el
         where jsonb_typeof(el.value) <> 'string' or btrim(el.value #>> '{}') = ''
       ) then
      raise exception 'Liste de valeurs invalide pour "%" : chaque valeur doit etre un texte non vide', new.label;
    end if;
    v_options := public.template_field_options_from_values(
      new.allowed_values,
      case when tg_op = 'UPDATE' then old.allowed_options end
    );
  end if;

  -- --- Forme des options ---------------------------------------------------------------
  if v_options is not null then
    if jsonb_typeof(v_options) <> 'array' then
      raise exception 'Liste d''options invalide pour "%"', new.label;
    end if;
    -- Le type est verifie A PART : `jsonb_object_keys` leve une erreur brute sur un
    -- element scalaire, et une erreur brute ne dit rien a l'utilisateur.
    if exists (select 1 from jsonb_array_elements(v_options) o where jsonb_typeof(o.value) <> 'object') then
      raise exception 'Option invalide pour "%" : un code, un libelle et un etat sont attendus', new.label;
    end if;
    -- Une cle surnumeraire, un libelle vide ou un `is_active` ABSENT sont REFUSES, jamais
    -- ignores : une option amputee en silence retirerait une valeur du formulaire. La
    -- presence de chaque cle est testee explicitement -- `jsonb_typeof` d'une cle absente
    -- rend NULL, qui n'est pas `true`, et laisserait donc passer l'option incomplete.
    if exists (
      select 1 from jsonb_array_elements(v_options) o
      where not (o.value ? 'value_key') or not (o.value ? 'label') or not (o.value ? 'is_active')
         or (select count(*) from jsonb_object_keys(o.value) k where k not in ('value_key', 'label', 'is_active')) > 0
         or jsonb_typeof(o.value -> 'value_key') <> 'string'
         or jsonb_typeof(o.value -> 'label') <> 'string'
         or jsonb_typeof(o.value -> 'is_active') <> 'boolean'
         or btrim(o.value ->> 'value_key') = ''
         or btrim(o.value ->> 'label') = ''
    ) then
      raise exception 'Option invalide pour "%" : un code, un libelle et un etat sont attendus', new.label;
    end if;
    if (select count(distinct o.value ->> 'value_key') from jsonb_array_elements(v_options) o)
       <> jsonb_array_length(v_options) then
      raise exception 'Deux options portent le meme code dans "%"', new.label;
    end if;
  end if;

  v_values := public.template_field_option_keys(v_options);

  -- --- Retrait d'une option encore portee par des dossiers : refuse --------------------
  -- Garde d'INTEGRITE, et non plus de version : une option peut quitter la liste des
  -- qu'aucun dossier ne la porte (y compris un dossier ancien dont l'enregistrement valide
  -- aussi la definition courante). `update_template_field` (surcharge p_option_replacements)
  -- remplace ou vide d'abord les valeurs, puis retire l'option. Renommer, ajouter,
  -- desactiver et reordonner ne retirent aucune cle : les dossiers ne sont alors pas lus.
  if tg_op = 'UPDATE' and old.allowed_values is not null then
    select coalesce(array_agg(k.value), '{}'::text[]) into v_removed
      from jsonb_array_elements_text(old.allowed_values) k
     where not (coalesce(v_values, '[]'::jsonb) @> jsonb_build_array(k.value));
    if cardinality(v_removed) > 0 and exists (
         select 1
           from public.template_field_value_holders(old.template_version_id, old.scope, old.field_key, true) h
          where exists (select 1 from unnest(v_removed) r(k) where public.field_value_has_option(h.value, r.k))
       ) then
      raise exception using errcode = 'P0001', message = 'OPTION_REPLACEMENT_REQUIRED',
        detail = jsonb_build_object('code', 'OPTION_REPLACEMENT_REQUIRED', 'field', new.label)::text;
    end if;
  end if;

  -- --- Coherence avec la valeur proposee (L28) -----------------------------------------
  -- Desactiver l'option qui sert de valeur proposee prefererait une modalite qu'on vient
  -- justement de retirer de la saisie. Refus explicite plutot que correction silencieuse.
  if v_options is not null and nullif(btrim(coalesce(new.default_value, '')), '') is not null
     and exists (
       select 1 from jsonb_array_elements(v_options) o
       where o.value ->> 'value_key' = btrim(new.default_value)
         and not (o.value ->> 'is_active')::boolean
     ) then
    raise exception 'Option desactivee alors qu''elle est la valeur proposee de "%" : changez la valeur proposee d''abord', new.label;
  end if;

  new.allowed_options := v_options;
  new.allowed_values  := v_values;
  return new;
end $function$;
revoke all on function public.enforce_template_field_allowed_options() from public, anon, authenticated;


-- Nouvelle surcharge : les memes parametres que la surcharge L35 (p_formula), plus
-- `p_option_replacements` = { cle_retiree: cle_de_remplacement | null }. Le client a jour
-- envoie toujours cette cle, ce qui selectionne cette surcharge.
--
-- Deroule, en une transaction :
--   a. controles (propriete, gel, comportement, remplacements complets et valides) ;
--   b. ecriture de la definition avec la liste FINALE + les options retirees encore portees
--      (provisoirement) : les cibles de remplacement existent deja, les valeurs actuelles
--      restent valides pendant la reecriture ;
--   c. reecriture et journalisation des valeurs ;
--   d. ecriture de la liste finale ; la garde d'integrite verifie qu'aucun dossier ne porte
--      plus une option retiree.
create function public.update_template_field(
  p_field_id uuid, p_field_key text, p_label text, p_description text, p_default_value text,
  p_scope text, p_section text, p_type text, p_required boolean, p_is_multiple boolean,
  p_missing_reasons text[], p_allowed_options jsonb, p_formula text, p_option_replacements jsonb,
  p_encounter_types text[] default null, p_allowed_values jsonb default null,
  p_min_value numeric default null, p_max_value numeric default null, p_unit text default null
)
returns public.template_field language plpgsql security definer set search_path = public, pg_temp as $$
declare
  cur          public.template_field;
  res          public.template_field;
  semantic     boolean;
  v_repl_in    jsonb := coalesce(p_option_replacements, '{}'::jsonb);
  v_final      jsonb;
  v_final_keys jsonb;
  v_removed    text[] := '{}'::text[];
  v_held       text[] := '{}'::text[];
  v_missing    text[];
  v_repl       jsonb := '{}'::jsonb;
  v_interim    jsonb;
  v_patients   uuid[];
  v_encounters uuid[];
begin
  select * into cur from public.template_field where id = p_field_id for update;
  if not found then raise exception 'Champ introuvable'; end if;
  if not public.owns_template(public.template_of_version(cur.template_version_id)) then
    raise exception 'Modification du gabarit non autorisee';
  end if;
  if public.template_version_locked(cur.template_version_id) then
    raise exception 'Version publiee/archivee immuable : creez une nouvelle version du jeu de variables';
  end if;

  semantic := (p_type is distinct from cur.type)
           or (coalesce(p_is_multiple, false) is distinct from cur.is_multiple)
           or (p_scope is distinct from cur.scope)
           or (p_required is distinct from cur.required)
           or ((case when p_scope = 'encounter' then p_encounter_types else null end) is distinct from cur.encounter_types)
           or (p_min_value is distinct from cur.min_value)
           or (p_max_value is distinct from cur.max_value)
           or (nullif(btrim(p_formula), '') is distinct from cur.formula);
  if semantic and public.template_field_in_use(p_field_id) then
    raise exception 'Variable deja utilisee : son type, sa portee, son caractere requis, ses types de rencontre, ses bornes et sa formule ne sont plus modifiables. Pour les changer, creez une nouvelle version du jeu de variables.';
  end if;

  if jsonb_typeof(v_repl_in) <> 'object' then
    raise exception using errcode = 'P0001', message = 'OPTION_REPLACEMENT_INVALID',
      detail = '{"code":"OPTION_REPLACEMENT_INVALID"}';
  end if;

  -- Liste finale demandee. Un client sans options (liste de cles) garde les libelles et
  -- desactivations deja connus, comme le declencheur le ferait.
  v_final := case
    when p_allowed_options is not null then p_allowed_options
    when p_allowed_values is not null and jsonb_typeof(p_allowed_values) = 'array'
      then public.template_field_options_from_values(p_allowed_values, cur.allowed_options)
    else null end;
  v_final_keys := public.template_field_option_keys(v_final);
  -- L'ecran envoie `null` quand toutes les options d'une liste sont retirees : pour le calcul
  -- des retraits, c'est une liste vide.
  if v_final_keys is null and p_type in ('select', 'multiselect') then
    v_final_keys := '[]'::jsonb;
  end if;

  if v_final_keys is not null and jsonb_typeof(v_final_keys) = 'array' and cur.allowed_values is not null then
    select coalesce(array_agg(k.value order by k.ord), '{}'::text[]) into v_removed
      from jsonb_array_elements_text(cur.allowed_values) with ordinality as k(value, ord)
     where not (v_final_keys @> jsonb_build_array(k.value));
  end if;

  -- Une designation ne vise qu'une option RETIREE, et ne designe qu'une option ACTIVE de la
  -- liste finale, ou le vidage (null).
  if exists (
    select 1 from jsonb_each(v_repl_in) e
     where not (e.key = any(v_removed))
        or jsonb_typeof(e.value) not in ('string', 'null')
        or (jsonb_typeof(e.value) = 'string' and not exists (
              select 1 from jsonb_array_elements(coalesce(v_final, '[]'::jsonb)) o
               where o.value ->> 'value_key' = e.value #>> '{}'
                 and coalesce((o.value ->> 'is_active')::boolean, false)))
  ) then
    raise exception using errcode = 'P0001', message = 'OPTION_REPLACEMENT_INVALID',
      detail = '{"code":"OPTION_REPLACEMENT_INVALID"}';
  end if;

  if cardinality(v_removed) > 0 then
    select coalesce(array_agg(distinct k), '{}'::text[]) into v_held
      from unnest(v_removed) k
     where exists (
       select 1 from public.template_field_value_holders(cur.template_version_id, cur.scope, cur.field_key, true) h
        where public.field_value_has_option(h.value, k));
    select coalesce(array_agg(k order by k), '{}'::text[]) into v_missing
      from unnest(v_held) k where not (v_repl_in ? k);
    if cardinality(v_missing) > 0 then
      raise exception using errcode = 'P0001', message = 'OPTION_REPLACEMENT_REQUIRED',
        detail = jsonb_build_object('code', 'OPTION_REPLACEMENT_REQUIRED', 'field', cur.label,
                                    'options', to_jsonb(v_missing))::text;
    end if;
    select coalesce(jsonb_object_agg(k, v_repl_in -> k), '{}'::jsonb) into v_repl
      from unnest(v_held) k;
  end if;

  -- (b) Liste provisoire : finale + options retirees encore portees, dans leur etat actuel.
  v_interim := v_final;
  if cardinality(v_held) > 0 then
    v_interim := coalesce(v_final, '[]'::jsonb) || coalesce((
      select jsonb_agg(o.value order by o.ord)
        from jsonb_array_elements(coalesce(cur.allowed_options,
               public.template_field_options_from_values(cur.allowed_values, null)))
             with ordinality as o(value, ord)
       where o.value ->> 'value_key' = any(v_held)), '[]'::jsonb);
  end if;

  update public.template_field
     set field_key = p_field_key, label = p_label, description = nullif(btrim(p_description), ''),
         default_value = nullif(btrim(p_default_value), ''),
         scope = p_scope, section = p_section, type = p_type, required = p_required,
         is_multiple = coalesce(p_is_multiple, false),
         encounter_types = case when p_scope = 'encounter' then p_encounter_types else null end,
         allowed_options = case when v_interim is not null then v_interim else p_allowed_options end,
         allowed_values = case when v_interim is not null then public.template_field_option_keys(v_interim)
                               else p_allowed_values end,
         min_value = p_min_value, max_value = p_max_value,
         unit = p_unit, missing_reasons = coalesce(p_missing_reasons, '{}'::text[]),
         -- Le declencheur `trg_template_field_formula` valide et deduit le type de sortie.
         formula = nullif(btrim(p_formula), '')
   where id = p_field_id returning * into res;

  if cardinality(v_held) = 0 then
    return res;
  end if;

  -- (c) Les valeurs ont deja suivi un eventuel renommage : on lit sous la cle finale.
  with logged as (
    insert into public.field_change_log
      (base_id, entity, entity_id, field_key, old_value, new_value, changed_by, reason, source)
    select h.base_id, h.entity, h.entity_id, res.field_key, h.value,
           public.field_data_option_replaced(jsonb_build_object(res.field_key, h.value), res.field_key, v_repl)
             -> res.field_key,
           auth.uid(), 'Option retiree de la liste de la variable : ' || res.label, 'option_retirement'
      from public.template_field_value_holders(res.template_version_id, res.scope, res.field_key, true) h
     where exists (select 1 from unnest(v_held) k where public.field_value_has_option(h.value, k))
    returning entity, entity_id
  )
  select coalesce(array_agg(entity_id) filter (where entity = 'patient'), '{}'::uuid[]),
         coalesce(array_agg(entity_id) filter (where entity = 'encounter'), '{}'::uuid[])
    into v_patients, v_encounters
    from logged;

  if cardinality(v_patients) > 0 then
    update public.patient
       set data = public.field_data_rewrite(data, 'replace_options', res.field_key, null, v_repl)
     where id = any(v_patients);
  end if;
  if cardinality(v_encounters) > 0 then
    update public.encounter
       set data = public.field_data_rewrite(data, 'replace_options', res.field_key, null, v_repl)
     where id = any(v_encounters);
  end if;
  perform public.rewrite_curation_drafts_for_field(
    res.template_version_id, res.scope, 'replace_options', res.field_key, null, v_repl);

  -- (d) Liste finale. La garde d'integrite du declencheur refuse si une valeur subsiste.
  update public.template_field
     set allowed_options = v_final,
         allowed_values = public.template_field_option_keys(v_final)
   where id = p_field_id returning * into res;

  perform public.log_audit('template_field_options_retired', 'template_field', p_field_id, null,
    jsonb_build_object('options', to_jsonb(v_held), 'replacements', v_repl,
                       'records', cardinality(v_patients) + cardinality(v_encounters)));
  return res;
end $$;
revoke all on function public.update_template_field(
  uuid, text, text, text, text, text, text, text, boolean, boolean, text[], jsonb, text, jsonb,
  text[], jsonb, numeric, numeric, text) from public, anon;
grant execute on function public.update_template_field(
  uuid, text, text, text, text, text, text, text, boolean, boolean, text[], jsonb, text, jsonb,
  text[], jsonb, numeric, numeric, text) to authenticated;

-- =============================================================================
-- 8. Regles d'une version utilisee
-- =============================================================================
-- La garde de version utilisee est retiree. Restent actives : la garde de version
-- publiee/archivee (`trg_vr_locked`), la structure (`trg_vr_structure`) et la
-- revalidation de la version en fin d'instruction.
drop trigger if exists trg_vr_inuse on public.validation_rule;
drop function if exists public.guard_validation_rule_inuse();

-- Le lot de regles suit la meme decision. L'apercu continue d'exposer `inUse` a titre
-- informatif ; seul `locked` fige le panneau.
create or replace function public.create_rule_batch(p_version_id uuid, p_operation_id uuid, p_payload jsonb, p_expected_fingerprint text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_op public.rule_batch_operation;
  v_hash text;
  v_plan jsonb;
  v_created jsonb := '[]'::jsonb;
  v_receipt jsonb;
  v_message text;
  v_severity text;
  v_error_details jsonb;
begin
  perform public.assert_rule_batch_access(p_version_id);
  if p_operation_id is null or p_expected_fingerprint is null then
    perform public.rule_batch_error('RULE_BATCH_INVALID');
  end if;
  -- Serialise les cles d'operation d'un meme auteur avant tout verrou de version.
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text, 94517));
  v_hash := md5(jsonb_build_array('create_rule_batch', p_version_id, p_payload)::text);
  select * into v_op from public.rule_batch_operation
    where owner_id = auth.uid() and operation_id = p_operation_id;
  if found then
    if v_op.request_hash <> v_hash then perform public.rule_batch_error('RULE_BATCH_OPERATION_CONFLICT'); end if;
    return v_op.receipt;
  end if;

  -- Verrou de version : deux lots concurrents ne peuvent pas s'entrelacer, et le declencheur
  -- d'invariants voit un etat stable.
  perform 1 from public.template_version where id = p_version_id for update;
  if public.template_version_locked(p_version_id) then
    perform public.rule_batch_error('RULE_BATCH_VERSION_LOCKED');
  end if;
  -- Une version deja servie a des dossiers accepte desormais de nouvelles regles : elles
  -- s'appliquent aux prochains enregistrements, sans revalidation retroactive.
  if public.template_version_rule_fingerprint(p_version_id) is distinct from p_expected_fingerprint then
    perform public.rule_batch_error('RULE_BATCH_CONFLICT');
  end if;

  v_plan := public.rule_batch_plan(p_version_id, p_payload);
  if jsonb_array_length(v_plan -> 'invalid') > 0 then
    -- Une seule cible refusee suffit a tout refuser : il n'existe pas de reussite partielle
    -- cachee, et l'ecran garde sa condition et ses cibles pour correction.
    perform public.rule_batch_error('RULE_BATCH_INVALID_TARGET', jsonb_build_object('targets', v_plan -> 'invalid'));
  end if;

  v_message := nullif(p_payload ->> 'message', '');
  v_severity := v_plan ->> 'severity';
  if jsonb_array_length(v_plan -> 'create') > 0 then
    begin
      -- Les cibles du plan sont dedupliquees. On insere toutes les regles en un seul
      -- statement, puis on associe chaque identifiant a sa cible et on preserve l'ordre
      -- d'origine dans le recu d'idempotence.
      with planned as materialized (
        select e.item ->> 'target' as target,
               e.item -> 'rule' as rule,
               e.ordinality
          from jsonb_array_elements(v_plan -> 'create') with ordinality as e(item, ordinality)
      ),
      inserted as (
        insert into public.validation_rule (template_version_id, rule, message, severity)
        select p_version_id, p.rule, v_message, v_severity
          from planned p
         order by p.ordinality
        returning id, rule
      )
      select coalesce(
        jsonb_agg(jsonb_build_object('id', i.id, 'target', p.target) order by p.ordinality),
        '[]'::jsonb
      )
        into v_created
        from inserted i
        join planned p on p.rule = i.rule;
    exception when others then
      -- Le statement est atomique : toute erreur d'une cible annule les insertions du lot.
      -- Conserver `target` pour un lot d'une seule cible; un lot multiple expose la liste,
      -- puisqu'une erreur de statement ne permet pas d'attribuer le refus a une seule ligne.
      v_error_details := jsonb_build_object('targets', (
          select coalesce(jsonb_agg(e.item ->> 'target' order by e.ordinality), '[]'::jsonb)
            from jsonb_array_elements(v_plan -> 'create') with ordinality as e(item, ordinality)
        ));
      if jsonb_array_length(v_plan -> 'create') = 1 then
        v_error_details := v_error_details || jsonb_build_object(
          'target', v_plan -> 'create' -> 0 ->> 'target'
        );
      end if;
      v_error_details := v_error_details || jsonb_build_object('reason', sqlerrm);
      perform public.rule_batch_error('RULE_BATCH_REFUSED', v_error_details);
    end;
  end if;

  v_receipt := jsonb_build_object(
    'created', v_created,
    'duplicates', v_plan -> 'duplicates',
    'fingerprint', public.template_version_rule_fingerprint(p_version_id));
  insert into public.rule_batch_operation (owner_id, operation_id, template_version_id, request_hash, receipt)
  values (auth.uid(), p_operation_id, p_version_id, v_hash, v_receipt);
  return v_receipt;
end $function$;
