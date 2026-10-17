// Applies pending migrations without starting the API: npm run migrate [-- --demo]
import { config } from '../config.js';
import { db } from './index.js';
import { migrate } from './init.js';

const applied = await migrate();
console.log(applied.length ? `Applied ${applied.join(', ')} to ${config.dbFile}` : `${config.dbFile} is up to date`);
db.close();
