const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
} = require('discord.js');
const rules = require('../../rules.js');
const { addInfraction } = require('../../infractionManager.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('infraction')
    .setDescription(
      'Issues an infraction to a user, with automated consequences.'
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .setDMPermission(false)
    .addUserOption((option) =>
      option
        .setName('target')
        .setDescription('The user to issue an infraction to')
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
      option.setName('details').setDescription('Additional details for the log')
    ),

  async execute(interaction) {
    const target = interaction.options.getUser('target');
    const member = interaction.guild.members.cache.get(target.id);
    const ruleBroken = interaction.options.getString('rule');
    const details =
      interaction.options.getString('details') ||
      'No additional details provided.';
    const reason = `Violated: ${ruleBroken}. Details: ${details}`;

    if (!member) {
      return interaction.editReply({
        content: 'That user is not in this server.',
      });
    }
    if (!member.moderatable) {
      return interaction.editReply({
        content: 'I cannot moderate this user. They may have a higher role.',
      });
    }

    const newInfractionCount = addInfraction(target.id, reason);
    const dmEmbed = new EmbedBuilder()
      .setColor('#ff4d4d')
      .setTitle('You have received an infraction')
      .addFields(
        { name: 'Server', value: interaction.guild.name },
        { name: 'Reason', value: reason }
      )
      .setTimestamp();

    let consequenceDescription = '';

    switch (newInfractionCount) {
      case 1:
        consequenceDescription =
          '**Consequence: Friendly Warning.**\nThis is a gentle reminder to review the server rules. No penalty has been applied.';
        break;
      case 2:
        await member.timeout(24 * 60 * 60 * 1000, reason);
        consequenceDescription =
          '**Consequence: Temporary Mute (24 hours).**\nYou are unable to send messages during this time.';
        break;
      case 3:
        await member.ban({ days: 3, reason: reason });
        consequenceDescription =
          '**Consequence: Temporary Ban (3 days).**\nYou have been removed from the server and may rejoin after the ban expires.';
        break;
      default:
        await member.ban({ reason: reason });
        consequenceDescription =
          '**Consequence: Permanent Ban.**\nYou have been permanently removed from the server.';
        break;
    }

    dmEmbed.setDescription(consequenceDescription);
    await target.send({ embeds: [dmEmbed] }).catch(() => {
      console.log(`Could not DM user ${target.tag}.`);
    });

    const replyEmbed = new EmbedBuilder()
      .setColor('#4dff7c')
      .setTitle('Infraction Issued Successfully')
      .setDescription(
        `**Target:** ${target.tag}\n**Infraction Count:** ${newInfractionCount}\n${consequenceDescription}`
      )
      .addFields({ name: 'Reason', value: reason })
      .setFooter({ text: `Issued by ${interaction.user.tag}` })
      .setTimestamp();

    await interaction.editReply({ embeds: [replyEmbed] });
  },
};
