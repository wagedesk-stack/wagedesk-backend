import express from "express";
import supabase from "../libs/supabaseClient.js";
import verifyToken from "../middleware/verifyToken.js";
import {
  listCompanyUsers,
  addCompanyUser,
  updateCompanyUserRole,
  removeCompanyUser,
  toggleUserSuspension,
  resetUserPassword,
  sendCredentialsEmail,
} from "../controllers/companyUsersController.js";

const router = express.Router();

// All routes require authentication
router.use(verifyToken);

// Company Users Management
router.get("/:companyId/users", listCompanyUsers);
router.post("/:companyId/users", addCompanyUser);
router.patch("/:companyId/users/:userId/role", updateCompanyUserRole);
router.delete("/:companyId/users/:userId", removeCompanyUser);

// User status management
router.patch("/:companyId/users/:userId/suspend", toggleUserSuspension);
router.post("/:companyId/users/:userId/reset-password", resetUserPassword);
router.post("/:companyId/users/:userId/send-credentials", sendCredentialsEmail);

export default router;