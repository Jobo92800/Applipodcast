import subprocess, time, json, base64, urllib.request, os, signal
os.makedirs('/tmp/shots2', exist_ok=True)
srv = subprocess.Popen(['node','serveur-seul.mjs'], cwd='/home/claude/mp2/tests',
                       stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
time.sleep(2)
B='http://localhost:8123'
EMAIL = 'marie%d@exemple.fr' % int(time.time())
def post(route, corps, entetes=None):
    r = urllib.request.Request(B+'/api/'+route, data=json.dumps(corps).encode(),
        headers={'Content-Type':'application/json', **(entetes or {})})
    return json.loads(urllib.request.urlopen(r).read())
def pack(bits):
    o = bytearray((len(bits)+7)//8)
    for i,b in enumerate(bits):
        if b: o[i>>3] |= 128 >> (i & 7)
    return base64.b64encode(bytes(o)).decode()

rep = post('admin', {'action':'creer','prenom':'Marie','nom':'Dupont','email':EMAIL,
                     'telephone':'0612345678','parcours':'A'}, {'x-mbp-code':'test-2026'})
# récupère le jeton d'invitation via le journal exposé par le serveur de test
inv = json.loads(urllib.request.urlopen(B+'/__emails').read())[-1]['acces']

from playwright.sync_api import sync_playwright
T=[]; erreurs=[]
def p(n,r): T.append((n,r))

with sync_playwright() as pw:
    nav = pw.chromium.launch()
    ctx = nav.new_context(viewport={'width':390,'height':844}, device_scale_factor=2)
    pg = ctx.new_page()
    pg.on('pageerror', lambda e: erreurs.append('client: '+str(e)))
    pg.on('console', lambda m: erreurs.append('console: '+m.text) if m.type=='error' else None)

    # 1. arrivée sans session -> écran de connexion
    pg.goto(B+'/'); pg.wait_for_timeout(1100)
    p('sans session -> connexion', pg.is_visible('#screen-connexion'))
    pg.screenshot(path='/tmp/shots2/c1-connexion.png', full_page=True)

    # 2. mauvais mot de passe
    pg.fill('#champ-email',EMAIL); pg.fill('#champ-mdp','mauvais')
    pg.click('#btn-connexion'); pg.wait_for_timeout(1200)
    p('erreur de mot de passe affichée', pg.is_visible('#connexion-erreur'))
    p('message en français', 'incorrect' in pg.inner_text('#connexion-erreur'))
    pg.screenshot(path='/tmp/shots2/c2-erreur.png', full_page=True)

    # 3. lien d'invitation -> choisir son mot de passe
    pg.goto(B+'/?mail=1#access_token='+inv+'&refresh_token=ref&type=invite'); pg.wait_for_timeout(1200)
    p("lien d'invitation -> écran mot de passe", pg.is_visible('#screen-definir'))
    p('titre de bienvenue', 'Bienvenue' in pg.inner_text('#definir-titre'))
    p('URL nettoyée', '#access_token' not in pg.url)
    pg.screenshot(path='/tmp/shots2/c3-definir.png', full_page=True)

    pg.fill('#champ-nouveau','court'); pg.click('#btn-definir'); pg.wait_for_timeout(700)
    p('mot de passe court refusé côté client', pg.is_visible('#definir-erreur'))
    pg.fill('#champ-nouveau','monbeaumotdepasse'); pg.click('#btn-definir'); pg.wait_for_timeout(1600)
    p('après mot de passe -> écran arrivée', pg.is_visible('#screen-arrivee'))
    pg.screenshot(path='/tmp/shots2/c4-arrivee.png', full_page=True)

    pg.click('#btn-commencer'); pg.wait_for_timeout(900)
    p('accueil affiché', pg.is_visible('#screen-accueil'))
    p('progression sur 4', 'sur 4' in pg.inner_text('#progres-texte'))
    pg.screenshot(path='/tmp/shots2/c5-accueil.png', full_page=True)

    pg.click('#btn-ecouter'); pg.wait_for_timeout(1600)
    p("écran d'écoute", pg.is_visible('#screen-ecoute'))
    pg.screenshot(path='/tmp/shots2/c6-ecoute.png', full_page=True)

    # 4. déconnexion puis reconnexion classique
    pg.click('#btn-retour'); pg.wait_for_timeout(500)
    pg.click('[data-aller=espace]'); pg.wait_for_timeout(700)
    pg.screenshot(path='/tmp/shots2/c7-espace.png', full_page=True)
    pg.click('#btn-deconnexion'); pg.wait_for_timeout(800)
    p('déconnexion -> écran de connexion', pg.is_visible('#screen-connexion'))
    pg.fill('#champ-email',EMAIL); pg.fill('#champ-mdp','monbeaumotdepasse')
    pg.click('#btn-connexion'); pg.wait_for_timeout(1800)
    p('reconnexion réussie', pg.is_visible('#screen-accueil'))

    # 5. session mémorisée au rechargement
    pg.reload(); pg.wait_for_timeout(1500)
    p('session mémorisée', pg.is_visible('#screen-accueil'))

    # 6. mot de passe oublié
    pg.click('[data-aller=espace]'); pg.wait_for_timeout(600)
    pg.click('#btn-deconnexion'); pg.wait_for_timeout(700)
    pg.click('#btn-oubli'); pg.wait_for_timeout(600)
    p('écran mot de passe oublié', pg.is_visible('#screen-oubli'))
    pg.fill('#champ-oubli',EMAIL); pg.click('#btn-envoyer-oubli'); pg.wait_for_timeout(1300)
    p('confirmation d\'envoi', pg.is_visible('#oubli-envoye'))
    pg.screenshot(path='/tmp/shots2/c8-oubli.png', full_page=True)

    # 7. espace thérapeute
    pg3 = nav.new_context(viewport={'width':1180,'height':900}, device_scale_factor=2).new_page()
    pg3.on('pageerror', lambda e: erreurs.append('admin: '+str(e)))
    pg3.on('console', lambda m: erreurs.append('admin console: '+m.text) if m.type=='error' else None)
    pg3.goto(B+'/admin'); pg3.wait_for_timeout(700)
    pg3.fill('#code','test-2026'); pg3.click('#btn-entrer'); pg3.wait_for_timeout(1400)
    p('espace thérapeute ouvert', pg3.is_visible('#zone-table'))
    p('e-mail affiché dans la liste', EMAIL in pg3.inner_text('#zone-table'))
    pg3.screenshot(path='/tmp/shots2/c9-admin.png', full_page=True)
    pg3.click('tr[data-id]'); pg3.wait_for_timeout(900)
    p('fiche avec compte actif', 'Compte' in pg3.inner_text('#contenu-fiche'))
    pg3.screenshot(path='/tmp/shots2/c10-fiche.png')
    pg3.keyboard.press('Escape'); pg3.wait_for_timeout(300)
    pg3.click('#btn-nouvelle'); pg3.wait_for_timeout(600)
    pg3.fill('#f-prenom','Sophie'); pg3.fill('#f-email','s'+str(int(time.time()))+'@exemple.fr')
    pg3.screenshot(path='/tmp/shots2/c11-nouvelle.png')
    pg3.click('#btn-creer'); pg3.wait_for_timeout(1400)
    p('compte créé avec invitation', 'invitation' in pg3.inner_text('#etat-mail').lower())
    pg3.screenshot(path='/tmp/shots2/c12-cree.png')
    nav.close()

srv.send_signal(signal.SIGTERM)
ko = 0
for n,r in T:
    if not r: ko += 1
    print(('  OK  ' if r else '  KO  ')+n)
print('\nERREURS JS:\n'+'\n'.join(erreurs) if erreurs else '\nAucune erreur JavaScript')
print(f'{ko} ÉCHEC(S)' if ko else f'{len(T)} contrôles passent')
