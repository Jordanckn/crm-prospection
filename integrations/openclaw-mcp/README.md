# WebFitYou CRM MCP pour OpenClaw

Ce serveur MCP local traduit les demandes d'OpenClaw en appels structurés vers
l'API métier du CRM. Il n'accède jamais directement à PostgreSQL et ne doit jamais
recevoir la clé Supabase `service_role`.

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
  --env CRM_API_KEY=crm_VOTRE_CLE

openclaw mcp doctor webfityou-crm --probe
openclaw mcp tools webfityou-crm
```

La clé n'est affichée qu'une seule fois. Conservez-la dans le gestionnaire de secrets
d'OpenClaw, jamais dans Git ou dans un fichier partagé.

