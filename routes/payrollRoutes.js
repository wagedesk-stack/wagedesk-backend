// backend/routes/payrollRoutes.js
import express from "express";
import { 
    syncPayroll,
    getPayrollRuns,
    getPayrollRun,
    getPayrollDetails,
    updatePayrollStatus,
    completePayrollRun,
    cancelPayrollRun,
    lockPayrollRun,
    unlockPayrollRun,
    markAsPaid,
    getPayrollYears,
    getPayrollSummary,
    deletePayrollRun,
    getPayrollReviewStatus,
    updateItemReviewStatus,
     bulkUpdateReviewStatus
} from '../controllers/payrollController.js';
import verifyToken from '../middleware/verifyToken.js';
import { checkPayrollAccess } from '../middleware/payrollAccess.js';

const router = express.Router({ mergeParams: true });

// Apply verification middleware to all routes
router.use(verifyToken);

// Main payroll operations
router.get('/payroll/runs/:runId/review-summary', getPayrollReviewStatus);
router.post('/payroll/sync', syncPayroll);
router.get('/payroll/runs', getPayrollRuns);
router.get('/payroll/runs/:runId', getPayrollRun);
router.get('/payroll/runs/:runId/details', getPayrollDetails);
router.get('/payroll/summary', getPayrollSummary);
router.get('/payroll/years', getPayrollYears);

router.patch('/payroll/reviews/:reviewId', updateItemReviewStatus);
// BULK review updates - Add this new route
router.post('/payroll/reviews/bulk', bulkUpdateReviewStatus);

// Status management with access control
router.patch('/payroll/:runId/status', checkPayrollAccess, updatePayrollStatus);
router.post('/payroll/:runId/complete', checkPayrollAccess, completePayrollRun);
router.post('/payroll/:runId/cancel', checkPayrollAccess, cancelPayrollRun);
router.post('/payroll/:runId/lock', checkPayrollAccess, lockPayrollRun);
router.post('/payroll/:runId/unlock', checkPayrollAccess, unlockPayrollRun);
router.post('/payroll/:runId/paid', checkPayrollAccess, markAsPaid);

// Dangerous operations (require additional checks)
router.delete('/payroll/:runId', checkPayrollAccess, deletePayrollRun);

export default router;