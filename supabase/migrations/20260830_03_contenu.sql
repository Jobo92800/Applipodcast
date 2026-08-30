/*
  MON PARCOURS by MAbeautyplus — le contenu réel des trois cures.

  Remplace les six étapes de démonstration du parcours A par les vrais titres,
  et crée les étapes des parcours B et C, qui n'existaient pas encore.

  Correspondance avec les dossiers audio :
    cure 1 mois  -> parcours A -> dossier 1/  ->  6 épisodes
    cure 3 mois  -> parcours B -> dossier 3/  -> 13 épisodes (le n° 4 manque)
    cure 6 mois  -> parcours C -> dossier 6/  -> 24 épisodes

  Le fichier audio n'est jamais renseigné ici : il s'attache tout seul au moment
  du dépôt depuis l'espace thérapeute, avec la durée réelle lue dans le MP3.
  Les durées ci-dessous ne servent qu'à l'affichage avant dépôt.

  Script ré-exécutable sans risque.
*/

-- ---------------------------------------------------------------------------
-- 1. Des noms de cure lisibles par la cliente
-- ---------------------------------------------------------------------------
update parcours set nom_commercial = 'Cure 1 mois' where code = 'A';
update parcours set nom_commercial = 'Cure 3 mois' where code = 'B';
update parcours set nom_commercial = 'Cure 6 mois' where code = 'C';

-- ---------------------------------------------------------------------------
-- 2. Les étapes de démonstration du parcours A pointaient vers des fichiers
--    inexistants (A/A01.mp3…). On efface ces chemins fantômes.
-- ---------------------------------------------------------------------------
update etapes set fichier = null, duree_sec = null
where fichier is not null and duree_sec is null;

-- ---------------------------------------------------------------------------
-- 3. Le contenu
-- ---------------------------------------------------------------------------
insert into etapes (parcours_code, numero, titre, duree_min) values
  -- Cure 1 mois
  ('A',  1, 'Introduction — Bienvenue dans votre transformation',              8),
  ('A',  2, 'Semaine 1 — Phase d''attaque : relancer la machine',             10),
  ('A',  3, 'Semaine 2 — Réintégrer avec intelligence',                       11),
  ('A',  4, 'Semaine 3 — Intégrer les féculents le soir : apaisement & équilibre', 8),
  ('A',  5, 'Semaine 4 — L''équilibre à vie',                                  8),
  ('A',  6, 'Fin de cure — L''équilibre à vie',                                5),

  -- Cure 3 mois
  ('B',  1, 'Introduction — Bienvenue dans votre transformation',              7),
  ('B',  2, 'Semaine 1 — Phase d''attaque : relancer la machine',             12),
  ('B',  3, 'Semaine 2 — Réintégrer avec intelligence',                        7),
  ('B',  4, 'Semaine 3 — Intégrer les féculents le soir : apaisement & équilibre', 7),
  ('B',  5, 'Semaine 4 — L''équilibre à vie',                                  5),
  ('B',  6, 'Semaine 5 — Gérer les écarts sans culpabilité',                   8),
  ('B',  7, 'Semaine 6 — Les familles d''aliments : comprendre pour choisir',  11),
  ('B',  8, 'Semaine 7 — Les 3 piliers : alimentation, hydratation, sommeil',   8),
  ('B',  9, 'Semaine 8 — Organisation alimentaire : liberté mentale',           5),
  ('B', 10, 'Semaine 9 — Glycémie, indice glycémique et perte de poids',        9),
  ('B', 11, 'Semaine 10 — Microbiote et digestion',                             7),
  ('B', 12, 'Semaine 11 — Élimination et surcharge toxique',                    6),
  ('B', 13, 'Semaine 12 — Stabiliser sans régresser',                           5),

  -- Cure 6 mois
  ('C',  1, 'Introduction — Bienvenue dans votre transformation',              15),
  ('C',  2, 'Semaine 1 — Phase d''attaque : relancer la machine',             12),
  ('C',  3, 'Semaine 2 — Réintégrer avec intelligence',                        8),
  ('C',  4, 'Semaine 3 — Intégrer les féculents le soir : apaisement & équilibre', 5),
  ('C',  5, 'Semaine 4 — L''équilibre à vie',                                  5),
  ('C',  6, 'Semaine 5 — Gérer les écarts sans culpabilité',                   8),
  ('C',  7, 'Semaine 6 — Les familles d''aliments : comprendre pour choisir',  11),
  ('C',  8, 'Semaine 7 — Les 3 piliers : alimentation, hydratation, sommeil',   8),
  ('C',  9, 'Semaine 8 — Organisation alimentaire : liberté mentale',           5),
  ('C', 10, 'Semaine 9 — Glycémie, indice glycémique et perte de poids',        9),
  ('C', 11, 'Semaine 10 — Microbiote et digestion',                             7),
  ('C', 12, 'Semaine 11 — Élimination et surcharge toxique',                    6),
  ('C', 13, 'Semaine 12 — Inflammation : l''ennemie silencieuse',              10),
  ('C', 14, 'Semaine 13 — Vitamines et inflammation : le duo essentiel',        7),
  ('C', 15, 'Semaine 14 — Minéraux : énergie, métabolisme, équilibre',          7),
  ('C', 16, 'Semaine 15 — Lipides : faire la paix avec les bonnes graisses',    6),
  ('C', 17, 'Semaine 16 — Densité nutritionnelle : nourrir au lieu de remplir', 5),
  ('C', 18, 'Semaine 17 — Alimentation anti-fatigue : se booster naturellement', 7),
  ('C', 19, 'Semaine 18 — Additifs et produits lights : les dangers cachés',    6),
  ('C', 20, 'Semaine 19 — Nutrition et hormones : tout est lié',                7),
  ('C', 21, 'Semaine 20 — L''assiette influence l''humeur',                     5),
  ('C', 22, 'Semaine 21 — L''humeur influence l''assiette',                     6),
  ('C', 23, 'Semaine 22 — Intuition alimentaire : se reconnecter à soi',        4),
  ('C', 24, 'Podcast 23 — Alimentation libre et durable : sortir des cases',    4)
on conflict (parcours_code, numero) do update
  set titre = excluded.titre,
      duree_min = excluded.duree_min,
      updated_at = now();

-- Les six sous-titres de démonstration ne correspondent plus aux vrais titres.
update etapes set sous_titre = null where parcours_code = 'A';

-- ---------------------------------------------------------------------------
-- 4. L'épisode manquant
--    Le fichier « 3 - 3.mp3 » de la cure 3 mois n'existe pas. Une étape sans
--    audio bloquerait définitivement la progression : personne ne pourrait la
--    terminer, donc personne n'atteindrait la suivante. On la met de côté.
--    Dès que le fichier est retrouvé : repasser actif à true, puis le déposer.
-- ---------------------------------------------------------------------------
update etapes set actif = false where parcours_code = 'B' and numero = 4;

-- ---------------------------------------------------------------------------
-- Vérification
-- ---------------------------------------------------------------------------
select p.code, p.nom_commercial,
       count(*) filter (where e.actif) as etapes_actives,
       count(*) filter (where not e.actif) as en_attente
from parcours p left join etapes e on e.parcours_code = p.code
group by p.code, p.nom_commercial order by p.code;
