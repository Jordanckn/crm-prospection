import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { sendEmailViaGmail } from "../_shared/gmail.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface SequenceStep {
  delay_days: number;
  template_id: string;
  subject: string;
}

function humanDelay(baseMinutes: number, aleaPourcent: number): number {
  const variation = baseMinutes * (aleaPourcent / 100);
  const randomFactor = (Math.random() * 2 - 1) * variation;
  const extraJitter = Math.random() * (baseMinutes * 0.15);
  return Math.max(30, Math.round((baseMinutes + randomFactor + extraJitter) * 60 * 1000));
}

async function rewriteWithAi(
  html: string,
  openrouterKey: string,
  model: string,
  supabaseUrl: string
): Promise<string> {
  if (!openrouterKey) return html;

  try {
    const systemPrompt = `Tu es un assistant specialise dans la reecriture d'emails commerciaux.
Tu recois un email HTML et tu dois le recrire en:
- Gardant EXACTEMENT le meme sens et le meme objectif commercial
- Changeant les formulations, tournures de phrases, synonymes
- Variant la structure (ordre des phrases, ponctuation, longueur)
- Gardant un ton professionnel et naturel en francais
- Preservant les balises HTML importantes (liens, images, mise en forme)
- Ne PAS ajouter ou supprimer d'informations
- Ne PAS changer les donnees specifiques (noms, chiffres, liens, coordonnees)

IMPORTANT: Retourne UNIQUEMENT le HTML reecrit, sans explication ni commentaire.`;

    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${openrouterKey}`,
        "HTTP-Referer": supabaseUrl,
        "X-Title": "WebFitYou CRM",
      },
      body: JSON.stringify({
        model: model || "openai/gpt-4o",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `Reecris cet email en gardant le meme sens mais en changeant les formulations:\n\n${html}` },
        ],
        temperature: 0.85,
        max_tokens: 4000,
      }),
    });

    if (!res.ok) return html;

    const data = await res.json();
    return data.choices?.[0]?.message?.content || html;
  } catch {
    return html;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const now = new Date().toISOString();
    const { data: enrollments, error: enrollError } = await supabase
      .from("email_sequence_enrollments")
      .select("*, email_sequences(*), contacts(*)")
      .eq("statut", "active")
      .lte("prochaine_execution", now);

    if (enrollError) throw enrollError;
    if (!enrollments || enrollments.length === 0) {
      return new Response(
        JSON.stringify({ message: "No sequences to process", processed: 0 }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let processed = 0;
    let errors = 0;

    for (let i = 0; i < enrollments.length; i++) {
      const enrollment = enrollments[i];
      try {
        const sequence = enrollment.email_sequences;
        const contact = enrollment.contacts;
        const etapes: SequenceStep[] = sequence.etapes || [];
        const currentStep = enrollment.etape_courante;
        const baseDelayMin: number = sequence.delai_base_minutes || 3;
        const aleaPct: number = sequence.alea_pourcentage || 30;
        const shouldRewrite: boolean = sequence.rewrite_ia !== false;

        if (currentStep >= etapes.length) {
          await supabase
            .from("email_sequence_enrollments")
            .update({ statut: "completed", updated_at: now })
            .eq("id", enrollment.id);
          continue;
        }

        const step = etapes[currentStep];

        const { data: template } = await supabase
          .from("templates")
          .select("*")
          .eq("id", step.template_id)
          .maybeSingle();

        if (!template || !contact.email) {
          errors++;
          continue;
        }

        // Replace variables
        let html = template.contenu
          .replace(/\{prenom\}/g, contact.prenom || "")
          .replace(/\{nom\}/g, contact.nom || "")
          .replace(/\{entreprise\}/g, contact.entreprise || "")
          .replace(/\{email\}/g, contact.email || "")
          .replace(/\{telephone\}/g, contact.telephone || "");

        const isHtml = /<[a-z][\s\S]*>/i.test(html);
        if (!isHtml) {
          html = `<div style="font-family:sans-serif;white-space:pre-wrap;">${html}</div>`;
        }

        // AI rewrite if enabled
        if (shouldRewrite) {
          // Use the settings of the commercial responsible for this contact.
          const { data: settings } = await supabase
            .from("app_settings")
            .select("cle, valeur")
            .eq("user_id", contact.assigned_to)
            .in("cle", ["openrouter_api_key", "ai_model"]);

          let openrouterKey = "";
          let aiModel = "openai/gpt-4o";
          if (settings) {
            for (const s of settings) {
              if (s.cle === "openrouter_api_key") openrouterKey = s.valeur;
              if (s.cle === "ai_model") aiModel = s.valeur;
            }
          }

          if (openrouterKey) {
            html = await rewriteWithAi(html, openrouterKey, aiModel, supabaseUrl);
          }
        }

        // Human-like delay between sends (not the first one)
        if (i > 0) {
          const delayMs = humanDelay(baseDelayMin, aleaPct);
          await new Promise(resolve => setTimeout(resolve, delayMs));
        }

        // Send from the connected Google Workspace mailbox.
        await sendEmailViaGmail({
          to: contact.email,
          subject: step.subject || template.titre,
          html,
        });

        // Log as interaction
        await supabase.from("interactions").insert([{
          contact_id: contact.id,
          user_id: contact.assigned_to,
          type: "Email",
          date_heure: new Date().toISOString(),
          duree: 0,
          resultat: "",
          notes: `[Sequence auto] ${sequence.titre} - Etape ${currentStep + 1}: ${step.subject || template.titre}`,
        }]);

        await supabase.from("contacts")
          .update({ derniere_interaction: new Date().toISOString() })
          .eq("id", contact.id);

        // Advance to next step or complete
        const nextStep = currentStep + 1;
        if (nextStep >= etapes.length) {
          await supabase
            .from("email_sequence_enrollments")
            .update({
              statut: "completed",
              etape_courante: nextStep,
              derniere_execution: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq("id", enrollment.id);
        } else {
          const nextDelay = etapes[nextStep].delay_days;
          const nextDate = new Date(Date.now() + nextDelay * 24 * 60 * 60 * 1000).toISOString();
          await supabase
            .from("email_sequence_enrollments")
            .update({
              etape_courante: nextStep,
              prochaine_execution: nextDate,
              derniere_execution: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq("id", enrollment.id);
        }

        processed++;
      } catch (err) {
        console.error(`Error processing enrollment ${enrollment.id}:`, err);
        errors++;
      }
    }

    return new Response(
      JSON.stringify({ message: "Sequences processed", processed, errors }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
