# CRM multi-marques MCP pour OpenClaw

Ce serveur MCP local traduit les demandes d'OpenClaw en appels structurés vers
l'API métier du CRM. Il n'accède jamais directement à PostgreSQL et ne doit jamais
recevoir la clé Supabase `service_role`. Chaque clé est verrouillée côté serveur sur une marque.

## Installation

```bash
cd integrations/openclaw-mcp
npm install
npm run build
```

Générez ensuite une clé dans **CRM > Administration > Intégrations**, puis configurez
OpenClaw :

```bash
openclaw mcp add webfityou-crm \
  --command node \
  --arg /CHEMIN/ABSOLU/crm-prospection/integrations/openclaw-mcp/dist/index.js \
  --env CRM_API_URL=https://PROJECT.supabase.co/functions/v1/crm-api \
  --env CRM_API_KEY=crm_VOTRE_CLE_WEBFITYOU \
  --env CRM_BRAND_NAME=WebFitYou

openclaw mcp doctor webfityou-crm --probe
openclaw mcp tools webfityou-crm
```

Recommencez après avoir basculé le CRM sur Epiderme AI et généré une seconde clé :

```bash
openclaw mcp add epiderme-ai-crm \
  --command node \
  --arg /CHEMIN/ABSOLU/crm-prospection/integrations/openclaw-mcp/dist/index.js \
  --env CRM_API_URL=https://PROJECT.supabase.co/functions/v1/crm-api \
  --env CRM_API_KEY=crm_VOTRE_CLE_EPIDERME \
  --env "CRM_BRAND_NAME=Epiderme AI"
```

Les deux clés sont distinctes : une erreur de sélection par OpenClaw ne peut donc pas contaminer l'autre espace.

La clé n'est affichée qu'une seule fois. Conservez-la dans le gestionnaire de secrets
d'OpenClaw, jamais dans Git ou dans un fichier partagé.
