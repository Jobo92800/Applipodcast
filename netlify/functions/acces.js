/*
  Identification par numéro de téléphone, porte de secours quand la cliente
  a perdu son lien.

  POST { telephone, appareil } ->
    { mode: 'direct', jeton }  si cet appareil est déjà associé à ce numéro
    { mode: 'sms' }            sinon : le lien part sur le téléphone de la cliente

  Ce second cas est la sécurité : quelqu'un qui saisirait le numéro d'une autre
  cliente ne verrait rien, le SMS partant chez la vraie titulaire de la ligne.
  La réponse est volontairement identique lorsque le numéro est inconnu, pour ne
  pas révéler qui est cliente du centre.
*/
import {
  json, configManquante, corpsJson, db, normaliserTel, envoyerSms,
  lienCliente, journaliser, ipDe, tropDAppels, APPAREILS_MAX,
} from '../lib/core.js';

export default async (req) => {
  if (req.method !== 'POST') return json(405, { erreur: 'Méthode non autorisée.' });
  const manque = configManquante();
  if (manque) return manque;

  const corps = await corpsJson(req);
  if (!corps) return json(400, { erreur: 'Requête invalide.' });

  const ip = ipDe(req);
  if (await tropDAppels(ip, 'acces-tel', 8, 300)) {
    return json(429, { erreur: 'trop-de-tentatives' });
  }

  const tel = normaliserTel(corps.telephone);
  if (!tel) return json(400, { erreur: 'numero-invalide' });

  try {
    await journaliser('acces-tel', { ip, detail: tel.slice(-4) });

    const cliente = await db.un(
      'clientes',
      `select=id,jeton,prenom&telephone=eq.${encodeURIComponent(tel)}&statut=eq.actif`
    );

    // Numéro inconnu : même réponse que le cas nominal, aucune information révélée.
    if (!cliente) return json(200, { mode: 'sms' });

    const empreinte = corps.appareil;
    if (empreinte) {
      const connu = await db.un(
        'appareils',
        `select=id&cliente_id=eq.${cliente.id}&empreinte=eq.${encodeURIComponent(empreinte)}`
      );
      if (connu) {
        await db.majSur('appareils', `id=eq.${connu.id}`, {
          derniere_vue: new Date().toISOString(),
        });
        await journaliser('acces-tel-direct', { clienteId: cliente.id, ip });
        return json(200, { mode: 'direct', jeton: cliente.jeton });
      }
    }

    const lien = lienCliente(cliente);
    await envoyerSms(
      tel,
      `Bonjour ${cliente.prenom}, voici l'acces a votre parcours audio MAbeautyplus : ${lien}`
    );
    await journaliser('acces-tel-sms', { clienteId: cliente.id, ip });

    return json(200, { mode: 'sms' });
  } catch (e) {
    console.error('acces :', e.message);
    return json(500, { erreur: 'Service momentanément indisponible.' });
  }
};
