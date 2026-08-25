# Intégration OpenClaw, API et MCP

## Architecture

```text
OpenClaw
   ├─ webfityou-crm (clé limitée à WebFitYou)
   └─ epiderme-ai-crm (clé limitée à Epiderme AI)
        └─ API CRM Supabase Edge Function
             ├─ validation des données et permissions
             ├─ idempotence anti-doublons
             ├─ journal d'audit
             └─ PostgreSQL / Supabase

Interface React ── Supabase Auth + RLS ── PostgreSQL / Supabase
```

L'interface web et OpenClaw partagent les mêmes données, mais pas les mêmes
identifiants. OpenClaw ne reçoit jamais la clé `service_role` et ne peut pas exécuter
de SQL arbitraire.

## Protections

- Clés techniques stockées sous forme de hash SHA-256 ; le jeton complet n'est affiché qu'à la création.
- Permissions explicites par clé.
- Expiration automatique des nouvelles clés après un an.
- `Idempotency-Key` obligatoire sur chaque écriture d'un agent.
- Journal immuable dans `agent_audit_logs`.
- Opération `record_followup` transactionnelle.
- Aucune suppression de contact exposée aux agents.
- Chaque clé est rattachée à une seule marque et toutes les requêtes sont filtrées par cette marque.
- Révocation immédiate depuis l'administration.

## API

Base :

```text
https://<project-ref>.supabase.co/functions/v1/crm-api
```

Authentification agent :

```http
Authorization: Bearer crm_xxxxxxxxx
```

Pour les requêtes `POST` et `PATCH` :

```http
Idempotency-Key: <UUID unique pour cette action>
```

### Routes principales

| Méthode | Route | Fonction |
| --- | --- | --- |
| GET | `/health` | Vérifier la connexion |
| GET | `/users` | Lister les utilisateurs |
| GET | `/contacts` | Rechercher et filtrer les contacts |
| GET | `/contacts/:id` | Dossier complet du prospect |
| POST | `/contacts` | Créer un contact |
| PATCH | `/contacts/:id` | Modifier ou réaffecter un contact |
| POST | `/interactions` | Enregistrer une interaction |
| POST | `/followups` | Contact + interaction + tâche en transaction |
| POST | `/tasks` | Créer une tâche |
| PATCH | `/tasks/:id/complete` | Terminer une tâche |
| POST | `/assignments` | Affectation en masse et organisation du travail |
| GET | `/work` | Planning entre deux dates |
| GET | `/reports` | KPI d'un utilisateur sur une période |
| GET | `/audit` | Journal technique |

Les opérations de création, modification et suivi acceptent également les réseaux sociaux :

```json
{
  "instagram": "https://instagram.com/entreprise",
  "facebook": "https://facebook.com/entreprise",
  "linkedin": "https://linkedin.com/company/entreprise",
  "twitter": "https://x.com/entreprise"
}
```

Le champ `x` est aussi accepté par l'API comme alias de `twitter`.

## Déploiement Supabase

Les migrations doivent être appliquées avant les fonctions :

```bash
supabase link --project-ref <project-ref>
supabase db push

supabase functions deploy admin-users --project-ref <project-ref>
supabase functions deploy process-sequences --project-ref <project-ref>
supabase functions deploy crm-api --project-ref <project-ref> --no-verify-jwt
```

`crm-api` utilise `--no-verify-jwt` au niveau de la passerelle parce qu'elle accepte
deux identités : JWT administrateur et clé agent `crm_*`. L'Edge Function valide
elle-même strictement ces deux formats.

## Connexion à OpenClaw

1. Se connecter au CRM avec le compte administrateur.
2. Choisir **WebFitYou** en haut à gauche, puis ouvrir **Administration > Intégrations & agents**.
3. Créer et copier la clé WebFitYou.
4. Choisir **Epiderme AI**, puis créer une deuxième clé distincte.
5. Installer et compiler le serveur MCP :

```bash
cd integrations/openclaw-mcp
npm install
npm run build
```

6. Enregistrer les deux serveurs dans OpenClaw :

```bash
openclaw mcp add webfityou-crm \
  --command node \
  --arg /CHEMIN/ABSOLU/integrations/openclaw-mcp/dist/index.js \
  --env CRM_API_URL=https://<project-ref>.supabase.co/functions/v1/crm-api \
  --env CRM_API_KEY=crm_CLE_WEBFITYOU \
  --env CRM_BRAND_NAME=WebFitYou

openclaw mcp doctor webfityou-crm --probe
openclaw mcp tools webfityou-crm

openclaw mcp add epiderme-ai-crm \
  --command node \
  --arg /CHEMIN/ABSOLU/integrations/openclaw-mcp/dist/index.js \
  --env CRM_API_URL=https://<project-ref>.supabase.co/functions/v1/crm-api \
  --env CRM_API_KEY=crm_CLE_EPIDERME \
  --env "CRM_BRAND_NAME=Epiderme AI"

openclaw mcp doctor epiderme-ai-crm --probe
```

OpenClaw doit sélectionner le serveur d'après la marque demandée. La sécurité ne repose toutefois pas sur son interprétation : l'API refuse techniquement tout accès hors de la marque inscrite dans la clé.

## Méthode recommandée pour l'agent

1. Appeler `crm_search_contacts` avant toute création.
2. Appeler `crm_get_contact` avant une relance pour lire l'historique.
3. Utiliser `crm_record_followup` après un échange commercial.
4. Toujours créer une prochaine action datée lorsqu'un suivi est nécessaire.
5. Utiliser `crm_list_users` avant une affectation si l'identifiant est inconnu.
6. Demander une confirmation humaine avant une affectation en masse.

## Rotation ou incident

En cas de doute, cliquer sur **Révoquer** dans l'administration. La clé cesse de
fonctionner immédiatement. Créer ensuite une nouvelle clé et remplacer uniquement
`CRM_API_KEY` dans la configuration OpenClaw.
