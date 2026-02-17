// backend/routes/reportsRoutes.js
import express from 'express';
import { 
    generateReport,
     generateAnnualGrossEarningsReport,
     getAnnualReportYears
     } from '../controllers/reportsController.js';
import { getPayrollReportData, getLatestPayrollOverview } from '../controllers/payrollReviewController.js';
import verifyToken from '../middleware/verifyToken.js';

const router = express.Router({ mergeParams: true });

router.get('/latest-overview', verifyToken, getLatestPayrollOverview);

router.get('/available-years', verifyToken, getAnnualReportYears);
router.get('/annual-gross-earnings', verifyToken, generateAnnualGrossEarningsReport);

router.get('/:runId/reports/:reportType', verifyToken, generateReport);
router.get("/:runId/prepare", verifyToken, getPayrollReportData);



export default router;