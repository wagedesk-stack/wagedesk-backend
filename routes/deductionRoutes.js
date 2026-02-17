import express from 'express';
import {
  assignDeduction,
  getDeductions,
  getDeductionById,
  updateDeduction,
  removeDeduction,
  generateDeductionTemplate,
  importDeductions,
  bulkDeleteDeductions
} from '../controllers/deductionController.js';
import verifyToken from '../middleware/verifyToken.js';
import multer from 'multer';

const router = express.Router();
const upload = multer();

router.post('/:companyId/deductions', verifyToken, assignDeduction);
router.get('/:companyId/deductions', verifyToken, getDeductions);
router.get('/:companyId/deductions/template', verifyToken, generateDeductionTemplate);
router.get('/:companyId/deductions/:id', verifyToken, getDeductionById);
router.put('/:companyId/deductions/:id', verifyToken, updateDeduction);
router.delete('/:companyId/deductions/:id', verifyToken, removeDeduction);
router.post('/:companyId/deductions/bulk', verifyToken, bulkDeleteDeductions);
router.post('/:companyId/deductions/import', verifyToken, upload.single('file'), importDeductions); 

export default router;