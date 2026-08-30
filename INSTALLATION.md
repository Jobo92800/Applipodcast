# MON PARCOURS *by MAbeautyplus* — installation

Compte à peu près une heure et demie la première fois. Rien à installer sur votre ordinateur.

---

## 1. Le SQL dans Supabase

Ouvrez l'éditeur SQL du projet :
https://supabase.com/dashboard/project/oiolujqwdcbhvlyqkyyg/sql/new

Exécutez les deux fichiers, **dans cet ordre** :

1. `supabase/migrations/20260830_init.sql` — tables, bucket privé, parcours A
2. `supabase/migrations/20260830_02_comptes.sql` — comptes e-mail

Vous avez déjà passé le premier : ne relancez que le second.

Il affiche à la fin le compte des clientes, des étapes et des parcours.

## 2. Les clés Supabase

`Project Settings` → `API` → section **Secret keys** → cliquez sur l'œil pour révéler la
clé `sb_secret_…`, puis copiez-la. C'est le remplaçant de l'ancienne `service_role` : elle
contourne toutes les règles de sécurité et ne doit jamais quitter Netlify.

La Publishable key ne sert pas ici.

## 3. Les e-mails : SMTP et modèles

C'est l'étape à ne pas sauter. Le service d'envoi intégré de Supabase est limité à
quelques e-mails par heure et réservé aux tests : vos invitations n'arriveraient pas.

**SMTP.** `Authentication` → `Emails` → `SMTP Settings`. Activez l'envoi personnalisé et
saisissez les identifiants SMTP de Brevo (dans Brevo : `Transactionnel` → `Paramètres` →
`SMTP & API`). Serveur `smtp-relay.brevo.com`, port `587`. Adresse d'expédition : une
adresse de votre domaine, par exemple `contact@mabeautyplus.fr`. Nom d'expéditeur :
`MAbeautyplus`.

**URL de redirection.** `Authentication` → `URL Configuration`. Mettez votre adresse dans
`Site URL`, et ajoutez-la aussi dans `Redirect URLs`. Sans ça, les liens des e-mails ne
ramèneront pas vers l'application.

**Modèles.** `Authentication` → `Emails` → `Templates`. Les textes par défaut sont en
anglais. Remplacez au minimum ces deux-là.

*Invite user* — objet : `Votre parcours audio MAbeautyplus`

```html
<h2>Bienvenue dans votre parcours audio</h2>
<p>Votre centre MAbeautyplus vous a ouvert l'accès à votre parcours audio.</p>
<p>Cliquez ci-dessous pour choisir votre mot de passe et commencer votre première étape.</p>
<p><a href="{{ .ConfirmationURL }}">Accéder à mon parcours</a></p>
<p>Ce lien est personnel. Si vous n'attendiez pas ce message, ignorez-le simplement.</p>
```

*Reset password* — objet : `Votre nouveau mot de passe MAbeautyplus`

```html
<h2>Nouveau mot de passe</h2>
<p>Vous avez demandé à changer le mot de passe de votre parcours audio MAbeautyplus.</p>
<p><a href="{{ .ConfirmationURL }}">Choisir un nouveau mot de passe</a></p>
<p>Si vous n'êtes pas à l'origine de cette demande, ignorez ce message : rien ne change.</p>
```

## 4. Le repo GitHub

Poussez le contenu de ce dossier sur `Jobo92800/Applipodcast`.

## 5. Netlify

Nouveau site, « Import from GitHub », choisissez `Applipodcast`. Ne touchez à aucun
réglage de build, le `netlify.toml` fait le nécessaire.

Dans `Site configuration` → `Environment variables` :

| Variable | Valeur |
|---|---|
| `SUPABASE_URL` | `https://oiolujqwdcbhvlyqkyyg.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | la clé `sb_secret_…` copiée à l'étape 2 |
| `ADMIN_CODE` | le code d'accès de l'espace thérapeute, que vous choisissez |
| `SITE_URL` | l'adresse du site, sans barre oblique finale |

`SITE_URL` doit correspondre exactement à ce que vous avez mis dans Supabase à l'étape 3.
C'est elle qui construit les liens des e-mails.

Enfin `Access control` → protégez `/admin` par un mot de passe de site. Le code interne
n'est qu'un garde-fou dans le navigateur.

## 6. Les épisodes

`votre-site/admin`, saisissez votre `ADMIN_CODE`, onglet **Épisodes**. Chaque étape a un
bouton « Déposer le MP3 ». Le fichier part dans l'espace privé Supabase, et sa durée réelle
est lue automatiquement pour calculer le seuil des 90 %.

Format conseillé : MP3 mono, 96 kbps, autour de -16 LUFS.

## 7. Votre première cliente

Onglet **Clientes** → « Ajouter une cliente ». Prénom, nom, adresse e-mail, téléphone
facultatif, parcours. L'invitation part immédiatement.

Testez avec votre propre adresse avant d'ouvrir aux clientes, et vérifiez que l'e-mail
arrive bien en boîte de réception plutôt qu'en indésirables.

---

## Comment ça marche

### L'identification

Chaque cliente a un compte Supabase Auth. La thérapeute le crée, la cliente reçoit une
invitation par e-mail, clique et choisit son mot de passe. Elle se connecte ensuite depuis
n'importe quel appareil, téléphone, tablette ou ordinateur.

Le navigateur ne parle jamais directement à Supabase : la connexion passe par les
fonctions Netlify, ce qui limite les tentatives et permet d'écrire les messages en
français.

La session se rafraîchit toute seule, donc en pratique elle ne retape son mot de passe
que si elle change d'appareil ou vide son navigateur. En cas d'oubli, un lien de
réinitialisation part par e-mail en un clic, sans intervention du centre.

Quatre appareils par cliente : téléphone, tablette, ordinateur, avec de la marge.
Au-delà, elle n'est jamais bloquée — c'est l'appareil le plus anciennement utilisé
qui laisse sa place. Un accès réellement partagé finit donc par déconnecter ses
utilisateurs les uns après les autres. La liste est réinitialisable depuis sa fiche,
et le nombre se règle par la variable `APPAREILS_MAX`.

### Le déblocage

Le navigateur enregistre les secondes réellement traversées en lecture, une seule fois
chacune, et les envoie au serveur toutes les 30 secondes ainsi qu'à la fermeture de la page.

**C'est le serveur qui compte et qui décide.** Une requête forgée annonçant « terminée »
n'a aucun effet, c'est vérifié par les tests. Faire glisser le curseur jusqu'à la fin ne
coche aucune seconde. Le seuil est de 90 % du contenu, modifiable par la variable
`SEUIL_DEBLOCAGE`.

La progression suit la cliente : elle peut commencer sur son téléphone et finir sur son
ordinateur, le décompte reprend là où il en était.

### Les fichiers audio

Le bucket est privé. Quand une cliente ouvre une étape, le serveur vérifie qu'elle y a
droit puis génère une adresse valable 2 heures. Aucun épisode verrouillé n'est
téléchargeable, et aucune adresse ne reste valable durablement.

---

## Coûts mensuels

Netlify gratuit, Supabase environ 10 $ pour ce second projet dans votre organisation,
e-mails inclus dans votre offre Brevo. Le volume audio reste très en dessous des quotas.

## Vérifier que tout va bien

Dans Netlify, `Logs` → `Functions` montre chaque appel. Dans Supabase, `Authentication` →
`Users` liste les comptes, et la table `acces_log` enregistre connexions, oublis de mot de
passe et tentatives sur des étapes verrouillées. C'est le premier endroit à regarder si une
cliente signale un problème.

## Si un e-mail n'arrive pas

Dans l'ordre : vérifiez les indésirables, puis le SMTP dans Supabase (`Authentication` →
`Emails`), puis les journaux d'envoi côté Brevo. Depuis la fiche de la cliente, le bouton
« Renvoyer l'invitation » relance l'envoi.

## La suite

Les notifications push (« votre nouvelle étape est disponible ») réutiliseront le montage
VAPID déjà en place dans l'app nutrition. La table `appareils` est prête à recevoir les
abonnements, il n'y aura rien à refaire côté structure.
