/*
  MON PARCOURS by MAbeautyplus — schéma initial

  À exécuter une seule fois dans le SQL Editor de Supabase :
  https://supabase.com/dashboard/project/oiolujqwdcbhvlyqkyyg/sql/new

  Principe de sécurité :
  aucune table n'est lisible depuis le navigateur. RLS est activé partout
  et AUCUNE politique n'est créée pour les rôles anon et authenticated.
  Seules les fonctions Netlify, qui utilisent la clé de service, accèdent
  aux données. La clé anonyme du projet ne sert à rien ici, et c'est voulu.
*/

-- ---------------------------------------------------------------------------
-- 1. Parcours
-- ---------------------------------------------------------------------------
create table if not exists parcours (
  code            text primary key check (code ~ '^[A-Z]$'),
  nom_commercial  text not null,
  ordre           int  not null default 0,
  actif           boolean not null default true,
  created_at      timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 2. Étapes
-- ---------------------------------------------------------------------------
create table if not exists etapes (
  id            uuid primary key default gen_random_uuid(),
  parcours_code text not null references parcours(code) on delete cascade,
  numero        int  not null check (numero > 0),
  titre         text not null,
  sous_titre    text,
  duree_min     int  not null default 15,          -- durée affichée, en minutes
  duree_sec     int,                               -- durée réelle du fichier, renseignée à l'envoi
  fichier       text,                              -- chemin dans le bucket, ex. 'A/A01.mp3'
  actif         boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (parcours_code, numero)
);
create index if not exists etapes_parcours_idx on etapes (parcours_code, numero);

-- ---------------------------------------------------------------------------
-- 3. Clientes
-- ---------------------------------------------------------------------------
create table if not exists clientes (
  id                 uuid primary key default gen_random_uuid(),
  jeton              text unique not null,
  prenom             text not null,
  nom                text,
  telephone          text not null,                -- normalisé en +33XXXXXXXXX
  centre             text,
  parcours_code      text not null references parcours(code),
  statut             text not null default 'actif' check (statut in ('actif','suspendu')),
  debloque_manuel    int  not null default 0,      -- étape forcée par la thérapeute
  vu                 boolean not null default false,
  derniere_activite  timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

/*
  Un seul parcours actif par numéro de téléphone.
  C'est ce qui rend l'identification par téléphone non ambiguë : si une cliente
  reprend une cure plus tard, on suspend l'ancien accès avant d'en créer un nouveau.
*/
create unique index if not exists clientes_tel_actif_idx
  on clientes (telephone) where statut = 'actif';
create index if not exists clientes_jeton_idx on clientes (jeton);

-- ---------------------------------------------------------------------------
-- 4. Appareils autorisés (2 maximum par cliente)
-- ---------------------------------------------------------------------------
create table if not exists appareils (
  id            uuid primary key default gen_random_uuid(),
  cliente_id    uuid not null references clientes(id) on delete cascade,
  empreinte     text not null,
  ua            text,
  derniere_vue  timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  unique (cliente_id, empreinte)
);

-- ---------------------------------------------------------------------------
-- 5. Progression
-- ---------------------------------------------------------------------------
create table if not exists progression (
  id           uuid primary key default gen_random_uuid(),
  cliente_id   uuid not null references clientes(id) on delete cascade,
  etape_id     uuid not null references etapes(id)   on delete cascade,
  couverture   text not null default '',            -- secondes écoutées, bitset en base64
  position_sec int  not null default 0,
  taux         numeric(4,3) not null default 0,     -- calculé côté serveur
  terminee     boolean not null default false,
  terminee_le  timestamptz,
  updated_at   timestamptz not null default now(),
  unique (cliente_id, etape_id)
);
create index if not exists progression_cliente_idx on progression (cliente_id);

-- ---------------------------------------------------------------------------
-- 6. Journal d'accès (sécurité, limitation de débit, suivi)
-- ---------------------------------------------------------------------------
create table if not exists acces_log (
  id         bigserial primary key,
  cliente_id uuid references clientes(id) on delete set null,
  action     text not null,
  ip         text,
  detail     text,
  created_at timestamptz not null default now()
);
create index if not exists acces_log_ip_idx on acces_log (ip, created_at desc);

-- ---------------------------------------------------------------------------
-- 7. Verrouillage complet : RLS actif, aucune politique
-- ---------------------------------------------------------------------------
alter table parcours    enable row level security;
alter table etapes      enable row level security;
alter table clientes    enable row level security;
alter table appareils   enable row level security;
alter table progression enable row level security;
alter table acces_log   enable row level security;

-- ---------------------------------------------------------------------------
-- 8. Bucket audio privé
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'parcours-audio',
  'parcours-audio',
  false,
  104857600,                                        -- 100 Mo par fichier
  array['audio/mpeg','audio/mp3','audio/mp4','audio/x-m4a','audio/aac','audio/wav']
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

/*
  Aucune politique sur storage.objects pour ce bucket : ni anon ni authenticated
  ne peuvent lire ou écrire. Les fonctions Netlify signent les URL de lecture
  (valables 2 h) et les URL d'envoi. Un MP3 n'est donc jamais accessible par une
  adresse permanente.
*/

-- ---------------------------------------------------------------------------
-- 9. Mise à jour automatique de updated_at
-- ---------------------------------------------------------------------------
create or replace function touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists etapes_touch      on etapes;
drop trigger if exists clientes_touch    on clientes;
drop trigger if exists progression_touch on progression;

create trigger etapes_touch      before update on etapes      for each row execute function touch_updated_at();
create trigger clientes_touch    before update on clientes    for each row execute function touch_updated_at();
create trigger progression_touch before update on progression for each row execute function touch_updated_at();

-- ---------------------------------------------------------------------------
-- 10. Les trois parcours
-- ---------------------------------------------------------------------------
insert into parcours (code, nom_commercial, ordre) values
  ('A', 'Parcours A', 1),
  ('B', 'Parcours B', 2),
  ('C', 'Parcours C', 3)
on conflict (code) do nothing;

-- ---------------------------------------------------------------------------
-- 11. Étapes du parcours A (les autres s'ajoutent depuis l'espace thérapeute)
-- ---------------------------------------------------------------------------
insert into etapes (parcours_code, numero, titre, sous_titre, duree_min, fichier) values
  ('A', 1, 'Votre point de départ',                    'Ce qui commence aujourd''hui',              12, 'A/A01.mp3'),
  ('A', 2, 'Comprendre votre nouveau départ',          'Pourquoi cette fois est différente',        14, 'A/A02.mp3'),
  ('A', 3, 'Installer vos premiers repères',           'Les gestes simples de la première semaine', 15, 'A/A03.mp3'),
  ('A', 4, 'La rééducation alimentaire au quotidien',  'Manger autrement, sans tout bouleverser',   16, 'A/A04.mp3'),
  ('A', 5, 'Traverser les moments de doute',           'Quand la motivation vacille',               13, 'A/A05.mp3'),
  ('A', 6, 'Garder le cap après votre cure',           'Ce que vous emportez avec vous',            15, 'A/A06.mp3')
on conflict (parcours_code, numero) do nothing;

-- Vérification
select p.code, p.nom_commercial, count(e.id) as etapes
from parcours p left join etapes e on e.parcours_code = p.code
group by p.code, p.nom_commercial order by p.ordre;
