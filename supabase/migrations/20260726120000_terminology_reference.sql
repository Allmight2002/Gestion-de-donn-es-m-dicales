-- =============================================================================
-- 20260726120000_terminology_reference.sql  (feature T1 — referentiel de terminologie)
--
-- POURQUOI. Les listes controlees (`allowed_values`) resolvent l'uniformite tant que la
-- liste est courte. Un referentiel diagnostique compte des dizaines de milliers de
-- concepts : il ne peut pas etre recopie dans CHAQUE version de gabarit ni charge en
-- entier par l'interface. Il lui faut une table dediee, interrogee par recherche
-- incrementale (typeahead).
--
-- IDENTIFIANT STABLE. Le concept porte un `code` (ex. code CIM). C'est LUI qui sera
-- stocke dans les donnees, jamais le libelle : corriger un libelle ne doit pas rendre
-- incoherent l'historique deja saisi, et deux orthographes ne doivent pas devenir deux
-- maladies distinctes dans les statistiques.
--
-- LECTURE SEULE POUR LES CLIENTS. RLS activee, politique de SELECT pour les comptes
-- authentifies, et grant limite a `select` : aucun client ne peut inserer, modifier ou
-- supprimer un concept. Le chargement d'un referentiel se fait hors API, en contexte
-- `service_role`, qui contourne la RLS. Rappel : `grant ... on all tables` de
-- 20260616090400_rls.sql ne couvre que les tables existantes a cette date.
--
-- PAS DE NOUVELLE EXTENSION. Le projet n'active que `pgcrypto`. La recherche s'appuie
-- sur une colonne normalisee generee et un index de prefixe, sans `pg_trgm` ni
-- `unaccent` : cela evite d'imposer une extension a l'environnement de test embarque.
--
-- ADDITIVE. Deux nouvelles tables et deux nouvelles fonctions ; aucun objet existant
-- n'est modifie, donc aucune donnee existante n'est touchee. Retour arriere : supprimer
-- les deux tables et les deux fonctions (aucune autre ne les reference a ce stade).
-- =============================================================================

-- Normalisation partagee : minuscules et lettres accentuees ramenees a leur base, pour
-- que « diabete » retrouve « Diabète ». IMMUTABLE car utilisee par une colonne generee.
-- Les apostrophes typographiques sont ramenees a l'apostrophe simple : les libelles
-- importes en contiennent (« Infection due a d’autres Vibrio »).
--
-- Les MAJUSCULES accentuees sont traduites elles aussi, et pas seulement les minuscules :
-- selon la locale du serveur, `lower()` peut laisser les caracteres non ASCII intacts. En
-- locale C, `lower('DIAB<E accent>TE')` ne convertit pas le E accentue ; s'en remettre a
-- `lower()` seul rendrait la recherche dependante de l'environnement.
create or replace function public.terminology_normalize(p_text text)
returns text
language sql
immutable
set search_path = pg_catalog, pg_temp
as $$
  select translate(
    lower(replace(coalesce(p_text, ''), U&'\2019', '''')),
    U&'\00E0\00E1\00E2\00E3\00E4\00E5\00E7\00E8\00E9\00EA\00EB\00EC\00ED\00EE\00EF\00F1\00F2\00F3\00F4\00F5\00F6\00F9\00FA\00FB\00FC\00FD\00FF\0153\00E6'
    || U&'\00C0\00C1\00C2\00C3\00C4\00C5\00C7\00C8\00C9\00CA\00CB\00CC\00CD\00CE\00CF\00D1\00D2\00D3\00D4\00D5\00D6\00D9\00DA\00DB\00DC\00DD\0178\0152\00C6',
    'aaaaaaceeeeiiiinooooouuuuyyoa' || 'aaaaaaceeeeiiiinooooouuuuyyoa'
  )
$$;

comment on function public.terminology_normalize(text) is
  'Normalisation de recherche (minuscules, accents ramenes a la lettre de base). Immutable : utilisee par une colonne generee.';

-- Un referentiel = une publication datee et identifiee (source, version, licence).
-- Conserver plusieurs referentiels permet d'en preparer un nouveau sans invalider les
-- donnees deja saisies avec le precedent.
create table if not exists public.terminology_release (
  id            uuid primary key default gen_random_uuid(),
  slug          text not null unique,
  title         text not null,
  source        text not null,
  version       text not null,
  -- Licence de la source, lorsqu'elle est connue. Si elle interdit les modifications, les
  -- libelles importes ne doivent pas etre reecrits : un service qui veut des intitules plus
  -- courts se constitue une liste locale (bibliotheque de jeux de valeurs), distincte du
  -- referentiel et qui ne s'en reclame pas.
  license       text,
  -- Mention a afficher partout ou le referentiel est utilise, quand la licence l'exige.
  attribution   text,
  concept_count integer not null default 0 check (concept_count >= 0),
  is_active     boolean not null default false,
  imported_at   timestamptz,
  created_at    timestamptz not null default now()
);

-- Un seul referentiel actif a la fois : c'est celui que la recherche interroge.
create unique index if not exists terminology_release_single_active
  on public.terminology_release ((is_active)) where is_active;

create table if not exists public.terminology_concept (
  id            uuid primary key default gen_random_uuid(),
  release_id    uuid not null references public.terminology_release(id) on delete cascade,
  -- Identifiant stable au sein du referentiel. C'est la valeur destinee a etre stockee
  -- dans les donnees ; le libelle n'est qu'un affichage.
  --
  -- Nullable a dessein : dans une classification, les REGROUPEMENTS n'ont pas toujours
  -- d'identifiant (28 chapitres et 572 blocs dans le referentiel importe le 26 juillet
  -- 2026). Cela ne pose pas de probleme tant qu'ils ne sont pas proposables a la saisie :
  -- ce qui n'est jamais stocke dans une donnee n'a pas besoin d'un identifiant stable.
  -- La contrainte plus bas rend le code OBLIGATOIRE des qu'un concept est selectionnable.
  code          text,
  label         text not null,
  -- Nature de l'entree : seules certaines sont proposables a la saisie.
  kind          text not null check (kind in ('chapter', 'block', 'category')),
  depth         integer not null default 0 check (depth >= 0),
  -- Hierarchie interne au referentiel. `set null` : la disparition d'un parent ne doit
  -- jamais faire disparaitre un concept deja utilise dans des donnees.
  parent_id     uuid references public.terminology_concept(id) on delete set null,
  -- Un chapitre ou un regroupement n'est pas un diagnostic : il structure, il ne se
  -- choisit pas. L'import decide ; la valeur reste modifiable au cas par cas.
  is_selectable boolean not null default true,
  search_text   text generated always as (public.terminology_normalize(label)) stored,
  created_at    timestamptz not null default now(),
  -- Un `unique` traite les NULL comme distincts : les regroupements sans identifiant
  -- coexistent, les concepts identifies restent uniques dans leur referentiel.
  unique (release_id, code),
  -- Ce qui peut atterrir dans une donnee patient DOIT etre designe de facon stable.
  constraint terminology_concept_selectable_has_code check (code is not null or not is_selectable)
);

-- Recherche par prefixe : index utilisable malgre le `like` (text_pattern_ops).
create index if not exists terminology_concept_search
  on public.terminology_concept (release_id, search_text text_pattern_ops);
create index if not exists terminology_concept_parent
  on public.terminology_concept (parent_id);

alter table public.terminology_release enable row level security;
alter table public.terminology_concept enable row level security;

-- Lecture pour tout compte authentifie : un referentiel diagnostique n'est pas une
-- donnee de patient. Aucune politique d'ecriture : tout INSERT/UPDATE/DELETE client est
-- refuse par defaut, y compris pour le proprietaire d'une base.
create policy terminology_release_read on public.terminology_release
  for select to authenticated using (true);
create policy terminology_concept_read on public.terminology_concept
  for select to authenticated using (true);

grant select on public.terminology_release to authenticated;
grant select on public.terminology_concept to authenticated;

-- Recherche incrementale. SECURITY INVOKER volontairement : aucun privilege n'est
-- necessaire puisque la RLS autorise deja la lecture aux comptes authentifies. Un
-- appelant anonyme ne verra donc aucune ligne, sans traitement particulier.
create or replace function public.search_terminology(p_query text, p_limit integer default 20)
returns table (id uuid, code text, label text, kind text, depth integer)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with needle as (
    -- Les jokers `like` fournis par l'appelant sont neutralises : une recherche reste
    -- une recherche de texte, jamais un motif arbitraire.
    select replace(replace(replace(public.terminology_normalize(p_query), '\', '\\'), '%', '\%'), '_', '\_') as t
  ),
  active as (
    select r.id from public.terminology_release r where r.is_active limit 1
  )
  select c.id, c.code, c.label, c.kind, c.depth
  from public.terminology_concept c, needle n, active a
  where c.release_id = a.id
    and c.is_selectable
    and length(n.t) >= 2
    and c.search_text like '%' || n.t || '%'
  -- Ce qui COMMENCE par la saisie d'abord, puis le libelle le plus court : « palu »
  -- doit proposer « Paludisme » avant « Suspicion de paludisme non confirme ».
  order by (case when c.search_text like n.t || '%' then 0 else 1 end), length(c.label), c.label
  limit least(greatest(coalesce(p_limit, 20), 1), 50)
$$;

comment on function public.search_terminology(text, integer) is
  'Recherche incrementale dans le referentiel actif. Minimum 2 caracteres, 50 resultats au maximum.';

grant execute on function public.terminology_normalize(text) to authenticated;
grant execute on function public.search_terminology(text, integer) to authenticated;
