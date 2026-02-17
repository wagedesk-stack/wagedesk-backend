import express from 'express';
import {
  assignAllowance,
  getAllowances,
  getAllowanceById,
  updateAllowance,
  removeAllowance,
  generateAllowanceTemplate,
  importAllowances,
  bulkDeleteAllowances
} from '../controllers/allowanceController.js';
import verifyToken from '../middleware/verifyToken.js';
import multer from 'multer';

const router = express.Router();
const upload = multer();

router.post('/:companyId/allowances', verifyToken, assignAllowance);
router.get('/:companyId/allowances', verifyToken, getAllowances);
router.get('/:companyId/allowances/template', verifyToken, generateAllowanceTemplate);
router.get('/:companyId/allowances/:id', verifyToken, getAllowanceById);
router.put('/:companyId/allowances/:id', verifyToken, updateAllowance);
router.delete('/:companyId/allowances/:id', verifyToken, removeAllowance);
router.post('/:companyId/allowances/bulk', verifyToken, bulkDeleteAllowances); // New route for bulk deletion
router.post('/:companyId/allowances/import', verifyToken, upload.single('file'), importAllowances); // New route for file upload

export default router;