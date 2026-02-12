import express from 'express';
import {
  createDeductionType,
  getDeductionTypes,
  getDeductionTypeById,
  updateDeductionType,
  deleteDeductionType
} from '../controllers/deductionTypeController.js';
import verifyToken from '../middleware/verifyToken.js';

const router = express.Router();

router.post('/:companyId/deduction-types', verifyToken, createDeductionType);
router.get('/:companyId/deduction-types', verifyToken, getDeductionTypes);
router.get('/:companyId/deduction-types/:id', verifyToken, getDeductionTypeById);
router.put('/:companyId/deduction-types/:id', verifyToken, updateDeductionType);
router.delete('/:companyId/deduction-types/:id', verifyToken, deleteDeductionType);

export default router;