// clear-commands.js
const { REST, Routes } = require('discord.js');
require('dotenv').config(); // Make sure this is at the top if you use .env

// ---- DEFINE THESE ONCE ----
const token = process.env.DISCORD_TOKEN;
const clientId = process.env.CLIENT_ID; // Your bot's client ID
const guildId = process.env.GUILD_ID; // Your test server's ID (only needed for guild commands)

// ---- INITIALIZE REST ONCE ----
const rest = new REST().setToken(token);

// Option 1: Clear GUILD commands
// Ensure this block is uncommented if you want to clear guild commands.
// Ensure it's commented out if you want to clear global commands.
(async () => {
  if (!guildId) {
    // Add a check for guildId
    console.log(
      'GUILD_ID is not set in your environment. Skipping guild command clearing.'
    );
    return;
  }
  try {
    console.log(
      `Started clearing application (/) commands for guild ${guildId}.`
    );
    await rest.put(
      Routes.applicationGuildCommands(clientId, guildId),
      { body: [] } // Empty array
    );
    console.log(
      `Successfully cleared application (/) commands for guild ${guildId}.`
    );
  } catch (error) {
    console.error('Error clearing guild commands:', error);
  }
})();

// Option 2: Clear GLOBAL commands (use with caution, affects all guilds)
// Ensure this block is uncommented if you want to clear global commands.
// Ensure it's commented out if you want to clear guild commands.
/*
(async () => {
  try {
    console.log('Started clearing GLOBAL application (/) commands.');
    await rest.put(
      Routes.applicationCommands(clientId),
      { body: [] }, // Empty array
    );
    console.log('Successfully cleared GLOBAL application (/) commands.');
  } catch (error) {
    console.error('Error clearing global commands:', error);
  }
})();
*/
