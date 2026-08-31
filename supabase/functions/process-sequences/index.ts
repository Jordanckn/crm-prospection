import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.57.4";
import { sendEmailViaGmail } from "../_shared/gmail.ts";
import { sendEmailViaResend } from "../_shared/resend.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

type SequenceStep = { delay_days: number; template_id: string; subject?: string };
type RequestBody = {
  source?: "cron" | "manual";
  sequence_id?: string;
  enrollment_id?: string;
  force?: boolean;
};

const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json" },
});

const relation = <T>(value: T | T[] | null | undefined): T | null =>
  Array.isArray(value) ? value[0] || null : value || null;

const isIsraelCountry = (value: unknown) => {
  const normalized = String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
  return normalized === 'israel' || normalized === 'il';
};

const isFranceCountry = (value: unknown) => {
  const normalized = String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
  return normalized === 'france' || normalized === 'fr';
};

async function requireAdmin(service: SupabaseClient, req: Request) {
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) throw new Error("AUTH:Session administrateur requise.");
  const { data: { user }, error } = await service.auth.getUser(token);
  if (error || !user) throw new Error("AUTH:Session administrateur invalide.");
  const { data: profile } = await service.from("profiles")
    .select("id, role, active, active_brand_id")
    .eq("id", user.id).maybeSingle();
  if (!profile?.active || profile.role !== "admin") {
    throw new Error("AUTH:Cette action est reservee aux administrateurs.");
  }
  return profile as { id: string; active_brand_id: string };
}

async function rewriteWithAi(html: string, apiKey: string, model: string, supabaseUrl: string) {
  if (!apiKey) return html;
  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
        "HTTP-Referer": supabaseUrl,
        "X-Title": "WebFitYou CRM",
      },
      body: JSON.stringify({
        model: model || "openai/gpt-4o",
        messages: [
          { role: "system", content: "Reecris cet email commercial en francais avec un ton professionnel et naturel. Preserve strictement le sens, les informations, les liens, les images et les balises HTML. Retourne uniquement le HTML." },
          { role: "user", content: html },
        ],
        temperature: 0.85,
        max_tokens: 4000,
      }),
    });
    if (!response.ok) return html;
    const data = await response.json();
    return data.choices?.[0]?.message?.content || html;
  } catch {
    return html;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Methode non autorisee." }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const service = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  let runId: string | null = null;
  let enrollmentId: string | null = null;
  let attemptId: string | null = null;

  try {
    const body = await req.json().catch(() => ({})) as RequestBody;
    const source = body.source === "manual" ? "manual" : "cron";
    let admin: { id: string; active_brand_id: string } | null = null;

    if (source === "manual") {
      admin = await requireAdmin(service, req);
      if (body.sequence_id) {
        const { data: sequence } = await service.from("email_sequences")
          .select("id, brand_id").eq("id", body.sequence_id).maybeSingle();
        if (!sequence || sequence.brand_id !== admin.active_brand_id) {
          return jsonResponse({ error: "Sequence introuvable dans cet espace." }, 404);
        }
      }
      if (body.enrollment_id) {
        const { data: enrollment } = await service.from("email_sequence_enrollments")
          .select("id, brand_id").eq("id", body.enrollment_id).maybeSingle();
        if (!enrollment || enrollment.brand_id !== admin.active_brand_id) {
          return jsonResponse({ error: "Inscription introuvable dans cet espace." }, 404);
        }
      }
    }

    const { data: startedRun, error: runError } = await service.rpc("begin_email_sequence_run", {
      p_source: source,
      p_brand_id: admin?.active_brand_id || null,
      p_triggered_by: admin?.id || null,
    });
    if (runError) throw runError;
    runId = startedRun as string | null;
    if (!runId) return jsonResponse({ message: "Moteur deja execute recemment.", processed: 0, skipped: true });

    const { data: claimed, error: claimError } = await service.rpc("claim_email_sequence_enrollment", {
      p_sequence_id: body.sequence_id || null,
      p_enrollment_id: body.enrollment_id || null,
      p_force: source === "manual" && body.force === true,
    });
    if (claimError) throw claimError;
    enrollmentId = claimed as string | null;
    if (!enrollmentId) {
      await service.from("email_sequence_runs").update({ status: "completed", finished_at: new Date().toISOString() }).eq("id", runId);
      return jsonResponse({ message: "Aucun email a envoyer.", processed: 0, run_id: runId });
    }

    const { data: enrollment, error: enrollmentError } = await service.from("email_sequence_enrollments")
      .select("*, email_sequences(*), contacts(*), brands(*)")
      .eq("id", enrollmentId).single();
    if (enrollmentError) throw enrollmentError;

    const sequence = relation(enrollment.email_sequences) as Record<string, unknown> | null;
    const contact = relation(enrollment.contacts) as Record<string, unknown> | null;
    const brand = relation(enrollment.brands) as Record<string, unknown> | null;
    if (!sequence || !contact || !brand) throw new Error("Donnees de sequence, prospect ou marque introuvables.");
    await service.from("email_sequence_runs").update({ brand_id: enrollment.brand_id }).eq("id", runId);

    if (contact.email_opted_out_at) {
      await service.from("email_sequence_enrollments").update({
        statut: "cancelled", execution_status: "cancelled", processing_started_at: null,
        processing_step: null, last_error: "Contact desinscrit des emails.", updated_at: new Date().toISOString(),
      }).eq("id", enrollmentId);
      await service.from("email_sequence_runs").update({
        status: "completed", finished_at: new Date().toISOString(), processed_count: 1,
      }).eq("id", runId);
      return jsonResponse({ message: "Contact desinscrit, sequence annulee.", processed: 1, run_id: runId });
    }

    const steps = (sequence.etapes || []) as SequenceStep[];
    const currentStep = Number(enrollment.etape_courante || 0);
    if (currentStep >= steps.length) {
      await service.from("email_sequence_enrollments").update({
        statut: "completed", execution_status: "completed", processing_started_at: null,
        processing_step: null, updated_at: new Date().toISOString(),
      }).eq("id", enrollmentId);
      await service.from("email_sequence_runs").update({ status: "completed", finished_at: new Date().toISOString() }).eq("id", runId);
      return jsonResponse({ message: "Sequence deja terminee.", processed: 0, run_id: runId });
    }

    const step = steps[currentStep];
    const { data: template, error: templateError } = await service.from("templates")
      .select("*").eq("id", step.template_id).eq("brand_id", enrollment.brand_id).maybeSingle();
    if (templateError) throw templateError;
    if (!template) throw new Error(`Template introuvable pour l'etape ${currentStep + 1}.`);
    if (!contact.email || contact.brand_id !== enrollment.brand_id) throw new Error("Prospect sans email valide ou rattache a une autre marque.");

    let emailSender = {
      code: String(brand.code || ''),
      from_name: String(brand.from_name || ''),
      from_email: String(brand.from_email || ''),
      reply_to: brand.reply_to ? String(brand.reply_to) : null,
      unsubscribe_email: brand.unsubscribe_email ? String(brand.unsubscribe_email) : null,
      logo_url: brand.logo_url ? String(brand.logo_url) : null,
      secret_name: 'RESEND_API_KEY_EPIDERME' as 'RESEND_API_KEY_EPIDERME' | 'RESEND_API_KEY_EPIDERM_ISRAEL',
    };
    if (brand.code === 'epiderme_ai') {
      if (!isIsraelCountry(contact.pays) && !isFranceCountry(contact.pays)) {
        throw new Error("Pays du contact invalide : choisissez France ou Israël avant l'envoi pour éviter d'utiliser la mauvaise identité.");
      }
      const country = isIsraelCountry(contact.pays) ? 'Israël' : 'France';
      const { data: routedSender, error: senderError } = await service.from('brand_email_senders')
        .select('*').eq('brand_id', enrollment.brand_id).eq('country', country).eq('active', true).maybeSingle();
      if (senderError) throw senderError;
      if (!routedSender) throw new Error(`Aucun expediteur actif configure pour ${country}. Envoi bloque pour eviter un melange de marque.`);
      emailSender = {
        code: routedSender.code,
        from_name: routedSender.from_name,
        from_email: routedSender.from_email,
        reply_to: routedSender.reply_to,
        unsubscribe_email: routedSender.unsubscribe_email,
        logo_url: routedSender.logo_url,
        secret_name: routedSender.secret_name as 'RESEND_API_KEY_EPIDERME' | 'RESEND_API_KEY_EPIDERM_ISRAEL',
      };
    }

    const { data: attempt, error: attemptError } = await service.from("email_sequence_attempts").insert({
      run_id: runId,
      enrollment_id: enrollmentId,
      sequence_id: enrollment.sequence_id,
      contact_id: enrollment.contact_id,
      brand_id: enrollment.brand_id,
      step_index: currentStep,
      scheduled_for: enrollment.prochaine_execution,
      template_id: step.template_id,
      recipient_email: String(contact.email),
      subject: step.subject || template.objet || template.titre,
      sender_code: emailSender.code,
      from_email: emailSender.from_email,
      status: "processing",
    }).select("id").single();
    if (attemptError) throw attemptError;
    attemptId = attempt.id;

    let html = String(template.contenu || "")
      .replace(/\{prenom\}/g, String(contact.prenom || ""))
      .replace(/\{nom\}/g, String(contact.nom || ""))
      .replace(/\{entreprise\}/g, String(contact.entreprise || ""))
      .replace(/\{email\}/g, String(contact.email || ""))
      .replace(/\{telephone\}/g, String(contact.telephone || ""));
    if (!/<[a-z][\s\S]*>/i.test(html)) {
      html = `<div style="font-family:Arial,sans-serif;white-space:pre-wrap;">${html}</div>`;
    }

    if (sequence.rewrite_ia !== false && contact.assigned_to) {
      const { data: settings } = await service.from("app_settings").select("cle, valeur")
        .eq("user_id", contact.assigned_to).eq("brand_id", enrollment.brand_id)
        .in("cle", ["openrouter_api_key", "ai_model"]);
      const openrouterKey = settings?.find(item => item.cle === "openrouter_api_key")?.valeur || "";
      const model = settings?.find(item => item.cle === "ai_model")?.valeur || "openai/gpt-4o";
      html = await rewriteWithAi(html, openrouterKey, model, supabaseUrl);
    }

    const subject = step.subject || template.objet || template.titre;
    let provider = "gmail";
    let providerMessageId = "";
    if (brand.email_provider === "resend") {
      const result = await sendEmailViaResend({
        to: String(contact.email), subject, html,
        fromName: emailSender.from_name, fromEmail: emailSender.from_email,
        replyTo: emailSender.reply_to,
        unsubscribeEmail: emailSender.unsubscribe_email,
        logoUrl: emailSender.logo_url,
        idempotencyKey: `sequence-${enrollmentId}-${currentStep}`,
        apiKeySecret: emailSender.secret_name,
      });
      provider = "resend";
      providerMessageId = result.id;
    } else {
      const result = await sendEmailViaGmail({ to: String(contact.email), subject, html });
      providerMessageId = result.id;
    }

    const { error: completeError } = await service.rpc("complete_email_sequence_step", {
      p_enrollment_id: enrollmentId,
      p_attempt_id: attemptId,
      p_provider: provider,
      p_provider_message_id: providerMessageId,
      p_subject: subject,
      p_from_email: emailSender.from_email,
    });
    if (completeError) throw new Error(`Email envoye (${providerMessageId}) mais suivi CRM incomplet : ${completeError.message}`);

    await service.from("email_sequence_runs").update({
      status: "completed", finished_at: new Date().toISOString(),
      processed_count: 1, success_count: 1,
    }).eq("id", runId);
    return jsonResponse({ message: "Email de sequence envoye.", processed: 1, success: 1, errors: 0, run_id: runId });
  } catch (error) {
    const message = error instanceof Error ? error.message.replace(/^AUTH:/, "") : "Erreur inconnue du moteur de sequences.";
    const isAuth = error instanceof Error && error.message.startsWith("AUTH:");
    if (enrollmentId) {
      if (attemptId) {
        await service.rpc("fail_email_sequence_step", { p_enrollment_id: enrollmentId, p_attempt_id: attemptId, p_error: message });
      } else {
        await service.from("email_sequence_enrollments").update({
          execution_status: "error", last_error: message, processing_started_at: null,
          processing_step: null, updated_at: new Date().toISOString(),
        }).eq("id", enrollmentId);
      }
    }
    if (runId) {
      await service.from("email_sequence_runs").update({
        status: "failed", finished_at: new Date().toISOString(), processed_count: enrollmentId ? 1 : 0,
        error_count: 1, error: message,
      }).eq("id", runId);
    }
    return jsonResponse({ error: message, processed: enrollmentId ? 1 : 0, errors: 1, run_id: runId }, isAuth ? 401 : 500);
  }
});
