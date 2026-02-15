import SibApiV3Sdk from "sib-api-v3-sdk";
import dotenv from "dotenv";

dotenv.config();

if (!process.env.BREVO_API_KEY) {
  console.warn("⚠️ Brevo API key not configured.");
}

const client = SibApiV3Sdk.ApiClient.instance;
client.authentications["api-key"].apiKey = process.env.BREVO_API_KEY;

const apiInstance = new SibApiV3Sdk.TransactionalEmailsApi();

/**
 * sendEmailService
 * Same signature as your nodemailer version.
 */
export const sendEmailService = async ({
  to,
  subject,
  text,
  html,
  company,
  attachments = [], // optional
}) => {
  try {
    const emailData = {
      sender: {
        name: company || "WageDesk",
       email: "wagedesk@gmail.com",
      },
      to: Array.isArray(to)
        ? to.map((email) => ({ email }))
        : [{ email: to }],
      subject,
      htmlContent: html,
      textContent: text,
      attachments: attachments.map((file) => ({
        name: file.name,
        content:
          file.content instanceof Buffer
            ? file.content.toString("base64")
            : file.content, // already base64
      })),
    };

    const response = await apiInstance.sendTransacEmail(emailData);

    return response;
  } catch (error) {
    console.error(
      "Brevo send error:",
      error.response?.body || error.message
    );
    throw new Error("Failed to send email");
  }
};

export const getPayslipEmailTemplate = (employeeName, companyName, payrollPeriod) => {
  const currentYear = new Date().getFullYear();

  return `
  <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
      <p>Hello ${employeeName},</p>

      <p>Your payslip for the period <strong>${payrollPeriod}</strong> from <strong>${companyName}</strong> is attached to this email.</p>

      <p>If you have any questions regarding your salary or deductions, please contact your payroll administrator.</p>

      <p>Best regards,<br/>${companyName} Payroll Team</p>

      <hr style="margin-top:24px;border:none;border-top:1px solid #eee;"/>
      <p style="font-size:11px;color:#999;text-align:center;">Powered by WageDesk · ${currentYear}</p>
  </div>
  `;
};

export const getP9AEmailTemplate = (employeeName, companyName, year) => {
  const currentYear = new Date().getFullYear();

  return `
  <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
      <p>Hello ${employeeName},</p>

      <p>Attached is your P9A tax deduction card for the year <strong>${year}</strong> from <strong>${companyName}</strong>.</p>

      <p>This document summarizes your annual earnings and tax deductions as required by the Kenya Revenue Authority (KRA).</p>

      <p>If you have any questions, please contact your payroll administrator.</p>

      <p>Best regards,<br/>${companyName} Payroll Team</p>

      <hr style="margin-top:24px;border:none;border-top:1px solid #eee;"/>
      <p style="font-size:11px;color:#999;text-align:center;">Powered by WageDesk · ${currentYear}</p>
  </div>
  `;
};