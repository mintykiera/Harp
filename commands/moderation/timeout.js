const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const ms = require('ms');
const rules = require('../../rules.js');

module.exports = {
  staffOnly: true,

  data: new SlashCommandBuilder()
    .setName('timeout')
    .setDescription('Mutes a user for a specific duration (manual action).')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption((option) =>
      option
        .setName('target')
        .setDescription('The user to timeout')
        .setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName('duration')
        .setDescription('e.g., 10m, 1h, 1d (max 28d)')
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
    await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
    const target = interaction.options.getUser('target');
    const member = await interaction.guild.members
      .fetch(target.id)
      .catch(() => null);
    const durationString = interaction.options.getString('duration');
    const rule = interaction.options.getString('rule');
    const details =
      interaction.options.getString('details') || 'No additional details.';
    const reason = `Rule: ${rule}. Details: ${details}`;

    if (!member) {
      return interaction.editReply({
        content: "I can't find that member in the server.",
      });
    }

    const durationMs = ms(durationString);

    if (
      !durationMs ||
      durationMs < 5000 ||
      durationMs > 28 * 24 * 60 * 60 * 1000
    ) {
      return interaction.editReply({
        content:
          'Invalid duration. Please provide a valid duration between 5 seconds and 28 days (e.g., 10m, 1h, 3d).',
      });
    }

    if (!member.moderatable) {
      return interaction.editReply({
        content:
          'I cannot timeout this user. They may have a higher role than me.',
      });
    }

    await member.timeout(durationMs, reason);

    await interaction.editReply({
      content: `Successfully timed out ${target.tag} for ${durationString}. Reason: ${reason}`,
    });
  },
};
