// backend/routes/reportsRoutes.js
import express from 'express';
import { 
    generateReport,
     generateAnnualGrossEarningsReport,
     getAnnualReportYears
     } from '../controllers/reportsController.js';
import verifyToken from '../middleware/verifyToken.js';

const router = express.Router({ mergeParams: true });

router.get('/:runId/reports/:reportType', verifyToken, generateReport);
router.get('/available-years', verifyToken, getAnnualReportYears);
router.get('/annual-gross-earnings', verifyToken, generateAnnualGrossEarningsReport);

export default router;