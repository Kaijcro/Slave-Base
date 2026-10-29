/** `npm run drive-sync`: copy everything to Google Drive now (the runner also does this after every task). */
import 'dotenv/config';
import { syncAll } from './sync';

const r = await syncAll({ log: console.log });
if (r.skipped) { console.log('Another copy to Drive is running right now (probably the town runner). Try again in a few minutes.'); process.exit(0); }
console.log(`✔ ${r.docs} file${r.docs === 1 ? '' : 's'} copied, ${r.sheets} sheet${r.sheets === 1 ? '' : 's'} refreshed.\n  Your folder: ${r.folderUrl}`);
