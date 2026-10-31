import type { Migration } from './types.js';
import { migration as m001 } from './001_initial_schema.js';
import { migration as m002 } from './002_auth_security.js';
import { migration as m003 } from './003_field_features.js';
import { migration as m004 } from './004_property_images.js';
import { migration as m005 } from './005_plot_crm.js';
import { migration as m006 } from './006_sales_tools.js';
import { migration as m007 } from './007_login_failures.js';

/** Append new migrations here; never edit or reorder a released one. */
export const MIGRATIONS: Migration[] = [m001, m002, m003, m004, m005, m006, m007];
export type { Migration };
