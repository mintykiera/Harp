const {
  SlashCommandBuilder,
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
} = require('discord.js');
const config = require('../../config.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('verify')
    .setDescription(
      'Start the verification process by creating a private ticket with staff.'
    )
    .setDMPermission(false),

  async execute(interaction) {
    // --- STEP 1: DEFER IMMEDIATELY ---
    // This is now the very first thing we do.
    await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

    const { user, guild, client, channel } = interaction;

    // It's better to fetch the member object to ensure we have the most up-to-date roles,
    // especially for a user who just joined. The cache might be stale.
    const member = await guild.members.fetch(user.id);

    // --- CHECK #1: Is this the correct channel? ---
    if (channel.id !== config.verifyChannelId) {
      // Since we deferred, we must use editReply
      return interaction.editReply({
        content: `This command can only be used in the <#${config.verifyChannelId}> channel.`,
      });
    }

    // --- CHECK #2: Does the user have the "Unverified" role? ---
    if (!member.roles.cache.has(config.unverifiedRoleId)) {
      return interaction.editReply({
        content: 'You do not need to use this command.',
      });
    }

    // Check if the user already has an open ticket
    if ([...client.openTickets.values()].includes(user.id)) {
      const existingChannelId = [...client.openTickets.entries()].find(
        ([, userId]) => userId === user.id
      )[0];
      return interaction.editReply({
        content: `You already have an open verification ticket! Please continue here: <#${existingChannelId}>`,
      });
    }

    try {
      // Create the private ticket channel
      const ticketChannel = await guild.channels.create({
        name: `verify-${user.username}`,
        type: ChannelType.GuildText,
        parent: config.ticketCategoryId,
        topic: `Verification ticket for ${user.tag} (${user.id})`,
        permissionOverwrites: [
          { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
          {
            id: user.id,
            allow: [
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.SendMessages,
              PermissionFlagsBits.ReadMessageHistory,
            ],
          },
          {
            id: config.staffRoleId,
            allow: [
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.SendMessages,
              PermissionFlagsBits.ReadMessageHistory,
            ],
          },
        ],
      });

      client.openTickets.set(ticketChannel.id, user.id);

      const welcomeEmbed = new EmbedBuilder()
        .setColor('#5865F2')
        .setTitle(`Verification Ticket for ${user.username}`)
        .setDescription(
          'Welcome! A staff member will be with you shortly to guide you through the verification process.'
        )
        .setTimestamp();

      await ticketChannel.send({
        content: `<@&${config.staffRoleId}>, a new user is ready for verification.`,
        embeds: [welcomeEmbed],
      });

      // All good, edit the final reply
      await interaction.editReply({
        content: `Your private verification ticket has been created! Please click here to continue: ${ticketChannel}`,
      });
    } catch (error) {
      console.error('Error creating verification ticket:', error);
      // Edit the reply with an error message
      await interaction.editReply({
        content: 'Sorry, something went wrong while creating your ticket.',
      });
    }
  },
};
