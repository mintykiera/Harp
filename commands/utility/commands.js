const {
  SlashCommandBuilder,
  EmbedBuilder,
  MessageFlags,
} = require('discord.js');
// We will import 'change-case' dynamically inside the execute function

module.exports = {
  data: new SlashCommandBuilder()
    .setName('commands')
    .setDescription('Lists all of my available commands by category.'),

  async execute(interaction) {
    // ✅ Dynamically import the 'change-case' module
    const { capitalCase } = await import('change-case');

    // Group commands by category
    const categories = new Map();

    // Filter out this 'commands' command from the list
    const commandsToDisplay = interaction.client.commands.filter(
      (cmd) => cmd.data.name !== 'commands'
    );

    commandsToDisplay.forEach((cmd) => {
      const category = cmd.category || 'Miscellaneous'; // Use 'Miscellaneous' if a category isn't set
      if (!categories.has(category)) {
        categories.set(category, []);
      }
      categories.get(category).push(cmd);
    });

    // Sort categories alphabetically
    const sortedCategories = [...categories.keys()].sort((a, b) =>
      a.localeCompare(b)
    );

    const embed = new EmbedBuilder()
      .setColor('#0099ff')
      .setTitle('My Commands')
      .setDescription(
        'Here is a list of all my available commands, sorted by category.'
      );

    // A check in case there are no commands to show
    if (sortedCategories.length === 0) {
      embed.setDescription('There are no commands available to display.');
      // ✅ Make this reply ephemeral too for consistency
      return interaction.reply({
        embeds: [embed],
        flags: [MessageFlags.Ephemeral],
      });
    }

    // Add a field for each category
    for (const category of sortedCategories) {
      const commandsInCategory = categories.get(category);

      // Sort commands within the category alphabetically by name
      commandsInCategory.sort((a, b) => a.data.name.localeCompare(b.data.name));

      const commandList = commandsInCategory
        .map((cmd) => `**\`/${cmd.data.name}\`**: ${cmd.data.description}`)
        .join('\n');

      // Potential improvement: Check if commandList is too long for an embed field
      // Discord embed field values have a limit of 1024 characters.
      // If a category has many commands, this could be an issue.
      // For now, this should be fine unless you have a very large number of commands per category.

      embed.addFields({
        name: `📂 ${capitalCase(category)}`,
        value: commandList || 'No commands in this category.', // Fallback if somehow empty after filtering
      });
    }

    await interaction.reply({
      embeds: [embed],
    });
  },
};
