import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { sendEmailViaGmail } from "../_shared/gmail.ts";
import { sendEmailViaResend } from "../_shared/resend.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface EmailPayload {
  to: string;
  subject: string;
  html: string;
  text?: string;
  attachment?: {
    filename: string;
    contentType: string;
    contentBase64: string;
  };
}

const MAX_ATTACHMENT_BASE64_LENGTH = 14_000_000;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const authorization = req.headers.get("Authorization") || "";
    const token = authorization.replace(/^Bearer\s+/i, "");
    const service = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: { user }, error: authError } = await service.auth.getUser(token);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Session invalide." }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { data: profile } = await service.from("profiles")
      .select("active, active_brand_id, brand:brands!profiles_active_brand_id_fkey(*)")
      .eq("id", user.id).maybeSingle();
    const brand = Array.isArray(profile?.brand) ? profile.brand[0] : profile?.brand;
    if (!profile?.active || !brand?.active) {
      return new Response(JSON.stringify({ error: "Profil ou espace de marque inactif." }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { to, subject, html, text, attachment }: EmailPayload = await req.json();

    if (!to || !subject || !html) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: to, subject, html" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: optedOut } = await service.from("contacts")
      .select("id")
      .eq("brand_id", profile.active_brand_id)
      .ilike("email", to.trim())
      .not("email_opted_out_at", "is", null)
      .limit(1)
      .maybeSingle();
    if (optedOut) {
      return new Response(JSON.stringify({ error: "Ce contact s'est desinscrit des emails de cet espace." }), {
        status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (attachment) {
      if (!attachment.filename || !attachment.contentBase64) {
        return new Response(
          JSON.stringify({ error: "Pièce jointe invalide." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (attachment.contentBase64.length > MAX_ATTACHMENT_BASE64_LENGTH) {
        return new Response(
          JSON.stringify({ error: "La pièce jointe dépasse la limite de 10 Mo." }),
          { status: 413, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (!/^[A-Za-z0-9+/]*={0,2}$/.test(attachment.contentBase64)) {
        return new Response(
          JSON.stringify({ error: "Le contenu de la pièce jointe est invalide." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    if (brand.email_provider === "resend") {
      const data = await sendEmailViaResend({
        to, subject, html, text, attachment,
        fromName: brand.from_name,
        fromEmail: brand.from_email,
        replyTo: brand.reply_to,
        unsubscribeEmail: brand.unsubscribe_email,
      });
      return new Response(
        JSON.stringify({ success: true, provider: "resend", id: data.id, brand: brand.code }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const data = await sendEmailViaGmail({ to, subject, html, text, attachment });

    return new Response(
      JSON.stringify({ success: true, provider: "gmail", id: data.id, threadId: data.threadId, brand: brand.code }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
