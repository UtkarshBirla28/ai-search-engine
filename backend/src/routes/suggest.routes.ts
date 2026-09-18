import { Router } from 'express';
import { suggest } from '../controllers/suggest.controller.js';
import validate from '../middlewares/validate.js';
import { suggestQuerySchema } from '../validators/suggest.validator.js';

const router = Router();

router.get('/', validate({ query: suggestQuerySchema }), suggest);

export default router;
