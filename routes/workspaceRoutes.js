import express from 'express'
import verifyToken from '../middleware/verifyToken.js';
import { getAuthContext } from '../controllers/workspaceController.js'

const router = express.Router();

router.get('/me/context', verifyToken, getAuthContext);

export default router;