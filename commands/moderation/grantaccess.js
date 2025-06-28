const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const config = require('../../config.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('grantaccess')
    .setDescription(
      'Grants a user the Verified role and removes the Unverified role.'
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption((option) =>
      option
        .setName('target')
        .setDescription('The user to verify')
        .setRequired(true)
    ),

  async execute(interaction) {
    const targetUser = interaction.options.getUser('target');
    const member = await interaction.guild.members
      .fetch(targetUser.id)
      .catch(() => null);

    if (!member) {
      return interaction.editReply({
        content: 'Could not find that user in the server.',
      });
    }

    try {
      await Promise.all([
        member.roles.add(config.verifiedRoleId),
        member.roles.remove(config.unverifiedRoleId),
      ]);

      await interaction.editReply({
        content: `Successfully verified ${targetUser.tag}. They now have access to the server.`,
      });

      await targetUser
        .send(
          `Congratulations! You have been verified in **${interaction.guild.name}**.`
        )
        .catch(() => {
          console.log(
            `Could not DM ${targetUser.tag} about their verification.`
          );
        });
    } catch (error) {
      console.error('Error granting access:', error);
      await interaction.editReply({
        content:
          'An error occurred while granting access. Please check my permissions and role hierarchy.',
      });
    }
  },
};
