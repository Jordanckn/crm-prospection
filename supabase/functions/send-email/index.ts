import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { sendEmailViaGmail } from "../_shared/gmail.ts";
import { sendEmailViaResend } from "../_shared/resend.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface EmailPayload {
  to: string;
  subject: string;
  html: string;
  text?: string;
  contact_id?: string;
  sender_code?: string;
  attachment?: { filename: string; contentType: string; contentBase64: string };
}

const MAX_ATTACHMENT_BASE64_LENGTH = 14_000_000;
const respond = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...corsHeaders, "Content-Type": "application/json" },
});
const isIsraelCountry = (value: unknown) => {
  const normalized = String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
  return normalized === 'israel' || normalized === 'il';
};
const isFranceCountry = (value: unknown) => {
  const normalized = String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
  return normalized === 'france' || normalized === 'fr';
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== "POST") return respond({ error: "Methode non autorisee." }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const service = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: { user }, error: authError } = await service.auth.getUser(token);
    if (authError || !user) return respond({ error: "Session invalide." }, 401);

    const { data: profile } = await service.from("profiles")
      .select("active, active_brand_id, brand:brands!profiles_active_brand_id_fkey(*)")
      .eq("id", user.id).maybeSingle();
    const brand = Array.isArray(profile?.brand) ? profile.brand[0] : profile?.brand;
    if (!profile?.active || !brand?.active) return respond({ error: "Profil ou espace de marque inactif." }, 403);

    const payload = await req.json() as EmailPayload;
    const { to, subject, html, text, attachment } = payload;
    if (!to || !subject || !html) return respond({ error: "Champs obligatoires : destinataire, objet et contenu." }, 400);

    let contact: Record<string, unknown> | null = null;
    if (payload.contact_id) {
      const { data, error } = await service.from("contacts").select("*")
        .eq("id", payload.contact_id).eq("brand_id", profile.active_brand_id).maybeSingle();
      if (error) throw error;
      if (!data) return respond({ error: "Contact introuvable dans cet espace." }, 404);
      contact = data;
      if (String(contact.email || '').trim().toLowerCase() !== to.trim().toLowerCase()) {
        return respond({ error: "Le destinataire ne correspond pas à l'email du contact sélectionné." }, 400);
      }
    } else {
      // Compatibilite avec les anciennes interfaces deja publiees : rattache l'envoi
      // au contact par son email, ce qui permet aussi d'appliquer le bon routage pays.
      const { data, error } = await service.from("contacts").select("*")
        .eq("brand_id", profile.active_brand_id).ilike("email", to.trim()).limit(1).maybeSingle();
      if (error) throw error;
      contact = data || null;
    }

    const { data: optedOut } = await service.from("contacts").select("id")
      .eq("brand_id", profile.active_brand_id).ilike("email", to.trim())
      .not("email_opted_out_at", "is", null).limit(1).maybeSingle();
    if (optedOut || contact?.email_opted_out_at) return respond({ error: "Ce contact s'est desinscrit des emails de cet espace." }, 409);

    if (attachment) {
      if (!attachment.filename || !attachment.contentBase64) return respond({ error: "Piece jointe invalide." }, 400);
      if (attachment.contentBase64.length > MAX_ATTACHMENT_BASE64_LENGTH) return respond({ error: "La piece jointe depasse 10 Mo." }, 413);
      if (!/^[A-Za-z0-9+/]*={0,2}$/.test(attachment.contentBase64)) return respond({ error: "Contenu de piece jointe invalide." }, 400);
    }

    let sender = {
      code: String(brand.code), country: '', from_name: String(brand.from_name), from_email: String(brand.from_email),
      reply_to: brand.reply_to as string | null, unsubscribe_email: brand.unsubscribe_email as string | null,
      logo_url: brand.logo_url as string | null,
      secret_name: 'RESEND_API_KEY_EPIDERME' as 'RESEND_API_KEY_EPIDERME' | 'RESEND_API_KEY_EPIDERM_ISRAEL',
    };
    let routing = 'brand_default';

    if (brand.code === 'epiderme_ai') {
      let senderQuery = service.from('brand_email_senders').select('*')
        .eq('brand_id', profile.active_brand_id).eq('active', true);
      if (payload.sender_code) {
        senderQuery = senderQuery.eq('code', payload.sender_code);
        routing = 'manual_override';
      } else if (contact) {
        if (!isIsraelCountry(contact.pays) && !isFranceCountry(contact.pays)) {
          return respond({ error: "Pays du contact invalide : choisissez France ou Israël avant l'envoi." }, 400);
        }
        const country = isIsraelCountry(contact.pays) ? 'Israël' : 'France';
        senderQuery = senderQuery.eq('country', country);
        routing = 'contact_country';
      } else {
        // Compatibilite temporaire avec l'ancienne interface Netlify, qui ne transmet
        // pas encore sender_code. Une saisie libre utilise la France par defaut ; le
        // choix explicite de la nouvelle interface restera toujours prioritaire.
        senderQuery = senderQuery.eq('country', 'France');
        routing = 'legacy_manual_default_france';
      }
      const { data: configuredSender, error: senderError } = await senderQuery.maybeSingle();
      if (senderError) throw senderError;
      if (!configuredSender) return respond({ error: "Expediteur demande introuvable ou inactif. Envoi bloque." }, 400);
      sender = {
        code: configuredSender.code,
        country: configuredSender.country,
        from_name: configuredSender.from_name,
        from_email: configuredSender.from_email,
        reply_to: configuredSender.reply_to,
        unsubscribe_email: configuredSender.unsubscribe_email,
        logo_url: configuredSender.logo_url,
        secret_name: configuredSender.secret_name as 'RESEND_API_KEY_EPIDERME' | 'RESEND_API_KEY_EPIDERM_ISRAEL',
      };
    }

    let provider = 'gmail';
    let messageId = '';
    let threadId: string | undefined;
    if (brand.email_provider === "resend") {
      const data = await sendEmailViaResend({
        to, subject, html, text, attachment,
        fromName: sender.from_name, fromEmail: sender.from_email,
        replyTo: sender.reply_to, unsubscribeEmail: sender.unsubscribe_email,
        logoUrl: sender.logo_url, apiKeySecret: sender.secret_name,
      });
      provider = 'resend';
      messageId = data.id;
    } else {
      const data = await sendEmailViaGmail({ to, subject, html, text, attachment });
      messageId = data.id;
      threadId = data.threadId;
    }

    let trackingWarning: string | null = null;
    if (contact) {
      const now = new Date().toISOString();
      const { error: interactionError } = await service.from('interactions').insert({
        contact_id: contact.id,
        user_id: user.id,
        type: 'Email',
        date_heure: now,
        duree: 0,
        resultat: 'Envoyé',
        notes: `[Email manuel] ${subject} - Expediteur : ${sender.from_email} - ${provider.toUpperCase()} #${messageId}${attachment ? ` - PJ : ${attachment.filename}` : ''}`,
        brand_id: profile.active_brand_id,
      });
      if (interactionError) trackingWarning = interactionError.message;
      else await service.from('contacts').update({ derniere_interaction: now }).eq('id', contact.id);
    }

    return respond({
      success: true, provider, id: messageId, threadId, brand: brand.code,
      sender: { code: sender.code, country: sender.country, name: sender.from_name, email: sender.from_email },
      routing, interaction_recorded: Boolean(contact) && !trackingWarning,
      tracking_warning: trackingWarning,
    });
  } catch (err) {
    return respond({ error: (err as Error).message }, 500);
  }
});
