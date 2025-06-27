const {
  SlashCommandBuilder,
  EmbedBuilder,
  MessageFlags,
} = require('discord.js');
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
    // 1. Determine the target user. If no user is mentioned, it defaults to the command user.
    const targetUser = interaction.options.getUser('user') || interaction.user;

    // 2. Handle the case where the target is a bot.
    if (targetUser.bot) {
      return interaction.reply({
        content: "Bots don't have game profiles!",
        flags: [MessageFlags.Ephemeral],
      });
    }

    // 3. Fetch the user's profile from the database.
    const userProfile = await User.findOne({ userId: targetUser.id });

    // 4. Handle the case where the user has never played a game.
    if (!userProfile) {
      return interaction.reply({
        content: `${targetUser.username} hasn't played any games yet.`,
        flags: [MessageFlags.Ephemeral],
      });
    }

    // 5. If a profile exists, extract and calculate stats.
    const { elo, stats } = userProfile;
    const totalGames = stats.wins + stats.losses + stats.draws;
    const winRate = totalGames === 0 ? 0 : (stats.wins / totalGames) * 100;

    // 6. Build the profile embed.
    const profileEmbed = new EmbedBuilder()
      .setColor('#5865F2') // A nice Discord blue
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

    // 7. Send the reply.
    await interaction.reply({ embeds: [profileEmbed] });
  },
};
