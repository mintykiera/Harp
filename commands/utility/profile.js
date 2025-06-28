const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const User = require('../../models/User');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('profile')
    .setDescription("View your own or another user's game profile and stats.")
    .addUserOption((option) =>
      option
        .setName('user')
        .setDescription('The user whose profile you want to view.')
        .setRequired(false)
    ),

  async execute(interaction) {
    const targetUser = interaction.options.getUser('user') || interaction.user;

    if (targetUser.bot) {
      return interaction.editReply({
        content: "Bots don't have game profiles!",
      });
    }

    const userProfile = await User.findOne({ userId: targetUser.id });
    if (!userProfile) {
      return interaction.editReply({
        content: `${targetUser.username} hasn't played any games yet.`,
      });
    }

    const { elo, stats } = userProfile;
    const totalGames = stats.wins + stats.losses + stats.draws;
    const winRate = totalGames === 0 ? 0 : (stats.wins / totalGames) * 100;

    const profileEmbed = new EmbedBuilder()
      .setColor('#5865F2')
      .setTitle(`${targetUser.username}'s Profile`)
      .setThumbnail(targetUser.displayAvatarURL())
      .addFields(
        { name: '🏆 Chess Elo', value: `**${elo}**`, inline: true },
        { name: '🎮 Total Games', value: totalGames.toString(), inline: true },
        { name: '📈 Win Rate', value: `${winRate.toFixed(1)}%`, inline: true },
        {
          name: 'Record (W-L-D)',
          value: `\`${stats.wins}\` - \`${stats.losses}\` - \`${stats.draws}\``,
        }
      )
      .setTimestamp();

    await interaction.editReply({ embeds: [profileEmbed] });
  },
};
