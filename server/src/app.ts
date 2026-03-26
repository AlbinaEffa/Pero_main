// auth.ts is imported first — its dotenv.config() runs before other routes create their Pool instances
import authRoutes from './routes/auth.js';
import projectsRoutes from './routes/projects.js';
import chaptersRoutes from './routes/chapters.js';
import aiRoutes from './routes/ai.js';
import bibleRoutes from './routes/bible.js';
import importRoutes from './routes/import.js';
import embedRoutes from './routes/embed.js';
import revisionRoutes from './routes/revision.js';
import jobsRoutes from './routes/jobs.js';
import feedbackRoutes from './routes/feedback.js';
import adminRoutes from './routes/admin.js';
import demoRoutes from './routes/demo.js';
import exportRoutes from './routes/export.js';
import searchRoutes from './routes/search.js';
import { getCircuitStates } from './lib/aiGuard.js';

import express from 'express';
import cors from 'cors';

export const app = express();

app.use(cors());
app.use(express.json({ limit: '5mb' }));

app.use('/api/auth',     authRoutes);
app.use('/api/projects', projectsRoutes);
app.use('/api/chapters', chaptersRoutes);
app.use('/api/ai',       aiRoutes);
app.use('/api/bible',    bibleRoutes);
app.use('/api/import',   importRoutes);
app.use('/api/embed',    embedRoutes);
app.use('/api/revision', revisionRoutes);
app.use('/api/jobs',     jobsRoutes);
app.use('/api/feedback', feedbackRoutes);
app.use('/api/admin',    adminRoutes);
app.use('/api/demo',     demoRoutes);
app.use('/api/export',   exportRoutes);
app.use('/api/search',   searchRoutes);

app.get('/health', (_req, res) => {
  const circuits = getCircuitStates();
  const anyOpen  = Object.values(circuits).some((c: any) => c.state === 'OPEN');
  res.status(anyOpen ? 503 : 200).json({
    status:   anyOpen ? 'degraded' : 'ok',
    circuits,
    uptime:   Math.floor(process.uptime()),
    memory:   process.memoryUsage().rss,
  });
});
