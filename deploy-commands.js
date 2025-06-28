const { REST, Routes } = require('discord.js');
const fs = require('node:fs');
const path = require('node:path');
require('dotenv').config();

// Make sure these are defined in your .env file
const clientId = process.env.CLIENT_ID;
const guildId = process.env.GUILD_ID;
const token = process.env.DISCORD_TOKEN;

if (!clientId || !guildId || !token) {
  console.error(
    'Error: CLIENT_ID, GUILD_ID, or DISCORD_TOKEN is missing from your .env file.'
  );
  process.exit(1); // Exit if essential variables are missing
}

const commands = [];
const foldersPath = path.join(__dirname, 'commands');
const commandFolders = fs.readdirSync(foldersPath);

for (const folder of commandFolders) {
  const commandsPath = path.join(foldersPath, folder);
  const commandFiles = fs
    .readdirSync(commandsPath)
    .filter((file) => file.endsWith('.js'));
  for (const file of commandFiles) {
    const filePath = path.join(commandsPath, file);
    const command = require(filePath);
    if ('data' in command && 'execute' in command) {
      commands.push(command.data.toJSON());
    } else {
      console.log(
        `[WARNING] The command at ${filePath} is missing a required "data" or "execute" property.`
      );
    }
  }
}

const rest = new REST().setToken(token);

(async () => {
  try {
    console.log(
      `Started refreshing ${commands.length} application (/) commands for your test server.`
    );

    // THE FIX IS HERE: We use applicationGuildCommands instead
    const data = await rest.put(
      Routes.applicationGuildCommands(clientId, guildId), // This targets your specific server
      { body: commands }
    );

    console.log(
      `Successfully reloaded ${data.length} GUILD application (/) commands.`
    );
  } catch (error) {
    console.error(error);
  }
})();
