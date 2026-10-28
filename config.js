// CodeArena settings. Change values here or set them as environment variables.
module.exports = {
  PORT: process.env.PORT || 3000,
  MONGO_URL: process.env.MONGO_URL || 'mongodb://127.0.0.1:27017/codearena',
  JWT_SECRET: process.env.JWT_SECRET || 'codearena-dev-secret-change-me',
  PISTON_URL: process.env.PISTON_URL || 'http://127.0.0.1:2000',

  MAX_PARALLEL: Number(process.env.MAX_PARALLEL || 3), // submissions judged at the same time
  SUBMIT_COOLDOWN_MS: 10000,                            // students wait 10s between submissions
  MAX_CODE_BYTES: 64 * 1024,                            // 64 KB max code size
  MAX_TIME_LIMIT: 5,                                    // seconds
  EMAIL_DOMAIN: '@rvce.edu.in'
};