/*
  MON PARCOURS by MAbeautyplus — bibliothèque partagée des fonctions Netlify.

  On appelle l'API REST de Supabase directement plutôt que @supabase/supabase-js :
  son client temps réel exige des WebSockets natifs, absents de l'environnement
  Node de Netlify. Même constat que dans l'app nutrition.
*/

export const SUPABASE_URL = process.env.SUPABASE_URL;
export const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
export const ADMIN_CODE = process.env.ADMIN_CODE;
export const SITE_URL = process.env.SITE_URL || 'https://monparcours.mabeautyplus.fr';
export const SEUIL = Number(process.env.SEUIL_DEBLOCAGE || 0.9);
export const APPAREILS_MAX = Number(process.env.APPAREILS_MAX || 2);
export const BUCKET = 'parcours-audio';

export const json = (status, payload) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

export function configManquante() {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error('Configuration Supabase absente (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY).');
    return json(500, { erreur: 'Service indisponible.' });
  }
  return null;
}

/* ------------------------------------------------------------------ REST --- */

async function rest(chemin, options = {}) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1${chemin}`, {
    ...options,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  if (!r.ok) {
    const texte = await r.text();
    throw new Error(`Supabase ${r.status} sur ${chemin} : ${texte.slice(0, 300)}`);
  }
  return r.status === 204 ? null : r.json();
}

export const db = {
  lire: (table, requete) => rest(`/${table}?${requete}`),
  async un(table, requete) {
    const lignes = await rest(`/${table}?${requete}&limit=1`);
    return lignes && lignes.length ? lignes[0] : null;
  },
  creer: (table, donnees) =>
    rest(`/${table}`, {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(donnees),
    }),
  majSur: (table, requete, donnees) =>
    rest(`/${table}?${requete}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(donnees),
    }),
  fusionner: (table, donnees, cles) =>
    rest(`/${table}?on_conflict=${cles}`, {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
      body: JSON.stringify(donnees),
    }),
  supprimer: (table, requete) => rest(`/${table}?${requete}`, { method: 'DELETE' }),
};

/* --------------------------------------------------------------- Storage --- */

/** URL de lecture temporaire d'un fichier audio. */
export async function urlSignee(chemin, secondes = 7200) {
  const r = await fetch(`${SUPABASE_URL}/storage/v1/object/sign/${BUCKET}/${chemin}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ expiresIn: secondes }),
  });
  if (!r.ok) throw new Error(`Signature refusée pour ${chemin} : ${r.status}`);
  const { signedURL } = await r.json();
  return `${SUPABASE_URL}/storage/v1${signedURL}`;
}

/** URL d'envoi temporaire, utilisée par l'espace thérapeute. */
export async function urlEnvoi(chemin) {
  const r = await fetch(`${SUPABASE_URL}/storage/v1/object/upload/sign/${BUCKET}/${chemin}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ upsert: true }),
  });
  if (!r.ok) throw new Error(`Signature d'envoi refusée pour ${chemin} : ${r.status}`);
  const { url } = await r.json();
  return `${SUPABASE_URL}/storage/v1${url}`;
}

/* ------------------------------------------------------------ Couverture --- */

/**
 * La couverture d'écoute est un bitset : un bit par seconde du fichier.
 * Une seconde ne compte qu'une fois, quel que soit le nombre de réécoutes.
 * Vingt minutes tiennent dans 150 octets, soit 200 caractères en base64.
 */
export function tauxCouverture(base64, dureeSec) {
  if (!base64 || !dureeSec || dureeSec < 1) return 0;
  let octets;
  try {
    octets = Buffer.from(base64, 'base64');
  } catch {
    return 0;
  }
  let n = 0;
  for (let i = 0; i < dureeSec; i++) {
    const o = octets[i >> 3];
    if (o && o & (128 >> (i & 7))) n++;
  }
  return Math.min(1, n / dureeSec);
}

/* --------------------------------------------------------------- Jetons --- */

const ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789'; // sans i, l, o, 0, 1

export function nouveauJeton(longueur = 20) {
  const octets = new Uint8Array(longueur);
  crypto.getRandomValues(octets);
  let s = '';
  for (const o of octets) s += ALPHABET[o % ALPHABET.length];
  return s;
}

export function slug(texte) {
  return (texte || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'acces';
}

export function lienCliente(cliente) {
  return `${SITE_URL.replace(/\/$/, '')}/${slug(cliente.prenom)}/${cliente.jeton}`;
}

/* ------------------------------------------------------------ Téléphone --- */

/** Normalise un numéro français en +33XXXXXXXXX. Renvoie null si invalide. */
export function normaliserTel(brut) {
  if (!brut) return null;
  let n = String(brut).replace(/[^\d+]/g, '');
  if (n.startsWith('+')) {
    n = '+' + n.slice(1).replace(/\D/g, '');
  } else if (n.startsWith('00')) {
    n = '+' + n.slice(2);
  } else if (n.startsWith('0')) {
    n = '+33' + n.slice(1);
  } else if (n.length === 9) {
    n = '+33' + n;
  } else {
    n = '+' + n;
  }
  return /^\+\d{10,15}$/.test(n) ? n : null;
}

/* ------------------------------------------------------------------ SMS --- */

/**
 * Envoi via Brevo. Sans clé configurée, on journalise sans faire échouer
 * l'appel : la thérapeute peut toujours transmettre le lien à la main.
 */
export async function envoyerSms(telephone, contenu) {
  const cle = process.env.BREVO_API_KEY;
  if (!cle) {
    console.warn('BREVO_API_KEY absente : SMS non envoyé à', telephone);
    return { envoye: false, raison: 'sms-non-configure' };
  }
  const r = await fetch('https://api.brevo.com/v3/transactionalSMS/sms', {
    method: 'POST',
    headers: { 'api-key': cle, 'Content-Type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      sender: (process.env.BREVO_SMS_SENDER || 'MAbeautyPl').slice(0, 11),
      recipient: telephone.replace('+', ''),
      content: contenu,
      type: 'transactional',
    }),
  });
  if (!r.ok) {
    console.error('Échec SMS Brevo :', r.status, (await r.text()).slice(0, 200));
    return { envoye: false, raison: 'sms-echec' };
  }
  return { envoye: true };
}

/* --------------------------------------------------- Limitation de débit --- */

export function ipDe(req) {
  return (
    req.headers.get('x-nf-client-connection-ip') ||
    (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() ||
    'inconnue'
  );
}

export async function journaliser(action, { clienteId = null, ip = null, detail = null } = {}) {
  try {
    await db.creer('acces_log', { cliente_id: clienteId, action, ip, detail });
  } catch (e) {
    console.error('Journalisation impossible :', e.message);
  }
}

/** Vrai si l'IP a dépassé le nombre d'appels autorisés sur la fenêtre donnée. */
export async function tropDAppels(ip, action, max = 10, secondes = 60) {
  const depuis = new Date(Date.now() - secondes * 1000).toISOString();
  try {
    const lignes = await db.lire(
      'acces_log',
      `select=id&ip=eq.${encodeURIComponent(ip)}&action=eq.${action}&created_at=gte.${depuis}&limit=${max + 1}`
    );
    return lignes.length > max;
  } catch (e) {
    console.error('Contrôle de débit impossible :', e.message);
    return false;
  }
}

/* -------------------------------------------------------------- Requête --- */

export async function corpsJson(req) {
  try {
    return await req.json();
  } catch {
    return null;
  }
}

/**
 * Retrouve une cliente par son jeton, enregistre l'appareil et applique
 * la limite d'appareils. Renvoie { cliente } ou { erreur, statut }.
 */
export async function clienteParJeton(jeton, empreinte, ua) {
  if (!jeton || !/^[a-z0-9]{6,40}$/.test(jeton)) {
    return { erreur: 'lien-invalide', statut: 404 };
  }
  const cliente = await db.un(
    'clientes',
    `select=*,parcours:parcours_code(nom_commercial)&jeton=eq.${jeton}`
  );
  if (!cliente) return { erreur: 'lien-invalide', statut: 404 };
  if (cliente.statut === 'suspendu') return { erreur: 'acces-suspendu', statut: 403 };

  if (empreinte) {
    const appareils = await db.lire('appareils', `select=*&cliente_id=eq.${cliente.id}`);
    const connu = appareils.find((a) => a.empreinte === empreinte);
    if (connu) {
      await db.majSur('appareils', `id=eq.${connu.id}`, { derniere_vue: new Date().toISOString() });
    } else if (appareils.length >= APPAREILS_MAX) {
      return { erreur: 'trop-appareils', statut: 403 };
    } else {
      await db.creer('appareils', {
        cliente_id: cliente.id,
        empreinte,
        ua: (ua || '').slice(0, 200),
      });
    }
  }
  return { cliente };
}
