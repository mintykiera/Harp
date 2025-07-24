const { REST, Routes, PermissionFlagsBits } = require('discord.js');
require('dotenv').config();

const commands = [
  {
    name: 'reply',
    description: 'Reply to the user in the ticket thread.',
    options: [
      {
        name: 'message',
        description: 'Your reply to the user.',
        type: 3,
        required: true,
      },
    ],
    default_member_permissions: String(PermissionFlagsBits.ManageChannels),
    dm_permission: false,
  },
  {
    name: 'ticket',
    description: 'Ticket management commands.',
    options: [
      {
        name: 'lookup',
        description: 'Look up archived tickets by user mention, ID, or tag.',
        type: 1,
        options: [
          {
            name: 'query',
            description:
              'The @mention, ID, or tag (e.g., User#1234) of the user.',
            type: 3,
            required: true,
          },
        ],
      },
    ],
    default_member_permissions: String(PermissionFlagsBits.ManageChannels),
    dm_permission: false,
  },
];

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    console.log('Started refreshing 1 application (/) command.');

    const data = await rest.put(
      Routes.applicationGuildCommands(
        process.env.CLIENT_ID,
        process.env.GUILD_ID
      ),
      { body: commands }
    );

    console.log(
      `Successfully reloaded ${data.length} application (/) command.`
    );
  } catch (error) {
    console.error(error);
  }
})();
