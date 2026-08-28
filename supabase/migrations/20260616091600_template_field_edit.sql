-- =============================================================================
-- 20260616091600_template_field_edit.sql
-- Edition d'une variable de gabarit (correction d'un champ deja cree).
--
-- Regle produit : le LIBELLE (et la section / le caractere requis) sont modifiables a
-- tout moment ; le NOM INTERNE (field_key), le TYPE et la PORTEE (scope) ne le sont que
-- tant que la variable n'a AUCUNE donnee saisie. Sinon -> supprimer puis recreer.
-- Raison : patient.data / encounter.data sont indexees par field_key ; renommer la cle
-- (ou changer son type) APRES saisie orphelinerait / invaliderait les donnees. La garde
-- est posee COTE BASE (defense en profondeur), pas seulement dans l'interface.
-- =============================================================================

-- Variable "utilisee" : au moins une donnee (patient ou rencontre) saisie SOUS CETTE
-- version de gabarit porte la cle de ce champ. patient/encounter portent leur propre
-- template_version_id (la saisie est horodatee sur une version donnee).
create or replace function public.template_field_in_use(p_field_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  with f as (
    select field_key, scope, template_version_id
    from public.template_field where id = p_field_id
  )
  select case (select scope from f)
    when 'patient' then exists (
      select 1 from public.patient p, f
      where p.template_version_id = f.template_version_id
        and p.deleted_at is null and p.data ? f.field_key)
    when 'encounter' then exists (
      select 1 from public.encounter e, f
      where e.template_version_id = f.template_version_id
        and e.deleted_at is null and e.data ? f.field_key)
    else false
  end
$$;

-- Champs DEJA utilises d'une version (pour griser nom/type cote interface).
create or replace function public.template_version_fields_in_use(p_version_id uuid)
returns setof uuid language sql stable security definer set search_path = public, pg_temp as $$
  select tf.id from public.template_field tf
  where tf.template_version_id = p_version_id and public.template_field_in_use(tf.id)
$$;

-- Mise a jour d'un champ. owns_template requis (medecin proprietaire / admin pour un
-- modele global). Changement STRUCTUREL (field_key / type / scope) refuse si la variable
-- est utilisee ; le libelle / la section / le caractere requis restent modifiables.
create or replace function public.update_template_field(
  p_field_id  uuid,
  p_field_key text,
  p_label     text,
  p_scope     text,
  p_section   text,
  p_type      text,
  p_required  boolean,
  p_encounter_types text[] default null
) returns public.template_field
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  cur      public.template_field;
  semantic boolean;
  res      public.template_field;
begin
  select * into cur from public.template_field where id = p_field_id;
  if not found then
    raise exception 'Champ introuvable';
  end if;
  if not public.owns_template(public.template_of_version(cur.template_version_id)) then
    raise exception 'Modification du gabarit non autorisee';
  end if;

  -- Changement SEMANTIQUE = qui altere le SENS / les regles du champ (audit §8.2) : nom interne,
  -- type, portee, caractere requis, types de rencontre concernes. Interdit si la variable est
  -- deja utilisee (la signification historique des donnees changerait). Le libelle et la section
  -- (cosmetiques) restent modifiables. Pour un vrai changement semantique apres usage : creer une
  -- nouvelle version du gabarit.
  semantic := (p_field_key       is distinct from cur.field_key)
           or (p_type            is distinct from cur.type)
           or (p_scope           is distinct from cur.scope)
           or (p_required        is distinct from cur.required)
           or ((case when p_scope = 'encounter' then p_encounter_types else null end) is distinct from cur.encounter_types);

  if semantic and public.template_field_in_use(p_field_id) then
    raise exception 'Variable deja utilisee : seuls le libelle et la section sont modifiables. Pour changer son comportement (nom, type, requis, types de rencontre), creez une nouvelle version du gabarit.';
  end if;
  update public.template_field
     set field_key = p_field_key,
         label     = p_label,
         scope     = p_scope,
         section   = p_section,
         type      = p_type,
         required  = p_required,
         encounter_types = case when p_scope = 'encounter' then p_encounter_types else null end
   where id = p_field_id
   returning * into res;
  return res;
end $$;

-- Suppression d'un champ. owns_template requis. REFUSEE si la variable est utilisee (au
-- moins une donnee patient/rencontre porte sa cle) : supprimer le champ orphelinerait ces
-- valeurs et ferait perdre son libelle / type au dictionnaire. Garde cote base (l'UI grise
-- aussi le bouton). Pour retirer un champ utilise : creer une nouvelle version du gabarit.
create or replace function public.delete_template_field(p_field_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare cur public.template_field;
begin
  select * into cur from public.template_field where id = p_field_id;
  if not found then return; end if;
  if not public.owns_template(public.template_of_version(cur.template_version_id)) then
    raise exception 'Modification du gabarit non autorisee';
  end if;
  if public.template_field_in_use(p_field_id) then
    raise exception 'Variable deja utilisee : suppression impossible. Creez une nouvelle version du gabarit pour la retirer.';
  end if;
  delete from public.template_field where id = p_field_id;
end $$;

grant execute on function public.template_field_in_use(uuid) to authenticated;
grant execute on function public.template_version_fields_in_use(uuid) to authenticated;
grant execute on function public.update_template_field(uuid, text, text, text, text, text, boolean, text[]) to authenticated;
grant execute on function public.delete_template_field(uuid) to authenticated;
