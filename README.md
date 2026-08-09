# WebFitYou CRM - Prospection

CRM de prospection interne WebFitYou : gestion des contacts, suivi des interactions (appels, email, WhatsApp, SMS), relances automatisées, séquences email et reporting de performance commerciale.

**Production :** https://crm-prospection-webfityou.netlify.app

## Stack technique

- [Vite](https://vitejs.dev/) + [React](https://react.dev/) + TypeScript
- [Tailwind CSS](https://tailwindcss.com/)
- [Supabase](https://supabase.com/) (PostgreSQL, Auth, Edge Functions)
- [Resend](https://resend.com/) pour l'envoi d'email (domaine `webfityou.org`)
- [Netlify](https://www.netlify.com/) pour l'hébergement

## Démarrage local

```bash
npm install
cp .env.example .env   # renseigner VITE_SUPABASE_URL et VITE_SUPABASE_ANON_KEY
npm run dev
```

## Scripts

| Commande | Description |
| --- | --- |
| `npm run dev` | Lance le serveur de développement |
| `npm run build` | Build de production dans `dist/` |
| `npm run preview` | Prévisualise le build de production |
| `npm run lint` | Lint du code |
| `npm run typecheck` | Vérification TypeScript |

## Base de données

Les migrations SQL versionnées se trouvent dans `supabase/migrations/`. Toutes les tables ont la Row Level Security (RLS) activée.

## Edge Functions

| Fonction | Rôle |
| --- | --- |
| `send-email` | Envoi d'un email unique via Resend |
| `rewrite-email` | Réécriture IA d'un email (OpenRouter) pour varier le contenu des relances |
| `process-sequences` | Traitement périodique des séquences email automatisées (relances) |

Déploiement : `supabase functions deploy <nom> --project-ref <ref>`.

## Administration et équipe

Le CRM prend en charge deux rôles :

- `admin` : voit l'ensemble de l'activité, crée les comptes, affecte les prospects et consulte les rapports individuels ;
- `commercial` : ne voit que les prospects, tâches, relances et listes d'appels qui lui sont attribués.

Après déploiement de la migration `20260730090000_add_multi_user_admin.sql`, le compte
`contact@webfityou.com` devient automatiquement administrateur. Les nouveaux comptes sont
ensuite créés depuis le menu **Administration** du CRM.

Une fois cette migration appliquée sur le projet Supabase distant, définir
`VITE_MULTI_USER_ENABLED=true` dans l'environnement du front. Conserver la valeur `false`
sur une base historique non migrée afin que la connexion reste compatible et n'interroge
pas la table `profiles` avant sa création.

La création sécurisée des comptes nécessite le déploiement de la fonction :

```bash
supabase functions deploy admin-users --project-ref <ref>
```

`SUPABASE_URL` et `SUPABASE_SERVICE_ROLE_KEY` sont fournis automatiquement à la fonction par
Supabase. La clé `service_role` ne doit jamais être ajoutée aux variables Vite ou au navigateur.

## API et agent OpenClaw

Le CRM inclut une API métier sécurisée, des clés techniques révocables, un journal
d'audit, une protection anti-doublons et un serveur MCP dans
`integrations/openclaw-mcp`. Les accès se gèrent dans **Administration > Intégrations
& agents**.

Voir [`docs/OPENCLAW_INTEGRATION.md`](docs/OPENCLAW_INTEGRATION.md) pour le déploiement,
la liste des routes et la connexion à OpenClaw.
