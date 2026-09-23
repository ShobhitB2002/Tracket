const { vercel } = require('../lib/http');
const { handleEvent } = require('../lib/core');
module.exports = vercel(handleEvent, { methods: ['POST'] });
