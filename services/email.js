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
