import { Router } from 'express';
import { crawlUrls, crawlStatus } from '../controllers/crawl.controller.js';
import validate from '../middlewares/validate.js';
import { crawlBodySchema } from '../validators/crawl.validator.js';

const router = Router();

router.post('/', validate({ body: crawlBodySchema }), crawlUrls);
router.get('/:jobId', crawlStatus);

export default router;
