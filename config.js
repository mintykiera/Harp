require('dotenv').config();

module.exports = {
  token: process.env.DISCORD_TOKEN,
  clientId: process.env.CLIENT_ID,
  guildId: process.env.GUILD_ID,
  staffRoleId: process.env.STAFF_ROLE_ID,
  verifiedRoleId: process.env.VERIFIED_ROLE_ID,
  unverifiedRoleId: process.env.UNVERIFIED_ROLE_ID,

  // ticket categories
  reportCategoryId: process.env.REPORT_CATEGORY_ID,
  questionCategoryId: process.env.QUESTION_CATEGORY_ID,
  otherCategoryId: process.env.OTHER_CATEGORY_ID,

  // verification
  verifyChannelId: process.env.VERIFY_CHANNEL_ID,

  // school roles
  schoolRoles: {
    gbseald: process.env.GBSEALD,
    soh: process.env.SOH,
    jgsom: process.env.JGSOM,
    sose: process.env.SOSE,
    rglsoss: process.env.RGLSOSS,
  },

  // external services
  mongoUri: process.env.MONGO_URI,
  googleApiKey: process.env.GOOGLE_API_KEY,
  searchEngineId: process.env.SEARCH_ENGINE_ID,
  geminiApiKeys: process.env.GEMINI_API_KEYS,
  stockfishExe: process.STOCKFISH_EXE,

  // port
  port: process.env.PORT,
};
