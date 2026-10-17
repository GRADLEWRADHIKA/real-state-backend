import { Router } from 'express';
import { realtime } from '../services/realtime.js';

/**
 * Server-sent events. Clients read the stream with fetch (so the bearer token and client header are
 * sent like any other request) and invalidate cached queries for the resources each event names.
 */
const r = Router();

r.get('/', (req, res) => {
  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
  res.write('retry: 5000\n\n');
  const remove = realtime.add({ userId: req.user.id, role: req.user.role, res });
  req.on('close', remove);
});

export default r;
