/*
  MON PARCOURS by MAbeautyplus — passage aux comptes email / mot de passe

  À exécuter APRÈS 20260830_init.sql, dans le SQL Editor de Supabase :
  https://supabase.com/dashboard/project/oiolujqwdcbhvlyqkyyg/sql/new

  Ce qui change :
    - chaque cliente est reliée à un compte Supabase Auth ;
    - l'identification se fait par email et mot de passe, depuis n'importe quel appareil ;
    - le téléphone reste enregistré, mais uniquement comme information pour le centre ;
    - le jeton de lien personnel disparaît.
*/

-- ---------------------------------------------------------------------------
-- 1. Nouvelles colonnes
-- ---------------------------------------------------------------------------
alter table clientes add column if not exists email text;
alter table clientes add column if not exists auth_user_id uuid;

-- Un compte Supabase = une cliente, et réciproquement.
create unique index if not exists clientes_email_idx on clientes (lower(email));
create unique index if not exists clientes_auth_idx  on clientes (auth_user_id);

-- ---------------------------------------------------------------------------
-- 2. Le téléphone n'identifie plus personne
-- ---------------------------------------------------------------------------
drop index if exists clientes_tel_actif_idx;
alter table clientes alter column telephone drop not null;

-- ---------------------------------------------------------------------------
-- 3. Le jeton de lien personnel n'a plus d'usage
-- ---------------------------------------------------------------------------
alter table clientes alter column jeton drop not null;

-- ---------------------------------------------------------------------------
-- 4. Ménage : supprimer les accès créés avant ce changement
--    (ils n'ont pas de compte email, ils ne pourraient plus se connecter)
-- ---------------------------------------------------------------------------
delete from clientes where email is null;

-- À partir d'ici, l'email devient obligatoire.
alter table clientes alter column email set not null;

-- ---------------------------------------------------------------------------
-- Vérification
-- ---------------------------------------------------------------------------
select
  (select count(*) from clientes) as clientes,
  (select count(*) from etapes)   as etapes,
  (select count(*) from parcours) as parcours;
