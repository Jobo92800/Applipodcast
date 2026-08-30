# MON PARCOURS *by MAbeautyplus*

Parcours audio remis en centre avec la cure. Une étape à la fois, la suivante se
débloque une fois la précédente réellement écoutée.

Aucun compte, aucun mot de passe : la cliente reçoit un lien personnel par SMS.

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
tests/                  Banc d'essai local (37 contrôles)
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
| `POST /api/acces` | Identification par téléphone, renvoi du lien par SMS |
| `POST /api/admin` | Espace thérapeute, protégé par `ADMIN_CODE` |

## Le déblocage

Le navigateur enregistre un bit par seconde réellement traversée en lecture, envoie ce
bitset toutes les 30 secondes, et **c'est le serveur qui compte et décide**. Une requête
annonçant « terminée » sans les secondes correspondantes n'a aucun effet. Faire glisser
le curseur jusqu'à la fin ne coche rien.

Seuil par défaut : 90 % du contenu, réglable par la variable `SEUIL_DEBLOCAGE`.

La progression suit la cliente d'un appareil à l'autre. Deux appareils maximum,
réinitialisables par la thérapeute.

## Les fichiers audio

Bucket Supabase privé. Le serveur vérifie que l'étape est débloquée puis signe une
adresse valable 2 heures. Aucun MP3 n'est accessible par une adresse permanente.

Les fichiers sont déposés depuis l'espace thérapeute, onglet Épisodes. Ils ne sont
jamais versionnés dans Git.

## Tests

```bash
node tests/run.mjs
```

Exécute les vraies fonctions sur une base simulée : accès, déblocage séquentiel,
tentative de triche, limite d'appareils, identification par téléphone, actions
thérapeute. Aucune connexion à Supabase.

## Variables d'environnement

Définies dans Netlify, jamais dans le dépôt : `SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY`, `ADMIN_CODE`, `SITE_URL`, `BREVO_API_KEY`,
`BREVO_SMS_SENDER`. Optionnelles : `SEUIL_DEBLOCAGE`, `APPAREILS_MAX`.

## Vocabulaire

Le mot « podcast » n'apparaît pas dans l'interface : *parcours audio*, *étapes*,
*votre accompagnement*. À conserver dans les SMS envoyés aux clientes.
