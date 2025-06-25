// File: commands/moderation/kick.js

const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const rules = require('../../rules.js'); // 1. Import the rules

module.exports = {
  data: new SlashCommandBuilder()
    .setName('kick')
    .setDescription('Kicks a user from the server (manual action).')
    .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
    .addUserOption((option) =>
      option
        .setName('target')
        .setDescription('The user to kick')
        .setRequired(true)
    )
    // 2. Change 'reason' to 'rule' with choices
    .addStringOption((option) =>
      option
        .setName('rule')
        .setDescription('The rule that was violated')
        .setRequired(true)
        .setChoices(...rules)
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

    if (!member.kickable) {
      return interaction.reply({
        content:
          'I cannot kick this user. They may have a higher role than me.',
        flags: [MessageFlags.Ephemeral],
      });
    }

    await target
      .send(
        `You have been kicked from **${interaction.guild.name}** for the following reason: ${reason}`
      )
      .catch(() => {
        console.log(`Could not DM user ${target.tag} about their kick.`);
      });

    await member.kick(reason);

    await interaction.reply({
      content: `Successfully kicked ${target.tag}. Reason: ${reason}`,
      flags: [MessageFlags.Ephemeral],
    });
  },
};
