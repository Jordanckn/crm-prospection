import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { sendEmailViaGmail } from "../_shared/gmail.ts";

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
    const { to, subject, html, text, attachment }: EmailPayload = await req.json();

    if (!to || !subject || !html) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: to, subject, html" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
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

    const data = await sendEmailViaGmail({ to, subject, html, text, attachment });

    return new Response(
      JSON.stringify({ success: true, provider: "gmail", id: data.id, threadId: data.threadId }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
