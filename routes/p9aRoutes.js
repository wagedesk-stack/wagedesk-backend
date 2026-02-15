// backend/routes/p9aRoutes.js
import express from 'express';
import { generateP9APdf, emailP9A } from '../controllers/p9aController.js';
import verifyToken from '../middleware/verifyToken.js';

const router = express.Router({ mergeParams: true });

/**
 * @swagger
 * /companies/{companyId}/employees/{employeeId}/p9a/{year}:
 * get:
 * summary: Generate a P9A tax deduction card for a specific employee and year.
 * tags: [Reports]
 * parameters:
 * - in: path
 * name: companyId
 * required: true
 * schema:
 * type: string
 * description: The ID of the company.
 * - in: path
 * name: employeeId
 * required: true
 * schema:
 * type: string
 * description: The ID of the employee.
 * - in: path
 * name: year
 * required: true
 * schema:
 * type: integer
 * description: The tax year for the report (e.g., 2023).
 * responses:
 * 200:
 * description: P9A PDF successfully generated and returned.
 * content:
 * application/pdf:
 * schema:
 * type: string
 * format: binary
 * 400:
 * description: Missing parameters.
 * 403:
 * description: Unauthorized access or data does not belong to the company.
 * 404:
 * description: Employee or payroll data not found.
 * 500:
 * description: Server error.
 */
router.get('/:employeeId/p9a/:year', verifyToken,  generateP9APdf);

// Define the new route to email the P9A
router.post('/:employeeId/p9a/:year/email', verifyToken, emailP9A);

export default router;
