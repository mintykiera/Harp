// File: commands/moderation/ban.js

const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const rules = require('../../rules.js'); // 1. Import the rules

module.exports = {
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
    // 2. Change 'reason' to 'rule' with choices
    .addStringOption(
      (option) =>
        option
          .setName('rule')
          .setDescription('The rule that was violated')
          .setRequired(true)
          .setChoices(...rules) // Use the imported rules as choices
    )
    // 3. (Recommended) Add an optional details field
    .addStringOption((option) =>
      option
        .setName('details')
        .setDescription('Provide specific details or message link for the log')
    ),
  async execute(interaction) {
    await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
    const target = interaction.options.getUser('target');
    const member = await interaction.guild.members.fetch(target.id);
    const rule = interaction.options.getString('rule');
    const details =
      interaction.options.getString('details') || 'No additional details.';

    // 4. Combine the rule and details for a clean reason
    const reason = `Rule: ${rule}. Details: ${details}`;

    if (!member) {
      return interaction.reply({
        content: "I can't find that member in the server.",
        flags: [MessageFlags.Ephemeral],
      });
    }

    if (!member.bannable) {
      return interaction.reply({
        content: 'I cannot ban this user. They may have a higher role than me.',
        flags: [MessageFlags.Ephemeral],
      });
    }

    // Try to DM the user before banning
    await target
      .send(
        `You have been banned from **${interaction.guild.name}** for the following reason: ${reason}`
      )
      .catch(() => {
        console.log(`Could not DM user ${target.tag} about their ban.`);
      });

    await member.ban({ reason });

    await interaction.reply({
      content: `Successfully banned ${target.tag}. Reason: ${reason}`,
      flags: [MessageFlags.Ephemeral],
    });
  },
};
