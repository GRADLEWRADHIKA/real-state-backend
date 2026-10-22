import { Router } from 'express';
import { expenseBody, expenseListQuery, toCsv } from '@estateflow/shared';
import { db } from '../db/index.js';
import { adminAppReadOnly, authorize } from '../middleware/auth.js';
import { HttpError, attachmentHeader, idParam, likeParam, notFound, pageMeta, paging, parse, parseQuery } from '../utils/http.js';
import { nowIso, today } from '../utils/dates.js';

/** Site and office spending ("kharcha"), kept by accounts. */
const r = Router();
r.use(authorize('admin', 'accounts'), adminAppReadOnly);

const SELECT = 'SELECT e.*, u.name AS recorded_by_name FROM expenses e LEFT JOIN users u ON u.id = e.recorded_by';

function filters(q: ReturnType<typeof expenseListQuery.parse>) {
  let where = 'WHERE 1=1';
  const params: unknown[] = [];
  if (q.category) { where += ' AND e.category = ?'; params.push(q.category); }
  if (q.from) { where += ' AND e.expense_date >= ?'; params.push(q.from); }
  if (q.to) { where += ' AND e.expense_date <= ?'; params.push(q.to); }
  if (q.q) { const like = likeParam(q.q); where += ' AND (e.description LIKE ? OR e.paid_to LIKE ? OR e.reference LIKE ?)'; params.push(like, like, like); }
  return { where, params };
}

r.get('/', async (req, res) => {
  const q = parseQuery(expenseListQuery, req);
  const p = paging(q, 100);
  const { where, params } = filters(q);
  const total = (await db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM expenses e ${where}`, params))!.n;
  const data = await db.all(`${SELECT} ${where} ORDER BY e.expense_date DESC, e.id DESC LIMIT ? OFFSET ?`, [...params, p.limit, p.offset]);
  const byCategory = await db.all(`SELECT e.category, COUNT(*) AS count, COALESCE(SUM(e.amount), 0) AS amount FROM expenses e ${where} GROUP BY e.category ORDER BY amount DESC`, params);
  const month = today().slice(0, 7);
  const sums = await db.get(
    `SELECT COALESCE(SUM(amount), 0) AS total,
       COALESCE(SUM(CASE WHEN expense_date = ? THEN amount END), 0) AS today,
       COALESCE(SUM(CASE WHEN substr(expense_date, 1, 7) = ? THEN amount END), 0) AS month
     FROM expenses e ${where}`,
    [today(), month, ...params],
  );
  res.json({ data, meta: pageMeta(total, p, { byCategory, totals: sums }) });
});

r.get('/export.csv', async (req, res) => {
  const q = parseQuery(expenseListQuery, req);
  const { where, params } = filters(q);
  const rows = await db.all(`${SELECT} ${where} ORDER BY e.expense_date, e.id`, params);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', attachmentHeader(`expenses-${today()}.csv`));
  res.send(
    toCsv(rows, [
      { key: 'expense_date', label: 'Date' },
      { key: 'category', label: 'Category' },
      { key: 'description', label: 'Description' },
      { key: 'paid_to', label: 'Paid to' },
      { key: 'method', label: 'Method' },
      { key: 'reference', label: 'Reference' },
      { key: 'amount', label: 'Amount (INR)' },
      { key: 'recorded_by_name', label: 'Recorded by' },
    ]),
  );
});

r.post('/', async (req, res) => {
  const data = parse(expenseBody, req.body);
  if (data.expense_date > today()) throw new HttpError(422, 'expense_date: cannot be in the future');
  const id = await db.insert('expenses', { ...data, recorded_by: req.user.id, created_at: nowIso() });
  res.status(201).json(await db.get(`${SELECT} WHERE e.id = ?`, [id]));
});

r.put('/:id', async (req, res) => {
  const id = idParam(req);
  if (!(await db.get('SELECT id FROM expenses WHERE id = ?', [id]))) throw notFound('Expense');
  const data = parse(expenseBody.partial(), req.body);
  if (data.expense_date && data.expense_date > today()) throw new HttpError(422, 'expense_date: cannot be in the future');
  await db.update('expenses', id, data);
  res.json(await db.get(`${SELECT} WHERE e.id = ?`, [id]));
});

r.delete('/:id', async (req, res) => {
  const id = idParam(req);
  if (!(await db.get('SELECT id FROM expenses WHERE id = ?', [id]))) throw notFound('Expense');
  await db.run('DELETE FROM expenses WHERE id = ?', [id]);
  res.status(204).end();
});

export default r;
