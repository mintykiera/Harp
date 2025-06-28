const { SlashCommandBuilder, PermissionsBitField } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('clear')
    .setDescription('Deletes a specified number of messages from a channel.')
    .addIntegerOption((option) =>
      option
        .setName('amount')
        .setDescription('The number of messages to delete (2-100).')
        .setRequired(true)
        .setMinValue(2)
        .setMaxValue(100)
    )
    .addUserOption((option) =>
      option
        .setName('user')
        .setDescription('Only delete messages from this user.')
        .setRequired(false)
    )
    .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageMessages),

  async execute(interaction) {
    if (
      !interaction.member.permissions.has(
        PermissionsBitField.Flags.ManageMessages
      )
    ) {
      return interaction.editReply({
        content: "You don't have permission to use this command.",
      });
    }

    const amount = interaction.options.getInteger('amount');
    const user = interaction.options.getUser('user');
    const channel = interaction.channel;
    const messages = await channel.messages.fetch({ limit: amount });

    let messagesToDelete = messages;
    if (user) {
      messagesToDelete = messages.filter((m) => m.author.id === user.id);
    }

    if (messagesToDelete.size === 0) {
      return interaction.editReply({
        content: `No messages found to delete${
          user ? ` from ${user.tag}` : ''
        }.`,
      });
    }

    try {
      const deletedMessages = await channel.bulkDelete(messagesToDelete, true);
      await interaction.editReply({
        content: `✅ Successfully deleted **${
          deletedMessages.size
        }** message(s)${user ? ` from ${user.tag}` : ''}.`,
      });
    } catch (error) {
      console.error('Error during bulk delete:', error);
      await interaction.editReply({
        content:
          '❌ An error occurred. I might not have permission to delete messages, or the messages are older than 14 days.',
      });
    }
  },
};
