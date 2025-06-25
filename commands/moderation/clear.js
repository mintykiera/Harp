const {
  SlashCommandBuilder,
  PermissionsBitField,
  MessageFlags, // <--- STEP 1: IMPORT IT HERE
} = require('discord.js');

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
    // This ensures only members with "Manage Messages" permission can see/use it
    .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageMessages),

  async execute(interaction) {
    // Check if the user executing the command has the required permission
    if (
      !interaction.member.permissions.has(
        PermissionsBitField.Flags.ManageMessages
      )
    ) {
      return interaction.reply({
        content: "You don't have permission to use this command.",
        flags: [MessageFlags.Ephemeral], // <--- Use flags for the error message too
      });
    }

    const amount = interaction.options.getInteger('amount');
    const user = interaction.options.getUser('user');

    await interaction.deferReply({ flags: [MessageFlags.Ephemeral] }); // Defer ephemerally

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
      const deletedMessages = await channel.bulkDelete(messagesToDelete, true); // `true` filters out messages older than 14 days

      await interaction.editReply({
        content: `✅ Successfully deleted **${
          deletedMessages.size
        }** message(s)${user ? ` from ${user.tag}` : ''}.`,
        // No flags needed here since we deferred ephemerally already
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
