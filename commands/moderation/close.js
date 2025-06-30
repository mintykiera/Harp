const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  PermissionOverwriteType,
} = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('close')
    .setDescription('Closes the current ticket channel.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addStringOption((option) =>
      option
        .setName('reason')
        .setDescription('Optional reason for closing the ticket for logs.')
    ),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });
    const { channel, guild } = interaction;

    // Validate ticket channel
    if (
      channel.type !== ChannelType.GuildText ||
      !channel.name.startsWith('ticket-')
    ) {
      return interaction.editReply({
        content: '❌ This command can only be used in ticket channels.',
        ephemeral: true,
      });
    }

    const reason =
      interaction.options.getString('reason') || 'No reason provided';

    try {
      // Find ticket owner from permission overwrites
      const ticketOwner = channel.permissionOverwrites.cache.find(
        (ow) =>
          ow.type === PermissionOverwriteType.Member &&
          !guild.members.cache.get(ow.id)?.user.bot
      );

      // Notify user if found
      if (ticketOwner) {
        const user = await guild.client.users.fetch(ticketOwner.id);
        await user
          .send({
            content: `📬 Your ticket in **${guild.name}** has been closed.\nReason: ${reason}`,
          })
          .catch(() => console.log(`[TICKET] Couldn't DM ${user.tag}`));
      }

      // Final response and deletion
      await interaction.editReply({
        content: '🗑️ Ticket will be deleted in 3 seconds...',
      });
      setTimeout(
        () => channel.delete(`Closed by ${interaction.user.tag}: ${reason}`),
        3000
      );
    } catch (error) {
      console.error('[TICKET CLOSE ERROR]', error);
      await interaction.editReply({
        content: '❌ Failed to close ticket. Please check console.',
        ephemeral: true,
      });
    }
  },
};
