import type { Migration } from './types.js';
import { uniqueSlug } from '../../images/slug.js';

export const migration: Migration = {
  id: '004_property_images',
  async up(db) {
    await db.exec(`
      ALTER TABLE properties ADD COLUMN slug TEXT;
      ALTER TABLE properties ADD COLUMN is_published INTEGER NOT NULL DEFAULT 0;

      CREATE TABLE property_images (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
        file_path TEXT NOT NULL,
        thumb_path TEXT NOT NULL,
        medium_path TEXT NOT NULL,
        alt_text TEXT NOT NULL,
        caption TEXT,
        kind TEXT NOT NULL DEFAULT 'other',
        is_cover INTEGER NOT NULL DEFAULT 0,
        is_ai_generated INTEGER NOT NULL DEFAULT 0,
        -- 'upload' (staff) or 'generated' (the generator; only these are ever replaced automatically)
        source TEXT NOT NULL DEFAULT 'upload',
        sort_order INTEGER NOT NULL DEFAULT 0,
        width INTEGER,
        height INTEGER,
        size INTEGER,
        mime TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_property_images_property ON property_images(property_id, sort_order);
      -- At most one cover per property, enforced by the database as well as in code.
      CREATE UNIQUE INDEX idx_property_images_cover ON property_images(property_id) WHERE is_cover = 1;
    `);
    // Existing properties keep all their data and get a readable, unique slug.
    const rows = await db.all<{ id: number; project: string; unit_number: string }>('SELECT id, project, unit_number FROM properties ORDER BY id');
    const taken = new Set<string>();
    for (const p of rows) {
      const slug = uniqueSlug(`${p.project} ${p.unit_number}`, taken);
      taken.add(slug);
      await db.run('UPDATE properties SET slug = ? WHERE id = ?', [slug, p.id]);
    }
    await db.exec('CREATE UNIQUE INDEX idx_properties_slug ON properties(slug)');
  },
};
