import express from "express";
import supabase from "../libs/supabaseClient.js";
import verifyToken from "../middleware/verifyToken.js";
import {
  createCompany,
  getCompanyDetails,
  updateCompanyDetails,
  getCompanySettingsSummary,
  manageDepartments,
  manageSubDepartments,
  manageJobTitles,
} from "../controllers/companyController.js";
import multer from "multer";

const upload = multer({ storage: multer.memoryStorage() });
const router = express.Router();

//create company
router.post("/", verifyToken, upload.single("logo"), createCompany);

router.get('/:companyId/settings', verifyToken, getCompanySettingsSummary);
router.get('/:companyId', verifyToken, getCompanyDetails);
router.patch('/:companyId', verifyToken, upload.single('logo'), updateCompanyDetails);

// Departments
router.get("/:companyId/departments", verifyToken, manageDepartments.list);
router.post("/departments", verifyToken, manageDepartments.create);
router.delete("/departments/:id", verifyToken, manageDepartments.delete);

// Sub-Departments
router.get(
  "/:companyId/sub-departments",
  verifyToken,
  manageSubDepartments.list,
);
// routes
router.get(
  "/departments/:departmentId/sub-departments",
  verifyToken,
  async (req, res) => {
    const { data, error } = await supabase
      .from("sub_departments")
      .select("*")
      .eq("department_id", req.params.departmentId);

    if (error) return res.status(400).json(error);
    res.json(data || []);
  },
);

router.post("/sub-departments", verifyToken, manageSubDepartments.create);

// Job Titles
router.get("/:companyId/job-titles", verifyToken, manageJobTitles.list);
router.post("/job-titles", verifyToken, manageJobTitles.create);

export default router;
