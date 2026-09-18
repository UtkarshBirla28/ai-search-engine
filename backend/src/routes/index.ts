import { Router } from 'express';
import healthRoutes from './health.routes.js';
import searchRoutes from './search.routes.js';
import answerRoutes from './answer.routes.js';
import suggestRoutes from './suggest.routes.js';
import crawlRoutes from './crawl.routes.js';

const router = Router();

router.use('/health', healthRoutes);
router.use('/search', searchRoutes);
router.use('/answer', answerRoutes);
router.use('/suggest', suggestRoutes);
router.use('/crawl', crawlRoutes);

export default router;
