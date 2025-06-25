const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  MessageFlags,
} = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('close')
    .setDescription('Closes the current ticket channel.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addStringOption((option) =>
      option
        .setName('reason')
        .setDescription('Optional reason for closing the ticket for logs.')
    ),

  async execute(interaction) {
    // --- STEP 1: Defer the reply IMMEDIATELY ---
    // This acknowledges the interaction and prevents the timeout error.
    // We will make the final messages public, so a public defer is fine.
    await interaction.deferReply();

    const { client, channel } = interaction;

    // --- STEP 2: Now, perform your checks ---
    if (!client.openTickets.has(channel.id)) {
      // Since we deferred, we MUST use editReply for the error message.
      // We also add the ephemeral flag here to make this error message private.
      return interaction.editReply({
        content: 'This command can only be used in a ticket channel.',
        flags: [MessageFlags.Ephemeral],
      });
    }

    // If we get here, it's a valid ticket channel.
    const userId = client.openTickets.get(channel.id);
    const reason =
      interaction.options.getString('reason') || 'Ticket closed by staff.';

    try {
      // Notify the user that the ticket is closing
      const user = await client.users.fetch(userId);
      if (user) {
        await user
          .send(
            `Your ticket in **${interaction.guild.name}** has been closed. Reason: ${reason}`
          )
          .catch(() => {
            console.log(`Could not DM user ${user.tag} about ticket closure.`);
          });
      }

      await interaction.editReply({
        content: 'This ticket will be deleted in 3 seconds...',
      });

      // Wait 10 seconds before deleting the channel
      setTimeout(() => {
        channel
          .delete(reason)
          .catch((err) =>
            console.error('Could not delete ticket channel:', err)
          );
      }, 3000);
    } catch (error) {
      console.error('Error during ticket closing:', error);
      await interaction.editReply({
        content: 'An error occurred while trying to close the ticket.',
      });
    } finally {
      client.openTickets.delete(channel.id);
      console.log(
        `[INFO] Ticket ${channel.id} closed and removed from memory.`
      );
    }
  },
};
