import express from 'express';
import {
  assignAbsentDays,
  getAbsentDays,
  getAbsentDaysById,
  updateAbsentDays,
  deleteAbsentDays,
  generateAbsentDaysTemplate,
  importAbsentDays,
  bulkDeleteAbsentDays
} from '../controllers/absentDaysController.js';
import verifyToken from '../middleware/verifyToken.js';
import multer from 'multer';

const router = express.Router();
const upload = multer();

// Template generation (must come before /:id routes)
router.get('/:companyId/absent-days/template', verifyToken, generateAbsentDaysTemplate);

// Bulk operations
router.post('/:companyId/absent-days/bulk', verifyToken, bulkDeleteAbsentDays);
router.post('/:companyId/absent-days/import', verifyToken, upload.single('file'), importAbsentDays);

// CRUD operations
router.post('/:companyId/absent-days', verifyToken, assignAbsentDays);
router.get('/:companyId/absent-days', verifyToken, getAbsentDays);
router.get('/:companyId/absent-days/:id', verifyToken, getAbsentDaysById);
router.put('/:companyId/absent-days/:id', verifyToken, updateAbsentDays);
router.delete('/:companyId/absent-days/:id', verifyToken, deleteAbsentDays);

export default router;