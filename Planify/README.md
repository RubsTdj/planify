# 📅 Planify
App de planning mobile-first pour infirmière.
Saisie rapide des shifts, repos, vacances et événements perso.
Export .ics pour Google Agenda / Apple Calendar.

## Stack
- HTML / CSS / Vanilla JS
- Single page, zero dépendance
- LocalStorage pour la persistance

## Fonctionnalités
- Calendrier mensuel avec navigation
- Shifts : Matin ☀️, Soir 🌇, Nuit 🌙
- Repos 😴, Vacances 🏖️
- Événements personnels (presets + création libre avec emoji)
- Multi-select : appliquer un type sur plusieurs jours d'un coup
- Suppression individuelle par jour ou par type
- Export `.ics` (Google Agenda, Apple Calendar)
- Impression

## Structure
```
Planify/
├── index.html       # Point d'entrée unique
├── css/
│   └── style.css    # Tous les styles (mobile-first, max-width 480px)
├── js/
│   ├── app.js       # Initialisation
│   ├── calendar.js  # Rendu du calendrier, navigation
│   ├── palette.js   # Types d'événements, constantes
│   ├── sheet.js     # Bottom-sheets, chips, batch mode
│   ├── modal.js     # Création d'événements perso
│   ├── storage.js   # localStorage
│   ├── export.js    # Export .ics
│   └── toast.js     # Notifications toast
└── README.md
```
