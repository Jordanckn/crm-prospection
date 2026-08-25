import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, Idempotency-Key, X-Request-Id, Apikey",
  "Content-Type": "application/json",
};

const ALL_PERMISSIONS = [
  "contacts:read", "contacts:write", "interactions:write", "tasks:write",
  "assignments:write", "work:read", "reports:read", "users:read", "audit:read",
] as const;

type Permission = typeof ALL_PERMISSIONS[number];
type ApiResult = { status: number; body: Record<string, unknown> };
type Actor = {
  kind: "api_client" | "admin";
  clientId: string | null;
  adminUserId: string | null;
  defaultUserId: string | null;
  permissions: string[];
  name: string;
  brandId: string;
  brandCode: string;
  brandName: string;
};

class ApiError extends Error {
  constructor(public status: number, message: string, public details?: unknown) {
    super(message);
  }
}

const response = (result: ApiResult) =>
  new Response(JSON.stringify(result.body), { status: result.status, headers: corsHeaders });

const ok = (data: unknown, status = 200, meta?: unknown): ApiResult => ({
  status,
  body: meta ? { data, meta } : { data },
});

const fail = (status: number, error: string, details?: unknown): ApiResult => ({
  status,
  body: { error, ...(details === undefined ? {} : { details }) },
});

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

function makeToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const base64 = btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
  return `crm_${base64}`;
}

function cleanSearch(value: string): string {
  return value.trim().replace(/[,%()]/g, " ").slice(0, 120);
}

function integer(value: string | null, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function asString(value: unknown, max = 10_000): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function asStringArray(value: unknown, max = 500): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter(item => typeof item === "string").map(item => item.trim()).filter(Boolean))].slice(0, max);
}

function isoDate(value: unknown, field: string, nullable = true): string | null {
  if ((value === null || value === undefined || value === "") && nullable) return null;
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) throw new ApiError(400, `${field} doit être une date valide.`);
  return date.toISOString();
}

async function authenticate(service: SupabaseClient, req: Request): Promise<Actor> {
  const header = req.headers.get("Authorization") || "";
  const token = header.replace(/^Bearer\s+/i, "").trim();
  if (!token) throw new ApiError(401, "Authentification requise.");

  if (token.startsWith("crm_")) {
    const keyHash = await sha256(token);
    const { data, error } = await service.from("api_clients")
      .select("id, name, permissions, default_user_id, active, expires_at, brand_id, brands(code, name)")
      .eq("key_hash", keyHash).maybeSingle();
    if (error || !data?.active) throw new ApiError(401, "Clé API invalide ou révoquée.");
    if (data.expires_at && new Date(data.expires_at) <= new Date()) {
      throw new ApiError(401, "Cette clé API a expiré.");
    }
    void service.from("api_clients").update({ last_used_at: new Date().toISOString() }).eq("id", data.id);
    return {
      kind: "api_client",
      clientId: data.id,
      adminUserId: null,
      defaultUserId: data.default_user_id,
      permissions: Array.isArray(data.permissions) ? data.permissions : [],
      name: data.name,
      brandId: data.brand_id,
      brandCode: data.brands?.code || "unknown",
      brandName: data.brands?.name || "Espace CRM",
    };
  }

  const { data: { user }, error } = await service.auth.getUser(token);
  if (error || !user) throw new ApiError(401, "Session invalide.");
  const { data: profile, error: profileError } = await service.from("profiles")
    .select("id, full_name, role, active, active_brand_id, brands!profiles_active_brand_id_fkey(code, name)").eq("id", user.id).maybeSingle();
  if (profileError) throw new ApiError(500, "Impossible de vérifier le profil administrateur.", profileError.message);
  if (!profile?.active || profile.role !== "admin") {
    throw new ApiError(403, "Accès réservé aux administrateurs.");
  }
  return {
    kind: "admin",
    clientId: null,
    adminUserId: user.id,
    defaultUserId: user.id,
    permissions: ["*"],
    name: profile.full_name || user.email || "Administrateur",
    brandId: profile.active_brand_id,
    brandCode: profile.brands?.code || "unknown",
    brandName: profile.brands?.name || "Espace CRM",
  };
}

function requirePermission(actor: Actor, permission: Permission) {
  if (!actor.permissions.includes("*") && !actor.permissions.includes(permission)) {
    throw new ApiError(403, `Permission manquante : ${permission}.`);
  }
}

async function requireActiveUser(service: SupabaseClient, userId: string | null, brandId: string): Promise<string> {
  if (!userId) throw new ApiError(400, "Un utilisateur cible doit être indiqué.");
  const { data } = await service.from("profile_brands").select("profile_id, profiles!inner(active)")
    .eq("profile_id", userId).eq("brand_id", brandId).eq("profiles.active", true).maybeSingle();
  if (!data) throw new ApiError(400, "Utilisateur cible introuvable ou désactivé.");
  return data.profile_id;
}

async function audit(
  service: SupabaseClient,
  req: Request,
  actor: Actor,
  action: string,
  payload: unknown,
  result: ApiResult,
  entityType = "",
  entityId?: string,
) {
  const requestId = req.headers.get("X-Request-Id") || req.headers.get("Idempotency-Key") || crypto.randomUUID();
  await service.from("agent_audit_logs").insert({
    request_id: requestId,
    client_id: actor.clientId,
    admin_user_id: actor.adminUserId,
    action,
    entity_type: entityType,
    entity_id: entityId || null,
    payload: payload || {},
    result: { status: result.status, success: result.status < 400 },
    ip_address: (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || null,
    brand_id: actor.brandId,
  });
}

async function beginIdempotency(
  service: SupabaseClient,
  req: Request,
  actor: Actor,
  action: string,
  body: unknown,
): Promise<{ recordId: string; cached?: ApiResult }> {
  if (!actor.clientId) return { recordId: "" };
  const key = (req.headers.get("Idempotency-Key") || "").trim();
  if (key.length < 8 || key.length > 200) {
    throw new ApiError(400, "Idempotency-Key est obligatoire pour toute écriture et doit contenir entre 8 et 200 caractères.");
  }
  const requestHash = await sha256(`${req.method}:${new URL(req.url).pathname}:${JSON.stringify(body)}`);
  const { data, error } = await service.from("agent_idempotency").insert({
    client_id: actor.clientId,
    idempotency_key: key,
    action,
    request_hash: requestHash,
    brand_id: actor.brandId,
  }).select("id").single();
  if (!error && data) return { recordId: data.id };
  if (error?.code !== "23505") throw error;

  const { data: previous } = await service.from("agent_idempotency")
    .select("id, request_hash, state, status_code, response")
    .eq("client_id", actor.clientId).eq("idempotency_key", key).single();
  if (!previous) throw new ApiError(409, "Impossible de retrouver la requête idempotente existante.");
  if (previous.request_hash !== requestHash) {
    throw new ApiError(409, "Cette clé d'idempotence a déjà été utilisée avec une autre requête.");
  }
  if ((previous.state === "completed" || previous.state === "failed") && previous.response) {
    return { recordId: previous.id, cached: { status: previous.status_code || 200, body: previous.response } };
  }
  throw new ApiError(409, "Une requête identique est déjà en cours de traitement.");
}

async function finishIdempotency(service: SupabaseClient, recordId: string, result: ApiResult) {
  if (!recordId) return;
  await service.from("agent_idempotency").update({
    state: "completed",
    status_code: result.status,
    response: result.body,
    completed_at: new Date().toISOString(),
  }).eq("id", recordId);
}

async function failIdempotency(service: SupabaseClient, recordId: string, result: ApiResult) {
  if (!recordId) return;
  await service.from("agent_idempotency").update({
    state: "failed",
    status_code: result.status,
    response: result.body,
    completed_at: new Date().toISOString(),
  }).eq("id", recordId);
}

async function route(
  service: SupabaseClient,
  req: Request,
  actor: Actor,
  method: string,
  parts: string[],
  body: Record<string, unknown>,
): Promise<{ result: ApiResult; action: string; entityType?: string; entityId?: string }> {
  const url = new URL(req.url);
  const resource = parts[0] || "";
  const id = parts[1] || "";

  if (method === "GET" && !resource) {
    return { action: "api.describe", result: ok({
      name: `${actor.brandName} CRM API`, version: "1.1.0", brand: { id: actor.brandId, code: actor.brandCode, name: actor.brandName },
      capabilities: ["contacts", "interactions", "followups", "tasks", "assignments", "work", "reports", "users", "audit"],
    }) };
  }

  if (method === "GET" && resource === "health") {
    return { action: "api.health", result: ok({ status: "ok", actor: actor.name, brand: { code: actor.brandCode, name: actor.brandName }, time: new Date().toISOString() }) };
  }

  if (resource === "clients") {
    if (actor.kind !== "admin") throw new ApiError(403, "La gestion des clés est réservée à l'administrateur humain.");
    if (method === "GET") {
      const { data, error } = await service.from("api_clients")
        .select("id, name, key_prefix, permissions, default_user_id, active, last_used_at, expires_at, created_at, brand_id, brands(code, name)")
        .eq("brand_id", actor.brandId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return { action: "clients.list", entityType: "api_client", result: ok(data || []) };
    }
    if (method === "POST" && !id) {
      const name = asString(body.name, 120);
      if (!name) throw new ApiError(400, "Le nom de l'intégration est obligatoire.");
      const requested = asStringArray(body.permissions, ALL_PERMISSIONS.length);
      const permissions = requested.length ? requested : [...ALL_PERMISSIONS];
      const invalid = permissions.filter(permission => !ALL_PERMISSIONS.includes(permission as Permission));
      if (invalid.length) throw new ApiError(400, "Permissions inconnues.", invalid);
      const defaultUserId = body.default_user_id ? await requireActiveUser(service, asString(body.default_user_id, 60), actor.brandId) : null;
      const expiresAt = body.expires_at
        ? isoDate(body.expires_at, "expires_at")
        : new Date(Date.now() + 365 * 86_400_000).toISOString();
      const token = makeToken();
      const keyHash = await sha256(token);
      const { data, error } = await service.from("api_clients").insert({
        name,
        key_hash: keyHash,
        key_prefix: token.slice(0, 12),
        permissions,
        default_user_id: defaultUserId,
        expires_at: expiresAt,
        created_by: actor.adminUserId,
        brand_id: actor.brandId,
      }).select("id, name, key_prefix, permissions, default_user_id, active, expires_at, created_at, brand_id").single();
      if (error) throw error;
      return { action: "clients.create", entityType: "api_client", entityId: data.id, result: ok({ ...data, token }, 201) };
    }
    if (method === "PATCH" && id) {
      const updates: Record<string, unknown> = {};
      if (typeof body.active === "boolean") updates.active = body.active;
      if (body.name !== undefined) updates.name = asString(body.name, 120);
      if (body.default_user_id !== undefined) {
        updates.default_user_id = body.default_user_id ? await requireActiveUser(service, asString(body.default_user_id, 60), actor.brandId) : null;
      }
      const { data, error } = await service.from("api_clients").update(updates).eq("id", id).eq("brand_id", actor.brandId)
        .select("id, name, key_prefix, permissions, default_user_id, active, last_used_at, expires_at, created_at").single();
      if (error) throw new ApiError(404, "Intégration introuvable.");
      return { action: "clients.update", entityType: "api_client", entityId: id, result: ok(data) };
    }
  }

  if (method === "GET" && resource === "users") {
    requirePermission(actor, "users:read");
    const { data, error } = await service.from("profiles")
      .select("id, full_name, email, role, active, profile_brands!inner(brand_id)")
      .eq("profile_brands.brand_id", actor.brandId).order("full_name");
    if (error) throw error;
    return { action: "users.list", entityType: "profile", result: ok(data || []) };
  }

  if (resource === "contacts" && method === "GET" && !id) {
    requirePermission(actor, "contacts:read");
    const page = integer(url.searchParams.get("page"), 1, 1, 100_000);
    const limit = integer(url.searchParams.get("limit"), 50, 1, 200);
    let query = service.from("contacts").select("*, assigned_user:profiles!contacts_assigned_to_fkey(id, full_name, email)", { count: "exact" }).eq("brand_id", actor.brandId);
    const search = cleanSearch(url.searchParams.get("query") || "");
    if (search) query = query.or(`prenom.ilike.%${search}%,nom.ilike.%${search}%,entreprise.ilike.%${search}%,email.ilike.%${search}%,telephone.ilike.%${search}%,site_web.ilike.%${search}%,instagram.ilike.%${search}%,facebook.ilike.%${search}%,linkedin.ilike.%${search}%,twitter.ilike.%${search}%`);
    const assignedTo = url.searchParams.get("assigned_to");
    if (assignedTo) query = query.eq("assigned_to", assignedTo);
    const status = url.searchParams.get("status");
    if (status) query = query.eq("statut", status);
    const { data, error, count } = await query.order("updated_at", { ascending: false }).range((page - 1) * limit, page * limit - 1);
    if (error) throw error;
    return { action: "contacts.search", entityType: "contact", result: ok(data || [], 200, { page, limit, total: count || 0 }) };
  }

  if (resource === "contacts" && method === "GET" && id) {
    requirePermission(actor, "contacts:read");
    const [contactRes, interactionRes, taskRes] = await Promise.all([
      service.from("contacts").select("*, assigned_user:profiles!contacts_assigned_to_fkey(id, full_name, email)").eq("id", id).eq("brand_id", actor.brandId).maybeSingle(),
      service.from("interactions").select("*").eq("contact_id", id).eq("brand_id", actor.brandId).order("date_heure", { ascending: false }).limit(100),
      service.from("taches").select("*").eq("contact_id", id).eq("brand_id", actor.brandId).order("date_echeance", { ascending: true }),
    ]);
    if (!contactRes.data) throw new ApiError(404, "Contact introuvable.");
    return { action: "contacts.get", entityType: "contact", entityId: id, result: ok({ ...contactRes.data, interactions: interactionRes.data || [], tasks: taskRes.data || [] }) };
  }

  if (resource === "contacts" && method === "POST" && !id) {
    requirePermission(actor, "contacts:write");
    const assignedTo = await requireActiveUser(service, asString(body.assigned_to, 60) || actor.defaultUserId, actor.brandId);
    const payload = {
      prenom: asString(body.prenom, 120), nom: asString(body.nom, 120), email: asString(body.email, 320),
      telephone: asString(body.telephone, 80), entreprise: asString(body.entreprise, 200),
      statut: ["Nouveau", "En cours", "Converti", "Perdu"].includes(asString(body.statut, 30)) ? body.statut : "Nouveau",
      pays: asString(body.pays, 80) || "France", secteur_activite: asString(body.secteur_activite, 160),
      adresse: asString(body.adresse, 300), ville: asString(body.ville, 120), code_postal: asString(body.code_postal, 30),
      notes_entreprise: asString(body.notes_entreprise), tags: asStringArray(body.tags, 50),
      site_web: asString(body.site_web, 500),
      instagram: asString(body.instagram, 500), facebook: asString(body.facebook, 500),
      linkedin: asString(body.linkedin, 500), twitter: asString(body.twitter ?? body.x, 500),
      assigned_to: assignedTo, created_by: assignedTo,
      brand_id: actor.brandId,
    };
    if (!payload.prenom && !payload.nom && !payload.entreprise) throw new ApiError(400, "Indiquez au moins un nom ou une entreprise.");
    const { data, error } = await service.from("contacts").insert(payload).select().single();
    if (error) throw error;
    return { action: "contacts.create", entityType: "contact", entityId: data.id, result: ok(data, 201) };
  }

  if (resource === "contacts" && method === "PATCH" && id) {
    requirePermission(actor, "contacts:write");
    const allowed = ["prenom", "nom", "email", "telephone", "entreprise", "statut", "pays", "secteur_activite", "adresse", "ville", "code_postal", "notes_entreprise", "site_web", "instagram", "facebook", "linkedin", "twitter"];
    const updates: Record<string, unknown> = {};
    for (const field of allowed) if (body[field] !== undefined) updates[field] = asString(body[field], field === "notes_entreprise" ? 10_000 : 500);
    if (body.x !== undefined && body.twitter === undefined) updates.twitter = asString(body.x, 500);
    if (body.tags !== undefined) updates.tags = asStringArray(body.tags, 50);
    if (body.assigned_to !== undefined) {
      requirePermission(actor, "assignments:write");
      updates.assigned_to = await requireActiveUser(service, asString(body.assigned_to, 60), actor.brandId);
    }
    const { data, error } = await service.from("contacts").update(updates).eq("id", id).eq("brand_id", actor.brandId).select().single();
    if (error) throw new ApiError(404, "Contact introuvable.");
    return { action: "contacts.update", entityType: "contact", entityId: id, result: ok(data) };
  }

  if (resource === "interactions" && method === "POST") {
    requirePermission(actor, "interactions:write");
    const contactId = asString(body.contact_id, 60);
    const { data: contact } = await service.from("contacts").select("id, assigned_to").eq("id", contactId).eq("brand_id", actor.brandId).maybeSingle();
    if (!contact) throw new ApiError(404, "Contact introuvable.");
    const userId = await requireActiveUser(service, asString(body.user_id, 60) || contact.assigned_to || actor.defaultUserId, actor.brandId);
    const type = asString(body.type, 30) || "Appel";
    if (!["Appel", "Email", "WhatsApp", "SMS", "Facebook", "Instagram"].includes(type)) throw new ApiError(400, "Type d'interaction invalide.");
    const { data, error } = await service.from("interactions").insert({
      contact_id: contactId, user_id: userId, type,
      date_heure: isoDate(body.date_heure, "date_heure") || new Date().toISOString(),
      duree: Math.max(0, Number(body.duree) || 0), resultat: asString(body.resultat, 80), notes: asString(body.notes),
      brand_id: actor.brandId,
    }).select().single();
    if (error) throw error;
    return { action: "interactions.create", entityType: "interaction", entityId: data.id, result: ok(data, 201) };
  }

  if (resource === "followups" && method === "POST") {
    requirePermission(actor, "contacts:write");
    requirePermission(actor, "interactions:write");
    if (body.task) requirePermission(actor, "tasks:write");
    const assignedTo = await requireActiveUser(service, asString(body.assigned_to, 60) || actor.defaultUserId, actor.brandId);
    const contactPayload = { ...asObject(body.contact), _brand_id: actor.brandId };
    const { data, error } = await service.rpc("crm_agent_record_followup", {
      p_contact_id: asString(body.contact_id, 60) || null,
      p_contact: contactPayload,
      p_interaction: asObject(body.interaction),
      p_task: body.task ? asObject(body.task) : null,
      p_assigned_to: assignedTo,
    });
    if (error) throw new ApiError(400, error.message);
    const socialUpdates: Record<string, string> = {};
    for (const field of ["instagram", "facebook", "linkedin", "twitter"] as const) {
      if (contactPayload[field] !== undefined) socialUpdates[field] = asString(contactPayload[field], 500);
    }
    if (contactPayload.x !== undefined && contactPayload.twitter === undefined) socialUpdates.twitter = asString(contactPayload.x, 500);
    if (Object.keys(socialUpdates).length && data?.contact_id) {
      const { error: socialError } = await service.from("contacts").update(socialUpdates)
        .eq("id", data.contact_id).eq("brand_id", actor.brandId);
      if (socialError) throw socialError;
    }
    return { action: "followups.record", entityType: "contact", entityId: data?.contact_id, result: ok(data, 201) };
  }

  if (resource === "tasks" && method === "POST" && !id) {
    requirePermission(actor, "tasks:write");
    const contactId = asString(body.contact_id, 60) || null;
    let inferredUser: string | null = null;
    if (contactId) {
      const { data: contact } = await service.from("contacts").select("assigned_to").eq("id", contactId).eq("brand_id", actor.brandId).maybeSingle();
      if (!contact) throw new ApiError(404, "Contact introuvable.");
      inferredUser = contact.assigned_to;
    }
    const assignedTo = await requireActiveUser(service, asString(body.assigned_to, 60) || inferredUser || actor.defaultUserId, actor.brandId);
    const title = asString(body.titre, 300);
    if (!title) throw new ApiError(400, "Le titre de la tâche est obligatoire.");
    const { data, error } = await service.from("taches").insert({
      contact_id: contactId, titre: title, description: asString(body.description),
      date_echeance: isoDate(body.date_echeance, "date_echeance"), statut: "En attente",
      assigned_to: assignedTo, created_by: assignedTo,
      brand_id: actor.brandId,
    }).select().single();
    if (error) throw error;
    return { action: "tasks.create", entityType: "task", entityId: data.id, result: ok(data, 201) };
  }

  if (resource === "tasks" && method === "PATCH" && id && parts[2] === "complete") {
    requirePermission(actor, "tasks:write");
    const { data, error } = await service.from("taches").update({ statut: "Terminé" }).eq("id", id).eq("brand_id", actor.brandId).select().single();
    if (error) throw new ApiError(404, "Tâche introuvable.");
    return { action: "tasks.complete", entityType: "task", entityId: id, result: ok(data) };
  }

  if (resource === "assignments" && method === "POST") {
    requirePermission(actor, "assignments:write");
    const contactIds = asStringArray(body.contact_ids, 500);
    if (!contactIds.length) throw new ApiError(400, "Aucun contact à affecter.");
    const assignedTo = await requireActiveUser(service, asString(body.assigned_to, 60), actor.brandId);
    const { data: scopedContacts } = await service.from("contacts").select("id").in("id", contactIds).eq("brand_id", actor.brandId);
    if ((scopedContacts || []).length !== contactIds.length) throw new ApiError(400, "Un ou plusieurs contacts n'appartiennent pas a cet espace.");
    const { error } = await service.from("contacts").update({ assigned_to: assignedTo }).in("id", contactIds).eq("brand_id", actor.brandId);
    if (error) throw error;
    await service.from("taches").update({ assigned_to: assignedTo }).in("contact_id", contactIds).eq("statut", "En attente");
    await service.from("liste_appels").delete().in("contact_id", contactIds).neq("statut", "traite");
    let callsCreated = 0;
    if (body.add_to_call_list !== false) {
      const { data: rows } = await service.from("liste_appels").select("ordre").eq("user_id", assignedTo).order("ordre", { ascending: false }).limit(1);
      let order = (rows?.[0]?.ordre ?? -1) + 1;
      const calls = contactIds.map(contactId => ({ user_id: assignedTo, contact_id: contactId, ordre: order++, notes_prep: asString(body.call_notes), statut: "en_attente", brand_id: actor.brandId }));
      const { error: callError } = await service.from("liste_appels").insert(calls);
      if (callError) throw callError;
      callsCreated = calls.length;
    }
    const task = asObject(body.task);
    let tasksCreated = 0;
    if (asString(task.titre, 300)) {
      const tasks = contactIds.map(contactId => ({
        contact_id: contactId, titre: asString(task.titre, 300), description: asString(task.description),
        date_echeance: isoDate(task.date_echeance, "task.date_echeance"), statut: "En attente",
        assigned_to: assignedTo, created_by: assignedTo,
        brand_id: actor.brandId,
      }));
      const { error: taskError } = await service.from("taches").insert(tasks);
      if (taskError) throw taskError;
      tasksCreated = tasks.length;
    }
    return { action: "assignments.create", entityType: "contact", result: ok({ contacts_assigned: contactIds.length, calls_created: callsCreated, tasks_created: tasksCreated }) };
  }

  if (resource === "work" && method === "GET") {
    requirePermission(actor, "work:read");
    const userId = await requireActiveUser(service, url.searchParams.get("user_id") || actor.defaultUserId, actor.brandId);
    const from = isoDate(url.searchParams.get("from") || new Date().toISOString().slice(0, 10), "from", false)!;
    const defaultTo = new Date(new Date(from).getTime() + 7 * 86_400_000).toISOString();
    const to = isoDate(url.searchParams.get("to") || defaultTo, "to", false)!;
    const [tasks, relances, calls] = await Promise.all([
      service.from("taches").select("*, contacts(id, prenom, nom, entreprise, telephone, email)").eq("assigned_to", userId).eq("brand_id", actor.brandId).eq("statut", "En attente").gte("date_echeance", from).lte("date_echeance", to).order("date_echeance"),
      service.from("relances").select("*, contacts!inner(id, prenom, nom, entreprise, telephone, email, assigned_to)").eq("contacts.assigned_to", userId).eq("brand_id", actor.brandId).eq("statut", "en_attente").gte("date_relance", from.slice(0, 10)).lte("date_relance", to.slice(0, 10)).order("date_relance"),
      service.from("liste_appels").select("*, contacts(id, prenom, nom, entreprise, telephone, email)").eq("user_id", userId).eq("brand_id", actor.brandId).neq("statut", "traite").order("ordre"),
    ]);
    return { action: "work.get", entityType: "profile", entityId: userId, result: ok({ user_id: userId, from, to, tasks: tasks.data || [], followups: relances.data || [], call_list: calls.data || [] }) };
  }

  if (resource === "reports" && method === "GET") {
    requirePermission(actor, "reports:read");
    const userId = await requireActiveUser(service, url.searchParams.get("user_id") || actor.defaultUserId, actor.brandId);
    const from = isoDate(url.searchParams.get("from") || new Date().toISOString().slice(0, 10), "from", false)!;
    const to = isoDate(url.searchParams.get("to") || new Date().toISOString(), "to", false)!;
    const [contacts, interactions, tasks, sessions] = await Promise.all([
      service.from("contacts").select("id, statut").eq("assigned_to", userId).eq("brand_id", actor.brandId),
      service.from("interactions").select("type, resultat, duree").eq("user_id", userId).eq("brand_id", actor.brandId).gte("date_heure", from).lte("date_heure", to),
      service.from("taches").select("statut, updated_at").eq("assigned_to", userId).eq("brand_id", actor.brandId).gte("updated_at", from).lte("updated_at", to),
      service.from("sessions_travail").select("duree_minutes, debut, fin").eq("user_id", userId).eq("brand_id", actor.brandId).gte("debut", from).lte("debut", to),
    ]);
    const activity = interactions.data || [];
    const taskRows = tasks.data || [];
    const minutes = (sessions.data || []).reduce((sum, session) => sum + (session.duree_minutes || (session.fin ? Math.max(0, Math.round((new Date(session.fin).getTime() - new Date(session.debut).getTime()) / 60_000)) : 0)), 0);
    const report = {
      user_id: userId, from, to,
      portfolio: { total: contacts.data?.length || 0, converted: (contacts.data || []).filter(contact => contact.statut === "Converti").length },
      interactions: {
        total: activity.length,
        calls: activity.filter(item => item.type === "Appel").length,
        messages: activity.filter(item => item.type !== "Appel").length,
        interested: activity.filter(item => item.resultat === "Intéressé").length,
        answered: activity.filter(item => item.resultat === "Répondu" || item.resultat === "Intéressé").length,
        call_minutes: activity.filter(item => item.type === "Appel").reduce((sum, item) => sum + (item.duree || 0), 0),
      },
      tasks: { total: taskRows.length, completed: taskRows.filter(task => task.statut === "Terminé").length, pending: taskRows.filter(task => task.statut === "En attente").length },
      work_minutes: minutes,
    };
    return { action: "reports.get", entityType: "profile", entityId: userId, result: ok(report) };
  }

  if (resource === "audit" && method === "GET") {
    requirePermission(actor, "audit:read");
    const limit = integer(url.searchParams.get("limit"), 50, 1, 200);
    let query = service.from("agent_audit_logs").select("id, request_id, client_id, admin_user_id, action, entity_type, entity_id, result, created_at");
    query = query.eq("brand_id", actor.brandId);
    if (url.searchParams.get("client_id")) query = query.eq("client_id", url.searchParams.get("client_id"));
    const { data, error } = await query.order("created_at", { ascending: false }).limit(limit);
    if (error) throw error;
    return { action: "audit.list", entityType: "audit", result: ok(data || []) };
  }

  throw new ApiError(404, "Route API introuvable.");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) return response(fail(500, "Configuration Supabase manquante."));
  const service = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });

  try {
    const actor = await authenticate(service, req);
    const url = new URL(req.url);
    const pathParts = url.pathname.split("/").filter(Boolean);
    const marker = pathParts.findIndex(part => part === "crm-api");
    const parts = pathParts.slice(marker >= 0 ? marker + 1 : 0);
    const method = req.method.toUpperCase();
    const body = method === "GET" ? {} : asObject(await req.json().catch(() => ({})));
    const actionHint = `${method.toLowerCase()}.${parts.join(".") || "root"}`;
    const idempotency = method === "GET" || (parts[0] === "clients" && actor.kind === "admin")
      ? { recordId: "" }
      : await beginIdempotency(service, req, actor, actionHint, body);
    if (idempotency.cached) return response(idempotency.cached);

    try {
      const routed = await route(service, req, actor, method, parts, body);
      await finishIdempotency(service, idempotency.recordId, routed.result);
      if (method !== "GET") {
        await audit(service, req, actor, routed.action, body, routed.result, routed.entityType, routed.entityId);
      }
      return response(routed.result);
    } catch (error) {
      const result = error instanceof ApiError
        ? fail(error.status, error.message, error.details)
        : fail(500, error instanceof Error ? error.message : "Erreur interne.");
      await failIdempotency(service, idempotency.recordId, result);
      if (method !== "GET") await audit(service, req, actor, actionHint, body, result);
      return response(result);
    }
  } catch (error) {
    if (error instanceof ApiError) return response(fail(error.status, error.message, error.details));
    console.error(error);
    return response(fail(500, error instanceof Error ? error.message : "Erreur interne."));
  }
});
