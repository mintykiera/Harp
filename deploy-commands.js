// deploy-commands.js
const { REST, Routes } = require('discord.js');
const fs = require('node:fs');
const path = require('node:path');
const config = require('./config.js');

const clientId = config.clientId;
const guildId = config.guildId;
const token = config.token;

if (!clientId || !token) {
  console.error(
    'Error: CLIENT_ID or DISCORD_TOKEN is missing from your .env file.'
  );
  process.exit(1);
}

// Check if the '--global' flag was passed
const isGlobalDeploy = process.argv.includes('--global');

if (!isGlobalDeploy && !guildId) {
  console.error(
    'Error: GUILD_ID is missing from your .env file. For global deploy, run with the --global flag.'
  );
  process.exit(1);
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
    let route;
    let logMessage;

    if (isGlobalDeploy) {
      route = Routes.applicationCommands(clientId);
      logMessage = `Started refreshing ${commands.length} GLOBAL application (/) commands.`;
    } else {
      route = Routes.applicationGuildCommands(clientId, guildId);
      logMessage = `Started refreshing ${commands.length} application (/) commands for GUILD ${guildId}.`;
    }

    console.log(logMessage);

    const data = await rest.put(route, { body: commands });

    console.log(`Successfully reloaded ${data.length} commands.`);
  } catch (error) {
    console.error(error);
  }
})();
