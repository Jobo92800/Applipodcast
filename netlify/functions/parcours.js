/*
  Ouverture du parcours par lien personnel.
  POST { jeton, appareil } -> état complet du parcours de la cliente.

  Les titres des étapes verrouillées ne sont jamais envoyés au navigateur :
  ce qui n'est pas encore débloqué n'existe pas côté client.
*/
import {
  json, configManquante, corpsJson, db, clienteParJeton,
  tauxCouverture, journaliser, ipDe, SEUIL,
} from '../lib/core.js';

export default async (req) => {
  if (req.method !== 'POST') return json(405, { erreur: 'Méthode non autorisée.' });
  const manque = configManquante();
  if (manque) return manque;

  const corps = await corpsJson(req);
  if (!corps) return json(400, { erreur: 'Requête invalide.' });

  try {
    const { cliente, erreur, statut } = await clienteParJeton(
      corps.jeton,
      corps.appareil,
      req.headers.get('user-agent')
    );
    if (erreur) {
      await journaliser(erreur, { ip: ipDe(req), detail: String(corps.jeton || '').slice(0, 40) });
      return json(statut, { erreur });
    }

    const etapes = await db.lire(
      'etapes',
      `select=id,numero,titre,sous_titre,duree_min,duree_sec&parcours_code=eq.${cliente.parcours_code}&actif=eq.true&order=numero.asc`
    );
    if (!etapes.length) return json(503, { erreur: 'parcours-vide' });

    const avancement = await db.lire(
      'progression',
      `select=etape_id,position_sec,taux,terminee,couverture&cliente_id=eq.${cliente.id}`
    );
    const parEtape = Object.fromEntries(avancement.map((p) => [p.etape_id, p]));

    // Première étape non terminée, jamais avant celle forcée par la thérapeute.
    let dispo = etapes.findIndex((e) => !parEtape[e.id]?.terminee);
    if (dispo === -1) dispo = etapes.length - 1;
    dispo = Math.max(dispo, Math.min(cliente.debloque_manuel || 0, etapes.length - 1));

    const liste = etapes.map((e, i) => {
      const p = parEtape[e.id] || {};
      const base = {
        numero: e.numero,
        terminee: !!p.terminee,
        accessible: i <= dispo,
      };
      if (i > dispo) return base;              // étape verrouillée : rien de plus
      return {
        ...base,
        titre: e.titre,
        sousTitre: e.sous_titre,
        dureeMin: e.duree_min,
        dureeSec: e.duree_sec,
        position: p.position_sec || 0,
        taux: Number(p.taux || 0),
        // Bitset des secondes déjà écoutées : permet de reprendre le décompte
        // sur un autre appareil sans repartir de zéro.
        couverture: p.terminee ? '' : (p.couverture || ''),
      };
    });

    // L'écran de bienvenue ne s'affiche qu'à la toute première ouverture :
    // on renvoie la valeur d'origine puis on la bascule côté serveur.
    const premiereFois = !cliente.vu;
    await db.majSur('clientes', `id=eq.${cliente.id}`, {
      derniere_activite: new Date().toISOString(),
      ...(premiereFois ? { vu: true } : {}),
    });

    return json(200, {
      cliente: {
        prenom: cliente.prenom,
        nom: cliente.nom,
        parcours: cliente.parcours?.nom_commercial || cliente.parcours_code,
        vu: !premiereFois,
      },
      etapes: liste,
      total: etapes.length,
      terminees: liste.filter((e) => e.terminee).length,
      disponible: dispo,
      seuil: SEUIL,
    });
  } catch (e) {
    console.error('parcours :', e.message);
    return json(500, { erreur: 'Service momentanément indisponible.' });
  }
};
