import express from 'express';
import verifyToken from '../middleware/verifyToken.js';
import { createCompany, manageDepartments, manageSubDepartments, manageJobTitles } from '../controllers/companyController.js';

const router = express.Router();

router.use(verifyToken);

router.post('/', createCompany);

// Departments
router.get('/:companyId/departments', manageDepartments.list);
router.post('/departments', manageDepartments.create);
router.delete('/departments/:id', manageDepartments.delete);

// Sub-Departments
router.get('/:companyId/sub-departments', manageSubDepartments.list);
router.post('/sub-departments', manageSubDepartments.create);

// Job Titles
router.get('/:companyId/job-titles', manageJobTitles.list);
router.post('/job-titles', manageJobTitles.create);

export default router;