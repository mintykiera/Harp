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
  WebhookClient,
  PermissionsBitField,
} = require('discord.js');
require('dotenv').config();
const connectDB = require('./utils/dbConnect');
const express = require('express');
const Ticket = require('./models/Ticket');

process.on('unhandledRejection', (error) => {
  console.error('Unhandled promise rejection:', error);
});
process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
});

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

const GUILD_ID = process.env.GUILD_ID;
const MOD_ROLE_ID = process.env.MOD_ROLE_ID;
const ADMIN_ROLE_ID = process.env.ADMIN_ROLE_ID;

const port = process.env.PORT || 3000;

const TICKET_CATEGORIES = {
  Report: process.env.REPORT_CATEGORY_ID,
  Question: process.env.QUESTION_CATEGORY_ID,
  Other: process.env.OTHER_CATEGORY_ID,
};

client.once(Events.ClientReady, (c) => {
  console.log(`✅ Ready! Logged in as ${c.user.tag}`);
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (interaction.isChatInputCommand()) {
    if (interaction.commandName === 'reply') {
      try {
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
        const { channel, guild, user, options } = interaction;
        const replyMessage = options.getString('message');

        const ticket = await Ticket.findOne({ channelId: channel.id });
        if (!ticket) {
          return interaction.editReply({
            content: '⚠️ This command can only be used in a ticket channel.',
          });
        }
        if (ticket.status === 'closed') {
          return interaction.editReply({
            content: '⚠️ This ticket is closed. You cannot reply to it.',
          });
        }

        let webhooks = await channel.fetchWebhooks();
        let webhook = webhooks.find((w) => w.name === 'StaffReplyHook');
        if (!webhook) {
          webhook = await channel.createWebhook({
            name: 'StaffReplyHook',
            avatar: guild.iconURL(),
          });
        }

        await webhook.send({
          content: replyMessage,
          username: user.displayName,
          avatarURL: user.displayAvatarURL(),
        });

        try {
          const targetUser = await interaction.client.users.fetch(
            ticket.userId
          );
          await targetUser.send(
            `**[staff] ${user.username}:** ${replyMessage}`
          );
        } catch (e) {
          await interaction.followUp({
            content:
              '⚠️ Message sent in channel, but the user could not be DMed (their DMs are likely closed).',
            flags: [MessageFlags.Ephemeral],
          });
        }

        return interaction.editReply({
          content: '✅ Your message has been sent.',
        });
      } catch (error) {
        console.error('Error executing /reply command:', error);
      }
    }
    if (interaction.commandName === 'ticket') {
      if (interaction.options.getSubcommand() === 'lookup') {
        await interaction.deferReply();

        const query = interaction.options.getString('query');
        const guild = interaction.guild;
        let user;

        const mentionMatch = query.match(/^<@!?(\d+)>$/);
        if (mentionMatch) {
          const userId = mentionMatch[1];
          try {
            user = await client.users.fetch(userId);
          } catch {}
        }
        if (!user && /^\d{17,20}$/.test(query)) {
          try {
            user = await client.users.fetch(query);
          } catch {}
        }
        if (!user) {
          await guild.members.fetch();
          const member = guild.members.cache.find(
            (m) => m.user.tag.toLowerCase() === query.toLowerCase()
          );
          if (member) {
            user = member.user;
          }
        }

        if (!user) {
          return interaction.editReply({
            content:
              '❌ Could not find a user based on your query. Please use their @mention, user ID, or full User#Tag.',
            flags: [MessageFlags.Ephemeral],
          });
        }

        const tickets = await Ticket.find({ userId: user.id }).sort({
          created: -1,
        });

        if (tickets.length === 0) {
          return interaction.editReply({
            content: `✅ No archived tickets found for ${user.tag}.`,
            flags: [MessageFlags.Ephemeral],
          });
        }

        const options = tickets.slice(0, 25).map((ticket) => {
          const createdDate = ticket.created.toDateString();

          const descriptionSnippet = ticket.reportDetails.openingMessage
            ? ticket.reportDetails.openingMessage.slice(0, 75) + '...'
            : 'No opening message.';

          return {
            label: `[${ticket.status.toUpperCase()}] ${ticket.ticketType}`,
            description: `(${createdDate}) ${descriptionSnippet}`,
            value: ticket._id.toString(),
          };
        });

        const selectMenu = new StringSelectMenuBuilder()
          .setCustomId('ticket_lookup_select')
          .setPlaceholder('Select a ticket to view its details...')
          .addOptions(options);

        const row = new ActionRowBuilder().addComponents(selectMenu);

        await interaction.editReply({
          content: `Found ${tickets.length} ticket(s) for ${user.tag}. Please select one to view.`,
          components: [row],
        });
      }
    }
  }

  if (interaction.isButton()) {
    if (interaction.customId.startsWith('close_ticket_')) {
      await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
      const ticket = await Ticket.findOne({
        channelId: interaction.channelId,
        status: 'open',
      });
      if (!ticket) {
        return interaction.editReply({
          content: 'This ticket was not found or is already closed.',
        });
      }

      await interaction.editReply({ content: 'Locking ticket...' });

      try {
        const user = await client.users.fetch(ticket.userId);
        await user.send('Your ticket has been closed by a staff member.');
      } catch (err) {
        console.log("Couldn't DM user about ticket closure.", err);
      }

      const channel = interaction.channel;
      await channel.setName(`closed-${channel.name}`.slice(0, 100));
      await channel.permissionOverwrites.edit(MOD_ROLE_ID, {
        SendMessages: false,
      });
      await channel.permissionOverwrites.edit(ADMIN_ROLE_ID, {
        SendMessages: false,
      });
      ticket.status = 'closed';
      await ticket.save();

      const deleteButton = new ButtonBuilder()
        .setCustomId(`confirm_delete_${channel.id}`)
        .setLabel('Delete Channel')
        .setStyle(ButtonStyle.Danger)
        .setEmoji('⛔');
      const row = new ActionRowBuilder().addComponents(deleteButton);

      await channel.send({
        content: `Ticket closed by <@${interaction.user.id}>. The channel is now locked and ready for deletion.`,
        components: [row],
      });
      return;
    }

    if (interaction.customId.startsWith('confirm_delete_')) {
      await interaction.channel.delete('Ticket permanently deleted by staff.');
    }
    return;
  }

  if (interaction.isStringSelectMenu()) {
    const userId = interaction.user.id;
    const selection = interaction.values[0];

    if (selection === 'cancel') {
      try {
        dmConversations.delete(userId);
        return interaction.update({
          content: 'Ticket creation has been cancelled.',
          embeds: [],
          components: [],
        });
      } catch (error) {
        if (error.code !== 40060)
          console.error('Error cancelling ticket:', error);
      }
      return;
    }

    if (interaction.customId === 'initial_ticket_select') {
      const conversation = dmConversations.get(userId) || {};
      conversation.step = 'awaiting_subtype';
      conversation.type = selection;
      conversation.data = {};
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
      try {
        await interaction.update({
          embeds: [nextEmbed],
          components: nextRow ? [nextRow] : [],
        });
      } catch (error) {
        if (error.code !== 40060)
          console.error('Error updating initial ticket interaction:', error);
      }
    } else if (
      interaction.customId === 'report_location_select' ||
      interaction.customId === 'question_topic_select'
    ) {
      const conversation = dmConversations.get(userId);
      if (!conversation) {
        try {
          return interaction.update({
            content: 'Your session has expired. Please start over.',
            embeds: [],
            components: [],
          });
        } catch (error) {
          if (error.code !== 40060)
            console.error('Error handling expired ticket session:', error);
          return;
        }
      }
      if (interaction.customId === 'report_location_select')
        conversation.data.location = selection;
      else conversation.data.topic = selection;
      conversation.step = 'awaiting_description';
      dmConversations.set(userId, conversation);

      const embed = new EmbedBuilder()
        .setColor('#2ECC71')
        .setTitle('Final Step: Details')
        .setDescription(
          'Thank you. Now, please provide any **additional details** for your ticket.\n\nIf you have no more details, you can simply reply with `none`.'
        );

      try {
        await interaction.update({ embeds: [embed], components: [] });
      } catch (error) {
        if (error.code !== 40060)
          console.error('Error updating final ticket interaction:', error);
      }
    }
    if (interaction.customId === 'ticket_lookup_select') {
      const ticketId = interaction.values[0];
      await interaction.deferUpdate();
      const ticket = await Ticket.findById(ticketId);

      if (!ticket) {
        return interaction.followUp({
          content:
            '❌ This ticket could not be found. It may have been deleted.',
          flags: [MessageFlags.Ephemeral],
        });
      }

      let user;
      try {
        user = await client.users.fetch(ticket.userId);
      } catch {
        user = null;
      }

      const createdTimestamp = Math.floor(ticket.created.getTime() / 1000);

      const embed = new EmbedBuilder()
        .setColor(ticket.status === 'closed' ? '#95a5a6' : '#2ecc71')
        .setTitle(`Ticket Details: ${ticket.ticketType}`)
        .setAuthor(
          user
            ? { name: user.tag, iconURL: user.displayAvatarURL() }
            : { name: 'Unknown User' }
        )
        .addFields(
          {
            name: 'User',
            value: user ? `<@${ticket.userId}>` : `ID: ${ticket.userId}`,
            inline: true,
          },
          {
            name: 'Status',
            value: `\`${ticket.status.toUpperCase()}\``,
            inline: true,
          },
          { name: 'Created', value: `<t:${createdTimestamp}:F>`, inline: false }
        )
        .addFields({
          name: 'Opening Message',
          value: ticket.reportDetails.openingMessage || '_Not provided._',
        })
        .addFields(
          ...(ticket.reportDetails.description
            ? [
                {
                  name: 'Additional Details Provided',
                  value: `> ${ticket.reportDetails.description.replace(
                    /\n/g,
                    '\n> '
                  )}`,
                },
              ]
            : []),
          ...(ticket.reportDetails.description &&
          (ticket.reportDetails.location || ticket.reportDetails.topic)
            ? [{ name: '\u200B', value: '\u200B' }]
            : []),
          ...(ticket.reportDetails.location
            ? [
                {
                  name: 'Report Location',
                  value: ticket.reportDetails.location,
                  inline: true,
                },
              ]
            : []),
          ...(ticket.reportDetails.topic
            ? [
                {
                  name: 'Question Topic',
                  value: ticket.reportDetails.topic,
                  inline: true,
                },
              ]
            : [])
        )
        .setFooter({
          text: `Ticket ID: ${ticket._id} • User ID: ${ticket.userId}`,
        });
      await interaction.editReply({
        content: `Showing details for ticket \`${ticket._id}\`:`,
        embeds: [embed],
        components: [],
      });
    }
  }
});

client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;

  const guild = client.guilds.cache.get(GUILD_ID);
  if (!guild) {
    return console.error('CRITICAL: Guild not found! Check your GUILD_ID.');
  }

  const isTicketChannel = await Ticket.exists({
    channelId: message.channel.id,
  });
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
      }
      return;
    }

    const conversation = dmConversations.get(message.author.id);
    if (conversation) {
      if (conversation.step === 'awaiting_description') {
        dmConversations.delete(message.author.id);
        await createTicket(
          message.author,
          conversation.type,
          {
            ...conversation.data,
            openingMessage: conversation.openingMessage,
            additionalDetails: message.content,
          },
          message.attachments
        );
      }
      return;
    }

    dmConversations.set(message.author.id, {
      step: 'initiated',
      openingMessage: message.content,
    });

    try {
      const initialEmbed = new EmbedBuilder()
        .setColor('#0099ff')
        .setTitle('Contact Staff')
        .setDescription(
          'Hey there! We received your message. Kindly select one of the following below which satisfies your request to contact a staff member:'
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
      await message.author.send({ embeds: [initialEmbed], components: [row] });
    } catch (error) {
      dmConversations.delete(message.author.id);
      console.log(`Could not DM ${message.author.tag}.`);
    }
  }
});

async function createTicket(user, type, data, attachments) {
  if (!MOD_ROLE_ID || !ADMIN_ROLE_ID) {
    console.error(
      'CRITICAL: MOD_ROLE_ID or ADMIN_ROLE_ID is not defined in your .env file! Cannot create ticket.'
    );
    try {
      await user.send(
        '❌ Sorry, the bot is not configured correctly by the admin. Please contact them for assistance.'
      );
    } catch (e) {}
    return;
  }

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
          id: ADMIN_ROLE_ID,
          allow: [
            'ViewChannel',
            'SendMessages',
            'ReadMessageHistory',
            'AttachFiles',
            'EmbedLinks',
          ],
        },
        {
          id: MOD_ROLE_ID,
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
            'ManageWebhooks',
          ],
        },
      ],
    });

    const newTicket = new Ticket({
      userId: user.id,
      channelId: channel.id,
      guildId: guild.id,
      ticketType: type,
      status: 'open',
      reportDetails: {
        location: data.location,
        topic: data.topic,
        openingMessage: data.openingMessage,
        description: data.additionalDetails,
      },
    });
    await newTicket.save();

    const reportEmbed = new EmbedBuilder()
      .setColor(
        type === 'Report'
          ? '#E74C3C'
          : type === 'Question'
          ? '#3498DB'
          : '#95A5A6'
      )
      .setAuthor({ name: user.tag, iconURL: user.displayAvatarURL() })
      .setTitle(`New ${type} Ticket`)
      .addFields({ name: 'User', value: `<@${user.id}>`, inline: true })
      .addFields({
        name: 'Opening Message',
        value: data.openingMessage || '_Not provided._',
      });

    const additionalDetails =
      data.additionalDetails &&
      data.additionalDetails.toLowerCase().trim() !== 'none'
        ? data.additionalDetails
        : '_None provided._';

    reportEmbed.addFields(
      ...(additionalDetails
        ? [
            {
              name: 'Additional Details Provided',
              value: `> ${additionalDetails.replace(/\n/g, '\n> ')}`,
            },
          ]
        : []),

      ...(additionalDetails && (data.location || data.topic)
        ? [{ name: '\u200B', value: '\u200B' }]
        : []),

      ...(data.location
        ? [{ name: 'Report Location', value: data.location, inline: true }]
        : []),
      ...(data.topic
        ? [{ name: 'Question Topic', value: data.topic, inline: true }]
        : [])
    );

    reportEmbed
      .setTimestamp()
      .setFooter({ text: `Ticket ID: ${newTicket._id} • User ID: ${user.id}` });
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

function setupWebServer() {
  const app = express();
  const port = process.env.PORT || 3000;

  app.get('/health', (req, res) => {
    res.status(200).send('OK');
  });
  app.get('/', (req, res) => res.send('Harp is alive and listening!'));

  return app.listen(port, () => {
    console.log(`[WEB SERVER] Listening on port ${port}.`);
    console.log(`[PORT BINDING] Service bound to port ${port}`);
  });
}

async function startBot() {
  try {
    await connectDB();
    setupWebServer();
    await client.login(process.env.DISCORD_TOKEN);
  } catch (error) {
    console.error('Bot startup failed:', error);
    process.exit(1);
  }
}

startBot();
