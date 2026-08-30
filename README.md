# MON PARCOURS *by MAbeautyplus*

Parcours audio remis en centre avec la cure. Une étape à la fois, la suivante se
débloque une fois la précédente réellement écoutée.

La cliente reçoit une invitation par e-mail, choisit son mot de passe, et se connecte
ensuite depuis n'importe quel appareil.

**Installation complète : [`INSTALLATION.md`](INSTALLATION.md)**

---

## Ce que contient le dépôt

```
index.html              Application cliente (PWA, 6 écrans)
admin.html              Espace thérapeute (clientes + épisodes)
netlify/
  functions/            Les 5 routes de l'API
  lib/core.js           Accès Supabase, couverture d'écoute, SMS, jetons
supabase/migrations/    Schéma de la base, à exécuter une fois
tests/                  Banc d'essai local (42 contrôles)
maquettes/              Maquettes Claude Design, hors application
assets/img/             Icônes PWA
```

## Architecture

Site statique sur Netlify. Le navigateur ne parle qu'aux fonctions Netlify, qui seules
détiennent la clé Supabase. Toutes les tables ont RLS activé sans aucune politique :
rien n'est lisible depuis le navigateur, même avec la clé anonyme.

| Route | Rôle |
|---|---|
| `POST /api/parcours` | État du parcours de la cliente |
| `POST /api/audio` | Adresse de lecture temporaire d'une étape débloquée |
| `POST /api/progression` | Enregistrement des secondes écoutées |
| `POST /api/session` | Connexion, rafraîchissement, mot de passe oublié |
| `POST /api/admin` | Espace thérapeute, protégé par `ADMIN_CODE` |

## Le déblocage

Le navigateur enregistre un bit par seconde réellement traversée en lecture, envoie ce
bitset toutes les 30 secondes, et **c'est le serveur qui compte et décide**. Une requête
annonçant « terminée » sans les secondes correspondantes n'a aucun effet. Faire glisser
le curseur jusqu'à la fin ne coche rien.

Seuil par défaut : 90 % du contenu, réglable par la variable `SEUIL_DEBLOCAGE`.

La progression suit la cliente d'un appareil à l'autre. Quatre appareils, et au-delà
c'est le plus ancien qui laisse sa place plutôt que la cliente qui reste dehors.
Réinitialisables par la thérapeute.

## L'identification

Comptes Supabase Auth, e-mail et mot de passe. Le navigateur ne parle jamais directement
à Supabase : la connexion passe par `/api/session`, ce qui permet de limiter les
tentatives et d'écrire les messages en français.

La thérapeute crée le compte, la cliente reçoit une invitation par e-mail, clique, et
choisit son mot de passe. La session se rafraîchit toute seule : en pratique elle ne le
retape presque jamais.

## Les fichiers audio

Bucket Supabase privé. Le serveur vérifie que l'étape est débloquée puis signe une
adresse valable 2 heures. Aucun MP3 n'est accessible par une adresse permanente.

Les fichiers sont déposés depuis l'espace thérapeute, onglet Épisodes. Ils ne sont
jamais versionnés dans Git.

## Tests

```bash
node tests/run.mjs
```

Exécute les vraies fonctions sur une base et un service d'authentification simulés :
invitation, connexion, mot de passe oublié, déblocage séquentiel, tentative de triche,
limite d'appareils, actions thérapeute. Aucune connexion à Supabase.

## Variables d'environnement

Définies dans Netlify, jamais dans le dépôt : `SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY`, `ADMIN_CODE`, `SITE_URL`.
Optionnelles : `SEUIL_DEBLOCAGE`, `APPAREILS_MAX`.

Les e-mails partent par le SMTP configuré dans Supabase, pas par Netlify.

## Vocabulaire

Le mot « podcast » n'apparaît pas dans l'interface : *parcours audio*, *étapes*,
*votre accompagnement*. À conserver dans les SMS envoyés aux clientes.
