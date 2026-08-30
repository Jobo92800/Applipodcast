import './serveur.mjs';
await new Promise(r=>setTimeout(r,300));
const B='http://localhost:8123';
const T=[]; const p=(n,r,d='')=>{T.push([n,r,d]);};
const post=async(r,c,h={})=>{const x=await fetch(B+'/api/'+r,{method:'POST',headers:{'Content-Type':'application/json',...h},body:JSON.stringify(c)});return {statut:x.status,...(await x.json().catch(()=>({})))};};
const ADMIN={'x-mbp-code':'test-2026'};

// --- espace thérapeute ---
let r = await post('admin',{action:'liste'});
p('admin sans code refusé', r.statut===401);
r = await post('admin',{action:'liste'},{'x-mbp-code':'faux'});
p('admin code erroné refusé', r.statut===401);
r = await post('admin',{action:'liste'},ADMIN);
p('admin liste vide', r.statut===200 && r.clientes.length===0);

r = await post('admin',{action:'creer',prenom:'Marie',nom:'Dupont',telephone:'06 12 34 56 78',parcours:'A'},ADMIN);
p('création cliente', r.statut===200 && !!r.cliente.lien, r.cliente?.lien);
const lien = r.cliente.lien, jeton = lien.split('/').pop();
p('jeton 20 caractères', jeton.length===20);
p('lien en /marie/...', lien.includes('/marie/'));

r = await post('admin',{action:'creer',prenom:'Autre',telephone:'0612345678',parcours:'A'},ADMIN);
p('numéro déjà actif refusé', r.statut===409 && r.erreur==='numero-deja-actif');
r = await post('admin',{action:'creer',prenom:'Test',telephone:'123',parcours:'A'},ADMIN);
p('numéro invalide refusé', r.statut===400);

// --- ouverture par la cliente ---
r = await post('parcours',{jeton:'inexistant0000000000',appareil:'ap1'});
p('jeton inconnu -> 404', r.statut===404 && r.erreur==='lien-invalide');

r = await post('parcours',{jeton,appareil:'ap1'});
p('ouverture parcours', r.statut===200 && r.cliente.prenom==='Marie');
p('4 étapes, 1 disponible', r.total===4 && r.disponible===0);
p('titre étape 1 visible', r.etapes[0].titre==='Étape A1');
p('titres verrouillés masqués', r.etapes[1].titre===undefined && r.etapes[3].titre===undefined);
p('étape 2 non accessible', r.etapes[1].accessible===false);

// --- audio ---
r = await post('audio',{jeton,appareil:'ap1',numero:1});
p('URL signée étape 1', r.statut===200 && r.url.includes('token=faux'));
r = await post('audio',{jeton,appareil:'ap1',numero:3});
p('étape 3 verrouillée', r.statut===403 && r.erreur==='etape-verrouillee');

// --- progression : le serveur recalcule ---
function pack(bits){const o=new Uint8Array(Math.ceil(bits.length/8));for(let i=0;i<bits.length;i++)if(bits[i])o[i>>3]|=128>>(i&7);return Buffer.from(o).toString('base64');}
const moitie=new Array(900).fill(0); for(let i=0;i<450;i++)moitie[i]=1;
r = await post('progression',{jeton,appareil:'ap1',numero:1,couverture:pack(moitie),position:450,duree:900});
p('50 % écouté, non validé', r.taux===0.5 && r.terminee===false);

r = await post('progression',{jeton,appareil:'ap1',numero:1,couverture:'',position:899,duree:900,terminee:true});
p('« terminee » forgé ignoré', r.terminee===false && r.taux===0);

const presque=new Array(900).fill(0); for(let i=0;i<800;i++)presque[i]=1;
r = await post('progression',{jeton,appareil:'ap1',numero:1,couverture:pack(presque),position:800,duree:900});
p('89 % : toujours verrouillé', r.terminee===false);

const assez=new Array(900).fill(0); for(let i=0;i<815;i++)assez[i]=1;
r = await post('progression',{jeton,appareil:'ap1',numero:1,couverture:pack(assez),position:815,duree:900});
p('90,6 % : étape validée', r.terminee===true);

r = await post('parcours',{jeton,appareil:'ap1'});
p('étape 2 débloquée', r.disponible===1 && r.etapes[1].titre==='Étape A2');
p('1 étape terminée', r.terminees===1);
p('couverture effacée après validation', r.etapes[0].couverture===undefined||r.etapes[0].couverture==='');
r = await post('audio',{jeton,appareil:'ap1',numero:2});
p('audio étape 2 accessible', r.statut===200);

// --- reprise de la couverture sur un autre appareil ---
const tiers=new Array(900).fill(0); for(let i=0;i<300;i++)tiers[i]=1;
await post('progression',{jeton,appareil:'ap1',numero:2,couverture:pack(tiers),position:300,duree:900});
r = await post('parcours',{jeton,appareil:'ap2'});
p('couverture rendue pour reprise', !!r.etapes[1].couverture && r.etapes[1].taux>0.33 && r.etapes[1].taux<0.34);

// --- limite d'appareils ---
r = await post('parcours',{jeton,appareil:'ap3'});
p('3e appareil refusé', r.statut===403 && r.erreur==='trop-appareils');

// --- identification par téléphone ---
r = await post('acces',{telephone:'06 12 34 56 78',appareil:'ap1'});
p('appareil connu -> entrée directe', r.mode==='direct' && r.jeton===jeton);
r = await post('acces',{telephone:'0612345678',appareil:'nouvel-appareil'});
p('appareil inconnu -> SMS', r.mode==='sms' && r.jeton===undefined);
r = await post('acces',{telephone:'0699999999',appareil:'x'});
p('numéro inconnu : même réponse', r.mode==='sms' && r.jeton===undefined);
r = await post('acces',{telephone:'abc'});
p('numéro invalide refusé', r.statut===400);

// --- gestion thérapeute ---
r = await post('admin',{action:'liste'},ADMIN);
const c = r.clientes.find(x=>x.prenom==='Marie');
p('progression visible côté thérapeute', c.terminees===1 && c.total===4);
p('appareils comptés', c.appareils===2);

r = await post('admin',{action:'valider-etape',id:c.id},ADMIN);
p('validation manuelle', r.numero===2);
r = await post('admin',{action:'modifier',id:c.id,statut:'suspendu'},ADMIN);
r = await post('parcours',{jeton,appareil:'ap1'});
p('accès suspendu bloqué', r.statut===403 && r.erreur==='acces-suspendu');
await post('admin',{action:'modifier',id:c.id,statut:'actif'},ADMIN);

r = await post('admin',{action:'modifier',id:c.id,reinitialiserAppareils:true},ADMIN);
r = await post('parcours',{jeton,appareil:'ap9'});
p('appareils réinitialisés', r.statut===200);

r = await post('admin',{action:'url-envoi',chemin:'A/A01.mp3'},ADMIN);
p('URL d\'envoi signée', r.statut===200 && r.url.includes('token=faux'));
r = await post('admin',{action:'url-envoi',chemin:'../secret.env'},ADMIN);
p('chemin d\'envoi malveillant refusé', r.statut===400);

let ko=0;
for(const [n,ok,d] of T){ if(!ok) ko++; console.log((ok?'  OK  ':'  KO  ')+n+(d&&!ok?' -> '+d:'')); }
console.log(ko? `\n${ko} ÉCHEC(S)` : `\n${T.length} contrôles passent`);
process.exit(ko?1:0);
