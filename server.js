import express from 'express';
import userRoutes from './routes/user.js';
import adminRoutes from './routes/admin.js';
import purchaseRoutes from './routes/purchase.js';
import employeeRoutes from './routes/employee.js';
import { getLiveCatalog } from './src/catalog.js';
import { userCors } from './src/firebase.js';
import { telegramNotify } from './src/telegram.js';
import { rateLimit, securityHeaders } from './src/security.js';
import { asyncHandler } from './src/asyncHandler.js';
import { policyCache } from './src/sharedCaches.js';
import { startBootstrap } from './src/bootstrap.js';
import { STORE_NAME } from './src/store.js';

const app = express();
app.disable('x-powered-by');

app.set('trust proxy', 1);

app.use(securityHeaders);

app.use('/api/user/avatar', express.json({ limit: '800kb' }));

app.use(express.json({ limit: '16kb' }));


app.use('/api', rateLimit({ windowMs: 60_000, max: 180, name: 'api' }));


app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ success: false, error: 'Invalid JSON body' });
  }
  next(err);
});


const NOTIFY_ALL_REQUESTS = process.env.NOTIFY_ALL_REQUESTS === 'true';
const securityAlertSeen = new Map();
const SECURITY_ALERT_TTL = 60_000;

app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const isProblem = res.statusCode === 401 || res.statusCode === 403 || res.statusCode === 429 || res.statusCode >= 500;
    if (!isProblem && !NOTIFY_ALL_REQUESTS) return;


    const alertKey = `${req.ip}|${req.method}|${req.path}|${res.statusCode}`;
    const now = Date.now();
    if (isProblem) {
      const last = securityAlertSeen.get(alertKey) || 0;
      if (now - last < SECURITY_ALERT_TTL) return;
      securityAlertSeen.set(alertKey, now);
      for (const [k, t] of securityAlertSeen) {
        if (now - t > SECURITY_ALERT_TTL * 2) securityAlertSeen.delete(k);
      }
    }

    const origin = req.headers.origin || req.headers.referer || '—';
    const emoji = isProblem ? '🚨' : '📡';
    telegramNotify(
      `${emoji} <b>${req.method} ${req.path}</b>\n` +
      `IP: <code>${req.ip}</code>\n` +
      `Origin: ${origin}\n` +
      `Status: <b>${res.statusCode}</b>\n` +
      `${Date.now() - start}ms`
    );
  });
  next();
});

app.get('/', (req, res) => {
  res.status(200).json({ success: true, status: 'online', store: STORE_NAME });
});


app.get('/health', (req, res) => {
  res.status(200).json({ success: true, status: 'awake', uptime: process.uptime() });
});


app.get('/api/catalog', userCors, asyncHandler(async (req, res) => {
  const catalog = await getLiveCatalog();
  res.json({ success: true, catalog });
}));


app.get('/api/policy', userCors, asyncHandler(async (req, res) => {

  res.json({ success: true, ...(await policyCache.get()) });
}));

app.use('/api/user', userRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/employee', employeeRoutes);
app.use('/api/purchase', purchaseRoutes);


app.use((err, req, res, next) => {
  console.error('[store-backend] Unhandled error:', err);
  if (res.headersSent) return next(err);
  res.status(500).json({ success: false, error: 'Internal server error. Please try again.' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`${STORE_NAME} backend listening on port ${PORT}`);

  startBootstrap();
});
