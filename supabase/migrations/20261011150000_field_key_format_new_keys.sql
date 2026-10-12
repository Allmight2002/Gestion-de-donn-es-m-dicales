-- =============================================================================
-- 20261011150000_field_key_format_new_keys.sql
--
-- POURQUOI. La cle technique d'une variable etait saisie librement (`IMC`, `Age`,
-- `date-IRM`) alors que l'import, la creation d'un jeu de variables complet et la
-- preparation de formulaire exigent `^[a-z][a-z0-9_]{0,62}$`. L'ecran normalise
-- desormais la saisie ; ce declencheur est le filet serveur pour les autres chemins
-- (application non rafraichie en cache, appel direct a l'API).
--
-- REGLE. Refus structure `FIELD_KEY_INVALID` pour :
--   * une variable INSEREE directement par un client (`current_user = 'authenticated'`,
--     meme discriminant que 20260616094700). Les fonctions `security definer` (nouvelle
--     version, preparation, import...) recopient des cles existantes et valident
--     elles-memes les cles nouvelles : elles ne sont pas concernees ;
--   * une cle RENOMMEE, quel que soit le chemin (`update_template_field`).
-- Une cle existante hors format n'est ni refusee ni reecrite : modifier une autre
-- propriete de la variable, ou la recopier dans une nouvelle version, reste possible.
--
-- ADDITIVE. Une fonction et un declencheur nouveaux ; aucune ligne n'est lue ni
-- modifiee. Retour arriere : supprimer le declencheur et la fonction.
-- =============================================================================

create function public.enforce_template_field_key_format()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.field_key ~ '^[a-z][a-z0-9_]{0,62}$' then
    return new;
  end if;
  if (tg_op = 'INSERT' and current_user = 'authenticated')
     or (tg_op = 'UPDATE' and new.field_key is distinct from old.field_key) then
    raise exception using errcode = 'P0001', message = 'FIELD_KEY_INVALID',
      detail = '{"code":"FIELD_KEY_INVALID"}';
  end if;
  return new;
end
$$;
revoke all on function public.enforce_template_field_key_format() from public, anon, authenticated;

create trigger trg_template_field_key_format
  before insert or update of field_key on public.template_field
  for each row execute function public.enforce_template_field_key_format();
