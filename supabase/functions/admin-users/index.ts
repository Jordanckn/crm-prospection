import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
  "Content-Type": "application/json",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: corsHeaders });

const allowedRoles = new Set(["admin", "editor", "contributor"]);
const normalizeRole = (value: unknown) => allowedRoles.has(String(value))
  ? String(value)
  : "contributor";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const authorization = req.headers.get("Authorization");
    if (!supabaseUrl || !serviceRoleKey || !authorization) {
      return json({ error: "Configuration ou authentification manquante." }, 401);
    }

    const service = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const token = authorization.replace(/^Bearer\s+/i, "");
    const { data: { user }, error: authError } = await service.auth.getUser(token);
    if (authError || !user) return json({ error: "Session invalide." }, 401);

    const { data: caller } = await service
      .from("profiles")
      .select("role, active")
      .eq("id", user.id)
      .maybeSingle();
    if (!caller?.active || caller.role !== "admin") {
      return json({ error: "Accès réservé aux administrateurs." }, 403);
    }

    if (req.method === "GET") {
      const { data, error } = await service
        .from("profiles")
        .select("*")
        .order("created_at", { ascending: true });
      if (error) throw error;
      return json({ users: data });
    }

    const body = await req.json();

    if (req.method === "POST") {
      const email = String(body.email || "").trim().toLowerCase();
      const password = String(body.password || "");
      const fullName = String(body.full_name || "").trim();
      const role = normalizeRole(body.role);
      if (!email || password.length < 8 || !fullName) {
        return json({ error: "Nom, email et mot de passe de 8 caractères minimum requis." }, 400);
      }

      const { data, error } = await service.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: fullName, role },
      });
      if (error) return json({ error: error.message }, 400);

      await service.from("profiles").update({
        email,
        full_name: fullName,
        role,
        active: true,
        manager_id: user.id,
      }).eq("id", data.user.id);

      return json({ user: data.user }, 201);
    }

    if (req.method === "PATCH") {
      const id = String(body.id || "");
      if (!id) return json({ error: "Utilisateur manquant." }, 400);
      if (id === user.id && (body.active === false || (body.role && body.role !== "admin"))) {
        return json({ error: "Vous ne pouvez pas retirer vos propres droits administrateur." }, 400);
      }

      const updates: Record<string, unknown> = {};
      if (typeof body.full_name === "string") updates.full_name = body.full_name.trim();
      if (allowedRoles.has(String(body.role))) updates.role = body.role;
      if (typeof body.active === "boolean") updates.active = body.active;
      updates.updated_at = new Date().toISOString();

      const { data, error } = await service
        .from("profiles")
        .update(updates)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;

      if (typeof body.password === "string" && body.password.length >= 8) {
        const { error: passwordError } = await service.auth.admin.updateUserById(id, {
          password: body.password,
        });
        if (passwordError) throw passwordError;
      }
      return json({ user: data });
    }

    return json({ error: "Méthode non autorisée." }, 405);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Erreur interne." }, 500);
  }
});
