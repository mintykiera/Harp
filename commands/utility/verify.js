const {
  SlashCommandBuilder,
  ChannelType,
  EmbedBuilder,
  PermissionFlagsBits,
  MessageFlags,
} = require('discord.js');
const config = require('../../config.js');

module.exports = {
  // This command is for public use, so no staffOnly flag.
  data: new SlashCommandBuilder()
    .setName('verify')
    .setDescription(
      'Starts the verification process by creating a private ticket.'
    )
    .setDMPermission(false), // Command cannot be used in DMs

  async execute(interaction) {
    const { user, guild, client, channel } = interaction;
    await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

    // Check 1: Is this the right channel?
    if (channel.id !== config.verifyChannelId) {
      return interaction.editReply({
        content: `This command can only be used in the <#${config.verifyChannelId}> channel.`,
      });
    }

    const member = await guild.members.fetch(user.id);
    // Check 2: Does the user have the Unverified role?
    if (!member.roles.cache.has(config.unverifiedRoleId)) {
      return interaction.editReply({
        content:
          'You are already verified and do not need to use this command.',
      });
    }

    // Check 3: Does the user already have an open verification ticket?
    if ([...client.verificationTickets.values()].includes(user.id)) {
      const existingChannelId = [...client.verificationTickets.entries()].find(
        ([, userId]) => userId === user.id
      )[0];
      return interaction.editReply({
        content: `You already have an open verification ticket! Please continue here: <#${existingChannelId}>`,
      });
    }

    // All checks passed, create the ticket.
    try {
      const ticketChannel = await guild.channels.create({
        name: `verify-${user.username}`,
        type: ChannelType.GuildText,
        parent: config.verificationTicketCategoryId,
        topic: `Verification ticket for ${user.tag} (${user.id})`,
        permissionOverwrites: [
          { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] }, // @everyone
          {
            // The user who ran the command
            id: user.id,
            allow: [
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.SendMessages,
              PermissionFlagsBits.ReadMessageHistory,
            ],
          },
          {
            // Staff role
            id: config.staffRoleId,
            allow: [
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.SendMessages,
              PermissionFlagsBits.ReadMessageHistory,
            ],
          },
        ],
      });

      // Add the ticket to our tracker
      client.verificationTickets.set(ticketChannel.id, user.id);

      const welcomeEmbed = new EmbedBuilder()
        .setColor('#5865F2')
        .setTitle(`Verification Ticket for ${user.username}`)
        .setDescription(
          'Welcome! A staff member will be with you shortly to guide you through the verification process. Please prepare your necessary identification.'
        )
        .setTimestamp();

      await ticketChannel.send({
        content: `<@&${config.staffRoleId}>, a new user is ready for verification. User: <@${user.id}>`,
        embeds: [welcomeEmbed],
      });

      await interaction.editReply({
        content: `Your private verification ticket has been created! Please click here to continue: ${ticketChannel}`,
      });
    } catch (error) {
      console.error('Error creating verification ticket:', error);
      await interaction.editReply({
        content:
          'Sorry, something went wrong while creating your ticket. Please check bot permissions.',
      });
    }
  },
};
