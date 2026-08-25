#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const apiUrl = (process.env.CRM_API_URL || "").replace(/\/$/, "");
const apiKey = process.env.CRM_API_KEY || "";
const brandName = process.env.CRM_BRAND_NAME || "l'espace lie a cette cle";

if (!apiUrl || !apiKey) {
  console.error("CRM_API_URL et CRM_API_KEY sont obligatoires.");
  process.exit(1);
}

type Json = Record<string, unknown>;

async function callApi(method: string, path: string, body?: Json, query?: Record<string, string | number | undefined>) {
  const url = new URL(`${apiUrl}/${path.replace(/^\//, "")}`);
  for (const [key, value] of Object.entries(query || {})) {
    if (value !== undefined && value !== "") url.searchParams.set(key, String(value));
  }
  const requestId = randomUUID();
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "X-Request-Id": requestId,
      ...(method === "GET" ? {} : { "Idempotency-Key": requestId }),
    },
    body: method === "GET" ? undefined : JSON.stringify(body || {}),
  });
  const payload = await response.json().catch(() => ({ error: `Réponse HTTP ${response.status} non JSON` }));
  if (!response.ok) {
    const message = typeof payload?.error === "string" ? payload.error : `Erreur CRM HTTP ${response.status}`;
    throw new Error(message);
  }
  return payload;
}

function toolResult(payload: unknown) {
  const text = JSON.stringify(payload, null, 2);
  return { content: [{ type: "text" as const, text }] };
}

function errorResult(error: unknown) {
  return {
    isError: true,
    content: [{ type: "text" as const, text: error instanceof Error ? error.message : "Erreur CRM inconnue" }],
  };
}

async function execute(operation: () => Promise<unknown>) {
  try { return toolResult(await operation()); }
  catch (error) { return errorResult(error); }
}

const userId = z.string().uuid().describe("Identifiant UUID du commercial concerné");
const contactId = z.string().uuid().describe("Identifiant UUID du contact");
const dateTime = z.string().datetime({ offset: true }).describe("Date ISO 8601 avec fuseau horaire");

const server = new McpServer(
  { name: `crm-${brandName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`, version: "1.2.0" },
  {
    instructions: [
      `Cette connexion est exclusivement reservee a ${brandName}. Ne melange jamais ses prospects, templates, actions ou rapports avec une autre marque.`,
      "La cle API impose aussi cette separation cote serveur.",
      "Utilise ce CRM comme source de vérité pour les prospects et le suivi commercial.",
      "Recherche toujours un contact avant de le créer afin d'éviter les doublons.",
      "Après une conversation commerciale, privilégie crm_record_followup : il enregistre le contact, l'interaction et la prochaine tâche ensemble.",
      "Ne fabrique jamais d'identifiants : utilise crm_search_contacts et crm_list_users.",
      "Demande confirmation à l'utilisateur avant une affectation en masse.",
    ].join(" "),
  },
);

server.registerTool("crm_health", {
  title: "Vérifier la connexion CRM",
  description: "Vérifie que l'API CRM et l'identité OpenClaw sont opérationnelles.",
  inputSchema: {},
}, async () => execute(() => callApi("GET", "health")));

server.registerTool("crm_list_users", {
  title: "Lister l'équipe CRM",
  description: "Retourne les utilisateurs avec leurs UUID, rôles et statuts. À appeler avant toute affectation lorsque l'UUID du commercial n'est pas connu.",
  inputSchema: {},
}, async () => execute(() => callApi("GET", "users")));

server.registerTool("crm_search_contacts", {
  title: "Rechercher des prospects",
  description: "Recherche les contacts par nom, société, email, téléphone, site ou réseau social. Toujours utiliser cet outil avant de créer un contact.",
  inputSchema: {
    query: z.string().optional().describe("Texte recherché"),
    assigned_to: z.string().uuid().optional().describe("Filtrer par commercial"),
    status: z.enum(["Nouveau", "En cours", "Converti", "Perdu"]).optional(),
    page: z.number().int().positive().default(1),
    limit: z.number().int().min(1).max(200).default(50),
  },
}, async args => execute(() => callApi("GET", "contacts", undefined, args)));

server.registerTool("crm_get_contact", {
  title: "Consulter un dossier prospect",
  description: "Retourne le contact, son historique d'interactions et ses tâches. Utiliser avant une relance pour comprendre le contexte.",
  inputSchema: { contact_id: contactId },
}, async ({ contact_id }) => execute(() => callApi("GET", `contacts/${contact_id}`)));

server.registerTool("crm_create_contact", {
  title: "Créer un prospect",
  description: "Crée un prospect après vérification d'absence de doublon. Affecter explicitement le commercial si le contexte le permet.",
  inputSchema: {
    prenom: z.string().optional(), nom: z.string().optional(), entreprise: z.string().optional(),
    email: z.string().email().optional(), telephone: z.string().optional(),
    assigned_to: z.string().uuid().optional(),
    statut: z.enum(["Nouveau", "En cours", "Converti", "Perdu"]).default("Nouveau"),
    pays: z.string().default("France"), secteur_activite: z.string().optional(),
    adresse: z.string().optional(), ville: z.string().optional(), code_postal: z.string().optional(),
    notes_entreprise: z.string().optional(), site_web: z.string().url().optional(),
    instagram: z.string().max(500).optional().describe("URL ou identifiant Instagram"),
    facebook: z.string().max(500).optional().describe("URL ou identifiant Facebook"),
    linkedin: z.string().max(500).optional().describe("URL ou identifiant LinkedIn"),
    twitter: z.string().max(500).optional().describe("URL ou identifiant X/Twitter"),
    tags: z.array(z.string()).max(50).optional(),
  },
}, async args => execute(() => callApi("POST", "contacts", args)));

server.registerTool("crm_update_contact", {
  title: "Mettre à jour un prospect",
  description: "Met à jour uniquement les champs fournis. Ne pas effacer une information existante sans demande explicite.",
  inputSchema: {
    contact_id: contactId,
    prenom: z.string().optional(), nom: z.string().optional(), entreprise: z.string().optional(),
    email: z.string().email().optional(), telephone: z.string().optional(),
    statut: z.enum(["Nouveau", "En cours", "Converti", "Perdu"]).optional(),
    assigned_to: z.string().uuid().optional(), pays: z.string().optional(), secteur_activite: z.string().optional(),
    adresse: z.string().optional(), ville: z.string().optional(), code_postal: z.string().optional(),
    notes_entreprise: z.string().optional(), site_web: z.string().url().optional(),
    instagram: z.string().max(500).optional().describe("URL ou identifiant Instagram"),
    facebook: z.string().max(500).optional().describe("URL ou identifiant Facebook"),
    linkedin: z.string().max(500).optional().describe("URL ou identifiant LinkedIn"),
    twitter: z.string().max(500).optional().describe("URL ou identifiant X/Twitter"),
    tags: z.array(z.string()).max(50).optional(),
  },
}, async ({ contact_id, ...changes }) => execute(() => callApi("PATCH", `contacts/${contact_id}`, changes)));

server.registerTool("crm_log_interaction", {
  title: "Enregistrer une interaction",
  description: "Enregistre un appel, email ou message sur un contact existant. Pour créer simultanément une relance, utiliser plutôt crm_record_followup.",
  inputSchema: {
    contact_id: contactId, user_id: z.string().uuid().optional(),
    type: z.enum(["Appel", "Email", "WhatsApp", "SMS", "Facebook", "Instagram"]),
    date_heure: dateTime.optional(), duree: z.number().int().nonnegative().optional().describe("Durée en minutes"),
    resultat: z.enum(["Pas de réponse", "Répondu", "Intéressé", "Non intéressé", "Relance", ""]).optional(),
    notes: z.string().optional(),
  },
}, async args => execute(() => callApi("POST", "interactions", args)));

server.registerTool("crm_record_followup", {
  title: "Enregistrer un suivi commercial complet",
  description: "Outil principal après un échange : retrouve ou crée le contact, enregistre l'interaction et programme facultativement la prochaine tâche dans une transaction unique.",
  inputSchema: {
    contact_id: z.string().uuid().optional().describe("Omettre seulement si le contact est nouveau"),
    assigned_to: userId.optional(),
    contact: z.object({
      prenom: z.string().optional(), nom: z.string().optional(), entreprise: z.string().optional(),
      email: z.string().email().optional(), telephone: z.string().optional(),
      statut: z.enum(["Nouveau", "En cours", "Converti", "Perdu"]).optional(),
      pays: z.string().optional(), secteur_activite: z.string().optional(), notes_entreprise: z.string().optional(), site_web: z.string().optional(),
      instagram: z.string().max(500).optional(), facebook: z.string().max(500).optional(),
      linkedin: z.string().max(500).optional(), twitter: z.string().max(500).optional(),
      tags: z.array(z.string()).optional(),
    }).default({}),
    interaction: z.object({
      type: z.enum(["Appel", "Email", "WhatsApp", "SMS", "Facebook", "Instagram"]),
      date_heure: dateTime.optional(), duree: z.number().int().nonnegative().optional(),
      resultat: z.enum(["Pas de réponse", "Répondu", "Intéressé", "Non intéressé", "Relance", ""]).optional(),
      notes: z.string().optional(),
    }),
    task: z.object({
      titre: z.string().min(1), description: z.string().optional(), date_echeance: dateTime,
    }).optional(),
  },
}, async args => execute(() => callApi("POST", "followups", args)));

server.registerTool("crm_create_task", {
  title: "Créer une tâche commerciale",
  description: "Crée une action planifiée pour un commercial, liée ou non à un prospect.",
  inputSchema: {
    titre: z.string().min(1), description: z.string().optional(), date_echeance: dateTime.optional(),
    contact_id: z.string().uuid().optional(), assigned_to: z.string().uuid().optional(),
  },
}, async args => execute(() => callApi("POST", "tasks", args)));

server.registerTool("crm_complete_task", {
  title: "Terminer une tâche",
  description: "Marque une tâche comme terminée après confirmation qu'elle a réellement été effectuée.",
  inputSchema: { task_id: z.string().uuid() },
}, async ({ task_id }) => execute(() => callApi("PATCH", `tasks/${task_id}/complete`, {})));

server.registerTool("crm_assign_contacts", {
  title: "Affecter des prospects et organiser leur traitement",
  description: "Affecte des prospects à un commercial, transfère leurs actions ouvertes et peut créer une liste d'appels et une tâche. Demander confirmation avant une affectation en masse.",
  inputSchema: {
    contact_ids: z.array(z.string().uuid()).min(1).max(500), assigned_to: userId,
    add_to_call_list: z.boolean().default(true), call_notes: z.string().optional(),
    task: z.object({ titre: z.string().min(1), description: z.string().optional(), date_echeance: dateTime.optional() }).optional(),
  },
}, async args => execute(() => callApi("POST", "assignments", args)));

server.registerTool("crm_get_work_plan", {
  title: "Obtenir le planning commercial",
  description: "Retourne les tâches, relances et appels à effectuer pour un utilisateur entre deux dates. Adapté aux briefs quotidiens, hebdomadaires et mensuels.",
  inputSchema: { user_id: userId.optional(), from: dateTime, to: dateTime },
}, async args => execute(() => callApi("GET", "work", undefined, args)));

server.registerTool("crm_get_user_report", {
  title: "Obtenir un rapport d'activité",
  description: "Calcule le portefeuille, les interactions, les conversions, les tâches et le temps travaillé d'un commercial sur une période.",
  inputSchema: { user_id: userId.optional(), from: dateTime, to: dateTime },
}, async args => execute(() => callApi("GET", "reports", undefined, args)));

const transport = new StdioServerTransport();
await server.connect(transport);

process.on("SIGINT", async () => {
  await server.close();
  process.exit(0);
});
