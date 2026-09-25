// Each test file gets its own throwaway store and a fixed secret. Require this first.
const os = require('os');
const path = require('path');
const fs = require('fs');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tracket-test-'));
process.env.TRACKET_DATA_FILE = path.join(dir, 'store.json');
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-secret-0123456789';
delete process.env.VERCEL;
module.exports = { dir };
