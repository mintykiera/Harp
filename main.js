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
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
} = require('discord.js');
require('dotenv').config();
const config = require('./config.js');
const connectDB = require('./utils/dbConnect');
const express = require('express');
const Ticket = require('./models/Ticket');

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

const dmConversations = new Collection();
client.verificationTickets = new Collection();

const GUILD_ID = process.env.GUILD_ID;
const STAFF_ROLE_ID = process.env.STAFF_ROLE_ID;

const TICKET_CATEGORIES = {
  Report: process.env.REPORT_CATEGORY_ID,
  Question: process.env.QUESTION_CATEGORY_ID,
  Other: process.env.OTHER_CATEGORY_ID,
};

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

client.once(Events.ClientReady, (c) => {
  console.log(`✅ Ready! Logged in as ${c.user.tag}`);
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (interaction.isChatInputCommand()) {
    const command = interaction.client.commands.get(interaction.commandName);
    if (!command) return;
    try {
      await command.execute(interaction);

      if (command.data.name === 'chess' && command.initGameCollector) {
        command.initGameCollector(interaction);
      }
    } catch (error) {
      console.error(`[COMMAND ERROR] ${command.data.name}:`, error);

      try {
        if (interaction.replied || interaction.deferred) {
          // Safe to edit or follow up
          await interaction.followUp({
            content: 'There was an error executing this command!',
            flags: [MessageFlags.Ephemeral],
          });
        } else {
          // First time sending a reply
          await interaction.reply({
            content: 'There was an error executing this command!',
            flags: [MessageFlags.Ephemeral],
          });
        }
      } catch (err) {
        console.error('❌ Failed to send error message to user:', err);
      }
    }
    return;
  }

  if (interaction.isButton()) {
    if (interaction.customId.startsWith('close_ticket_')) {
      await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
      const ticket = await Ticket.findOne({ channelId: interaction.channelId });
      if (!ticket)
        return interaction.editReply({
          content: 'This ticket was not found in the database.',
        });

      try {
        const user = await client.users.fetch(ticket.userId);
        await user.send(
          'Your ticket has been closed by a staff member. If you have another issue, feel free to message me again!'
        );
      } catch (err) {
        console.log("Couldn't DM user about ticket closure.", err);
        await interaction.editReply({
          content:
            'Ticket will be closed, but I could not notify the user (DMs are likely disabled).',
        });
      }

      await Ticket.deleteOne({ channelId: interaction.channelId });
      await interaction.channel.delete('Ticket closed by staff.');
    }
    return;
  }

  if (interaction.isStringSelectMenu()) {
    const userId = interaction.user.id;
    const selection = interaction.values[0];

    if (selection === 'cancel') {
      dmConversations.delete(userId);
      return interaction.update({
        content: 'Ticket creation has been cancelled.',
        embeds: [],
        components: [],
      });
    }

    if (interaction.customId === 'initial_ticket_select') {
      const conversation = {
        step: 'awaiting_subtype',
        type: selection,
        data: {},
      };
      dmConversations.set(userId, conversation);
      let nextEmbed, nextRow;
      if (selection === 'Report') {
        nextEmbed = new EmbedBuilder()
          .setColor('#E67E22')
          .setTitle('File a Report')
          .setDescription(
            'Please select the location where the incident occurred.'
          );
        const locationMenu = new StringSelectMenuBuilder()
          .setCustomId('report_location_select')
          .setPlaceholder('Select a location...')
          .addOptions(
            { label: 'Red Brick Road', value: 'Red Brick Road' },
            { label: 'Canvas Modules', value: 'Canvas Modules' },
            { label: 'Discussion Boards', value: 'Discussion Boards' },
            { label: 'Hangout Spots', value: 'Hangout Spots' },
            { label: 'Other', value: 'Other Location' },
            { label: 'Cancel', value: 'cancel', emoji: '❌' }
          );
        nextRow = new ActionRowBuilder().addComponents(locationMenu);
      } else if (selection === 'Question') {
        nextEmbed = new EmbedBuilder()
          .setColor('#3498DB')
          .setTitle('Ask a Question')
          .setDescription('Please select the topic of your question.');
        const questionMenu = new StringSelectMenuBuilder()
          .setCustomId('question_topic_select')
          .setPlaceholder('Select a topic...')
          .addOptions(
            { label: 'General', value: 'General' },
            { label: 'Registration', value: 'Registration' },
            { label: 'Scholarship', value: 'Scholarship' },
            { label: 'Curriculum Request', value: 'Curriculum Request' },
            { label: 'Server Suggestion', value: 'Server Suggestion' },
            { label: 'Other', value: 'Other Topic' },
            { label: 'Cancel', value: 'cancel', emoji: '❌' }
          );
        nextRow = new ActionRowBuilder().addComponents(questionMenu);
      } else {
        conversation.step = 'awaiting_description';
        nextEmbed = new EmbedBuilder()
          .setColor('#95A5A6')
          .setTitle('Other Inquiry')
          .setDescription(
            'Please describe your issue in detail in your next message.'
          );
        nextRow = null;
      }
      await interaction.update({
        embeds: [nextEmbed],
        components: nextRow ? [nextRow] : [],
      });
    } else if (
      interaction.customId === 'report_location_select' ||
      interaction.customId === 'question_topic_select'
    ) {
      const conversation = dmConversations.get(userId);
      if (!conversation)
        return interaction.update({
          content: 'Your session has expired. Please start over.',
          embeds: [],
          components: [],
        });
      if (interaction.customId === 'report_location_select')
        conversation.data.location = selection;
      else conversation.data.topic = selection;
      conversation.step = 'awaiting_description';
      dmConversations.set(userId, conversation);
      const embed = new EmbedBuilder()
        .setColor('#2ECC71')
        .setTitle('Final Step: Details')
        .setDescription(
          'Thank you. Now, please describe your issue in full detail in your next message.'
        );
      await interaction.update({ embeds: [embed], components: [] });
    }
  }
});

client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;

  const guild = client.guilds.cache.get(GUILD_ID);
  if (!guild)
    return console.error('CRITICAL: Guild not found! Check your GUILD_ID.');

  const isTicketChannel = Object.values(TICKET_CATEGORIES)
    .filter(Boolean)
    .includes(message.channel.parentId);
  if (message.inGuild() && isTicketChannel) {
    return;
  }

  if (!message.inGuild()) {
    try {
      await guild.members.fetch(message.author.id);
    } catch (e) {
      return console.log(
        `Ignoring DM from user ${message.author.tag} (not in server).`
      );
    }

    const existingTicket = await Ticket.findOne({
      userId: message.author.id,
      status: 'open',
    });
    if (existingTicket) {
      const ticketChannel = guild.channels.cache.get(existingTicket.channelId);
      if (ticketChannel) {
        ticketChannel.send({
          content: `**${message.author.username}:** ${message.content}`,
          files: message.attachments.map((a) => a.url),
        });
        return;
      }
    }

    const conversation = dmConversations.get(message.author.id);
    if (conversation && conversation.step === 'awaiting_description') {
      conversation.data.description = message.content;
      await createTicket(
        message.author,
        conversation.type,
        conversation.data,
        message.attachments
      );
      dmConversations.delete(message.author.id);
      return;
    }
    if (conversation) return; // Ignore messages if user is supposed to be using a dropdown

    // Start a new ticket process for a new DM
    const initialEmbed = new EmbedBuilder()
      .setColor('#0099ff')
      .setTitle('Contact Staff')
      .setDescription(
        'Hi! Kindly select one of the following below which satisfies your request to contact a staff member:'
      );
    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId('initial_ticket_select')
      .setPlaceholder('Choose an option...')
      .addOptions(
        { label: 'Report a User or Incident', value: 'Report', emoji: '📢' },
        { label: 'Ask a Question', value: 'Question', emoji: '❓' },
        { label: 'Other Inquiry', value: 'Other', emoji: '📄' },
        { label: 'Cancel', value: 'cancel', emoji: '❌' }
      );
    const row = new ActionRowBuilder().addComponents(selectMenu);
    await message.author
      .send({ embeds: [initialEmbed], components: [row] })
      .catch(() => console.log(`Could not DM ${message.author.tag}.`));
  }
});

// --- Helper function to create the ticket (CORRECTED LOGIC) ---
async function createTicket(user, type, data, attachments) {
  const guild = client.guilds.cache.get(GUILD_ID);
  if (!guild) return;

  const parentCategoryId =
    TICKET_CATEGORIES[type] || TICKET_CATEGORIES['Other'];
  if (!parentCategoryId) {
    console.error(
      `CRITICAL: No category ID for ticket type "${type}". Check .env.`
    );
    return user.send(
      '❌ Bot is not configured correctly. Please contact an admin.'
    );
  }

  try {
    const channelName = `ticket-${type.toLowerCase()}-${user.username}`
      .replace(/[^a-z0-9-]/gi, '')
      .slice(0, 100);
    const channel = await guild.channels.create({
      name: channelName,
      type: ChannelType.GuildText,
      parent: parentCategoryId,
      topic: `Ticket for ${user.tag} (${user.id}). Type: ${type}`,
      permissionOverwrites: [
        { id: guild.id, deny: ['ViewChannel'] },
        {
          id: STAFF_ROLE_ID,
          allow: [
            'ViewChannel',
            'SendMessages',
            'ReadMessageHistory',
            'AttachFiles',
            'EmbedLinks',
          ],
        },
        {
          id: client.user.id,
          allow: [
            'ViewChannel',
            'SendMessages',
            'ReadMessageHistory',
            'AttachFiles',
            'EmbedLinks',
          ],
        },
      ],
    });

    const newTicket = new Ticket({
      userId: user.id,
      channelId: channel.id,
      guildId: guild.id,
      ticketType: type,
      reportDetails: {
        location: data.location,
        topic: data.topic,
        description: data.description,
      },
    });
    await newTicket.save();

    const reportEmbed = new EmbedBuilder()
      .setColor(
        type === 'Report'
          ? '#C70039'
          : type === 'Question'
          ? '#3498DB'
          : '#95A5A6'
      )
      .setTitle(`New Ticket: ${type}`)
      .setAuthor({ name: user.tag, iconURL: user.displayAvatarURL() })
      .addFields(
        { name: 'User', value: `<@${user.id}>`, inline: true },
        { name: 'User ID', value: `\`${user.id}\``, inline: true }
      )
      .setTimestamp()
      .setFooter({ text: `Channel ID: ${channel.id}` });

    if (data.location)
      reportEmbed.addFields({
        name: 'Report Location',
        value: data.location,
        inline: false,
      });
    if (data.topic)
      reportEmbed.addFields({
        name: 'Question Topic',
        value: data.topic,
        inline: false,
      });
    reportEmbed.addFields({ name: 'Description', value: data.description });

    if (attachments.size > 0) {
      reportEmbed.addFields({
        name: 'Attachments',
        value: attachments.map((a) => `[${a.name}](${a.url})`).join('\n'),
      });
      const firstImage = attachments.find((a) =>
        a.contentType?.startsWith('image')
      );
      if (firstImage) reportEmbed.setImage(firstImage.url);
    }

    const closeButton = new ButtonBuilder()
      .setCustomId(`close_ticket_${channel.id}`)
      .setLabel('Close Ticket')
      .setStyle(ButtonStyle.Danger)
      .setEmoji('🔒');
    const row = new ActionRowBuilder().addComponents(closeButton);

    await channel.send({
      content: `A new ticket has been created.`,
      embeds: [reportEmbed],
      components: [row],
    });

    await user.send(
      `✅ Your ticket has been created successfully! Staff has been notified. **You can continue sending messages here to communicate with them.**`
    );
  } catch (error) {
    console.error('Error creating ticket:', error);
    await user.send(
      '❌ Something went wrong creating your ticket. Please try again later.'
    );
  }
}

// --- Welcome Role Handler (No Changes) ---
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

// --- Web Server & Start Bot (No Changes) ---
function setupWebServer() {
  const app = express();
  const port = process.env.PORT || 3000;
  app.get('/', (req, res) => res.send('Harp is alive and listening!'));
  app.listen(port, () =>
    console.log(`[WEB SERVER] Listening on port ${port}.`)
  );
}
async function startBot() {
  await connectDB();
  await client.login(process.env.DISCORD_TOKEN);
}
setupWebServer();
startBot();
