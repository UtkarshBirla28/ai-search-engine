import { Router } from 'express';
import { search } from '../controllers/search.controller.js';
import validate from '../middlewares/validate.js';
import { searchQuerySchema } from '../validators/search.validator.js';

const router = Router();

router.get('/', validate({ query: searchQuerySchema }), search);

export default router;
