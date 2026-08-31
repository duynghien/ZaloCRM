/**
 * email-service.ts — Sends executive AI Digest reports via HTML email using nodemailer.
 * Supports organization-level SMTP settings or environment variable fallbacks.
 */
import nodemailer from 'nodemailer';
import { prisma } from '../../shared/database/prisma-client.js';
import { logger } from '../../shared/utils/logger.js';

export interface SmtpConfig {
  host: string;
  port: number;
  secure?: boolean;
  auth: {
    user: string;
    pass: string;
  };
  from?: string;
}

export interface SendEmailReportOptions {
  orgId: string;
  toEmail: string | string[];
  reportTitle: string;
  markdownContent: string;
  periodText?: string;
  smtpConfig?: SmtpConfig;
}

export interface SendEmailReportResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

/**
 * Resolve SMTP configuration for an organization (from DB settings or ENV)
 */
export async function getOrgSmtpConfig(orgId: string): Promise<SmtpConfig | null> {
  try {
    const setting = await prisma.appSetting.findUnique({
      where: {
        orgId_settingKey: {
          orgId,
          settingKey: 'ai_report_smtp_config',
        },
      },
    });

    if (setting?.valuePlain) {
      const parsed = JSON.parse(setting.valuePlain);
      if (parsed.host && parsed.auth?.user && parsed.auth?.pass) {
        return parsed as SmtpConfig;
      }
    }
  } catch (err) {
    logger.warn(`[email-service] Failed to read DB SMTP settings for org ${orgId}:`, err);
  }

  // Fallback to environment variables
  if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
    return {
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || '587', 10),
      secure: process.env.SMTP_SECURE === 'true' || process.env.SMTP_PORT === '465',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
      from: process.env.SMTP_FROM || `"ZaloCRM AI Digest" <${process.env.SMTP_USER}>`,
    };
  }

  return null;
}

/**
 * Basic Markdown to HTML converter for email rendering
 */
function markdownToEmailHtml(markdown: string): string {
  let html = markdown
    // Headings
    .replace(/^# (.*$)/gim, '<h1 style="color: #0F172A; font-size: 22px; margin-top: 24px; margin-bottom: 12px; font-weight: 700; border-bottom: 2px solid #E2E8F0; padding-bottom: 8px;">$1</h1>')
    .replace(/^## (.*$)/gim, '<h2 style="color: #1E293B; font-size: 17px; margin-top: 20px; margin-bottom: 10px; font-weight: 600; border-left: 4px solid #0284C7; padding-left: 10px;">$1</h2>')
    .replace(/^### (.*$)/gim, '<h3 style="color: #334155; font-size: 15px; margin-top: 14px; margin-bottom: 6px; font-weight: 600;">$1</h3>')
    // Bold & italic
    .replace(/\*\*(.*?)\*\*/gim, '<strong style="color: #0F172A;">$1</strong>')
    .replace(/\*(.*?)\*/gim, '<em>$1</em>')
    // Horizontal rule
    .replace(/^---$/gim, '<hr style="border: 0; border-top: 1px solid #E2E8F0; margin: 20px 0;" />')
    // Bullet lists
    .replace(/^\s*-\s+(.*$)/gim, '<li style="margin-bottom: 6px; line-height: 1.6;">$1</li>')
    // Paragraphs / line breaks
    .replace(/\n\n/gim, '</p><p style="margin-bottom: 12px; line-height: 1.6; color: #334155;">')
    .replace(/\n/gim, '<br />');

  return `<p style="margin-bottom: 12px; line-height: 1.6; color: #334155;">${html}</p>`;
}

/**
 * Build responsive HTML email template
 */
export function buildReportEmailHtml(title: string, markdown: string, periodText?: string): string {
  const bodyHtml = markdownToEmailHtml(markdown);

  return `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #F8FAFC; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #334155;">
  <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #F8FAFC; padding: 24px 12px;">
    <tr>
      <td align="center">
        <table width="100%" max-width="680" border="0" cellspacing="0" cellpadding="0" style="max-width: 680px; width: 100%; background-color: #FFFFFF; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06); border: 1px solid #E2E8F0;">
          
          <!-- Header Banner -->
          <tr>
            <td style="background: linear-gradient(135deg, #0284C7, #0369A1); padding: 28px 24px; text-align: left;">
              <div style="display: inline-block; background: rgba(255, 255, 255, 0.2); color: #FFFFFF; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; padding: 4px 10px; border-radius: 9999px; margin-bottom: 8px;">
                🤖 AI Executive Digest
              </div>
              <h1 style="color: #FFFFFF; margin: 0 0 6px 0; font-size: 20px; font-weight: 700; line-height: 1.3;">
                ${title}
              </h1>
              ${
                periodText
                  ? `<div style="color: #BAE6FD; font-size: 13px;">${periodText}</div>`
                  : ''
              }
            </td>
          </tr>

          <!-- Report Body -->
          <tr>
            <td style="padding: 28px 24px; font-size: 14px; line-height: 1.6;">
              ${bodyHtml}
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color: #F1F5F9; padding: 18px 24px; text-align: center; border-top: 1px solid #E2E8F0; font-size: 12px; color: #64748B;">
              <p style="margin: 0 0 4px 0;">Báo cáo được tổng hợp tự động bởi <strong>ZaloCRM AI Engine</strong>.</p>
              <p style="margin: 0;">Xem chi tiết và tùy chỉnh tại hệ thống ZaloCRM.</p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/**
 * Send report email to recipient(s)
 */
export async function sendReportEmail(options: SendEmailReportOptions): Promise<SendEmailReportResult> {
  const { orgId, toEmail, reportTitle, markdownContent, periodText } = options;

  const smtp = options.smtpConfig || (await getOrgSmtpConfig(orgId));
  if (!smtp) {
    logger.warn(`[email-service] No SMTP configuration found for org ${orgId}`);
    return {
      success: false,
      error: 'Hệ thống chưa được cấu hình máy chủ gửi Email SMTP.',
    };
  }

  try {
    const transporter = nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.secure ?? smtp.port === 465,
      auth: {
        user: smtp.auth.user,
        pass: smtp.auth.pass,
      },
    });

    const html = buildReportEmailHtml(reportTitle, markdownContent, periodText);

    const info = await transporter.sendMail({
      from: smtp.from || smtp.auth.user,
      to: Array.isArray(toEmail) ? toEmail.join(', ') : toEmail,
      subject: `[ZaloCRM] ${reportTitle}`,
      text: markdownContent,
      html,
    });

    logger.info(`[email-service] Sent report email to ${toEmail} (messageId: ${info.messageId})`);
    return {
      success: true,
      messageId: info.messageId,
    };
  } catch (err: any) {
    logger.error(`[email-service] Error sending report email to ${toEmail}:`, err?.message || err);
    return {
      success: false,
      error: err?.message || 'Lỗi khi gửi email SMTP.',
    };
  }
}
