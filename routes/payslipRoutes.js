// backend/routes/payslipRoutes.js

import express from 'express';
import { generatePayslipPdf, emailPayslip } from '../controllers/payslipController.js';
import verifyToken from '../middleware/verifyToken.js';

const router = express.Router({ mergeParams: true });


// Define the route to download the payslip
// The :companyId is included for context and security
router.get('/:payrollDetailId/download', verifyToken, generatePayslipPdf);
// Define the route to email the payslip
router.post('/:payrollDetailId/email', verifyToken, emailPayslip);

export default router;