/*
  Enregistrement de la progression d'écoute.
  POST { jeton, appareil, numero, couverture, position, duree } -> { taux, terminee }

  Point important : le navigateur envoie le bitset des secondes écoutées, jamais
  le verdict. C'est le serveur qui compte les bits et décide si l'étape est
  validée. Une requête forgée annonçant « terminée » n'a donc aucun effet.

  La durée de référence est celle enregistrée sur l'étape. Tant qu'elle est
  inconnue, on retient celle du navigateur et on la fige pour les envois suivants.
*/
import {
  json, configManquante, corpsJson, db, clienteParSession,
  tauxCouverture, SEUIL,
} from '../lib/core.js';

export default async (req) => {
  if (req.method !== 'POST') return json(405, { erreur: 'Méthode non autorisée.' });
  const manque = configManquante();
  if (manque) return manque;

  const corps = await corpsJson(req);
  if (!corps) return json(400, { erreur: 'Requête invalide.' });

  const numero = Number(corps.numero);
  const couverture = typeof corps.couverture === 'string' ? corps.couverture.slice(0, 8000) : '';
  const position = Math.max(0, Math.floor(Number(corps.position) || 0));
  const dureeClient = Math.floor(Number(corps.duree) || 0);

  if (!Number.isInteger(numero) || numero < 1) return json(400, { erreur: 'Étape inconnue.' });

  try {
    const { cliente, erreur, statut } = await clienteParSession(req, corps.appareil, corps.acces);
    if (erreur) return json(statut, { erreur });

    const etape = await db.un(
      'etapes',
      `select=id,numero,duree_sec&parcours_code=eq.${cliente.parcours_code}&numero=eq.${numero}&actif=eq.true`
    );
    if (!etape) return json(404, { erreur: 'Étape inconnue.' });

    // Durée de référence : celle de la base, sinon celle annoncée à la première écoute.
    let duree = etape.duree_sec;
    if (!duree && dureeClient > 30 && dureeClient < 36000) {
      duree = dureeClient;
      await db.majSur('etapes', `id=eq.${etape.id}`, { duree_sec: duree });
    }
    if (!duree) return json(202, { taux: 0, terminee: false, note: 'duree-inconnue' });

    const existant = await db.un(
      'progression',
      `select=terminee&cliente_id=eq.${cliente.id}&etape_id=eq.${etape.id}`
    );
    if (existant?.terminee) {
      return json(200, { taux: 1, terminee: true, deja: true });
    }

    const taux = tauxCouverture(couverture, duree);
    const terminee = taux >= SEUIL;
    const maintenant = new Date().toISOString();

    await db.fusionner(
      'progression',
      {
        cliente_id: cliente.id,
        etape_id: etape.id,
        // Une fois l'étape validée, le détail seconde par seconde ne sert plus.
        couverture: terminee ? '' : couverture,
        position_sec: Math.min(position, duree),
        taux: Number(taux.toFixed(3)),
        terminee,
        terminee_le: terminee ? maintenant : null,
        updated_at: maintenant,
      },
      'cliente_id,etape_id'
    );

    await db.majSur('clientes', `id=eq.${cliente.id}`, { derniere_activite: maintenant });

    return json(200, { taux: Number(taux.toFixed(3)), terminee, seuil: SEUIL });
  } catch (e) {
    console.error('progression :', e.message);
    return json(500, { erreur: 'Service momentanément indisponible.' });
  }
};
