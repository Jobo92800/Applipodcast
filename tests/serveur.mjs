/*
  Banc d'essai local. Exécute les vraies fonctions Netlify en simulant
  l'API REST de Supabase et son stockage. Sert à vérifier la logique
  avant tout déploiement — ce n'est pas du code de production.
*/
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const RACINE = new URL('..', import.meta.url).pathname;
const FAUX = 'http://fauxsupabase.local';

process.env.SUPABASE_URL = FAUX;
process.env.SUPABASE_SERVICE_ROLE_KEY = 'cle-de-service-test';
process.env.ADMIN_CODE = 'test-2026';
process.env.SITE_URL = 'http://localhost:8123';

/* ------------------------------------------------- base simulée --- */
export const tables = {
  parcours: [
    { code: 'A', nom_commercial: 'Parcours A', ordre: 1, actif: true },
    { code: 'B', nom_commercial: 'Parcours B', ordre: 2, actif: true },
  ],
  etapes: [],
  clientes: [],
  appareils: [],
  progression: [],
  acces_log: [],
};
for (let n = 1; n <= 4; n++) {
  tables.etapes.push({
    id: 'et-A' + n, parcours_code: 'A', numero: n, titre: 'Étape A' + n,
    sous_titre: 'sous-titre', duree_min: 15, duree_sec: 900,
    fichier: `A/A0${n}.mp3`, actif: true,
  });
}
tables.etapes.push({
  id: 'et-B1', parcours_code: 'B', numero: 1, titre: 'Étape B1',
  sous_titre: '', duree_min: 10, duree_sec: 600, fichier: 'B/B01.mp3', actif: true,
});

export const journal = { emails: [], signatures: [] };

/* Comptes simulés de Supabase Auth */
export const comptes = new Map();   // jeton d'accès -> compte
export const parEmail = new Map();  // email -> compte
let seq = 0;
function nouveauCompte(email, motDePasse) {
  const c = { id: 'auth-' + (++seq), email, motDePasse: motDePasse || null };
  parEmail.set(email, c);
  return c;
}
function ouvrirSession(compte) {
  const acces = 'acc-' + compte.id + '-' + (++seq);
  comptes.set(acces, compte);
  return { access_token: acces, refresh_token: 'ref-' + compte.id, expires_in: 3600, user: compte };
}

/* ------------------------------------- PostgREST minimal simulé --- */
function filtrer(lignes, params) {
  let out = [...lignes];
  for (const [cle, val] of params) {
    if (['select', 'order', 'limit', 'on_conflict', 'offset'].includes(cle)) continue;
    const [op, ...reste] = val.split('.');
    const v = decodeURIComponent(reste.join('.'));
    out = out.filter((l) => {
      const c = l[cle];
      if (op === 'eq') return String(c) === v || (v === 'true' && c === true) || (v === 'false' && c === false);
      if (op === 'gte') return String(c) >= v;
      if (op === 'lte') return String(c) <= v;
      return true;
    });
  }
  const ordre = params.get('order');
  if (ordre) {
    const criteres = ordre.split(',').map((o) => o.split('.'));
    out.sort((a, b) => {
      for (const [col, sens] of criteres) {
        const x = a[col], y = b[col];
        if (x === y) continue;
        return ((x > y ? 1 : -1)) * (sens === 'desc' ? -1 : 1);
      }
      return 0;
    });
  }
  const limite = params.get('limit');
  return limite ? out.slice(0, Number(limite)) : out;
}

/** Ajoute les relations demandées dans select=..., version simplifiée. */
function embarquer(table, lignes, select) {
  if (!select) return lignes;
  return lignes.map((l) => {
    const copie = { ...l };
    if (table === 'clientes') {
      if (select.includes('parcours:parcours_code')) {
        copie.parcours = tables.parcours.find((p) => p.code === l.parcours_code) || null;
      }
      if (select.includes('progression(')) {
        copie.progression = tables.progression.filter((p) => p.cliente_id === l.id);
      }
      if (select.includes('appareils(')) {
        copie.appareils = tables.appareils.filter((a) => a.cliente_id === l.id);
      }
    }
    return copie;
  });
}

function repondre(donnees, statut = 200) {
  if (statut === 204) return new Response(null, { status: 204 });
  return new Response(JSON.stringify(donnees), {
    status: statut, headers: { 'Content-Type': 'application/json' },
  });
}

// Postgres applique les DEFAULT des colonnes ; on les reproduit ici.
const DEFAUTS = {
  clientes: { statut: 'actif', debloque_manuel: 0, vu: false, derniere_activite: null, nom: null, centre: null, telephone: null, auth_user_id: null },
  progression: { couverture: '', position_sec: 0, taux: 0, terminee: false },
  etapes: { actif: true, duree_min: 15, duree_sec: null, fichier: null },
  appareils: { derniere_vue: new Date().toISOString() },
};

const vraiFetch = globalThis.fetch;
globalThis.fetch = async (url, options = {}) => {
  const u = String(url);
  if (!u.startsWith(FAUX)) {
    return vraiFetch(url, options);
  }

  const apres = u.slice(FAUX.length);

  /* ---- Supabase Auth ---- */
  if (apres.startsWith('/auth/v1/')) {
    const corps = options.body ? JSON.parse(options.body) : {};
    const jeton = (options.headers?.Authorization || '').replace('Bearer ', '');
    const chemin = apres.split('?')[0];

    if (chemin === '/auth/v1/user' && (options.method || 'GET') === 'GET') {
      const c = comptes.get(jeton);
      return c ? repondre(c) : repondre({ msg: 'invalid token' }, 401);
    }
    if (chemin === '/auth/v1/user' && options.method === 'PUT') {
      const c = comptes.get(jeton);
      if (!c) return repondre({ msg: 'invalid token' }, 401);
      if ((corps.password || '').length < 8) return repondre({ msg: 'weak password' }, 422);
      c.motDePasse = corps.password;
      return repondre(c);
    }
    if (chemin === '/auth/v1/token' && apres.includes('grant_type=password')) {
      const c = parEmail.get(corps.email);
      if (!c || !c.motDePasse || c.motDePasse !== corps.password) {
        return repondre({ error: 'invalid_grant' }, 400);
      }
      return repondre(ouvrirSession(c));
    }
    if (chemin === '/auth/v1/token' && apres.includes('grant_type=refresh_token')) {
      const c = [...parEmail.values()].find((x) => 'ref-' + x.id === corps.refresh_token);
      return c ? repondre(ouvrirSession(c)) : repondre({ error: 'invalid_grant' }, 400);
    }
    if (chemin === '/auth/v1/invite') {
      if (parEmail.has(corps.email)) {
        return repondre({ msg: 'A user with this email address has already been registered' }, 422);
      }
      const c = nouveauCompte(corps.email);
      const s = ouvrirSession(c);
      journal.emails.push({ type: 'invite', email: corps.email, acces: s.access_token });
      return repondre(c);
    }
    // Création directe avec mot de passe : le compte est utilisable aussitôt.
    if (chemin === '/auth/v1/admin/users' && options.method === 'POST') {
      if (parEmail.has(corps.email)) {
        return repondre({ msg: 'A user with this email address has already been registered' }, 422);
      }
      const c = nouveauCompte(corps.email);
      c.motDePasse = corps.password;
      journal.emails.push({ type: 'creation-directe', email: corps.email });
      return repondre(c);
    }
    // Redéfinition du mot de passe d'un compte existant.
    if (chemin.startsWith('/auth/v1/admin/users/') && options.method === 'PUT') {
      const id = chemin.split('/').pop();
      const c = [...parEmail.values()].find((x) => x.id === id);
      if (!c) return repondre({ msg: 'not found' }, 404);
      c.motDePasse = corps.password;
      return repondre(c);
    }
    if (chemin === '/auth/v1/recover') {
      const c = parEmail.get(corps.email);
      if (c) {
        const s = ouvrirSession(c);
        journal.emails.push({ type: 'recovery', email: corps.email, acces: s.access_token });
      }
      return repondre({});
    }
    return repondre({ msg: 'auth non simulé : ' + chemin }, 404);
  }

  if (apres.startsWith('/storage/v1/object/sign/')) {
    const chemin = apres.replace('/storage/v1/object/sign/parcours-audio/', '');
    journal.signatures.push(chemin);
    return repondre({ signedURL: `/object/sign/parcours-audio/${chemin}?token=faux` });
  }
  if (apres.startsWith('/storage/v1/object/upload/sign/')) {
    const chemin = apres.replace('/storage/v1/object/upload/sign/parcours-audio/', '');
    return repondre({ url: `/object/upload/sign/parcours-audio/${chemin}?token=faux` });
  }

  const [chemin, requete = ''] = apres.replace('/rest/v1/', '').split('?');
  const table = chemin;
  const params = new URLSearchParams(requete);
  if (!tables[table]) return repondre({ message: 'table inconnue ' + table }, 404);
  const methode = (options.method || 'GET').toUpperCase();
  const corps = options.body ? JSON.parse(options.body) : null;

  if (methode === 'GET') {
    return repondre(embarquer(table, filtrer(tables[table], params), params.get('select')));
  }
  if (methode === 'POST') {
    const entrees = Array.isArray(corps) ? corps : [corps];
    const prefer = options.headers?.Prefer || '';
    const creees = entrees.map((e) => {
      const ligne = { id: e.id || randomUUID(), created_at: new Date().toISOString(), ...(DEFAUTS[table] || {}), ...e };
      if (prefer.includes('merge-duplicates')) {
        const cles = (params.get('on_conflict') || '').split(',').filter(Boolean);
        const idx = tables[table].findIndex((l) => cles.every((k) => String(l[k]) === String(e[k])));
        if (idx >= 0) { tables[table][idx] = { ...tables[table][idx], ...e }; return tables[table][idx]; }
      }
      tables[table].push(ligne);
      return ligne;
    });
    return repondre(creees, 201);
  }
  if (methode === 'PATCH') {
    const cibles = filtrer(tables[table], params);
    cibles.forEach((l) => Object.assign(l, corps));
    return repondre(cibles);
  }
  if (methode === 'DELETE') {
    const cibles = new Set(filtrer(tables[table], params));
    tables[table] = tables[table].filter((l) => !cibles.has(l));
    return repondre(null, 204);
  }
  return repondre({ message: 'méthode non gérée' }, 400);
};

/* ------------------------------------------- serveur de test --- */
const FONCTIONS = {};
for (const nom of ['parcours', 'audio', 'progression', 'session', 'admin']) {
  FONCTIONS[nom] = (await import(`${RACINE}/netlify/functions/${nom}.js`)).default;
}

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
};

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');

  if (url.pathname === '/__emails') {
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(journal.emails));
    return;
  }

  if (url.pathname.startsWith('/api/')) {
    const nom = url.pathname.slice(5);
    const fn = FONCTIONS[nom];
    if (!fn) { res.writeHead(404).end('inconnue'); return; }
    const morceaux = [];
    for await (const m of req) morceaux.push(m);
    const requete = new Request('http://localhost' + req.url, {
      method: req.method,
      headers: req.headers,
      body: morceaux.length ? Buffer.concat(morceaux) : undefined,
    });
    try {
      const rep = await fn(requete);
      const texte = await rep.text();
      res.writeHead(rep.status, { 'Content-Type': 'application/json' }).end(texte);
    } catch (e) {
      console.error('ERREUR FONCTION', nom, e);
      res.writeHead(500).end(JSON.stringify({ erreur: e.message }));
    }
    return;
  }

  // Liens personnels /prenom/jeton et /admin
  let fichier = url.pathname;
  if (fichier === '/admin') fichier = '/admin.html';
  else if (fichier === '/') fichier = '/index.html';
  const complet = path.join(RACINE, fichier);
  if (!fs.existsSync(complet) || fs.statSync(complet).isDirectory()) {
    res.writeHead(404).end('introuvable');
    return;
  }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(complet)] || 'application/octet-stream' });
  res.end(fs.readFileSync(complet));
}).listen(8123, () => console.log('banc prêt sur 8123'));
