const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  WebhookClient,
  EmbedBuilder,
  MessageFlags,
} = require('discord.js');
const Ticket = require('../../models/Ticket');

module.exports = {
  staffOnly: true,

  data: new SlashCommandBuilder()
    .setName('reply')
    .setDescription('Reply to the user in the ticket thread.')
    .addStringOption((option) =>
      option
        .setName('message')
        .setDescription('Your reply to the user')
        .setRequired(true)
    ),

  async execute(interaction) {
    const { channel, guild, user, options } = interaction;
    const replyMessage = options.getString('message');

    // check staff roles
    const member = await guild.members.fetch(user.id);
    const allowedRoles = [
      '1389130370267746364', // Admin
      '1389127894508503050', // Moderator
    ];
    const hasRole = member.roles.cache.some((r) => allowedRoles.includes(r.id));
    if (!hasRole) {
      return interaction.editReply({
        content: '🚫 You do not have permission to use this command here.',
        flags: [MessageFlags.Ephemeral],
      });
    }

    // is this a valid ticket?
    const ticket = await Ticket.findOne({ channelId: channel.id });
    if (!ticket) {
      return interaction.editReply({
        content: '⚠️ This is not a recognized ticket channel.',
        flags: [MessageFlags.Ephemeral],
      });
    }

    // create webhook or reuse it
    let webhooks = await channel.fetchWebhooks();
    let webhook = webhooks.find((w) => w.name === 'StaffWebhook');
    if (!webhook) {
      webhook = await channel.createWebhook({
        name: 'StaffWebhook',
        avatar: guild.iconURL(),
      });
    }

    // send as webhook
    await webhook.send({
      content: replyMessage,
      username: user.displayName || user.username,
      avatarURL: user.displayAvatarURL(),
    });

    // forward to user in DM
    try {
      const targetUser = await interaction.client.users.fetch(ticket.userId);
      await targetUser.send(`**[staff] ${user.username}:** ${replyMessage}`);
    } catch (e) {
      await interaction.followUp({
        content: '⚠️ User could not be DMed (maybe DMs closed).',
        flags: [MessageFlags.Ephemeral],
      });
    }

    await interaction.editReply({
      content: '✅ Message sent to user successfully.',
      flags: [MessageFlags.Ephemeral],
    });
  },
};
