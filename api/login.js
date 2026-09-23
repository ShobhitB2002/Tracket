const { vercel } = require('../lib/http');
const { handleLogin } = require('../lib/login');
module.exports = vercel(handleLogin, { methods: ['POST'], open: true });
