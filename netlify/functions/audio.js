/*
  URL de lecture temporaire d'une étape.
  POST { jeton, appareil, numero } -> { url, expireDans }

  Le serveur refuse toute étape qui n'est pas encore débloquée : c'est ici que
  se joue le verrou du produit. Le lien renvoyé vit 2 h et n'est pas réutilisable
  au-delà, donc il ne circule pas durablement.
*/
import {
  json, configManquante, corpsJson, db, clienteParJeton,
  urlSignee, journaliser, ipDe,
} from '../lib/core.js';

const DUREE_LIEN = 7200;

export default async (req) => {
  if (req.method !== 'POST') return json(405, { erreur: 'Méthode non autorisée.' });
  const manque = configManquante();
  if (manque) return manque;

  const corps = await corpsJson(req);
  if (!corps) return json(400, { erreur: 'Requête invalide.' });

  const numero = Number(corps.numero);
  if (!Number.isInteger(numero) || numero < 1) return json(400, { erreur: 'Étape inconnue.' });

  try {
    const { cliente, erreur, statut } = await clienteParJeton(
      corps.jeton,
      corps.appareil,
      req.headers.get('user-agent')
    );
    if (erreur) return json(statut, { erreur });

    const etapes = await db.lire(
      'etapes',
      `select=id,numero,fichier,duree_sec&parcours_code=eq.${cliente.parcours_code}&actif=eq.true&order=numero.asc`
    );
    const index = etapes.findIndex((e) => e.numero === numero);
    if (index === -1) return json(404, { erreur: 'Étape inconnue.' });

    const avancement = await db.lire(
      'progression',
      `select=etape_id,terminee&cliente_id=eq.${cliente.id}`
    );
    const terminees = new Set(avancement.filter((p) => p.terminee).map((p) => p.etape_id));

    let dispo = etapes.findIndex((e) => !terminees.has(e.id));
    if (dispo === -1) dispo = etapes.length - 1;
    dispo = Math.max(dispo, Math.min(cliente.debloque_manuel || 0, etapes.length - 1));

    if (index > dispo) {
      await journaliser('etape-verrouillee', {
        clienteId: cliente.id, ip: ipDe(req), detail: `demande ${numero}, dispo ${dispo + 1}`,
      });
      return json(403, { erreur: 'etape-verrouillee' });
    }

    const etape = etapes[index];
    if (!etape.fichier) return json(503, { erreur: 'audio-absent' });

    return json(200, {
      url: await urlSignee(etape.fichier, DUREE_LIEN),
      expireDans: DUREE_LIEN,
      dureeSec: etape.duree_sec,
    });
  } catch (e) {
    console.error('audio :', e.message);
    return json(500, { erreur: 'Service momentanément indisponible.' });
  }
};
