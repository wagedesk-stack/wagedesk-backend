import { Resend } from 'resend';
import dotenv from "dotenv";

dotenv.config();

// Initialize Resend with your API Key
const resend = new Resend(process.env.RESEND_API_KEY);

/**
 * Modern Email Dispatcher using Resend
 * @param {Object} options - to, subject, html, text
 */
export const dispatchEmail = async ({ to, subject, html, text }) => {
  try {
    const { data, error } = await resend.emails.send({
      from: process.env.EMAIL_FROM || "WageWise <onboarding@resend.dev>",
      to: [to], // Resend expects an array or string
      subject: subject,
      html: html,
      text: text,
    });

    if (error) {
      console.error("Resend API Error:", error);
      throw new Error(error.message);
    }

    return data;
  } catch (err) {
    console.error("Dispatch Error:", err.message);
    throw new Error("Failed to dispatch professional email");
  }
};