const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  MessageFlags,
} = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('untimeout')
    .setDescription('Removes the timeout from a user.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers) // Same permission as timeout
    .addUserOption((option) =>
      option
        .setName('target')
        .setDescription('The user to remove the timeout from')
        .setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName('reason')
        .setDescription('Reason for removing the timeout (for logs)')
    ),

  async execute(interaction) {
    await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
    const target = interaction.options.getUser('target');
    const member = await interaction.guild.members.fetch(target.id);
    const reason =
      interaction.options.getString('reason') || 'No reason provided.';

    if (!member) {
      return interaction.reply({
        content: "I can't find that member in the server.",
        flags: [MessageFlags.Ephemeral],
      });
    }

    // Check if the user is actually timed out
    if (!member.isCommunicationDisabled()) {
      return interaction.reply({
        content: 'This user is not currently timed out.',
        flags: [MessageFlags.Ephemeral],
      });
    }

    try {
      // To remove a timeout, pass `null` as the duration.
      await member.timeout(null, reason);

      await interaction.reply({
        content: `Successfully removed the timeout from ${target.tag}. Reason: ${reason}`,
        flags: [MessageFlags.Ephemeral],
      });

      // (Optional but recommended) DM the user
      await target
        .send(
          `Your timeout in **${interaction.guild.name}** has been removed by a moderator.`
        )
        .catch(() => {
          console.log(`Could not DM user ${target.tag} about timeout removal.`);
        });
    } catch (error) {
      console.error(error);
      await interaction.editReply({
        content: 'An unexpected error occurred while processing the timeout.',
      });
    }
  },
};
