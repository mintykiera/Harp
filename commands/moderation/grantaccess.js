const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const config = require('../../config.js');

module.exports = {
  staffOnly: true,

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
    )
    .addStringOption((option) =>
      option
        .setName('school')
        .setDescription('The primary school/department of the user')
        .setRequired(true)
        .addChoices(
          { name: 'GBSEALD', value: config.schoolRoles.gbseald },
          { name: 'SOH', value: config.schoolRoles.soh },
          { name: 'JGSOM', value: config.schoolRoles.jgsom },
          { name: 'SOSE', value: config.schoolRoles.sose },
          { name: 'RGLSOSS', value: config.schoolRoles.rglsoss }
        )
    ),

  async execute(interaction) {
    const targetUser = interaction.options.getUser('target');
    const chosenSchoolRoleId = interaction.options.getString('school');
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
        member.roles.add(chosenSchoolRoleId),
        member.roles.remove(config.unverifiedRoleId),
      ]);

      const assignedRole = await interaction.guild.roles.fetch(
        chosenSchoolRoleId
      );
      const roleName = assignedRole ? assignedRole.name : 'the assigned';

      await interaction.editReply({
        content: `Successfully verified ${targetUser.tag}. They have been granted the **${roleName}** and **Verified** roles.`,
      });

      await targetUser
        .send(
          `Congratulations! You have been verified in **${interaction.guild.name}** and assigned the **${roleName}** role.`
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
