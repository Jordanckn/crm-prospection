export interface ResendEmailInput {
  to: string;
  subject: string;
  html: string;
  text?: string;
  fromName: string;
  fromEmail: string;
  replyTo?: string | null;
  unsubscribeEmail?: string | null;
  logoUrl?: string | null;
  idempotencyKey?: string;
  apiKeySecret?: 'RESEND_API_KEY_EPIDERME' | 'RESEND_API_KEY_EPIDERM_ISRAEL';
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
  const secretName = input.apiKeySecret || 'RESEND_API_KEY_EPIDERME';
  const apiKey = Deno.env.get(secretName);
  if (!apiKey) throw new Error(`La cle Resend ${secretName === 'RESEND_API_KEY_EPIDERM_ISRAEL' ? 'Epiderm AI Israel' : 'Epiderme AI France'} est absente.`);

  const unsubscribeUrl = input.unsubscribeEmail
    ? `mailto:${encodeURIComponent(input.unsubscribeEmail)}?subject=${encodeURIComponent('Désinscription Epiderme AI')}&body=${encodeURIComponent(`Bonjour, je souhaite me désinscrire des emails Epiderme AI envoyés à ${input.to}.`)}`
    : null;
  const logoContentId = 'epiderme-ai-logo';
  const sourceHtml = input.logoUrl
    ? input.html.replaceAll(input.logoUrl, `cid:${logoContentId}`)
    : input.html;
  const brandIdentity = input.logoUrl && !input.html.includes(input.logoUrl)
    ? `<div style="margin-top:28px;padding-top:18px;border-top:1px solid #e5e7eb;font-family:Arial,sans-serif;text-align:left;"><img src="cid:${logoContentId}" alt="${htmlEscape(input.fromName)}" width="120" style="display:block;width:120px;max-width:100%;height:auto;border:0;"><div style="margin-top:8px;font-size:12px;font-weight:700;color:#172033;">${htmlEscape(input.fromName)}</div></div>`
    : '';
  const unsubscribeFooter = unsubscribeUrl
    ? `<div style="margin-top:18px;padding-top:12px;border-top:1px solid #e5e7eb;font-family:Arial,sans-serif;font-size:11px;line-height:1.5;color:#94a3b8;text-align:center;">Vous ne souhaitez plus recevoir nos messages ? <a href="${htmlEscape(unsubscribeUrl)}" style="color:#64748b;text-decoration:underline;">Se désinscrire</a></div>`
    : '';
  const footer = `${brandIdentity}${unsubscribeFooter}`;
  const html = /<\/body>/i.test(sourceHtml)
    ? sourceHtml.replace(/<\/body>/i, `${footer}</body>`)
    : `${sourceHtml}${footer}`;
  const attachments = [
    ...(input.logoUrl ? [{
      path: input.logoUrl,
      filename: 'epiderme-ai-logo.png',
      content_id: logoContentId,
    }] : []),
    ...(input.attachment ? [{
      filename: input.attachment.filename,
      content: input.attachment.contentBase64,
      content_type: input.attachment.contentType,
    }] : []),
  ];

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      ...(input.idempotencyKey ? { 'Idempotency-Key': input.idempotencyKey } : {}),
    },
    body: JSON.stringify({
      from: `${input.fromName} <${input.fromEmail}>`,
      to: [input.to],
      subject: input.subject,
      html,
      ...(input.text ? { text: input.text } : {}),
      ...(input.replyTo ? { reply_to: input.replyTo } : {}),
      ...(unsubscribeUrl ? { headers: { 'List-Unsubscribe': `<${unsubscribeUrl}>` } } : {}),
      ...(attachments.length ? { attachments } : {}),
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.message || `Erreur Resend HTTP ${response.status}`);
  return data as { id: string };
}
