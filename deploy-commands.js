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
        type: 3, // 3 = String Type
        required: true,
      },
    ],
    // This makes the command only visible to members with "Manage Channels" permission by default
    default_member_permissions: String(PermissionFlagsBits.ManageChannels),
    dm_permission: false, // Prevents command from being used in DMs
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
