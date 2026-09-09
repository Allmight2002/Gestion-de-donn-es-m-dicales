-- L59 -- catalogue des blocs importables (spec-blocs-reutilisables.md §5).
--
-- L58 a livre l'import cote base, dormant. Pour le rendre utilisable il manque une seule
-- chose au serveur : dire a l'editeur QUELS blocs il a le droit d'importer. Cette migration
-- n'ajoute que cette lecture. Elle ne cree aucune table, ne touche aucune donnee, ne change
-- aucune garde et ne modifie ni `preview_template_section_import` ni `import_template_section`.
--
-- POURQUOI UNE FONCTION plutot qu'une requete du client : recouper toutes les versions
-- lisibles cote web serait N+1 sur un catalogue qui grandit avec l'usage, et le comptage des
-- variables portees par un bloc suppose de connaitre ses sous-sections. Le serveur le fait
-- en une passe.
--
-- POURQUOI `security invoker` : la RLS doit filtrer, et elle filtre deja exactement comme il
-- faut. `ts_read` et `tv_read` portent toutes deux `can_read_template(...)`, c'est-a-dire le
-- MEME predicat que `template_section_import_plan` applique a la source. Le catalogue ne peut
-- donc ni proposer un bloc que l'import refuserait pour `IMPORT_SOURCE_FORBIDDEN`, ni cacher
-- un bloc qu'il accepterait. Aucune permission nouvelle n'est introduite.

-- `template` n'est PAS joint en inner join, et c'est delibere : sa policy `template_read`
-- (`is_global or owner or admin`) est strictement plus etroite que `can_read_template`, qui
-- couvre en plus le gabarit d'une base partagee et le staff de curation. Un inner join
-- amputerait donc le catalogue de sources que l'import accepte -- exactement le genre
-- d'ecart silencieux entre l'ecran et le serveur que le §5 interdit. Le nom du gabarit est
-- un CONFORT d'affichage : il arrive quand la RLS le laisse passer, il est nul sinon, et
-- l'ecran retombe alors sur le numero de version. `template_id` vient de `template_version`,
-- lisible dans les deux cas, pour que le regroupement tienne quand meme.
create function public.list_importable_template_sections()
returns table (
  template_id      uuid,
  template_name    text,
  is_global        boolean,
  version_id       uuid,
  version_number   integer,
  version_status   text,
  section_key      text,
  label            text,
  display_order    integer,
  subsection_count integer,
  field_count      integer
)
language sql stable security invoker set search_path = public, pg_temp as $$
  select tv.template_id,
         t.name,
         coalesce(t.is_global, false),
         tv.id,
         tv.version_number,
         tv.status,
         s.section_key,
         s.label,
         s.display_order,
         (select count(*) from public.template_section c where c.parent_section_id = s.id)::integer,
         -- MEME primitive d'appartenance que l'import (`template_section_field_keys`), et non
         -- un second comptage. Un compte etabli par un predicat different finirait par
         -- diverger de ce que l'import copie reellement, et l'ecart se lirait sur l'apercu.
         (select count(*) from public.template_section_field_keys(tv.id, s.section_key))::integer
    from public.template_section s
    join public.template_version tv on tv.id = s.template_version_id
    left join public.template t on t.id = tv.template_id
   where s.parent_section_id is null
   order by t.name nulls last, tv.template_id, tv.version_number, s.display_order, s.section_key;
$$;

revoke all on function public.list_importable_template_sections() from public, anon;
grant execute on function public.list_importable_template_sections() to authenticated;

comment on function public.list_importable_template_sections() is
  'L59 : blocs racines de toutes les versions lisibles, avec le nombre de variables portees '
  '(sous-sections comprises). Lecture seule, filtree par la RLS, sans permission nouvelle.';
