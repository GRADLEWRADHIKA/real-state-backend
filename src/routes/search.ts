import { Router } from 'express';
import { db } from '../db/index.js';
import { authorize } from '../middleware/auth.js';
import { phoneDigitsSql, phoneLikeParam } from '../utils/http.js';

const r = Router();
r.use(authorize('admin', 'manager', 'sales', 'accounts'));

r.get('/', async (req, res) => {
  const q = String(req.query.q ?? '').trim();
  if (q.length < 2) return res.json({ leads: [], customers: [], properties: [] });
  const like = `%${q}%`;
  const phone = phoneLikeParam(q);
  const u = req.user;
  const sales = u.role === 'sales';
  const [leads, customers, properties] = await Promise.all([
    u.role === 'accounts'
      ? []
      : db.all(
          `SELECT l.id, l.code, l.name, l.phone, l.status FROM leads l
           WHERE (l.name LIKE ? OR l.phone LIKE ? OR l.phone_norm LIKE ? OR l.email LIKE ? OR l.code LIKE ?)${sales ? ' AND l.assigned_to = ?' : ''}
           ORDER BY l.updated_at DESC LIMIT 6`,
          [like, like, phone, like, like, ...(sales ? [u.id] : [])],
        ),
    db.all(
      `SELECT c.id, c.code, c.name, c.phone, p.project AS property_project, p.unit_number AS property_unit FROM customers c
       LEFT JOIN properties p ON p.id = c.property_id
       WHERE (c.name LIKE ? OR c.phone LIKE ? OR ${phoneDigitsSql('c.phone')} LIKE ? OR c.email LIKE ? OR c.code LIKE ?)${sales ? ' AND c.assigned_to = ?' : ''}
       ORDER BY c.name LIMIT 6`,
      [like, like, phone, like, like, ...(sales ? [u.id] : [])],
    ),
    db.all(
      `SELECT id, code, name, project, unit_number, status, price FROM properties
       WHERE name LIKE ? OR project LIKE ? OR unit_number LIKE ? OR code LIKE ? ORDER BY project, unit_number LIMIT 6`,
      [like, like, like, like],
    ),
  ]);
  res.json({ leads, customers, properties });
});

export default r;
