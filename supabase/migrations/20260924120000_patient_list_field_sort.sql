-- L62 — trier la liste d'une base par une variable analytique de portee patient.
--
-- Contrat. Le navigateur designe une variable par sa CLE ; il ne fournit ni fragment SQL, ni
-- conversion. Le serveur resout cette cle contre la base et sa version de gabarit ACTIVE
-- (`base.current_template_version_id`), puis applique dans cet ordre : filtre (code, ids),
-- ordre total, effectif, page. Les tris techniques `created_at` / `patient_code` restent servis
-- par la lecture PostgREST existante, inchangee.
--
-- Types pris en charge et ordre scalaire (valeur JSON attendue -> cle de tri) :
--   number, integer : nombre JSON             -> ordre numerique
--   date            : texte AAAA-MM-JJ        -> ordre chronologique (largeur fixe, octets)
--   boolean         : booleen JSON            -> faux avant vrai
--   select          : cle d'option            -> rang de l'option dans la version active ;
--                     une cle absente de la version active vient apres les options connues,
--                     puis par cle (octets)
--   text            : texte non vide          -> texte replie (minuscules, sans accents
--                     latins), puis texte brut, en ordre d'octets : deterministe, pas
--                     linguistique
-- Refuses faute de semantique definie : multiselect et terminology (liste ou objet),
-- datetime (valeurs avec et sans decalage horaire coexistent, sans fuseau de reference).
--
-- Valeur absente : cle manquante, null JSON, raison `__missing__`, texte vide, ou valeur dont
-- le type JSON ne correspond pas au type actif (fiche d'une version anterieure). Elle vient
-- APRES les valeurs presentes dans les deux sens. Egalites et absents : `id` croissant.
--
-- SECURITY INVOKER : la base, le gabarit et les patients sont lus sous la RLS de l'appelant
-- (`base_select`, `tf_read`, `p_select`). Aucune elevation n'est necessaire, et aucune
-- identite n'est lue. Une base invisible, une cle inconnue, supprimee, d'une autre base, hors
-- portee patient ou d'un type refuse produisent la MEME erreur, sans la cle ni detail interne.
-- La cle n'est jamais interpolee : elle sert de parametre a `data -> p_field_key`.
--
-- Index : aucun. Le tri porte sur les patients d'UNE base, deja cibles par
-- `ix_patient_base_created_id` ; un index par expression devrait exister par cle et par
-- type, et un index JSONB generique ne sert pas un ORDER BY. Mesure consignee dans
-- docs/l61-liste-patients-recherche-tri-identite.md (L62).
--
-- Reprise : fonction nouvelle, sans donnee ni table modifiee. Retour arriere = `drop function`.

create function public.list_patients_by_field(
  p_base_id uuid,
  p_field_key text,
  p_direction text,
  p_limit int,
  p_offset int,
  p_code_query text default null,
  p_ids uuid[] default null
) returns jsonb
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare
  v_version uuid;
  v_type text;
  v_options jsonb;
  v_option_keys text[];
  v_desc boolean;
  v_needle text;
  v_pattern text;
begin
  -- Parametres de forme : une erreur distincte, sans relation avec les donnees.
  if p_direction is null or p_direction not in ('asc', 'desc')
     or p_limit is null or p_limit < 1 or p_limit > 200
     or p_offset is null or p_offset < 0
     or (p_ids is not null and cardinality(p_ids) > 1000)
     or char_length(coalesce(p_code_query, '')) > 200 then
    raise exception using
      errcode = 'P0001',
      message = 'PATIENT_SORT_INVALID_REQUEST : requete de tri invalide',
      detail = jsonb_build_object('code', 'PATIENT_SORT_INVALID_REQUEST')::text;
  end if;
  v_desc := p_direction = 'desc';

  -- Resolution de la cle, sous la RLS de l'appelant. Toute absence est indiscernable.
  if auth.uid() is not null and p_base_id is not null
     and p_field_key is not null and char_length(p_field_key) <= 200 then
    select b.current_template_version_id into v_version
      from public.base b
     where b.id = p_base_id and b.deleted_at is null;
    if v_version is not null then
      select f.type, f.allowed_options into v_type, v_options
        from public.template_field f
       where f.template_version_id = v_version
         and f.field_key = p_field_key
         and f.scope = 'patient'
         and not f.is_multiple;
    end if;
  end if;
  if v_type is null or v_type not in ('number', 'integer', 'date', 'boolean', 'select', 'text') then
    raise exception using
      errcode = 'P0001',
      message = 'PATIENT_SORT_UNAVAILABLE : tri indisponible',
      detail = jsonb_build_object('code', 'PATIENT_SORT_UNAVAILABLE')::text;
  end if;

  if v_type = 'select' and jsonb_typeof(v_options) = 'array' then
    select coalesce(array_agg(o.value ->> 'value_key' order by o.ord), '{}')
      into v_option_keys
      from jsonb_array_elements(v_options) with ordinality as o(value, ord);
  end if;
  v_option_keys := coalesce(v_option_keys, '{}');

  v_needle := btrim(coalesce(p_code_query, ''));
  if v_needle <> '' then
    v_pattern := '%' || replace(replace(replace(v_needle, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  end if;

  return (
    with filtered as (
      select p.id, p.patient_code, p.template_version_id, p.data, p.validation_status,
             p.row_version, p.updated_at, p.data -> p_field_key as v
        from public.patient p
       where p.base_id = p_base_id
         and p.deleted_at is null
         and (v_pattern is null or p.patient_code ilike v_pattern)
         and (p_ids is null or p.id = any(p_ids))
    ),
    keyed as (
      select f.*,
             case
               when v_type in ('number', 'integer') and jsonb_typeof(f.v) = 'number'
                 then (f.v #>> '{}')::numeric
               when v_type = 'select' and jsonb_typeof(f.v) = 'string' and (f.v #>> '{}') <> ''
                 then coalesce(array_position(v_option_keys, f.v #>> '{}'),
                               cardinality(v_option_keys) + 1)::numeric
             end as k_num,
             case
               when v_type = 'boolean' and jsonb_typeof(f.v) = 'boolean'
                 then (f.v #>> '{}')::boolean
             end as k_bool,
             case
               when v_type = 'date' and jsonb_typeof(f.v) = 'string'
                    and (f.v #>> '{}') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
                 then f.v #>> '{}'
               when v_type = 'text' and jsonb_typeof(f.v) = 'string' and btrim(f.v #>> '{}') <> ''
                 then lower(translate(f.v #>> '{}',
                   'àáâãäåçèéêëìíîïñòóôõöùúûüýÿÀÁÂÃÄÅÇÈÉÊËÌÍÎÏÑÒÓÔÕÖÙÚÛÜÝ',
                   'aaaaaaceeeeiiiinooooouuuuyyaaaaaaceeeeiiiinooooouuuuy'))
             end as k_text,
             case
               when v_type in ('text', 'select') and jsonb_typeof(f.v) = 'string'
                    and btrim(f.v #>> '{}') <> ''
                 then f.v #>> '{}'
             end as k_raw
        from filtered f
    ),
    ranked as (
      select k.*,
             row_number() over (
               order by
                 (k.k_num is null and k.k_bool is null and k.k_text is null) asc,
                 case when not v_desc then k.k_num end asc,
                 case when v_desc then k.k_num end desc,
                 case when not v_desc then k.k_bool end asc,
                 case when v_desc then k.k_bool end desc,
                 case when not v_desc then k.k_text end collate "C" asc,
                 case when v_desc then k.k_text end collate "C" desc,
                 case when not v_desc then k.k_raw end collate "C" asc,
                 case when v_desc then k.k_raw end collate "C" desc,
                 k.id asc
             ) as rn
        from keyed k
    )
    select jsonb_build_object(
      'total', (select count(*) from ranked),
      'rows', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'id', r.id,
                 'patient_code', r.patient_code,
                 'template_version_id', r.template_version_id,
                 'data', r.data,
                 'validation_status', r.validation_status,
                 'row_version', r.row_version,
                 'updated_at', r.updated_at
               ) order by r.rn)
          from ranked r
         where r.rn > p_offset and r.rn <= p_offset + p_limit
      ), '[]'::jsonb)
    )
  );
end $$;

comment on function public.list_patients_by_field(uuid, text, text, int, int, text, uuid[]) is
  'L62 : page pseudonymisee triee par une variable patient de la version active. INVOKER, RLS de l''appelant ; cle refusee = PATIENT_SORT_UNAVAILABLE.';

revoke all on function public.list_patients_by_field(uuid, text, text, int, int, text, uuid[])
  from public, anon;
grant execute on function public.list_patients_by_field(uuid, text, text, int, int, text, uuid[])
  to authenticated;
