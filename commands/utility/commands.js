const {
  SlashCommandBuilder,
  EmbedBuilder,
  MessageFlags,
} = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('commands')
    .setDescription('Lists all of my available commands by category.'),

  async execute(interaction) {
    // STEP 1: Defer the reply IMMEDIATELY. This is the crucial fix.
    // This acknowledges the interaction and prevents any timeouts.
    await interaction.deferReply();

    // Dynamically import the 'change-case' module
    const { capitalCase } = await import('change-case');

    // Group commands by category
    const categories = new Map();

    const commandsToDisplay = interaction.client.commands.filter(
      (cmd) => cmd.data.name !== 'commands'
    );

    commandsToDisplay.forEach((cmd) => {
      const category = cmd.category || 'Miscellaneous';
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

    if (sortedCategories.length === 0) {
      embed.setDescription('There are no commands available to display.');
      // This must also be an editReply now, since we deferred.
      return interaction.editReply({ embeds: [embed] });
    }

    for (const category of sortedCategories) {
      const commandsInCategory = categories.get(category);
      commandsInCategory.sort((a, b) => a.data.name.localeCompare(b.data.name));

      const commandList = commandsInCategory
        .map((cmd) => `**\`/${cmd.data.name}\`**: ${cmd.data.description}`)
        .join('\n');

      embed.addFields({
        name: `📂 ${capitalCase(category)}`,
        value: commandList || 'No commands in this category.',
      });
    }

    // STEP 2: Use editReply to send the final response.
    // This replaces the "Harp is thinking..." message with our completed embed.
    await interaction.editReply({
      embeds: [embed],
    });
  },
};
