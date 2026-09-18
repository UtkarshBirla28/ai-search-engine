import { Router } from 'express';
import { answer } from '../controllers/answer.controller.js';
import validate from '../middlewares/validate.js';
import { answerQuerySchema } from '../validators/answer.validator.js';

const router = Router();

router.get('/', validate({ query: answerQuerySchema }), answer);

export default router;
