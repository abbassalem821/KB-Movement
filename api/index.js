// Vercel serverless entry point: every /api/* request is handled by the Express app in server.js.
// The website itself (public/) is served by Vercel's CDN.
module.exports = require('../server');
