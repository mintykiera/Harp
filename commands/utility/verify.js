const {
  SlashCommandBuilder,
  ChannelType,
  EmbedBuilder,
  PermissionFlagsBits,
  MessageFlags,
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
    const { user, guild, client, channel } = interaction;
    const member = await guild.members.fetch(user.id);

    if (channel.id !== config.verifyChannelId) {
      return interaction.editReply({
        content: `This command can only be used in the <#${config.verifyChannelId}> channel.`,
        flags: [MessageFlags.Ephemeral],
      });
    }

    if (!member.roles.cache.has(config.unverifiedRoleId)) {
      return interaction.editReply({
        content: 'You do not need to use this command.',
        flags: [MessageFlags.Ephemeral],
      });
    }

    if ([...client.openTickets.values()].includes(user.id)) {
      const existingChannelId = [...client.openTickets.entries()].find(
        ([, userId]) => userId === user.id
      )[0];
      return interaction.editReply({
        content: `You already have an open verification ticket! Please continue here: <#${existingChannelId}>`,
        flags: [MessageFlags.Ephemeral],
      });
    }

    try {
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
        content: `A new user is ready for verification.`,
        embeds: [welcomeEmbed],
      });

      await interaction.editReply({
        content: `Your private verification ticket has been created! Please click here to continue: ${ticketChannel}`,
        flags: [MessageFlags.Ephemeral],
      });
    } catch (error) {
      console.error('Error creating verification ticket:', error);
      await interaction.editReply({
        content: 'Sorry, something went wrong while creating your ticket.',
        flags: [MessageFlags.Ephemeral],
      });
    }
  },
};
