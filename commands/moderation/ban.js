const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const rules = require('../../rules.js');

module.exports = {
  staffOnly: true,

  data: new SlashCommandBuilder()
    .setName('ban')
    .setDescription('Bans a user from the server (manual action).')
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .addUserOption((option) =>
      option
        .setName('target')
        .setDescription('The user to ban')
        .setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName('rule')
        .setDescription('The rule that was violated')
        .setRequired(true)
        .setChoices(...rules)
    )
    .addStringOption((option) =>
      option
        .setName('details')
        .setDescription('Provide specific details or message link for the log')
    ),
  async execute(interaction) {
    const target = interaction.options.getUser('target');
    const member = await interaction.guild.members
      .fetch(target.id)
      .catch(() => null);
    const rule = interaction.options.getString('rule');
    const details =
      interaction.options.getString('details') || 'No additional details.';
    const reason = `Rule: ${rule}. Details: ${details}`;

    if (!member) {
      return interaction.editReply({
        content: "I can't find that member in the server.",
      });
    }

    if (!member.bannable) {
      return interaction.editReply({
        content: 'I cannot ban this user. They may have a higher role than me.',
      });
    }

    await target
      .send(
        `You have been banned from **${interaction.guild.name}** for the following reason: ${reason}`
      )
      .catch(() => {
        console.log(`Could not DM user ${target.tag} about their ban.`);
      });

    await member.ban({ reason });

    await interaction.editReply({
      content: `Successfully banned ${target.tag}. Reason: ${reason}`,
    });
  },
};
