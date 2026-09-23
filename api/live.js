const { vercel } = require('../lib/http');
const { handleLive } = require('../lib/core');
module.exports = vercel(handleLive);
