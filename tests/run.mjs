import './serveur.mjs';
await new Promise(r=>setTimeout(r,300));
import { journal } from './serveur.mjs';
const B='http://localhost:8123';
const T=[]; const p=(n,r,d='')=>{T.push([n,r,d]);};
const post=async(r,c,h={})=>{const x=await fetch(B+'/api/'+r,{method:'POST',headers:{'Content-Type':'application/json',...h},body:JSON.stringify(c)});return {statut:x.status,...(await x.json().catch(()=>({})))};};
const ADMIN={'x-mbp-code':'test-2026'};
const auth=(t)=>({Authorization:'Bearer '+t});
function pack(bits){const o=new Uint8Array(Math.ceil(bits.length/8));for(let i=0;i<bits.length;i++)if(bits[i])o[i>>3]|=128>>(i&7);return Buffer.from(o).toString('base64');}

// --- espace thérapeute ---
let r = await post('admin',{action:'liste'});
p('admin sans code refusé', r.statut===401);
r = await post('admin',{action:'liste'},{'x-mbp-code':'faux'});
p('admin code erroné refusé', r.statut===401);

r = await post('admin',{action:'creer',prenom:'Marie',nom:'Dupont',email:'MARIE@Exemple.FR',telephone:'0612345678',parcours:'A'},ADMIN);
p('création avec compte e-mail', r.statut===200 && r.cliente.email==='marie@exemple.fr');
p('invitation envoyée', r.invitation?.envoye===true);
p('e-mail d\'invitation dans la file', journal.emails.at(-1)?.type==='invite');
const invitation = journal.emails.at(-1).acces;

r = await post('admin',{action:'creer',prenom:'Autre',email:'marie@exemple.fr',parcours:'A'},ADMIN);
p('e-mail déjà utilisé refusé', r.statut===409 && r.erreur==='email-deja-utilise');
r = await post('admin',{action:'creer',prenom:'Test',email:'pasunemail',parcours:'A'},ADMIN);
p('e-mail invalide refusé', r.statut===400 && r.erreur==='email-invalide');

// --- première connexion : choisir son mot de passe ---
r = await post('session',{action:'definir',motDePasse:'court',acces:invitation});
p('mot de passe trop court refusé', r.statut===400 && r.erreur==='mot-de-passe-court');
r = await post('session',{action:'definir',motDePasse:'monbeaumotdepasse',acces:invitation});
p('mot de passe enregistré', r.statut===200 && r.ok===true);
r = await post('session',{action:'definir',motDePasse:'autrepassword',acces:'jeton-bidon'});
p('lien d\'invitation invalide refusé', r.statut===401);

// --- connexion ---
r = await post('session',{action:'connexion',email:'marie@exemple.fr',motDePasse:'mauvais'});
p('mot de passe erroné refusé', r.statut===401 && r.erreur==='identifiants-invalides');
r = await post('session',{action:'connexion',email:'inconnue@exemple.fr',motDePasse:'x'});
p('compte inconnu refusé', r.statut===401);
r = await post('session',{action:'connexion',email:'  Marie@Exemple.fr ',motDePasse:'monbeaumotdepasse'});
p('connexion, e-mail insensible à la casse', r.statut===200 && !!r.acces);
const acces = r.acces, rafraichissement = r.rafraichissement;

r = await post('session',{action:'rafraichir',rafraichissement});
p('session rafraîchie', r.statut===200 && !!r.acces);
r = await post('session',{action:'rafraichir',rafraichissement:'faux'});
p('rafraîchissement invalide refusé', r.statut===401);

// --- accès au parcours ---
r = await post('parcours',{appareil:'ap1'});
p('parcours sans session refusé', r.statut===401 && r.erreur==='session-expiree');
r = await post('parcours',{appareil:'ap1'},auth('jeton-bidon'));
p('jeton invalide refusé', r.statut===401);

r = await post('parcours',{appareil:'ap1'},auth(acces));
p('ouverture du parcours', r.statut===200 && r.cliente.prenom==='Marie');
p('4 étapes, 1 disponible', r.total===4 && r.disponible===0);
p('titres verrouillés masqués', r.etapes[1].titre===undefined);

r = await post('audio',{appareil:'ap1',numero:1},auth(acces));
p('URL signée étape 1', r.statut===200 && r.url.includes('token=faux'));
r = await post('audio',{appareil:'ap1',numero:3},auth(acces));
p('étape 3 verrouillée', r.statut===403 && r.erreur==='etape-verrouillee');

// --- progression : le serveur recalcule ---
const moitie=new Array(900).fill(0); for(let i=0;i<450;i++)moitie[i]=1;
r = await post('progression',{appareil:'ap1',numero:1,couverture:pack(moitie),position:450,duree:900},auth(acces));
p('50 % écouté, non validé', r.taux===0.5 && r.terminee===false);
r = await post('progression',{appareil:'ap1',numero:1,couverture:'',position:899,duree:900,terminee:true},auth(acces));
p('« terminee » forgé ignoré', r.terminee===false);
const assez=new Array(900).fill(0); for(let i=0;i<815;i++)assez[i]=1;
r = await post('progression',{appareil:'ap1',numero:1,couverture:pack(assez),position:815,duree:900},auth(acces));
p('90,6 % : étape validée', r.terminee===true);

r = await post('parcours',{appareil:'ap1'},auth(acces));
p('étape 2 débloquée', r.disponible===1 && r.etapes[1].titre==='Étape A2');

// sendBeacon : le jeton passe dans le corps
const tiers=new Array(900).fill(0); for(let i=0;i<300;i++)tiers[i]=1;
r = await post('progression',{acces,appareil:'ap1',numero:2,couverture:pack(tiers),position:300,duree:900});
p('sendBeacon accepté sans en-tête', r.statut===200 && r.taux>0.33 && r.taux<0.34);

r = await post('parcours',{appareil:'ap2'},auth(acces));
p('couverture rendue pour reprise', !!r.etapes[1].couverture);
r = await post('parcours',{appareil:'ap3'},auth(acces));
p('3e appareil accepté', r.statut===200);
r = await post('parcours',{appareil:'ap4'},auth(acces));
p('4e appareil accepté', r.statut===200);
r = await post('parcours',{appareil:'ap5'},auth(acces));
p('5e appareil accepté au lieu d\'être bloqué', r.statut===200);
const fiches = await post('admin',{action:'liste'},ADMIN);
const fiche = fiches.clientes.find((x) => x.email==='marie@exemple.fr');
p('le plus ancien appareil est libéré', fiche.appareils===4);

// --- mot de passe oublié ---
r = await post('session',{action:'oubli',email:'marie@exemple.fr'});
p('e-mail de réinitialisation envoyé', r.statut===200 && journal.emails.at(-1)?.type==='recovery');
const reinit = journal.emails.at(-1).acces;
r = await post('session',{action:'oubli',email:'inconnue@exemple.fr'});
p('adresse inconnue : même réponse', r.statut===200 && r.ok===true);
r = await post('session',{action:'definir',motDePasse:'nouveaumotdepasse',acces:reinit});
p('nouveau mot de passe enregistré', r.statut===200);
r = await post('session',{action:'connexion',email:'marie@exemple.fr',motDePasse:'nouveaumotdepasse'});
p('connexion avec le nouveau mot de passe', r.statut===200);
const acces2 = r.acces;

// --- gestion thérapeute ---
r = await post('admin',{action:'liste'},ADMIN);
const c = r.clientes.find(x=>x.prenom==='Marie');
p('progression visible côté thérapeute', c.terminees===1 && c.total===4);
p('compte marqué actif', c.compteActive===true);
p('téléphone conservé pour le centre', c.telephone==='+33612345678');

// --- création directe avec mot de passe ---
r = await post('admin',{action:'creer',prenom:'Sonia',email:'sonia@exemple.fr',parcours:'A',motDePasse:'motdepasse1'},ADMIN);
p('compte créé avec mot de passe', r.statut===200 && r.invitation?.motDePasseDefini===true);
r = await post('session',{action:'connexion',email:'sonia@exemple.fr',motDePasse:'motdepasse1',appareil:'apS'});
p('connexion immédiate sans invitation', r.statut===200 && !!r.acces);
r = await post('admin',{action:'creer',prenom:'Sonia',email:'sonia@exemple.fr',parcours:'B',motDePasse:'nouveaumdp1'},ADMIN);
p('compte existant : mot de passe redéfini', r.statut===200 && r.existante===true);
r = await post('session',{action:'connexion',email:'sonia@exemple.fr',motDePasse:'nouveaumdp1',appareil:'apS'});
p('connexion avec le nouveau mot de passe', r.statut===200);
r = await post('admin',{action:'creer',prenom:'Trop',email:'court@exemple.fr',parcours:'A',motDePasse:'abc'},ADMIN);
p('mot de passe trop court refusé', r.statut===400 && r.erreur==='mot-de-passe-court');

r = await post('admin',{action:'renvoyer-invitation',id:c.id},ADMIN);
p('renvoi vers un compte existant', r.statut===200 && r.invitation?.deja===true);

r = await post('admin',{action:'valider-etape',id:c.id},ADMIN);
p('validation manuelle', r.numero===2);
await post('admin',{action:'modifier',id:c.id,statut:'suspendu'},ADMIN);
r = await post('parcours',{appareil:'ap1'},auth(acces2));
p('accès suspendu bloqué', r.statut===403 && r.erreur==='acces-suspendu');
await post('admin',{action:'modifier',id:c.id,statut:'actif'},ADMIN);
await post('admin',{action:'modifier',id:c.id,reinitialiserAppareils:true},ADMIN);
r = await post('parcours',{appareil:'ap9'},auth(acces2));
p('appareils réinitialisés', r.statut===200);

const lot = await post('admin',{action:'parcours'},ADMIN);
const avecAudio = lot.etapes.find((e) => e.fichier);
r = await post('admin',{action:'ecouter',id:avecAudio.id},ADMIN);
p('écoute de contrôle signée', r.statut===200 && r.url.includes('token=faux'));
r = await post('admin',{action:'ecouter',id:'00000000-0000-0000-0000-000000000000'},ADMIN);
p('écoute d\'une étape inconnue refusée', r.statut===404);

r = await post('admin',{action:'url-envoi',chemin:'A/A01.mp3'},ADMIN);
p('URL d\'envoi signée', r.statut===200 && r.url.includes('token=faux'));
r = await post('admin',{action:'url-envoi',chemin:'../secret.env'},ADMIN);
p('chemin d\'envoi malveillant refusé', r.statut===400);

let ko=0;
for(const [n,ok,d] of T){ if(!ok) ko++; console.log((ok?'  OK  ':'  KO  ')+n+(d&&!ok?' -> '+d:'')); }
console.log(ko? `\n${ko} ÉCHEC(S)` : `\n${T.length} contrôles passent`);
process.exit(ko?1:0);
