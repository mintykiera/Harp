const {
  SlashCommandBuilder,
  EmbedBuilder,
  MessageFlags,
} = require('discord.js');
const User = require('../../models/User');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('history')
    .setDescription('View recent activity for yourself or another user.')
    .addSubcommand((subcommand) =>
      subcommand
        .setName('chess')
        .setDescription("View a user's 10 most recent chess games.")
        .addUserOption((option) =>
          option.setName('user').setDescription('The user to look up.')
        )
    )
    .addSubcommand(
      (subcommand) =>
        subcommand
          .setName('google')
          .setDescription('View your 25 most recent Google searches.')
      // No user option here to enforce privacy
    ),

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();

    if (subcommand === 'chess') {
      const targetUser =
        interaction.options.getUser('user') || interaction.user;

      if (targetUser.bot) {
        return interaction.reply({
          content: "Bots don't have game history!",
          flags: [MessageFlags.Ephemeral],
        });
      }

      const userProfile = await User.findOne({ userId: targetUser.id });

      if (
        !userProfile ||
        !userProfile.recentGames ||
        userProfile.recentGames.length === 0
      ) {
        return interaction.reply({
          content: `${targetUser.username} has no chess games on record.`,
          flags: [MessageFlags.Ephemeral],
        });
      }

      const historyDescription = userProfile.recentGames
        .reverse() // Show most recent games first
        .map((game) => {
          const resultEmoji =
            game.result === 'win' ? '✅' : game.result === 'loss' ? '❌' : '➖';
          const eloSign = game.eloChange > 0 ? '+' : '';
          const eloString =
            game.eloChange !== 0 ? `(${eloSign}${game.eloChange})` : '';
          const timestamp = Math.floor(game.timestamp.getTime() / 1000);
          return `${resultEmoji} vs. **${game.opponentUsername}** ${eloString} - <t:${timestamp}:R>`;
        })
        .join('\n');

      const embed = new EmbedBuilder()
        .setColor('#E5E5E5')
        .setTitle(`♟️ Chess History for ${targetUser.username}`)
        .setThumbnail(targetUser.displayAvatarURL())
        .setDescription(historyDescription)
        .setTimestamp();

      await interaction.reply({ embeds: [embed] });
    } else if (subcommand === 'google') {
      const userProfile = await User.findOne({ userId: interaction.user.id });

      if (
        !userProfile ||
        !userProfile.searchHistory ||
        userProfile.searchHistory.length === 0
      ) {
        return interaction.reply({
          content: "You don't have any Google searches on record.",
          flags: [MessageFlags.Ephemeral],
        });
      }

      const historyDescription = userProfile.searchHistory
        .reverse() // Show most recent searches first
        .map((search) => {
          const timestamp = Math.floor(search.timestamp.getTime() / 1000);
          // Make sure query isn't too long for one line
          const query =
            search.query.length > 80
              ? `${search.query.substring(0, 77)}...`
              : search.query;
          return `\`${query}\` - <t:${timestamp}:R>`;
        })
        .join('\n');

      const embed = new EmbedBuilder()
        .setColor('#4285F4')
        .setTitle(`🔎 Your Google Search History`)
        .setDescription(historyDescription)
        .setFooter({ text: 'This history is only visible to you.' })
        .setTimestamp();

      await interaction.reply({
        embeds: [embed],
        flags: [MessageFlags.Ephemeral],
      });
    }
  },
};
