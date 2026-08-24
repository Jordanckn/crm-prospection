import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
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
      .select("role, active, active_brand_id")
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
    const targetId = String(body.id || "");

    const loadTarget = async () => {
      if (!targetId) return null;
      const { data } = await service.from("profiles")
        .select("id, email, full_name, role, active, active_brand_id, profile_brands!inner(brand_id)")
        .eq("id", targetId)
        .eq("profile_brands.brand_id", caller.active_brand_id)
        .maybeSingle();
      return data;
    };

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
        active_brand_id: caller.active_brand_id,
      }).eq("id", data.user.id);
      await service.from("profile_brands").upsert({
        profile_id: data.user.id,
        brand_id: caller.active_brand_id,
      });

      return json({ user: data.user }, 201);
    }

    if (req.method === "PATCH") {
      const id = targetId;
      if (!id) return json({ error: "Utilisateur manquant." }, 400);
      const target = await loadTarget();
      if (!target) return json({ error: "Utilisateur introuvable dans cet espace." }, 404);
      const isPrimaryAdmin = target.email.toLowerCase() === "contact@webfityou.com";
      if (id === user.id && (body.active === false || (body.role && body.role !== "admin"))) {
        return json({ error: "Vous ne pouvez pas retirer vos propres droits administrateur." }, 400);
      }
      if (isPrimaryAdmin && (
        body.active === false
        || (body.role && body.role !== "admin")
        || (body.email && String(body.email).trim().toLowerCase() !== "contact@webfityou.com")
      )) {
        return json({ error: "Le compte administrateur principal doit conserver son email, son rôle et son statut actif." }, 400);
      }

      const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : undefined;
      const fullName = typeof body.full_name === "string" ? body.full_name.trim() : undefined;
      const password = typeof body.password === "string" ? body.password : undefined;
      if (email !== undefined && !email) return json({ error: "L'email ne peut pas être vide." }, 400);
      if (fullName !== undefined && !fullName) return json({ error: "Le nom ne peut pas être vide." }, 400);
      if (password && password.length < 8) return json({ error: "Le nouveau mot de passe doit contenir au moins 8 caractères." }, 400);

      const authUpdates: Record<string, unknown> = {};
      if (email !== undefined && email !== target.email.toLowerCase()) {
        authUpdates.email = email;
        authUpdates.email_confirm = true;
      }
      if (password) authUpdates.password = password;
      if (fullName !== undefined || allowedRoles.has(String(body.role))) {
        authUpdates.user_metadata = {
          full_name: fullName ?? target.full_name,
          role: allowedRoles.has(String(body.role)) ? body.role : target.role,
        };
      }
      if (Object.keys(authUpdates).length) {
        const { error: authUpdateError } = await service.auth.admin.updateUserById(id, authUpdates);
        if (authUpdateError) return json({ error: authUpdateError.message }, 400);
      }

      const updates: Record<string, unknown> = {};
      if (fullName !== undefined) updates.full_name = fullName;
      if (email !== undefined) updates.email = email;
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

      return json({ user: data });
    }

    if (req.method === "DELETE") {
      if (!targetId) return json({ error: "Utilisateur manquant." }, 400);
      if (targetId === user.id) return json({ error: "Vous ne pouvez pas supprimer votre propre compte." }, 400);
      const target = await loadTarget();
      if (!target) return json({ error: "Utilisateur introuvable dans cet espace." }, 404);
      if (target.email.toLowerCase() === "contact@webfityou.com") {
        return json({ error: "Le compte administrateur principal ne peut pas être supprimé." }, 400);
      }

      const { data: remaining, error: transferError } = await service.rpc("admin_remove_user_from_brand", {
        p_target_user_id: targetId,
        p_reassign_to_user_id: user.id,
        p_brand_id: caller.active_brand_id,
      });
      if (transferError) throw transferError;

      if (Number(remaining) === 0) {
        const { error: deleteError } = await service.auth.admin.deleteUser(targetId);
        if (deleteError) return json({ error: `Compte désactivé, mais suppression Auth incomplète : ${deleteError.message}` }, 500);
      }

      return json({
        deleted: Number(remaining) === 0,
        removed_from_brand: true,
        reassigned_to: user.id,
        remaining_brand_accesses: Number(remaining),
      });
    }

    return json({ error: "Méthode non autorisée." }, 405);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Erreur interne." }, 500);
  }
});
