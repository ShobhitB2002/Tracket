const { vercel } = require('../lib/http');
const { handleClearRunning } = require('../lib/core');
module.exports = vercel(handleClearRunning, { methods: ['DELETE'] });
