const {
  SlashCommandBuilder,
  EmbedBuilder,
  PermissionsBitField,
  ChannelType,
} = require('discord.js');
const chrono = require('chrono-node');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('schedule')
    .setDescription('Schedules a message to be sent as you.')
    .addStringOption((option) =>
      option
        .setName('message')
        .setDescription('The message content you want to schedule.')
        .setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName('when')
        .setDescription('When to send? E.g., "5pm", "tomorrow 9:30am"')
        .setRequired(true)
    )
    .addChannelOption((option) =>
      option
        .setName('channel')
        .setDescription(
          'The channel to send the message in (defaults to current).'
        )
        .addChannelTypes(ChannelType.GuildText)
    ),

  async execute(interaction) {
    if (
      !interaction.guild.members.me.permissions.has(
        PermissionsBitField.Flags.ManageWebhooks
      )
    ) {
      return interaction.editReply({
        content: 'I need the "Manage Webhooks" permission to do this!',
      });
    }

    const messageContent = interaction.options.getString('message');
    const whenString = interaction.options.getString('when');
    const targetChannel =
      interaction.options.getChannel('channel') || interaction.channel;

    const parsedDate = chrono.parseDate(whenString, new Date(), {
      forwardDate: true,
    });

    if (!parsedDate) {
      return interaction.editReply({
        content:
          'I could not understand that date/time format. Please try something like "5pm" or "tomorrow at 9am".',
      });
    }

    if (parsedDate.getTime() <= Date.now()) {
      return interaction.editReply({
        content:
          'The time you provided is in the past. Please schedule for a future time.',
      });
    }

    const delayInMs = parsedDate.getTime() - Date.now();
    if (delayInMs > 30 * 24 * 60 * 60 * 1000) {
      return interaction.editReply({
        content: 'You can only schedule messages up to 30 days in the future.',
      });
    }

    const confirmationEmbed = new EmbedBuilder()
      .setColor('#57F287')
      .setTitle('✅ Message Scheduled!')
      .setDescription(
        `Your message will be sent in ${targetChannel.name} at the following time:`
      )
      .addFields({
        name: 'Scheduled Time',
        value: `<t:${Math.floor(parsedDate.getTime() / 1000)}:F>`,
      })
      .setFooter({
        text: 'Note: If the bot restarts, this schedule will be cancelled.',
      });

    await interaction.editReply({ embeds: [confirmationEmbed] });

    setTimeout(async () => {
      try {
        const member = await interaction.guild.members.fetch(
          interaction.user.id
        );
        const webhooks = await targetChannel.fetchWebhooks();
        let webhook = webhooks.find(
          (wh) => wh.owner.id === interaction.client.user.id
        );
        if (!webhook) {
          webhook = await targetChannel.createWebhook({
            name: 'Scheduler Bot',
            avatar: interaction.client.user.displayAvatarURL(),
          });
        }
        await webhook.send({
          content: messageContent,
          username: member.displayName,
          avatarURL: member.user.displayAvatarURL({ dynamic: true }),
        });
      } catch (error) {
        console.error('Failed to send scheduled message:', error);
      }
    }, delayInMs);
  },
};
