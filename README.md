# Scanner Pro (React + Vite)

## Variables d’environnement

- `VITE_TWELVE_DATA_KEY` — Twelve Data (navigateur)
- `ANTHROPIC_KEY` — **sans** préfixe `VITE_` : utilisée uniquement par la fonction serverless `api/claude.js` (proxy vers Anthropic, pas d’exposition au client)
- `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` — **sans** `VITE_` : utilisées par `api/telegram.js` pour les alertes (token du bot + id du chat)

Copier `.env.example` vers `.env` et renseigner les clés.

## Développement local (Analyse IA)

L’appel IA passe par `/api/claude`. Avec Vite seul, ce chemin est proxifié vers `http://127.0.0.1:3000` : lance **`vercel dev`** dans un terminal (port 3000 par défaut), puis **`npm run dev`** dans un autre, ou utilise uniquement `vercel dev` si tout est servi par Vercel.

Sur **Vercel** en production, ajoute `ANTHROPIC_KEY`, `TELEGRAM_BOT_TOKEN` et `TELEGRAM_CHAT_ID` dans les variables du projet.

## Alertes Telegram

Active les alertes avec le bouton **🔔** dans le header. Un message part lorsque la confluence globale **> 75**, qu’au moins **2 timeframes** (1D / 4H / 15m) ont un score **> 75**, et qu’au moins une bougie **réelle** a été mise à jour ce scan — pas deux fois le même actif en **30 minutes** (stocké en `localStorage`).

---

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.
