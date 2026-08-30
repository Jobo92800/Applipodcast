/*
  Espace thérapeute. Toutes les actions passent par ici.
  POST { action, ... } avec l'en-tête x-mbp-code.

  Le code est un garde-fou, pas une authentification forte : protège aussi
  /admin par le mot de passe de site Netlify.
*/
import {
  json, configManquante, corpsJson, db, ADMIN_CODE, APPAREILS_MAX,
  nouveauJeton, normaliserTel, lienCliente, envoyerSms, urlEnvoi,
  journaliser, ipDe,
} from '../lib/core.js';

const ok = (donnees) => json(200, { ok: true, ...donnees });

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
            jeton: c.jeton,
            prenom: c.prenom,
            nom: c.nom,
            telephone: c.telephone,
            centre: c.centre,
            parcoursCode: c.parcours_code,
            parcoursNom: c.parcours?.nom_commercial || c.parcours_code,
            statut: c.statut,
            terminees: (c.progression || []).filter((p) => p.terminee).length,
            total: totaux[c.parcours_code] || 0,
            appareils: (c.appareils || []).length,
            appareilsMax: APPAREILS_MAX,
            derniereActivite: c.derniere_activite,
            lien: lienCliente(c),
          })),
        });
      }

      case 'creer': {
        const prenom = (corps.prenom || '').trim();
        const tel = normaliserTel(corps.telephone);
        if (!prenom) return json(400, { erreur: 'prenom-requis' });
        if (!tel) return json(400, { erreur: 'numero-invalide' });

        const parcoursCode = (corps.parcours || 'A').toUpperCase();
        const parcours = await db.un('parcours', `select=code&code=eq.${parcoursCode}`);
        if (!parcours) return json(400, { erreur: 'parcours-inconnu' });

        const actuelle = await db.un(
          'clientes',
          `select=id,prenom&telephone=eq.${encodeURIComponent(tel)}&statut=eq.actif`
        );
        if (actuelle && !corps.remplacer) {
          return json(409, { erreur: 'numero-deja-actif', prenom: actuelle.prenom });
        }
        if (actuelle) {
          await db.majSur('clientes', `id=eq.${actuelle.id}`, { statut: 'suspendu' });
        }

        const [cliente] = await db.creer('clientes', {
          jeton: nouveauJeton(),
          prenom,
          nom: (corps.nom || '').trim() || null,
          telephone: tel,
          centre: corps.centre || null,
          parcours_code: parcoursCode,
        });

        const lien = lienCliente(cliente);
        let sms = { envoye: false };
        if (corps.envoyerSms !== false) {
          sms = await envoyerSms(
            tel,
            `Bonjour ${prenom}, voici votre parcours audio MAbeautyplus : ${lien}`
          );
        }
        await journaliser('cliente-creee', { clienteId: cliente.id, ip: ipDe(req) });
        return ok({ cliente: { id: cliente.id, prenom, lien }, sms });
      }

      case 'modifier': {
        const id = corps.id;
        if (!id) return json(400, { erreur: 'id-requis' });
        const champs = {};

        if (corps.statut) champs.statut = corps.statut === 'actif' ? 'actif' : 'suspendu';
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
        // Débloque manuellement l'étape suivante, sans passer par l'écoute.
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

      case 'renvoyer-lien': {
        const cliente = await db.un('clientes', `select=*&id=eq.${corps.id}`);
        if (!cliente) return json(404, { erreur: 'cliente-inconnue' });
        const sms = await envoyerSms(
          cliente.telephone,
          `Bonjour ${cliente.prenom}, voici votre parcours audio MAbeautyplus : ${lienCliente(cliente)}`
        );
        return ok({ sms });
      }

      /* --------------------------------------------------------- étapes --- */
      case 'parcours': {
        const parcours = await db.lire('parcours', 'select=*&order=ordre.asc');
        const etapes = await db.lire(
          'etapes',
          'select=*&order=parcours_code.asc,numero.asc'
        );
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

      case 'url-envoi': {
        // Renvoie une adresse temporaire pour déposer un MP3 dans le bucket privé.
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
