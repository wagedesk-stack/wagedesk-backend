// backend/controllers/bankController.js
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";



// Path to the static banks JSON file
// Recreate __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const banksFilePath = path.join(__dirname, "../data/banks.json");

// Get all Kenyan bank data from the JSON file
export const getKenyanBanks = (req, res) => {
  try {
    const banksData = JSON.parse(fs.readFileSync(banksFilePath, "utf8"));
    res.status(200).json(banksData);
  } catch (error) {
    console.error("Failed to read banks.json:", error);
    res.status(500).json({ error: "Failed to retrieve bank data." });
  }
};
