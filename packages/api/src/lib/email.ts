// ── Email service abstraction ──────────────────────────────────
// Dev: prints the email-change link to console (no setup needed)
// Prod: sends via Resend API (no npm dep — raw fetch)

import { isCaRole, CA_ROLE_DESCRIPTIONS, CA_ROLE_LABELS, maskEmail, type CaRole } from "@fintranzact/shared";

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/** A message from the public contact or partner form, sent to our inbox. */
export interface EnquiryEmail {
  to: string;
  /** The visitor's address, so a reply from the inbox goes straight back to them. */
  replyTo: string;
  subject: string;
  /** Label/value pairs shown as a table above the message. */
  fields: Array<[string, string]>;
  message: string;
}

interface EmailService {
  sendEmailChangeLink(to: string, url: string): Promise<void>;
  sendInvitation(to: string, inviteUrl: string, businessName: string, inviterName: string | null, role?: string): Promise<void>;
  sendPartnerApproved(to: string, details: PartnerApprovedEmail): Promise<void>;
  sendEnquiry(enquiry: EnquiryEmail): Promise<void>;
  /** A plain notice (reminders): subject and text only, no links or tokens. */
  sendNotice(to: string, subject: string, text: string): Promise<void>;
  /** A payment reminder from a business to its customer. */
  sendReminder(mail: ReminderEmail): Promise<void>;
}

export interface ReminderEmail {
  to: string;
  /** The business name, shown as the sender's display name. */
  fromName: string;
  /** The business's own email, so a reply reaches the business. */
  replyTo?: string | null;
  subject: string;
  text: string;
  html: string;
}

/** A display name that is safe inside a From header. */
export function safeDisplayName(name: string): string {
  const cleaned = name.replace(/[\r\n"<>,;:\\]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
  return cleaned || "Fintranzact";
}

/**
 * Subject, plain text and HTML of a payment reminder (pure). The message is
 * the business's own text, escaped; the footer tells the customer to reply to
 * the business to stop the reminders (there is no unsubscribe page).
 */
export function buildReminderEmail(p: { subject: string; text: string; businessName: string }): BuiltEmail {
  const footerText = `You are receiving this because ${p.businessName} sent you an invoice. To stop these reminders, reply to this email and tell ${p.businessName}.`;
  const body = escapeHtml(p.text).replace(/\n/g, "<br />");
  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /><title>${escapeHtml(p.subject)}</title></head><body style="margin:0;padding:24px;background-color:#f3f4f6;"><table role="presentation" width="100%" style="max-width:560px;margin:0 auto;background-color:#ffffff;border:1px solid #e5e7eb;border-radius:12px;"><tr><td style="padding:24px;${MAIL_FONT}font-size:15px;line-height:23px;color:#374151;">${body}</td></tr><tr><td style="padding:0 24px 20px 24px;${MAIL_FONT}font-size:12px;line-height:18px;color:#9ca3af;border-top:1px solid #f3f4f6;"><p style="margin:14px 0 0 0;">${escapeHtml(footerText)}</p></td></tr></table></body></html>`;
  return { subject: p.subject, text: `${p.text}\n\n--\n${footerText}`, html };
}

export interface PartnerApprovedEmail {
  contactName: string;
  companyName: string;
  referralCode: string;
  signupUrl: string;
  /** Where the partner signs in (with this email) to see their referrals and payouts. */
  portalUrl: string;
}

function partnerApprovedText(d: PartnerApprovedEmail): string {
  return [
    `Hi ${d.contactName},`,
    "",
    `${d.companyName} is now a Fintranzact partner.`,
    "",
    `Your referral code: ${d.referralCode}`,
    `Share this sign-up link: ${d.signupUrl}`,
    "",
    "Businesses that sign up with your code or link count as your referrals. Your badge and commission",
    "grow with the number of them on a paid plan.",
    "",
    `Sign in with this email address to see your referrals, badge and payouts: ${d.portalUrl}`,
    "",
    "Welcome aboard,",
    "The Fintranzact team",
  ].join("\n");
}

function partnerApprovedHtml(d: PartnerApprovedEmail): string {
  const e = escapeHtml;
  const font = "font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;";
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /><title>You're a Fintranzact partner</title></head>
<body style="margin:0;padding:0;background-color:#f3f4f6;">
<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color:#f3f4f6;"><tr><td style="padding:40px 16px;">
<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width:480px;margin:0 auto;background-color:#ffffff;border-radius:12px;border:1px solid #e5e7eb;">
<tr><td style="height:4px;background:#3B5EAA;font-size:0;line-height:0;">&nbsp;</td></tr>
<tr><td style="padding:32px 40px 0 40px;${font}">
<p style="margin:0 0 4px 0;font-size:13px;font-weight:600;color:#3B5EAA;text-transform:uppercase;letter-spacing:.5px;">Partner programme</p>
<h1 style="margin:0 0 16px 0;font-size:22px;color:#111827;">Welcome aboard, ${e(d.contactName)}</h1>
<p style="margin:0 0 20px 0;font-size:15px;line-height:22px;color:#374151;">${e(d.companyName)} is now a Fintranzact partner. Businesses that sign up with your code or link count as your referrals, and your badge and commission grow with the number of them on a paid plan.</p>
</td></tr>
<tr><td style="padding:0 40px;${font}">
<table role="presentation" width="100%" style="background-color:#eef2fa;border-radius:10px;"><tr><td style="padding:18px 20px;text-align:center;">
<p style="margin:0;font-size:12px;font-weight:600;color:#3B5EAA;text-transform:uppercase;letter-spacing:.5px;">Your referral code</p>
<p style="margin:6px 0 0 0;font-family:Menlo,Consolas,monospace;font-size:26px;font-weight:700;letter-spacing:2px;color:#111827;">${e(d.referralCode)}</p>
</td></tr></table>
</td></tr>
<tr><td style="padding:24px 40px 0 40px;text-align:center;${font}">
<a href="${e(d.signupUrl)}" style="display:inline-block;padding:12px 22px;background-color:#3B5EAA;color:#ffffff;border-radius:8px;font-size:15px;font-weight:600;text-decoration:none;">Your sign-up link</a>
<p style="margin:10px 0 0 0;font-size:12px;color:#6b7280;word-break:break-all;">${e(d.signupUrl)}</p>
</td></tr>
<tr><td style="padding:24px 40px 32px 40px;${font}">
<p style="margin:0;font-size:14px;line-height:21px;color:#374151;">See your referrals, badge and payouts any time: <a href="${e(d.portalUrl)}" style="color:#3B5EAA;">sign in to your partner portal</a> with this email address.</p>
</td></tr>
</table></td></tr></table></body></html>`;
}

/** Plain-text body for an enquiry (console output and the text part of the email). */
export function enquiryText(enquiry: EnquiryEmail): string {
  const rows = enquiry.fields.filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`);
  return [...rows, "", enquiry.message || "(no message)"].join("\n");
}

/** Minimal, fully escaped HTML body for an enquiry. */
export function enquiryHtml(enquiry: EnquiryEmail): string {
  const font = "font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;";
  const rows = enquiry.fields
    .filter(([, v]) => v)
    .map(
      ([k, v]) =>
        `<tr><td style="${font} padding: 4px 16px 4px 0; font-size: 13px; color: #6b7280; vertical-align: top;">${escapeHtml(k)}</td><td style="${font} padding: 4px 0; font-size: 14px; color: #111827;">${escapeHtml(v)}</td></tr>`,
    )
    .join("");
  const message = escapeHtml(enquiry.message || "(no message)").replace(/\n/g, "<br />");
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8" /><title>${escapeHtml(enquiry.subject)}</title></head><body style="margin: 0; padding: 24px; background-color: #f3f4f6;"><table role="presentation" width="100%" style="max-width: 560px; margin: 0 auto; background-color: #ffffff; border: 1px solid #e5e7eb; border-radius: 12px;"><tr><td style="padding: 24px;"><h1 style="${font} margin: 0 0 16px 0; font-size: 18px; color: #111827;">${escapeHtml(enquiry.subject)}</h1><table role="presentation">${rows}</table><p style="${font} margin: 20px 0 0 0; font-size: 14px; line-height: 22px; color: #374151;">${message}</p></td></tr></table></body></html>`;
}

function normalInvitationHtml(inviteUrl: string, businessName: string, inviterName: string | null): string {
  const fromDisplay = escapeHtml(inviterName ?? "Someone");
  const bizDisplay = escapeHtml(businessName);
  return `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" lang="en">
<head>
<meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta name="color-scheme" content="light dark" />
<meta name="supported-color-schemes" content="light dark" />
<title>You've been invited to join ${bizDisplay} on Fintranzact</title>
<!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
</head>
<body style="margin: 0; padding: 0; background-color: #f3f4f6; -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%;">

<!-- Preheader text (hidden, shows in inbox preview) -->
<div style="display: none; max-height: 0; overflow: hidden; font-size: 1px; line-height: 1px; color: #f3f4f6;">${fromDisplay} invited you to join ${bizDisplay} on Fintranzact. Accept your invitation to get started.&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;</div>

<!-- Outer wrapper table for background -->
<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #f3f4f6;">
<tr><td style="padding: 40px 16px;">

<!-- Inner card container -->
<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 480px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; overflow: hidden; border: 1px solid #e5e7eb;">

<!-- Brand accent stripe -->
<tr><td style="height: 4px; background: linear-gradient(90deg, #243C77 0%, #3B5EAA 50%, #243C77 100%); font-size: 0; line-height: 0;">&nbsp;</td></tr>

<!-- Logo + brand mark -->
<!-- Grid lockup is built from nested tables (not an image) so it renders identically in Gmail, Outlook, Apple Mail — no image-blocking, no external fetch, no broken alt. Matches the Fintranzact mark: brand-blue circle with a white F. -->
<tr><td style="padding: 32px 40px 0 40px; text-align: center;">
<table role="presentation" border="0" cellpadding="0" cellspacing="0" align="center" style="margin: 0 auto;">
<tr>
<td style="vertical-align: middle; line-height: 1; font-size: 0;">
<table role="presentation" border="0" cellpadding="0" cellspacing="0" style="border-collapse: separate;"><tr><td width="36" height="36" align="center" valign="middle" bgcolor="#3B5EAA" style="width: 36px; height: 36px; background-color: #3B5EAA; background-image: linear-gradient(180deg, #3B5EAA 0%, #243C77 100%); border-radius: 18px; color: #ffffff; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; font-size: 20px; font-weight: 700; line-height: 36px; mso-line-height-rule: exactly;">F</td></tr></table>
</td>
<td height="36" style="padding-left: 12px; vertical-align: middle; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; font-size: 22px; font-weight: 700; color: #111827; letter-spacing: -0.3px; line-height: 36px;">Fintranzact</td>
</tr>
</table>
</td></tr>

<!-- Invitation badge -->
<tr><td style="padding: 24px 40px 0 40px; text-align: center;">
<table role="presentation" border="0" cellpadding="0" cellspacing="0" style="margin: 0 auto;">
<tr><td style="padding: 6px 14px; background-color: #eef2ff; border-radius: 20px;">
<p style="margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; font-size: 12px; font-weight: 600; color: #4f46e5; text-transform: uppercase; letter-spacing: 0.5px;">Team Invitation</p>
</td></tr>
</table>
</td></tr>

<!-- Main content -->
<tr><td style="padding: 20px 40px 0 40px;">
<h1 style="margin: 0 0 16px 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; font-size: 22px; font-weight: 700; color: #111827; text-align: center; line-height: 28px;">You've been invited to join a team</h1>
</td></tr>

<!-- Invitation details card -->
<tr><td style="padding: 0 40px;">
<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #f9fafb; border-radius: 10px; border: 1px solid #e5e7eb;">
<tr><td style="padding: 20px 24px;">
<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
<!-- Business name row -->
<tr>
<td style="padding: 0 0 12px 0; width: 80px; vertical-align: top;"><p style="margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; font-size: 12px; font-weight: 600; color: #9ca3af; text-transform: uppercase; letter-spacing: 0.3px;">Business</p></td>
<td style="padding: 0 0 12px 0; vertical-align: top;"><p style="margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; font-size: 15px; font-weight: 600; color: #111827;">${bizDisplay}</p></td>
</tr>
<!-- Invited by row -->
<tr>
<td style="padding: 0; width: 80px; vertical-align: top;"><p style="margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; font-size: 12px; font-weight: 600; color: #9ca3af; text-transform: uppercase; letter-spacing: 0.3px;">From</p></td>
<td style="padding: 0; vertical-align: top;"><p style="margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; font-size: 15px; color: #374151;">${fromDisplay}</p></td>
</tr>
</table>
</td></tr>
</table>
</td></tr>

<!-- Context message -->
<tr><td style="padding: 20px 40px 0 40px;">
<p style="margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; font-size: 14px; line-height: 22px; color: #6b7280; text-align: center;">Accept the invitation below to start collaborating on <strong style="color: #374151;">${bizDisplay}</strong>'s invoices, parties, and reports.</p>
</td></tr>

<!-- CTA Button -->
<tr><td style="padding: 24px 40px 0 40px;">
<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
<tr><td style="text-align: center; padding: 0 0 4px 0;">
<!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${escapeHtml(inviteUrl)}" style="height:52px;v-text-anchor:middle;width:320px;" arcsize="15%" fill="t"><v:fill type="gradient" color="#4f46e5" color2="#4338ca" angle="180" /><w:anchorlock/><center style="color:#ffffff;font-family:sans-serif;font-size:16px;font-weight:bold;">Accept Invitation</center></v:roundrect><![endif]-->
<!--[if !mso]><!-->
<a href="${escapeHtml(inviteUrl)}" target="_blank" style="display: inline-block; width: 100%; max-width: 320px; padding: 14px 32px; background: linear-gradient(180deg, #4f46e5 0%, #4338ca 100%); color: #ffffff; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; font-size: 16px; font-weight: 600; text-decoration: none; text-align: center; border-radius: 10px; box-sizing: border-box; -webkit-text-size-adjust: none; mso-hide: all;">Accept Invitation</a>
<!--<![endif]-->
</td></tr>
</table>
</td></tr>

<!-- Expiry notice -->
<tr><td style="padding: 16px 40px 0 40px; text-align: center;">
<p style="margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; font-size: 12px; color: #9ca3af;">This invitation expires in <strong style="color: #6b7280;">7 days</strong></p>
</td></tr>

<!-- Divider -->
<tr><td style="padding: 24px 40px 0 40px;">
<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
<tr><td style="border-top: 1px solid #e5e7eb; font-size: 0; line-height: 0; height: 1px;">&nbsp;</td></tr>
</table>
</td></tr>

<!-- Fallback URL -->
<tr><td style="padding: 20px 40px 0 40px;">
<p style="margin: 0 0 6px 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; font-size: 12px; font-weight: 600; color: #9ca3af; text-transform: uppercase; letter-spacing: 0.5px;">Button not working? Copy this link:</p>
<p style="margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; font-size: 12px; line-height: 18px; color: #6b7280; word-break: break-all;">${escapeHtml(inviteUrl)}</p>
</td></tr>

<!-- Safety notice -->
<tr><td style="padding: 20px 40px 32px 40px;">
<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #f9fafb; border-radius: 8px;">
<tr><td style="padding: 12px 16px;">
<p style="margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; font-size: 12px; line-height: 18px; color: #9ca3af;">If you weren't expecting this invitation, you can safely ignore this email. No account will be created unless you accept.</p>
</td></tr>
</table>
</td></tr>

</table>
<!-- End inner card -->

<!-- Footer -->
<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 480px; margin: 0 auto;">
<tr><td style="padding: 24px 40px 0 40px; text-align: center;">
<p style="margin: 0 0 4px 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; font-size: 13px; font-weight: 600; color: #6b7280;">Fintranzact &mdash; <span style="color: #4f46e5;">Hisaab, pakka.</span></p>
<p style="margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; font-size: 12px; line-height: 18px; color: #9ca3af;">Free, open-source invoicing for Indian businesses</p>
</td></tr>
</table>

</td></tr>
</table>
<!-- End outer wrapper -->

</body>
</html>`;
}

const MAIL_FONT = "font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;";

export interface InvitationEmailParams {
  inviteUrl: string;
  businessName: string;
  inviterName: string | null;
  /** Member role being offered. An accountant (CA) role gets the accountant wording. */
  role?: string;
}

export interface BuiltEmail {
  subject: string;
  text: string;
  html: string;
}

function caInvitationText(p: InvitationEmailParams, access: string): string {
  const who = p.inviterName ?? "Someone";
  return [
    `${who} has invited you as their accountant on Fintranzact.`,
    "",
    `Business: ${p.businessName}`,
    `Access: ${CA_ROLE_LABELS[p.role as CaRole]}`,
    access,
    "",
    "The business can remove your access at any time, and your activity in their books is logged.",
    "",
    `Accept the invitation: ${p.inviteUrl}`,
    "",
    "This invitation expires in 7 days. If you weren't expecting it, you can safely ignore this email.",
  ].join("\n");
}

function caInvitationHtml(p: InvitationEmailParams, access: string): string {
  const e = escapeHtml;
  const who = e(p.inviterName ?? "Someone");
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /><title>${who} has invited you as their accountant on Fintranzact</title></head>
<body style="margin:0;padding:0;background-color:#f3f4f6;">
<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color:#f3f4f6;"><tr><td style="padding:40px 16px;">
<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width:480px;margin:0 auto;background-color:#ffffff;border-radius:12px;border:1px solid #e5e7eb;">
<tr><td style="height:4px;background:#3B5EAA;font-size:0;line-height:0;">&nbsp;</td></tr>
<tr><td style="padding:32px 40px 0 40px;${MAIL_FONT}">
<p style="margin:0 0 4px 0;font-size:13px;font-weight:600;color:#3B5EAA;text-transform:uppercase;letter-spacing:.5px;">Accountant invitation</p>
<h1 style="margin:0 0 16px 0;font-size:22px;line-height:28px;color:#111827;">${who} has invited you as their accountant on Fintranzact</h1>
</td></tr>
<tr><td style="padding:0 40px;${MAIL_FONT}">
<table role="presentation" width="100%" style="background-color:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;"><tr><td style="padding:18px 20px;">
<p style="margin:0 0 4px 0;font-size:12px;font-weight:600;color:#9ca3af;text-transform:uppercase;letter-spacing:.3px;">Business</p>
<p style="margin:0 0 14px 0;font-size:15px;font-weight:600;color:#111827;">${e(p.businessName)}</p>
<p style="margin:0 0 4px 0;font-size:12px;font-weight:600;color:#9ca3af;text-transform:uppercase;letter-spacing:.3px;">Your access: ${e(CA_ROLE_LABELS[p.role as CaRole])}</p>
<p style="margin:0;font-size:14px;line-height:21px;color:#374151;">${e(access)}</p>
</td></tr></table>
</td></tr>
<tr><td style="padding:16px 40px 0 40px;${MAIL_FONT}">
<p style="margin:0;font-size:14px;line-height:21px;color:#6b7280;">The business can remove your access at any time, and your activity in their books is logged.</p>
</td></tr>
<tr><td style="padding:24px 40px 0 40px;text-align:center;${MAIL_FONT}">
<a href="${e(p.inviteUrl)}" target="_blank" style="display:inline-block;padding:14px 32px;background-color:#4f46e5;color:#ffffff;border-radius:10px;font-size:16px;font-weight:600;text-decoration:none;">Accept invitation</a>
<p style="margin:10px 0 0 0;font-size:12px;color:#9ca3af;">This invitation expires in <strong style="color:#6b7280;">7 days</strong></p>
</td></tr>
<tr><td style="padding:20px 40px 32px 40px;${MAIL_FONT}">
<p style="margin:0 0 6px 0;font-size:12px;font-weight:600;color:#9ca3af;text-transform:uppercase;letter-spacing:.5px;">Button not working? Copy this link:</p>
<p style="margin:0 0 12px 0;font-size:12px;line-height:18px;color:#6b7280;word-break:break-all;">${e(p.inviteUrl)}</p>
<p style="margin:0;font-size:12px;line-height:18px;color:#9ca3af;">If you weren't expecting this invitation, you can safely ignore this email. No account will be created unless you accept.</p>
</td></tr>
</table></td></tr></table></body></html>`;
}

/**
 * Subject, plain text and HTML of an invitation email (pure). Accountant (CA)
 * roles get "X has invited you as their accountant" with the access level; any
 * other role keeps the standard team invitation.
 */
export function buildInvitationEmail(p: InvitationEmailParams): BuiltEmail {
  if (isCaRole(p.role)) {
    const access = CA_ROLE_DESCRIPTIONS[p.role];
    const who = p.inviterName ?? "Someone";
    return {
      subject: `${who} has invited you as their accountant on Fintranzact`,
      text: caInvitationText(p, access),
      html: caInvitationHtml(p, access),
    };
  }
  const who = p.inviterName ?? "Someone";
  return {
    subject: `You've been invited to join ${p.businessName} on Fintranzact`,
    text: [
      `${who} invited you to join ${p.businessName} on Fintranzact.`,
      "",
      `Accept the invitation: ${p.inviteUrl}`,
      "",
      "This invitation expires in 7 days. If you weren't expecting it, you can safely ignore this email.",
    ].join("\n"),
    html: normalInvitationHtml(p.inviteUrl, p.businessName, p.inviterName),
  };
}

class ConsoleEmailService implements EmailService {
  async sendReminder(mail: ReminderEmail): Promise<void> {
    // Dev / self-hosted without a mail provider: log that it happened, never the address or the message.
    console.log(`[reminder] email to ${maskEmail(mail.to)} from ${JSON.stringify(mail.fromName)} subject=${JSON.stringify(mail.subject)}`);
  }

  async sendNotice(to: string, subject: string, text: string): Promise<void> {
    // Reminders are best-effort: without a mail provider they are only logged.
    console.log(`[notice] to=${to} subject=${JSON.stringify(subject)}\n${text}`);
  }

  async sendPartnerApproved(to: string, details: PartnerApprovedEmail): Promise<void> {
    if (process.env.NODE_ENV === "production") {
      console.error("[email] FATAL: No email service configured for production. Set RESEND_API_KEY.");
      throw new Error("Email service not configured");
    }
    console.log(`\n[email] Partner approved: ${to}\n${partnerApprovedText(details)}\n`);
  }

  async sendEmailChangeLink(to: string, url: string): Promise<void> {
    if (process.env.NODE_ENV === "production") {
      console.error("[email] FATAL: No email service configured for production. Set RESEND_API_KEY.");
      throw new Error("Email service not configured");
    }
    console.log("");
    console.log("╔══════════════════════════════════════════════════════════╗");
    console.log(`║  Confirm new email for ${to.padEnd(34)}║`);
    console.log("╠══════════════════════════════════════════════════════════╣");
    console.log(`║  Link:      ${url}`);
    console.log("╚══════════════════════════════════════════════════════════╝");
    console.log("");
  }

  async sendInvitation(to: string, inviteUrl: string, businessName: string, inviterName: string | null, role?: string): Promise<void> {
    if (process.env.NODE_ENV === "production") {
      console.error("[email] FATAL: No email service configured for production. Set RESEND_API_KEY.");
      throw new Error("Email service not configured");
    }
    console.log("");
    console.log("╔══════════════════════════════════════════════════════════╗");
    console.log(`║  Invitation for ${to.padEnd(40)}║`);
    console.log(`║  From: ${(inviterName ?? "Someone").padEnd(49)}║`);
    console.log(`║  Business: ${businessName.padEnd(47)}║`);
    if (isCaRole(role)) {
      console.log(`║  As accountant: ${CA_ROLE_LABELS[role].padEnd(42)}║`);
      console.log(`║  ${CA_ROLE_DESCRIPTIONS[role]}`);
    }
    console.log("╠══════════════════════════════════════════════════════════╣");
    console.log(`║  ${inviteUrl}`);
    console.log("╚══════════════════════════════════════════════════════════╝");
    console.log("");
  }

  async sendEnquiry(enquiry: EnquiryEmail): Promise<void> {
    // Without a mail provider the enquiry is only logged, so the public form
    // keeps working on dev and self-hosted installs. Warn loudly in production
    // because nobody will see these unless they read the logs.
    if (process.env.NODE_ENV === "production") {
      console.warn("[email] RESEND_API_KEY not set — enquiry logged instead of emailed.");
    }
    console.log(`[enquiry] to=${enquiry.to} reply-to=${enquiry.replyTo} subject=${JSON.stringify(enquiry.subject)}\n${enquiryText(enquiry)}`);
  }
}

class ResendEmailService implements EmailService {
  async sendReminder(mail: ReminderEmail): Promise<void> {
    const address = /<([^>]+)>/.exec(this.fromAddress)?.[1] ?? this.fromAddress;
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: `${safeDisplayName(mail.fromName)} <${address}>`,
        to: mail.to,
        ...(mail.replyTo ? { reply_to: mail.replyTo } : {}),
        subject: mail.subject,
        text: mail.text,
        html: mail.html,
      }),
    });
    if (!res.ok) {
      console.error("[email] Resend reminder failed:", res.status);
      throw new Error("Failed to send email");
    }
  }

  async sendNotice(to: string, subject: string, text: string): Promise<void> {
    const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8" /><title>${escapeHtml(subject)}</title></head><body style="margin:0;padding:24px;background-color:#f3f4f6;"><table role="presentation" width="100%" style="max-width:560px;margin:0 auto;background-color:#ffffff;border:1px solid #e5e7eb;border-radius:12px;"><tr><td style="padding:24px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;font-size:14px;line-height:22px;color:#374151;">${escapeHtml(text).replace(/\n/g, "<br />")}</td></tr></table></body></html>`;
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: this.fromAddress, to, subject, text, html }),
    });
    if (!res.ok) {
      console.error("[email] Resend notice failed:", res.status, await res.text().catch(() => ""));
      throw new Error("Failed to send email");
    }
  }

  async sendPartnerApproved(to: string, details: PartnerApprovedEmail): Promise<void> {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: this.fromAddress,
        to,
        subject: `You're a Fintranzact partner — your referral code is ${details.referralCode}`,
        html: partnerApprovedHtml(details),
        text: partnerApprovedText(details),
      }),
    });
    if (!res.ok) {
      console.error("[email] Resend partner email failed:", res.status, await res.text().catch(() => ""));
      throw new Error("Failed to send email");
    }
  }

  constructor(
    private apiKey: string,
    private fromAddress: string,
  ) {}

  async sendEmailChangeLink(to: string, url: string): Promise<void> {
    const subject = "Confirm your new email address";
    const preheader = "Confirm this address for your Fintranzact account. This link expires in 15 minutes.";

    const mainContentHtml = `<!-- Main content -->
<tr><td style="padding: 28px 40px 0 40px;">
<h1 style="margin: 0 0 12px 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; font-size: 22px; font-weight: 700; color: #111827; text-align: center; line-height: 28px;">Confirm your new email</h1>
<p style="margin: 0 0 24px 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; font-size: 15px; line-height: 24px; color: #4b5563; text-align: center;">Tap the button below to use this address for your Fintranzact account. This link is single-use and expires in <strong style="color: #374151;">15 minutes</strong>.</p>
</td></tr>`;

    const ctaLabel = "Confirm email address";
    const ctaLabelOutlook = "Confirm email address";

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: this.fromAddress,
        to,
        subject,
        html: `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" lang="en">
<head>
<meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta name="color-scheme" content="light dark" />
<meta name="supported-color-schemes" content="light dark" />
<title>${subject}</title>
<!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
</head>
<body style="margin: 0; padding: 0; background-color: #f3f4f6; -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%;">

<!-- Preheader text (hidden, shows in inbox preview) -->
<div style="display: none; max-height: 0; overflow: hidden; font-size: 1px; line-height: 1px; color: #f3f4f6;">${preheader}&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;</div>

<!-- Outer wrapper table for background -->
<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #f3f4f6;">
<tr><td style="padding: 40px 16px;">

<!-- Inner card container -->
<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 480px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; overflow: hidden; border: 1px solid #e5e7eb;">

<!-- Brand accent stripe -->
<tr><td style="height: 4px; background: linear-gradient(90deg, #243C77 0%, #3B5EAA 50%, #243C77 100%); font-size: 0; line-height: 0;">&nbsp;</td></tr>

<!-- Logo + brand mark -->
<!-- Grid lockup is built from nested tables (not an image) so it renders identically in Gmail, Outlook, Apple Mail — no image-blocking, no external fetch, no broken alt. Matches the Fintranzact mark: brand-blue circle with a white F. -->
<tr><td style="padding: 32px 40px 0 40px; text-align: center;">
<table role="presentation" border="0" cellpadding="0" cellspacing="0" align="center" style="margin: 0 auto;">
<tr>
<td style="vertical-align: middle; line-height: 1; font-size: 0;">
<table role="presentation" border="0" cellpadding="0" cellspacing="0" style="border-collapse: separate;"><tr><td width="36" height="36" align="center" valign="middle" bgcolor="#3B5EAA" style="width: 36px; height: 36px; background-color: #3B5EAA; background-image: linear-gradient(180deg, #3B5EAA 0%, #243C77 100%); border-radius: 18px; color: #ffffff; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; font-size: 20px; font-weight: 700; line-height: 36px; mso-line-height-rule: exactly;">F</td></tr></table>
</td>
<td height="36" style="padding-left: 12px; vertical-align: middle; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; font-size: 22px; font-weight: 700; color: #111827; letter-spacing: -0.3px; line-height: 36px;">Fintranzact</td>
</tr>
</table>
</td></tr>

${mainContentHtml}

<!-- CTA Button -->
<tr><td style="padding: 0 40px;">
<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
<tr><td style="text-align: center; padding: 4px 0 20px 0;">
<!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${escapeHtml(url)}" style="height:52px;v-text-anchor:middle;width:320px;" arcsize="15%" fill="t"><v:fill type="gradient" color="#4f46e5" color2="#4338ca" angle="180" /><w:anchorlock/><center style="color:#ffffff;font-family:sans-serif;font-size:16px;font-weight:bold;">${ctaLabelOutlook}</center></v:roundrect><![endif]-->
<!--[if !mso]><!-->
<a href="${escapeHtml(url)}" target="_blank" style="display: inline-block; width: 100%; max-width: 320px; padding: 14px 32px; background: linear-gradient(180deg, #4f46e5 0%, #4338ca 100%); color: #ffffff; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; font-size: 16px; font-weight: 600; text-decoration: none; text-align: center; border-radius: 10px; box-sizing: border-box; -webkit-text-size-adjust: none; mso-hide: all;">${ctaLabel}</a>
<!--<![endif]-->
</td></tr>
</table>
</td></tr>

<!-- Divider -->
<tr><td style="padding: 24px 40px 0 40px;">
<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
<tr><td style="border-top: 1px solid #e5e7eb; font-size: 0; line-height: 0; height: 1px;">&nbsp;</td></tr>
</table>
</td></tr>

<!-- Fallback URL -->
<tr><td style="padding: 20px 40px 0 40px;">
<p style="margin: 0 0 6px 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; font-size: 12px; font-weight: 600; color: #9ca3af; text-transform: uppercase; letter-spacing: 0.5px;">Button not working? Copy this link:</p>
<p style="margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; font-size: 12px; line-height: 18px; color: #6b7280; word-break: break-all;">${escapeHtml(url)}</p>
</td></tr>

<!-- Safety notice -->
<tr><td style="padding: 20px 40px 32px 40px;">
<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #f9fafb; border-radius: 8px;">
<tr><td style="padding: 12px 16px;">
<p style="margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; font-size: 12px; line-height: 18px; color: #9ca3af;">If you didn't request this email, you can safely ignore it. No account changes have been made.</p>
</td></tr>
</table>
</td></tr>

</table>
<!-- End inner card -->

<!-- Footer -->
<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 480px; margin: 0 auto;">
<tr><td style="padding: 24px 40px 0 40px; text-align: center;">
<p style="margin: 0 0 4px 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; font-size: 13px; font-weight: 600; color: #6b7280;">Fintranzact &mdash; <span style="color: #4f46e5;">Hisaab, pakka.</span></p>
<p style="margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; font-size: 12px; line-height: 18px; color: #9ca3af;">Free, open-source invoicing for Indian businesses</p>
</td></tr>
</table>

</td></tr>
</table>
<!-- End outer wrapper -->

</body>
</html>`,
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      console.error(`[email] Resend API error: ${res.status} ${text}`);
      throw new Error("Failed to send email");
    }
  }

  async sendInvitation(to: string, inviteUrl: string, businessName: string, inviterName: string | null, role?: string): Promise<void> {
    const mail = buildInvitationEmail({ inviteUrl, businessName, inviterName, role });
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from: this.fromAddress, to, subject: mail.subject, text: mail.text, html: mail.html }),
    });

    if (!res.ok) {
      const text = await res.text();
      console.error(`[email] Resend API error: ${res.status} ${text}`);
      throw new Error("Failed to send email");
    }
  }

  async sendEnquiry(enquiry: EnquiryEmail): Promise<void> {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: this.fromAddress,
        to: enquiry.to,
        reply_to: enquiry.replyTo,
        subject: enquiry.subject,
        text: enquiryText(enquiry),
        html: enquiryHtml(enquiry),
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      console.error(`[email] Resend API error: ${res.status} ${text}`);
      throw new Error("Failed to send email");
    }
  }
}

function createEmailService(): EmailService {
  const resendKey = process.env.RESEND_API_KEY;
  const fromAddress = process.env.EMAIL_FROM || "Fintranzact <noreply@fintranzact.com>";

  if (resendKey) {
    console.log("[email] Using Resend email service");
    return new ResendEmailService(resendKey, fromAddress);
  }

  console.log("[email] No RESEND_API_KEY — email links will print to console");
  return new ConsoleEmailService();
}

export const emailService = createEmailService();
