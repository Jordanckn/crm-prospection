type GmailSendInput = {
  to: string;
  subject: string;
  html: string;
  text?: string;
};

type GmailSendResult = {
  id: string;
  threadId?: string;
};

const requiredSecret = (name: string) => {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`${name} non configuré dans les secrets Supabase.`);
  return value;
};

const stripHeaderBreaks = (value: string) => value.replace(/[\r\n]+/g, " ").trim();

const utf8Base64 = (value: string) => {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
};

const base64Url = (value: string) => utf8Base64(value)
  .replace(/\+/g, "-")
  .replace(/\//g, "_")
  .replace(/=+$/g, "");

export const htmlToText = (html: string) => html
  .replace(/<style[\s\S]*?<\/style>/gi, " ")
  .replace(/<script[\s\S]*?<\/script>/gi, " ")
  .replace(/<br\s*\/?>/gi, "\n")
  .replace(/<\/p>/gi, "\n\n")
  .replace(/<[^>]+>/g, " ")
  .replace(/&nbsp;/gi, " ")
  .replace(/&amp;/gi, "&")
  .replace(/&lt;/gi, "<")
  .replace(/&gt;/gi, ">")
  .replace(/[ \t]+/g, " ")
  .replace(/\n{3,}/g, "\n\n")
  .trim();

async function gmailAccessToken() {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: requiredSecret("GMAIL_CLIENT_ID"),
      client_secret: requiredSecret("GMAIL_CLIENT_SECRET"),
      refresh_token: requiredSecret("GMAIL_REFRESH_TOKEN"),
      grant_type: "refresh_token",
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || typeof payload.access_token !== "string") {
    const reason = payload.error_description || payload.error || `HTTP ${response.status}`;
    throw new Error(`Autorisation Gmail impossible : ${reason}`);
  }
  return payload.access_token as string;
}

function mimeMessage(input: GmailSendInput) {
  const fromEmail = requiredSecret("GMAIL_FROM_EMAIL");
  const to = stripHeaderBreaks(input.to);
  const subject = stripHeaderBreaks(input.subject);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
    throw new Error("Adresse e-mail destinataire invalide.");
  }
  if (!subject) throw new Error("Objet de l'e-mail manquant.");

  const boundary = `wfy_${crypto.randomUUID().replaceAll("-", "")}`;
  const text = input.text?.trim() || htmlToText(input.html);
  return [
    `From: WebFitYou <${stripHeaderBreaks(fromEmail)}>`,
    `To: ${to}`,
    `Subject: =?UTF-8?B?${utf8Base64(subject)}?=`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    utf8Base64(text),
    `--${boundary}`,
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    utf8Base64(input.html),
    `--${boundary}--`,
    "",
  ].join("\r\n");
}

export async function sendEmailViaGmail(input: GmailSendInput): Promise<GmailSendResult> {
  const accessToken = await gmailAccessToken();
  const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ raw: base64Url(mimeMessage(input)) }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || typeof payload.id !== "string") {
    const reason = payload.error?.message || payload.error || `HTTP ${response.status}`;
    throw new Error(`Envoi Gmail impossible : ${reason}`);
  }
  return { id: payload.id, threadId: payload.threadId };
}
