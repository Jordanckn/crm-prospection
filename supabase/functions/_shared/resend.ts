export interface ResendEmailInput {
  to: string;
  subject: string;
  html: string;
  text?: string;
  fromName: string;
  fromEmail: string;
  replyTo?: string | null;
  unsubscribeEmail?: string | null;
  attachment?: {
    filename: string;
    contentType: string;
    contentBase64: string;
  };
}

const htmlEscape = (value: string) => value
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;');

export async function sendEmailViaResend(input: ResendEmailInput) {
  const apiKey = Deno.env.get('RESEND_API_KEY_EPIDERME');
  if (!apiKey) throw new Error('La cle Resend Epiderme AI est absente.');

  const unsubscribeUrl = input.unsubscribeEmail
    ? `mailto:${encodeURIComponent(input.unsubscribeEmail)}?subject=${encodeURIComponent('Désinscription Epiderme AI')}&body=${encodeURIComponent(`Bonjour, je souhaite me désinscrire des emails Epiderme AI envoyés à ${input.to}.`)}`
    : null;
  const html = unsubscribeUrl
    ? `${input.html}<div style="margin-top:28px;padding-top:12px;border-top:1px solid #e5e7eb;font-family:Arial,sans-serif;font-size:11px;line-height:1.5;color:#94a3b8;text-align:center;">Vous ne souhaitez plus recevoir nos messages ? <a href="${htmlEscape(unsubscribeUrl)}" style="color:#64748b;text-decoration:underline;">Se désinscrire</a></div>`
    : input.html;

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: `${input.fromName} <${input.fromEmail}>`,
      to: [input.to],
      subject: input.subject,
      html,
      ...(input.text ? { text: input.text } : {}),
      ...(input.replyTo ? { reply_to: input.replyTo } : {}),
      ...(unsubscribeUrl ? { headers: { 'List-Unsubscribe': `<${unsubscribeUrl}>` } } : {}),
      ...(input.attachment ? {
        attachments: [{
          filename: input.attachment.filename,
          content: input.attachment.contentBase64,
          content_type: input.attachment.contentType,
        }],
      } : {}),
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.message || `Erreur Resend HTTP ${response.status}`);
  return data as { id: string };
}
