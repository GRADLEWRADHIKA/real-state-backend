import type { Migration } from './types.js';
import { migration as m001 } from './001_initial_schema.js';
import { migration as m002 } from './002_auth_security.js';
import { migration as m003 } from './003_field_features.js';
import { migration as m004 } from './004_property_images.js';

/** Append new migrations here; never edit or reorder a released one. */
export const MIGRATIONS: Migration[] = [m001, m002, m003, m004];
export type { Migration };
