# Tests

Banc d'essai local : exécute les vraies fonctions Netlify sur une base et un service
d'authentification simulés, sans toucher à Supabase.

    node tests/run.mjs

42 contrôles : invitation, choix du mot de passe, connexion, rafraîchissement de session,
mot de passe oublié, déblocage séquentiel, tentative de triche, limite d'appareils,
actions de l'espace thérapeute.

Contrôle des interfaces dans un navigateur (Playwright requis) :

    python3 tests/ui-test.py
