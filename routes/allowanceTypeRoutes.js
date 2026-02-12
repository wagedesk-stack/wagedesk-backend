import express from 'express';
import {
  createAllowanceType,
  getAllowanceTypes,
  getAllowanceTypeById,
  updateAllowanceType,
  deleteAllowanceType
} from '../controllers/allowanceTypeController.js';
import verifyToken from '../middleware/verifyToken.js';

const router = express.Router();

router.post('/:companyId/allowance-types', verifyToken, createAllowanceType);
router.get('/:companyId/allowance-types', verifyToken, getAllowanceTypes);
router.get('/:companyId/allowance-types/:id', verifyToken, getAllowanceTypeById);
router.put('/:companyId/allowance-types/:id', verifyToken, updateAllowanceType);
router.delete('/:companyId/allowance-types/:id', verifyToken, deleteAllowanceType);

export default router;