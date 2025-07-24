const { REST, Routes } = require('discord.js');
require('dotenv').config();

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.CLIENT_ID;
const guildId = process.env.GUILD_ID;

const rest = new REST().setToken(token);
async function clearAllCommands() {
  console.log('--- Starting Command Clearing ---');

  if (!guildId) {
    console.log(
      '[SKIPPING] GUILD_ID not set in .env, skipping guild command clearing.'
    );
  } else {
    try {
      console.log(
        `Started clearing application (/) commands for guild ${guildId}.`
      );
      await rest.put(Routes.applicationGuildCommands(clientId, guildId), {
        body: [],
      });
      console.log(
        `[SUCCESS] Successfully cleared application (/) commands for guild ${guildId}.`
      );
    } catch (error) {
      console.error('[ERROR] Error clearing guild commands:', error);
    }
  }

  try {
    console.log('Started clearing GLOBAL application (/) commands.');
    await rest.put(Routes.applicationCommands(clientId), { body: [] });
    console.log(
      '[SUCCESS] Successfully cleared GLOBAL application (/) commands.'
    );
  } catch (error) {
    console.error('[ERROR] Error clearing global commands:', error);
  }

  console.log('--- Command Clearing Finished ---');
}

clearAllCommands();
