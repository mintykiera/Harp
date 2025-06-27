const fs = require('node:fs');
const path = require('node:path');
const {
  Client,
  Collection,
  Events,
  GatewayIntentBits,
  EmbedBuilder,
  Partials,
  MessageFlags,
} = require('discord.js');
require('dotenv').config();
const config = require('./config.js');
const connectDB = require('./utils/dbConnect');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildVoiceStates,
  ],
  partials: [Partials.Channel],
});

// In-memory ticket system (can be refactored to DB later)
client.openTickets = new Collection();
let ticketCounter = 1;
const GUILD_ID = process.env.GUILD_ID;
const CATEGORY_ID = process.env.CATEGORY_ID;
const STAFF_ROLE_ID = process.env.STAFF_ROLE_ID;

// Command Loading
client.commands = new Collection();
const foldersPath = path.join(__dirname, 'commands');
const commandFolders = fs.readdirSync(foldersPath);

console.log('[COMMAND LOADER] Starting to load commands...');
for (const folder of commandFolders) {
  const commandsPath = path.join(foldersPath, folder);
  const commandFiles = fs
    .readdirSync(commandsPath)
    .filter((file) => file.endsWith('.js'));

  for (const file of commandFiles) {
    const filePath = path.join(commandsPath, file);
    try {
      const command = require(filePath);
      if ('data' in command && 'execute' in command) {
        command.category = folder;
        client.commands.set(command.data.name, command);
        console.log(`[COMMAND LOADER] Loaded command: /${command.data.name}`);
      } else {
        console.log(
          `[WARNING] Command at ${filePath} is missing "data" or "execute".`
        );
      }
    } catch (error) {
      console.error(`[ERROR] Failed to load command at ${filePath}:`, error);
    }
  }
}
console.log('[COMMAND LOADER] Finished loading commands.');

// Bot Ready
client.once(Events.ClientReady, (c) => {
  console.log(`✅ Ready! Logged in as ${c.user.tag}`);
});

// Interaction and Command Handler
client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const command = interaction.client.commands.get(interaction.commandName);
  if (!command) {
    console.error(`No command matching ${interaction.commandName} was found.`);
    return;
  }

  try {
    await command.execute(interaction);

    if (command.data.name === 'chess' && command.initGameCollector) {
      if (interaction.deferred || interaction.replied) {
        command.initGameCollector(interaction);
      }
    }
  } catch (error) {
    console.error(`[COMMAND ERROR] ${command.data.name}:`, error);
    try {
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: 'There was an error while executing this command!',
          flags: [MessageFlags.Ephemeral],
        });
      } else {
        // This may still error if already replied/followed up
        await interaction.followUp({
          content: 'There was an error while executing this command!',
          flags: [MessageFlags.Ephemeral],
        });
      }
    } catch (err) {
      console.warn(
        '[ERROR HANDLER] Could not send error message (already acknowledged). Suppressing.',
        err
      );
    }
  }
});

// DM and Ticket Relay Handler
client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;

  const guild = client.guilds.cache.get(GUILD_ID);
  if (!guild)
    return console.error('CRITICAL: Guild not found! Check your GUILD_ID.');

  if (message.inGuild() && client.openTickets.has(message.channel.id)) {
    const userId = client.openTickets.get(message.channel.id);
    try {
      const user = await client.users.fetch(userId);
      await user.send({
        content: `**${message.author.username}:** ${message.content}`,
        files: message.attachments.map((a) => a.url),
      });
    } catch (error) {
      message.channel.send(
        '⚠️ Could not deliver the message to the user. They may have DMs disabled.'
      );
    }
    return;
  }

  if (!message.inGuild()) {
    const userHasTicket = [...client.openTickets.values()].includes(
      message.author.id
    );
    if (userHasTicket) {
      const channelId = [...client.openTickets.entries()].find(
        ([, value]) => value === message.author.id
      )[0];
      const channel = guild.channels.cache.get(channelId);
      if (channel) {
        channel.send({
          content: `**${message.author.username}:** ${message.content}`,
          files: message.attachments.map((a) => a.url),
        });
      }
    } else {
      try {
        await message.author.send(
          "We've received your message! A staff member will be with you shortly."
        );

        const channel = await guild.channels.create({
          name: `ticket-${ticketCounter++}`,
          type: 0,
          parent: CATEGORY_ID,
          topic: `Ticket for ${message.author.tag} (${message.author.id})`,
        });

        client.openTickets.set(channel.id, message.author.id);

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
          reportEmbed.setImage(message.attachments.first().url);
        }

        await channel.send({
          content: `<@&${STAFF_ROLE_ID}>`,
          embeds: [reportEmbed],
        });
      } catch (error) {
        console.error('Error creating new ticket:', error);
        await message.author.send(
          'Sorry, something went wrong while creating your ticket.'
        );
      }
    }
  }
});

// Welcome Role Handler
client.on(Events.GuildMemberAdd, async (member) => {
  if (member.guild.id !== config.guildId) return;
  try {
    const role = member.guild.roles.cache.get(config.unverifiedRoleId);
    if (role) {
      await member.roles.add(role);
      console.log(`Assigned Unverified role to ${member.user.tag}.`);
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

async function startBot() {
  await connectDB();
  await client.login(process.env.DISCORD_TOKEN);
}

startBot();
