import express from 'express';
import { getKenyanBanks } from '../controllers/bankController.js';

const router = express.Router();

router.get('/banks', getKenyanBanks);

export default router;