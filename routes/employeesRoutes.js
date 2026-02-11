import express from 'express';
import verifyToken from '../middleware/verifyToken.js'
import multer from 'multer';
import {
    getEmployees,
    getEmployeeById,
    addEmployee,
    updateEmployee,
    deleteEmployee,
    importEmployees,
    generateEmployeeTemplate,
    sendEmployeeEmail
} from '../controllers/employeeController.js';

const router = express.Router();
const upload = multer();

router.get('/:companyId/employees', verifyToken, getEmployees);
router.get('/:companyId/employees/template', verifyToken, generateEmployeeTemplate);
router.get('/:companyId/employees/:employeeId', verifyToken, getEmployeeById);
router.post('/:companyId/employees/email', verifyToken, sendEmployeeEmail);
router.post('/:companyId/employees', verifyToken, addEmployee);
router.put('/:companyId/employees/:employeeId', verifyToken, updateEmployee);
router.post('/:companyId/employees/import', verifyToken, upload.single('file'), importEmployees);
router.delete('/:companyId/employees/:employeeId', verifyToken, deleteEmployee);

export default router;