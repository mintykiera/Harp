const fs = require('node:fs');
const path = require('node:path');
const {
  Client,
  Collection,
  Events,
  GatewayIntentBits,
  EmbedBuilder,
  Partials,
} = require('discord.js');
require('dotenv').config();
const config = require('./config.js');
const express = require('express'); // <-- ADDED for keep-alive

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildVoiceStates, // <-- ADDED: Crucial for music bots
  ],
  partials: [Partials.Channel],
});

// --- Ticket System Setup ---
client.openTickets = new Collection();
let ticketCounter = 1;
// Remember to update these IDs if they change
const GUILD_ID = process.env.GUILD_ID;
const CATEGORY_ID = process.env.CATEGORY_ID;
const STAFF_ROLE_ID = process.env.STAFF_ROLE_ID;

// --- COMMAND LOADING ---
client.commands = new Collection();
const foldersPath = path.join(__dirname, 'commands');
const commandFolders = fs.readdirSync(foldersPath);

console.log('[COMMAND LOADER] Starting to load commands...'); // Optional: good for debugging
for (const folder of commandFolders) {
  // folder will be 'games', 'moderation', 'utility'
  const commandsPath = path.join(foldersPath, folder);
  const commandFiles = fs
    .readdirSync(commandsPath)
    .filter((file) => file.endsWith('.js'));

  if (commandFiles.length === 0) {
    // Optional: good for debugging
    console.log(`[COMMAND LOADER] No command files found in ${folder}.`);
    continue;
  }

  for (const file of commandFiles) {
    // file will be e.g., 'chess.js', 'ban.js'
    const filePath = path.join(commandsPath, file);
    try {
      // Optional: Added try-catch for more robust loading
      const command = require(filePath);
      // Modified to check for both 'data' and 'execute'
      if ('data' in command && 'execute' in command) {
        command.category = folder;
        client.commands.set(command.data.name, command);
        console.log(
          `[COMMAND LOADER] Loaded command: /${command.data.name} (Category: ${command.category})`
        ); // Optional: good for debugging
      } else {
        console.log(
          `[WARNING] The command at ${filePath} is missing a required "data" or "execute" property.`
        );
      }
    } catch (error) {
      // Optional: Added try-catch
      console.error(`[ERROR] Failed to load command at ${filePath}:`, error);
    }
  }
}
console.log('[COMMAND LOADER] Finished loading commands.');

// --- BOT READY ---
client.once(Events.ClientReady, (c) => {
  console.log(`✅ Ready! Logged in as ${c.user.tag}`);
});

// --- INTERACTION AND COMMAND HANDLER ---
client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const command = interaction.client.commands.get(interaction.commandName);
  if (!command) {
    console.error(`No command matching ${interaction.commandName} was found.`);
    return;
  }

  try {
    await command.execute(interaction);
  } catch (error) {
    console.error(error);
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({
        content: 'There was an error while executing this command!',
        ephemeral: true,
      });
    } else {
      await interaction.reply({
        content: 'There was an error while executing this command!',
        ephemeral: true,
      });
    }
  }
});

// --- DM AND TICKET RELAY HANDLER ---
// Your existing ticket system code... (no changes needed here)
client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;

  const guild = client.guilds.cache.get(GUILD_ID);
  if (!guild)
    return console.error(
      'CRITICAL: Guild not found! Check your GUILD_ID in main.js'
    );

  // Part A: Handling Staff Replies in Ticket Channels
  if (message.inGuild() && client.openTickets.has(message.channel.id)) {
    const userId = client.openTickets.get(message.channel.id);
    try {
      const user = await client.users.fetch(userId);
      let content = `**${message.author.username}:** ${message.content}`;
      let files = message.attachments.map((a) => a.url);
      await user.send({ content, files });
    } catch (error) {
      message.channel.send(
        '⚠️ Could not deliver the message to the user. They may have DMs disabled.'
      );
    }
    return;
  }

  // Part B: Handling Direct Messages from Users
  if (!message.inGuild()) {
    const userHasTicket = [...client.openTickets.values()].includes(
      message.author.id
    );

    if (userHasTicket) {
      // B1: Relay message to existing ticket
      const channelId = [...client.openTickets.entries()].find(
        ([, value]) => value === message.author.id
      )[0];
      const channel = guild.channels.cache.get(channelId);
      if (channel) {
        let content = `**${message.author.username}:** ${message.content}`;
        let files = message.attachments.map((a) => a.url);
        channel.send({ content, files });
      }
    } else {
      // B2: Create a new ticket
      try {
        await message.author.send(
          "We've received your message! Kindly wait for one of our staff to get to you :)"
        );

        const channel = await guild.channels.create({
          name: `ticket-${ticketCounter}`,
          type: 0,
          parent: CATEGORY_ID,
          topic: `Ticket for ${message.author.tag} (${message.author.id})`,
        });

        client.openTickets.set(channel.id, message.author.id);
        ticketCounter++;

        const reportEmbed = new EmbedBuilder()
          .setColor('#0099ff')
          .setTitle(`New Ticket from ${message.author.username}`)
          .setAuthor({
            name: message.author.tag,
            iconURL: message.author.displayAvatarURL(),
          })
          .setDescription(message.content || '*No message content*')
          .setTimestamp()
          .setFooter({ text: `User ID: ${message.author.id}` });

        if (message.attachments.size > 0) {
          const attachment = message.attachments.first();
          if (attachment.contentType?.startsWith('image/')) {
            reportEmbed.setImage(attachment.url);
          }
        }

        await channel.send({
          content: `<@&${STAFF_ROLE_ID}>`,
          embeds: [reportEmbed],
        });
      } catch (error) {
        console.error('Error creating new ticket:', error);
        await message.author.send(
          'Sorry, something went wrong while creating your ticket. Please contact a staff member directly.'
        );
      }
    }
  }
});

// --- WELCOME ROLE HANDLER ---
// Your existing member add code... (no changes needed here)
client.on(Events.GuildMemberAdd, async (member) => {
  if (member.guild.id !== config.guildId) return;
  console.log(
    `New member joined: ${member.user.tag}. Assigning Unverified role.`
  );
  try {
    const role = member.guild.roles.cache.get(config.unverifiedRoleId);
    if (role) {
      await member.roles.add(role);
      console.log(
        `Successfully assigned Unverified role to ${member.user.tag}.`
      );
    } else {
      console.error(
        `[ERROR] Unverified role with ID ${config.unverifiedRoleId} not found!`
      );
    }
  } catch (error) {
    console.error(
      `[ERROR] Could not assign Unverified role to ${member.user.tag}:`,
      error
    );
  }
});

// --- REPLIT KEEP-ALIVE ---
// This part is for hosting on Replit. It creates a small web server.
const server = express();
server.all('/', (req, res) => {
  res.send('Bot is running!');
});
function keepAlive() {
  server.listen(3000, () => {
    console.log('Server is ready.');
  });
}
keepAlive(); // <-- ADDED: Starts the server

// --- BOT LOGIN ---
client.login(process.env.DISCORD_TOKEN);
