/*
  Session de la cliente : connexion, rafraîchissement, mot de passe.
  POST { action, ... }

  Le navigateur ne parle jamais directement à Supabase. Tout passe par ici,
  ce qui permet de limiter les tentatives, d'écrire les messages en français
  et de ne jamais exposer la moindre clé.
*/
import {
  json, configManquante, corpsJson, auth, db,
  journaliser, ipDe, tropDAppels, SITE_URL,
} from '../lib/core.js';

const nettoyerEmail = (v) => String(v || '').trim().toLowerCase();

/** Ce que le navigateur reçoit après une connexion réussie. */
function session(corps) {
  return {
    acces: corps.access_token,
    rafraichissement: corps.refresh_token,
    expireDans: corps.expires_in,
  };
}

export default async (req) => {
  if (req.method !== 'POST') return json(405, { erreur: 'Méthode non autorisée.' });
  const manque = configManquante();
  if (manque) return manque;

  const corps = await corpsJson(req);
  if (!corps?.action) return json(400, { erreur: 'Requête invalide.' });

  const ip = ipDe(req);

  try {
    switch (corps.action) {
      /* ------------------------------------------------------ connexion --- */
      case 'connexion': {
        if (await tropDAppels(ip, 'connexion', 10, 300)) {
          return json(429, { erreur: 'trop-de-tentatives' });
        }
        const email = nettoyerEmail(corps.email);
        const motDePasse = String(corps.motDePasse || '');
        if (!email || !motDePasse) return json(400, { erreur: 'champs-manquants' });

        await journaliser('connexion', { ip, detail: email });

        const r = await auth('/token?grant_type=password', {
          method: 'POST',
          body: JSON.stringify({ email, password: motDePasse }),
        });
        if (!r.ok) return json(401, { erreur: 'identifiants-invalides' });

        // Un compte peut exister sans parcours attribué : on le dit clairement.
        const utilisateur = r.corps.user;
        const cliente = await db.un(
          'clientes',
          `select=id,statut&auth_user_id=eq.${utilisateur.id}`
        );
        if (!cliente) {
          const parEmail = await db.un(
            'clientes',
            `select=id,statut&email=eq.${encodeURIComponent(email)}`
          );
          // Rattrapage : le compte a été créé avant d'être relié à la fiche.
          if (parEmail) {
            await db.majSur('clientes', `id=eq.${parEmail.id}`, { auth_user_id: utilisateur.id });
          } else {
            return json(403, { erreur: 'compte-sans-parcours' });
          }
        }
        return json(200, session(r.corps));
      }

      /* ------------------------------------------------- rafraîchissement --- */
      case 'rafraichir': {
        if (!corps.rafraichissement) return json(400, { erreur: 'champs-manquants' });
        const r = await auth('/token?grant_type=refresh_token', {
          method: 'POST',
          body: JSON.stringify({ refresh_token: corps.rafraichissement }),
        });
        if (!r.ok) return json(401, { erreur: 'session-expiree' });
        return json(200, session(r.corps));
      }

      /* ---------------------------------------------- mot de passe oublié --- */
      case 'oubli': {
        if (await tropDAppels(ip, 'oubli', 5, 600)) {
          return json(429, { erreur: 'trop-de-tentatives' });
        }
        const email = nettoyerEmail(corps.email);
        if (!email) return json(400, { erreur: 'champs-manquants' });
        await journaliser('oubli', { ip, detail: email });

        await auth(`/recover?redirect_to=${encodeURIComponent(SITE_URL)}`, {
          method: 'POST',
          body: JSON.stringify({ email }),
        });
        // Réponse identique que l'adresse existe ou non : on ne révèle jamais
        // qui est cliente du centre.
        return json(200, { ok: true });
      }

      /* --------------------------------------------- choisir un mot de passe --- */
      case 'definir': {
        const motDePasse = String(corps.motDePasse || '');
        if (motDePasse.length < 8) return json(400, { erreur: 'mot-de-passe-court' });
        if (!corps.acces) return json(401, { erreur: 'session-expiree' });

        const r = await auth('/user', {
          method: 'PUT',
          jetonUtilisateur: corps.acces,
          body: JSON.stringify({ password: motDePasse }),
        });
        if (!r.ok) {
          const message = String(r.corps?.msg || r.corps?.error_description || '');
          if (/weak|password/i.test(message)) return json(400, { erreur: 'mot-de-passe-faible' });
          return json(401, { erreur: 'lien-expire' });
        }

        // Première connexion : on relie le compte à sa fiche si ce n'est pas fait.
        const utilisateur = r.corps;
        if (utilisateur?.id && utilisateur?.email) {
          const cliente = await db.un(
            'clientes',
            `select=id,auth_user_id&email=eq.${encodeURIComponent(utilisateur.email.toLowerCase())}`
          );
          if (cliente && !cliente.auth_user_id) {
            await db.majSur('clientes', `id=eq.${cliente.id}`, { auth_user_id: utilisateur.id });
          }
        }
        return json(200, { ok: true });
      }

      default:
        return json(400, { erreur: 'action-inconnue' });
    }
  } catch (e) {
    console.error('session :', e.message);
    return json(500, { erreur: 'Service momentanément indisponible.' });
  }
};
