# 📅 Planify
App de planning mobile-first pour infirmière.
Saisie rapide des shifts, repos, vacances et événements perso.
Export .ics pour Google Agenda / Apple Calendar.

## Stack
- HTML / CSS / Vanilla JS
- Single page, zero dépendance
- Système visuel « Encre » : interface monochrome (encre / gris / blanc), toute
  la couleur réservée à la donnée. Typo Schibsted Grotesk, jeu de 18 icônes
  dessinées en sprite SVG dans `index.html`. Les emoji sont réservés au contenu
  (types perso choisis par l'utilisatrice), jamais à l'interface.
- LocalStorage pour la persistance

## Fonctionnalités
- Calendrier mensuel avec navigation
- Shifts : Matin, Soir, Nuit, Repos, Vacances
- Événements personnels (création libre, le nom porte tout : plus de saisie d'emoji)
  - **Ponctuel** : posé directement sur le(s) jour(s), sans encombrer la palette
  - **Réutilisable** : gardé dans « mes types » pour le réappliquer plus tard
- Multi-select : appliquer un type sur plusieurs jours d'un coup
- Suppression individuelle par jour
- Retrait d'un type de la palette **sans toucher aux jours déjà planifiés**
  (le type est archivé, puis supprimé pour de bon quand plus aucun jour ne l'utilise)
- Lien d'abonnement calendrier (Google Agenda, Apple Calendar) — sync auto
- **Partage de planning entre comptes** : code d'invitation à usage unique,
  lecture seule, périmètre au choix (shifts seuls ou tout), révocable des deux
  côtés. Les règles d'accès vivent dans les politiques RLS, pas dans le front
  (voir `supabase/migration_sharing.sql`)
- Carte de charge du mois : jours travaillés, répartition matin/soir/nuit, repos
- Grille lue comme une carte de couleurs : le shift colore le numéro du jour,
  les autres événements s'affichent en toutes lettres sous le numéro
- À l'impression et dans le flux ICS, tout redevient du texte : la couleur ne
  traverse ni une imprimante noir et blanc ni un agenda externe
- Impression

## Structure
```
Planify/
├── index.html       # Point d'entrée unique
├── css/
│   └── style.css    # Tous les styles (mobile-first, max-width 480px)
├── js/
│   ├── app.js       # Initialisation
│   ├── auth.js      # OTP Supabase + menu utilisateur
│   ├── calendar.js  # Rendu du calendrier, navigation, impression
│   ├── config.js    # Client Supabase
│   ├── modal.js     # Création d'événements perso
│   ├── palette.js   # Types d'événements, constantes
│   ├── sheet.js     # Bottom-sheets, chips, batch mode
│   ├── storage.js   # Persistance Supabase
│   ├── subscribe.js # Lien d'abonnement calendrier (sync auto)
│   ├── sharing.js   # Partage de planning entre comptes (invitation, lecture seule)
│   ├── toast.js     # Notifications toast
│   └── utils.js     # Helpers DOM + ICS partagés
├── supabase/
│   ├── functions/calendar-feed/   # Edge Function qui sert le .ics
│   └── *.sql                      # Migrations
└── README.md
```
