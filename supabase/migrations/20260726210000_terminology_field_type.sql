-- =============================================================================
-- 20260726210000_terminology_field_type.sql  (feature T2 — champ de terminologie)
--
-- POURQUOI. Le referentiel pose par T1 n'etait relie a rien : aucun champ ne pouvait
-- l'utiliser. Ce lot ajoute le type `terminology`, seul type dont les valeurs permises ne
-- sont PAS recopiees dans le gabarit mais resolues dans le referentiel actif.
--
-- CE QUI EST STOCKE. Un objet {"code": "...", "label": "..."} et rien d'autre :
--  * le CODE est l'identifiant stable, celui sur lequel les statistiques regroupent. Il
--    survit a une correction de libelle, qui sinon scinderait une maladie en deux ;
--  * le LIBELLE est un instantane, pris au moment de la saisie. Il garantit qu'une fiche
--    reste lisible meme si le referentiel change ou est retire. Redondance assumee.
--
-- Le serveur verifie que le couple est COHERENT, pas seulement que le code existe : sans
-- cela, un appelant pourrait stocker un libelle trompeur a cote d'un code valide, et la
-- fiche mentirait sur elle-meme. Contrepartie assumee : apres une correction de libelle
-- dans le referentiel, un client dont le cache est perime se voit refuser l'ecriture et
-- doit rafraichir. C'est le comportement voulu — la base reste la source de verite.
--
-- ADDITIVE. Aucune donnee existante n'est touchee : la contrainte de type est ELARGIE, la
-- validation n'ajoute qu'une branche pour un type qui n'existait pas, et aucun champ
-- existant ne peut etre de ce type. Retour arriere : rétablir la contrainte precedente et
-- les deux fonctions dans leur version anterieure.
-- =============================================================================

-- 1. Elargir les types de champ autorises ------------------------------------------------
-- Le nom de la contrainte est recherche plutot que suppose : une contrainte inline porte un
-- nom genere, et un `drop constraint if exists` sur un nom errone echouerait en silence en
-- laissant l'ancienne regle refuser le nouveau type.
do $$
declare c_name text;
begin
  select conname into c_name
  from pg_constraint
  where conrelid = 'public.template_field'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) like '%multiselect%';
  if c_name is null then
    raise exception 'Contrainte de type de champ introuvable sur template_field';
  end if;
  execute format('alter table public.template_field drop constraint %I', c_name);
end $$;

alter table public.template_field
  add constraint template_field_type_check
  check (type in ('number','integer','text','date','datetime','boolean','select','multiselect','terminology'));

-- 2. Validation des valeurs saisies -------------------------------------------------------
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

    if jsonb_typeof(v) = 'object' and (v ? '__missing__') then
      if not f.allow_missing_codes then
        raise exception 'Valeur manquante non autorisee pour "%"', f.label;
      end if;
      if (v ->> '__missing__') is null or (v ->> '__missing__') not in ('non_fait','inconnu','non_applicable') then
        raise exception 'Code de donnee manquante invalide pour "%"', f.label;
      end if;
      continue;
    end if;

    -- Terminologie : un couple code + libelle, verifie contre le referentiel ACTIF.
    if f.type = 'terminology' then
      if jsonb_typeof(v) <> 'object' then
        raise exception 'Code et libelle attendus pour "%"', f.label;
      end if;
      -- Aucune cle surnumeraire : le contenu du champ doit rester previsible pour l'export
      -- et les statistiques.
      if exists (select 1 from jsonb_object_keys(v) k where k not in ('code','label')) then
        raise exception 'Contenu inattendu pour "%"', f.label;
      end if;
      if jsonb_typeof(v -> 'code') <> 'string' or jsonb_typeof(v -> 'label') <> 'string'
         or btrim(coalesce(v ->> 'code', '')) = '' or btrim(coalesce(v ->> 'label', '')) = '' then
        raise exception 'Code et libelle requis pour "%"', f.label;
      end if;
      -- Le concept doit exister, etre proposable a la saisie, et porter CE libelle : un
      -- code valide accompagne d'un autre libelle serait une fiche trompeuse.
      if not exists (
        select 1
        from public.terminology_concept c
        join public.terminology_release r on r.id = c.release_id and r.is_active
        where c.code = (v ->> 'code') and c.is_selectable and c.label = (v ->> 'label')
      ) then
        raise exception 'Diagnostic inconnu ou libelle non conforme pour "%"', f.label;
      end if;
      continue;
    end if;

    if f.type = 'multiselect' then
      if jsonb_typeof(v) <> 'array' then
        raise exception 'Liste (tableau) attendue pour "%"', f.label;
      end if;
      if exists (select 1 from jsonb_array_elements(v) el(value) where jsonb_typeof(el.value) <> 'string') then
        raise exception 'Liste de textes attendue pour "%"', f.label;
      end if;
      if f.allowed_values is not null
         and exists (select 1 from jsonb_array_elements_text(v) el where not (f.allowed_values @> jsonb_build_array(el))) then
        raise exception 'Valeur non autorisee pour "%"', f.label;
      end if;
      continue;
    end if;

    if f.type in ('number','integer') then
      if jsonb_typeof(v) <> 'number' then
        raise exception 'Valeur numerique JSON attendue pour "%"', f.label;
      end if;
      n := (v #>> '{}')::numeric;
      if f.type = 'integer' and n <> trunc(n) then
        raise exception 'Entier attendu pour "%"', f.label;
      end if;
      if f.min_value is not null and n < f.min_value then
        raise exception '"%" en dessous du minimum autorise (%)', f.label, f.min_value;
      end if;
      if f.max_value is not null and n > f.max_value then
        raise exception '"%" au dessus du maximum autorise (%)', f.label, f.max_value;
      end if;
      continue;
    end if;

    if f.type = 'boolean' then
      if jsonb_typeof(v) <> 'boolean' then
        raise exception 'Booleen JSON attendu pour "%"', f.label;
      end if;
      continue;
    end if;

    if jsonb_typeof(v) <> 'string' then
      raise exception 'Texte JSON attendu pour "%"', f.label;
    end if;
    txt := v #>> '{}';
    if txt is null or txt = '' then continue; end if;

    if f.type = 'select' then
      if f.allowed_values is not null and not (f.allowed_values @> jsonb_build_array(txt)) then
        raise exception 'Valeur non autorisee pour "%"', f.label;
      end if;
    elsif f.type = 'date' then
      if not public.is_strict_date_text(txt) then
        raise exception 'Date invalide pour "%" (format AAAA-MM-JJ attendu)', f.label;
      end if;
    elsif f.type = 'datetime' then
      if not public.is_strict_datetime_text(txt) then
        raise exception 'Date/heure invalide pour "%" (format ISO AAAA-MM-JJTHH:MM attendu)', f.label;
      end if;
    end if;
  end loop;
end $$;
