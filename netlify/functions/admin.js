/*
  Espace thérapeute. Toutes les actions passent par ici.
  POST { action, ... } avec l'en-tête x-mbp-code.

  Le code est un garde-fou, pas une authentification forte : protège aussi
  /admin par le mot de passe de site Netlify.
*/
import {
  json, configManquante, corpsJson, db, auth, ADMIN_CODE, APPAREILS_MAX,
  normaliserTel, urlEnvoi, urlSignee, journaliser, ipDe, SITE_URL,
} from '../lib/core.js';

const ok = (donnees) => json(200, { ok: true, ...donnees });
const nettoyerEmail = (v) => String(v || '').trim().toLowerCase();
const emailValide = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);

const MDP_MIN = 8;

/**
 * Crée le compte avec son mot de passe déjà défini et l'e-mail confirmé.
 *
 * La cliente est dans le centre au moment de la signature : lui faire faire
 * un aller-retour par sa boîte mail pendant que la thérapeute attend n'a pas
 * de sens. Le compte fonctionne immédiatement.
 */
async function creerAvecMotDePasse(email, prenom, motDePasse) {
  const r = await auth('/admin/users', {
    method: 'POST',
    body: JSON.stringify({
      email,
      password: motDePasse,
      email_confirm: true,
      user_metadata: { prenom },
    }),
  });
  if (r.ok) return { envoye: false, motDePasseDefini: true, utilisateur: r.corps };

  const message = String(r.corps?.msg || r.corps?.message || r.corps?.error_description || '');
  return { envoye: false, motDePasseDefini: false, raison: 'creation-refusee', detail: message.slice(0, 160) };
}

/** Redéfinit le mot de passe d'un compte existant. */
async function redefinirMotDePasse(userId, motDePasse) {
  const r = await auth(`/admin/users/${userId}`, {
    method: 'PUT',
    body: JSON.stringify({ password: motDePasse, email_confirm: true }),
  });
  return r.ok;
}

/** Envoie l'e-mail d'invitation qui permet de choisir son mot de passe. */
async function inviter(email, prenom) {
  const r = await auth(`/invite?redirect_to=${encodeURIComponent(SITE_URL)}`, {
    method: 'POST',
    body: JSON.stringify({ email, data: { prenom } }),
  });
  if (r.ok) return { envoye: true, utilisateur: r.corps };

  const message = String(r.corps?.msg || r.corps?.error_description || r.corps?.message || '');
  // Compte déjà existant : on bascule sur un e-mail de réinitialisation.
  if (/already been registered|already exists|User already/i.test(message)) {
    const secours = await auth(`/recover?redirect_to=${encodeURIComponent(SITE_URL)}`, {
      method: 'POST',
      body: JSON.stringify({ email }),
    });
    return { envoye: secours.ok, deja: true, raison: secours.ok ? null : 'email-refuse' };
  }
  console.error('Invitation refusée :', r.statut, message);
  return { envoye: false, raison: 'email-refuse', detail: message.slice(0, 160) };
}

export default async (req) => {
  if (req.method !== 'POST') return json(405, { erreur: 'Méthode non autorisée.' });
  const manque = configManquante();
  if (manque) return manque;

  if (!ADMIN_CODE) {
    console.error('ADMIN_CODE absent des variables Netlify.');
    return json(500, { erreur: 'Service indisponible.' });
  }
  if (req.headers.get('x-mbp-code') !== ADMIN_CODE) {
    await journaliser('admin-refuse', { ip: ipDe(req) });
    return json(401, { erreur: 'code-invalide' });
  }

  const corps = await corpsJson(req);
  if (!corps?.action) return json(400, { erreur: 'Requête invalide.' });

  try {
    switch (corps.action) {
      /* ------------------------------------------------------- clientes --- */
      case 'liste': {
        const clientes = await db.lire(
          'clientes',
          'select=*,parcours:parcours_code(nom_commercial),progression(terminee),appareils(id)&order=created_at.desc&limit=500'
        );
        const etapes = await db.lire('etapes', 'select=parcours_code&actif=eq.true');
        const totaux = etapes.reduce((acc, e) => {
          acc[e.parcours_code] = (acc[e.parcours_code] || 0) + 1;
          return acc;
        }, {});
        return ok({
          clientes: clientes.map((c) => ({
            id: c.id,
            prenom: c.prenom,
            nom: c.nom,
            email: c.email,
            telephone: c.telephone,
            centre: c.centre,
            parcoursCode: c.parcours_code,
            parcoursNom: c.parcours?.nom_commercial || c.parcours_code,
            statut: c.statut,
            compteActive: !!c.auth_user_id,
            terminees: (c.progression || []).filter((p) => p.terminee).length,
            total: totaux[c.parcours_code] || 0,
            appareils: (c.appareils || []).length,
            appareilsMax: APPAREILS_MAX,
            derniereActivite: c.derniere_activite,
          })),
          lienSite: SITE_URL.replace(/\/$/, ''),
        });
      }

      case 'creer': {
        const prenom = (corps.prenom || '').trim();
        const email = nettoyerEmail(corps.email);
        if (!prenom) return json(400, { erreur: 'prenom-requis' });
        if (!emailValide(email)) return json(400, { erreur: 'email-invalide' });

        const parcoursCode = (corps.parcours || 'A').toUpperCase();
        const parcours = await db.un('parcours', `select=code&code=eq.${parcoursCode}`);
        if (!parcours) return json(400, { erreur: 'parcours-inconnu' });

        const motDePasse = String(corps.motDePasse || '');
        if (motDePasse && motDePasse.length < MDP_MIN) {
          return json(400, { erreur: 'mot-de-passe-court' });
        }

        const existante = await db.un(
          'clientes',
          `select=id,prenom,statut,auth_user_id,parcours_code&email=${'eq.' + encodeURIComponent(email)}`
        );

        // Compte déjà là : avec un mot de passe fourni, on le redéfinit et on
        // met le parcours à jour plutôt que de refuser. C'est ce que la
        // thérapeute veut quand elle reprend une cliente au comptoir.
        if (existante) {
          if (!motDePasse) {
            return json(409, { erreur: 'email-deja-utilise', prenom: existante.prenom });
          }
          if (!existante.auth_user_id) {
            return json(409, { erreur: 'compte-sans-identifiant', prenom: existante.prenom });
          }
          const redefini = await redefinirMotDePasse(existante.auth_user_id, motDePasse);
          if (!redefini) return json(502, { erreur: 'mot-de-passe-refuse' });

          if (existante.parcours_code !== parcoursCode) {
            await db.majSur('clientes', `id=eq.${existante.id}`, { parcours_code: parcoursCode });
          }
          await journaliser('cliente-mdp-redefini', { clienteId: existante.id, ip: ipDe(req) });
          return ok({
            cliente: { id: existante.id, prenom: existante.prenom, email },
            invitation: { envoye: false, motDePasseDefini: true },
            existante: true,
          });
        }

        const invitation = motDePasse
          ? await creerAvecMotDePasse(email, prenom, motDePasse)
          : await inviter(email, prenom);

        if (motDePasse && !invitation.motDePasseDefini) {
          return json(502, { erreur: 'creation-refusee', detail: invitation.detail });
        }

        const [cliente] = await db.creer('clientes', {
          prenom,
          nom: (corps.nom || '').trim() || null,
          email,
          telephone: normaliserTel(corps.telephone),
          centre: corps.centre || null,
          parcours_code: parcoursCode,
          auth_user_id: invitation.utilisateur?.id || null,
        });

        await journaliser('cliente-creee', { clienteId: cliente.id, ip: ipDe(req), detail: email });
        return ok({ cliente: { id: cliente.id, prenom, email }, invitation });
      }

      case 'renvoyer-invitation': {
        const cliente = await db.un('clientes', `select=*&id=eq.${corps.id}`);
        if (!cliente) return json(404, { erreur: 'cliente-inconnue' });
        const invitation = await inviter(cliente.email, cliente.prenom);
        if (invitation.utilisateur?.id && !cliente.auth_user_id) {
          await db.majSur('clientes', `id=eq.${cliente.id}`, {
            auth_user_id: invitation.utilisateur.id,
          });
        }
        await journaliser('invitation-renvoyee', { clienteId: cliente.id, ip: ipDe(req) });
        return ok({ invitation });
      }

      case 'modifier': {
        const id = corps.id;
        if (!id) return json(400, { erreur: 'id-requis' });
        const champs = {};

        if (corps.statut) champs.statut = corps.statut === 'actif' ? 'actif' : 'suspendu';
        if (corps.telephone !== undefined) champs.telephone = normaliserTel(corps.telephone);
        if (corps.debloqueManuel != null) {
          champs.debloque_manuel = Math.max(0, Math.floor(Number(corps.debloqueManuel)));
        }
        if (corps.parcours) {
          champs.parcours_code = String(corps.parcours).toUpperCase();
          champs.debloque_manuel = 0;
          await db.supprimer('progression', `cliente_id=eq.${id}`);
        }
        if (Object.keys(champs).length) await db.majSur('clientes', `id=eq.${id}`, champs);
        if (corps.reinitialiserAppareils) await db.supprimer('appareils', `cliente_id=eq.${id}`);

        await journaliser('cliente-modifiee', { clienteId: id, ip: ipDe(req) });
        return ok({});
      }

      case 'valider-etape': {
        const cliente = await db.un('clientes', `select=*&id=eq.${corps.id}`);
        if (!cliente) return json(404, { erreur: 'cliente-inconnue' });

        const etapes = await db.lire(
          'etapes',
          `select=id,numero&parcours_code=eq.${cliente.parcours_code}&actif=eq.true&order=numero.asc`
        );
        const avancement = await db.lire(
          'progression',
          `select=etape_id,terminee&cliente_id=eq.${cliente.id}`
        );
        const terminees = new Set(avancement.filter((p) => p.terminee).map((p) => p.etape_id));
        const etape = etapes.find((e) => !terminees.has(e.id));
        if (!etape) return ok({ note: 'parcours-termine' });

        await db.fusionner(
          'progression',
          {
            cliente_id: cliente.id,
            etape_id: etape.id,
            couverture: '',
            taux: 1,
            terminee: true,
            terminee_le: new Date().toISOString(),
          },
          'cliente_id,etape_id'
        );
        await journaliser('etape-validee-main', {
          clienteId: cliente.id, ip: ipDe(req), detail: `etape ${etape.numero}`,
        });
        return ok({ numero: etape.numero });
      }

      /* --------------------------------------------------------- étapes --- */
      case 'parcours': {
        const parcours = await db.lire('parcours', 'select=*&order=ordre.asc');
        const etapes = await db.lire('etapes', 'select=*&order=parcours_code.asc,numero.asc');
        return ok({ parcours, etapes });
      }

      case 'etape-maj': {
        const champs = {};
        for (const [cle, colonne] of [
          ['titre', 'titre'], ['sousTitre', 'sous_titre'],
          ['dureeMin', 'duree_min'], ['fichier', 'fichier'], ['actif', 'actif'],
        ]) {
          if (corps[cle] !== undefined) champs[colonne] = corps[cle];
        }
        if (corps.dureeSec !== undefined) {
          champs.duree_sec = Math.floor(Number(corps.dureeSec)) || null;
        }
        if (corps.id) {
          await db.majSur('etapes', `id=eq.${corps.id}`, champs);
          return ok({});
        }
        if (!corps.parcours || !corps.numero) return json(400, { erreur: 'etape-incomplete' });
        const [etape] = await db.fusionner(
          'etapes',
          {
            parcours_code: String(corps.parcours).toUpperCase(),
            numero: Math.floor(Number(corps.numero)),
            titre: corps.titre || 'Nouvelle étape',
            ...champs,
          },
          'parcours_code,numero'
        );
        return ok({ etape });
      }

      /* Écoute de contrôle depuis l'espace thérapeute : même URL signée que
         pour une cliente, mais sans condition de déblocage. */
      case 'ecouter': {
        const etape = await db.un('etapes', `select=id,titre,fichier&id=eq.${corps.id}`);
        if (!etape) return json(404, { erreur: 'etape-inconnue' });
        if (!etape.fichier) return json(404, { erreur: 'audio-absent' });
        return ok({ url: await urlSignee(etape.fichier, 3600), titre: etape.titre });
      }

      case 'url-envoi': {
        const chemin = String(corps.chemin || '').replace(/[^A-Za-z0-9/._-]/g, '');
        if (!/^[A-C]\/[A-Za-z0-9._-]+\.(mp3|m4a|aac|wav)$/i.test(chemin)) {
          return json(400, { erreur: 'chemin-invalide' });
        }
        return ok({ url: await urlEnvoi(chemin), chemin });
      }

      default:
        return json(400, { erreur: 'action-inconnue' });
    }
  } catch (e) {
    console.error('admin :', e.message);
    return json(500, { erreur: 'Service momentanément indisponible.' });
  }
};
