const { vercel } = require('../lib/http');
const { handleToday } = require('../lib/core');
module.exports = vercel(handleToday);
