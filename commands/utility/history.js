const {
  SlashCommandBuilder,
  EmbedBuilder,
  MessageFlags,
} = require('discord.js');
const User = require('../../models/User');
const Gemini = require('../../models/Gemini');

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
    .addSubcommand((subcommand) =>
      subcommand
        .setName('google')
        .setDescription('View your 25 most recent Google searches.')
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('gemini')
        .setDescription('View your 25 most recent Gemini conversations.')
    ),

  async execute(interaction) {
    await interaction.deferReply();

    const subcommand = interaction.options.getSubcommand();
    const targetUser = interaction.options.getUser('user') || interaction.user;

    if (subcommand === 'chess') {
      if (targetUser.bot) {
        return interaction.editReply({
          content: "🤖 Bots don't have game history!",
        });
      }

      const userProfile = await User.findOne({ userId: targetUser.id });
      if (!userProfile?.recentGames?.length) {
        return interaction.editReply({
          content: `${targetUser.username} has no chess games on record.`,
        });
      }

      const historyDescription = userProfile.recentGames
        .slice(-10)
        .reverse()
        .map((game, i) => {
          const eloChange = game.eloChange;
          const sign = eloChange > 0 ? '+' : '';
          const eloString = eloChange ? ` **(${sign}${eloChange})**` : '';
          return `**${i + 1}.** ${game.result} vs. ${
            game.opponentUsername
          }${eloString}`;
        })
        .join('\n');

      const embed = new EmbedBuilder()
        .setColor('#E5E5E5')
        .setTitle(`♟️ Chess History for ${targetUser.username}`)
        .setThumbnail(targetUser.displayAvatarURL())
        .setDescription(historyDescription)
        .setTimestamp();

      return interaction.editReply({ embeds: [embed] });
    }

    if (subcommand === 'google') {
      const userProfile = await User.findOne({ userId: interaction.user.id });
      if (!userProfile?.searchHistory?.length) {
        return interaction.editReply({
          content: "🔍 You don't have any Google searches on record.",
        });
      }

      const historyDescription = userProfile.searchHistory
        .slice(-25)
        .reverse()
        .map(
          (search, i) =>
            `**${i + 1}.** \`${search.query}\` (<t:${Math.floor(
              new Date(search.timestamp).getTime() / 1000
            )}:R>)`
        )
        .join('\n');

      const embed = new EmbedBuilder()
        .setColor('#4285F4')
        .setTitle(`🔎 Your Google Search History`)
        .setDescription(historyDescription)
        .setTimestamp();

      return interaction.editReply({ embeds: [embed] });
    }

    if (subcommand === 'gemini') {
      const conversations = await Gemini.find({ userId: interaction.user.id })
        .sort({ updatedAt: -1 })
        .limit(25);

      if (!conversations.length) {
        return interaction.editReply({
          content: "💬 You don't have any Gemini conversations on record.",
        });
      }

      const historyDescription = conversations
        .map(
          (convo, i) =>
            `**${i + 1}.** ${convo.title} (<t:${Math.floor(
              new Date(convo.updatedAt).getTime() / 1000
            )}:R>)`
        )
        .join('\n');

      const embed = new EmbedBuilder()
        .setColor('#4A88F6')
        .setTitle(`💬 Your Recent Gemini Conversations`)
        .setDescription(historyDescription)
        .setTimestamp();

      return interaction.editReply({ embeds: [embed] });
    }
  },
};
