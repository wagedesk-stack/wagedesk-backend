import nodemailer from "nodemailer";
import dotenv from "dotenv";

dotenv.config();

if (!process.env.EMAIL_USER || !process.env.EMAIL_PASSWORD) {
  console.warn("⚠️ Email service not fully configured.");
}

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASSWORD,
  },
});

export const sendEmailService = async ({
  to,
  subject,
  text,
  html,
  company,
}) => {
  try {
    const info = await transporter.sendMail({
      from: `${company} <${process.env.EMAIL_USER}>`,
      to,
      subject,
      text,
      html,
    });

    return info;
  } catch (error) {
    console.error("Email send error:", error.message);
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