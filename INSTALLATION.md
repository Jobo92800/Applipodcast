# MON PARCOURS *by MAbeautyplus* — installation

Compte à peu près une heure la première fois. Rien à installer sur ton ordinateur.

---

## 1. Le SQL dans Supabase

Ouvre l'éditeur SQL du projet :
https://supabase.com/dashboard/project/oiolujqwdcbhvlyqkyyg/sql/new

Colle tout le contenu de `supabase/migrations/20260830_init.sql`, puis « Run ».
En bas s'affiche la liste des trois parcours avec le nombre d'étapes. Le parcours A
arrive avec ses 6 étapes, B et C sont vides et s'ajouteront depuis l'espace thérapeute.

Ce script crée aussi le bucket `parcours-audio` en **privé**. Ne le repasse jamais en
public : c'est ce qui empêche un MP3 de circuler par une adresse permanente.

## 2. Les clés

Dans Supabase, `Project Settings` → `API` :

- **Project URL** : `https://oiolujqwdcbhvlyqkyyg.supabase.co`
- **service_role** : la clé secrète, celle marquée « never share ». Copie-la.

Cette clé donne tous les droits sur la base. Elle ne va que dans Netlify, jamais dans
le code, jamais dans le repo, jamais dans un message.

## 3. Le repo GitHub

Dépose le contenu de ce dossier à la racine de `Jobo92800/Applipodcast`, et range le
document Claude Design existant dans un sous-dossier `maquettes/` pour ne pas mélanger
la maquette et l'application.

Le `.gitignore` fourni exclut déjà les `.mp3` : les fichiers audio vivent dans Supabase,
pas dans Git.

## 4. Netlify

Nouveau site, « Import from GitHub », choisis `Applipodcast`. Le `netlify.toml` fait le
reste, il n'y a ni commande de build ni dossier de publication à saisir.

Dans `Site configuration` → `Environment variables`, ajoute :

| Variable | Valeur |
|---|---|
| `SUPABASE_URL` | `https://oiolujqwdcbhvlyqkyyg.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | la clé service_role copiée à l'étape 2 |
| `ADMIN_CODE` | le code d'accès de l'espace thérapeute, que tu choisis |
| `SITE_URL` | `https://monparcours.mabeautyplus.fr` |
| `BREVO_API_KEY` | ta clé API Brevo, pour les SMS |
| `BREVO_SMS_SENDER` | `MAbeautyPl` (11 caractères maximum) |

Puis `Domain management` → ajoute `monparcours.mabeautyplus.fr` et suis les instructions
DNS. Tant que le domaine n'est pas actif, `SITE_URL` doit contenir l'adresse Netlify
provisoire, sinon les liens envoyés par SMS pointeront dans le vide.

Enfin `Access control` → protège `/admin` par un mot de passe de site. Le code interne
n'est qu'un garde-fou dans le navigateur.

## 5. Les épisodes

Ouvre `monparcours.mabeautyplus.fr/admin`, saisis ton `ADMIN_CODE`, onglet **Épisodes**.
Chaque étape a un bouton « Déposer le MP3 ». Le fichier part directement dans l'espace
privé Supabase, et la durée réelle est lue automatiquement pour calculer le seuil des 90 %.

Format conseillé : MP3 mono, 96 kbps, autour de -16 LUFS.
Si tu réenregistres un épisode, redépose-le simplement : le nom du fichier change à
chaque envoi, donc aucun cache ne sert l'ancienne version.

## 6. La première cliente

Onglet **Clientes** → « Ajouter une cliente ». Prénom, nom, téléphone, parcours.
Le SMS part tout seul avec le lien. Tu peux aussi copier le lien ou l'envoyer par WhatsApp.

Teste avec ton propre numéro avant d'ouvrir aux clientes.

---

## Comment ça marche

### L'accès

Le lien personnel contient un jeton de 20 caractères tiré aléatoirement par le serveur.
À la première ouverture, l'app le retient dans le téléphone et le retire de la barre
d'adresse : ensuite, l'icône sur l'écran d'accueil suffit.

Si la cliente perd son lien, elle va sur le site et saisit son numéro. Si l'appareil est
déjà reconnu, elle entre directement. Sinon le lien lui est renvoyé par SMS. Une personne
qui saisirait le numéro d'une autre ne verrait donc rien.

Deux appareils maximum par cliente. Au-delà, l'ouverture est refusée avec un message
invitant à appeler le centre, et la thérapeute peut réinitialiser en un clic.

Un seul parcours actif par numéro de téléphone. Si une cliente reprend une cure, l'espace
thérapeute propose de mettre l'ancien accès en pause avant de créer le nouveau.

### Le déblocage

Le navigateur enregistre les secondes réellement traversées en lecture, une seule fois
chacune, et les envoie au serveur toutes les 30 secondes ainsi qu'à la fermeture de la page.

**C'est le serveur qui compte et qui décide.** Une requête forgée annonçant « terminée »
n'a aucun effet, c'est vérifié par les tests. Faire glisser le curseur jusqu'à la fin ne
coche aucune seconde. Le seuil est de 90 % du contenu, modifiable par la variable
`SEUIL_DEBLOCAGE`.

La progression suit la cliente : elle peut commencer sur son téléphone et finir sur sa
tablette, le décompte reprend là où il en était.

### Les fichiers audio

Le bucket est privé. Quand une cliente ouvre une étape, le serveur vérifie qu'elle y a
droit puis génère une adresse valable 2 heures. Aucun épisode verrouillé n'est
téléchargeable, et aucune adresse ne reste valable durablement.

---

## Coûts mensuels

Netlify gratuit, Supabase environ 10 $ pour ce second projet dans ton organisation,
Brevo au SMS envoyé. Le volume audio reste très en dessous des quotas inclus.

## Vérifier que tout va bien

Dans Netlify, `Logs` → `Functions` montre chaque appel. Dans Supabase, la table
`acces_log` enregistre les ouvertures, les tentatives sur des étapes verrouillées et les
identifications par téléphone. C'est le premier endroit à regarder si une cliente signale
un problème.

## La suite

Les notifications push (« votre nouvelle étape est disponible ») réutiliseront le montage
VAPID déjà en place dans l'app nutrition. La table `appareils` est prête à recevoir les
abonnements, il n'y aura rien à refaire côté structure.
