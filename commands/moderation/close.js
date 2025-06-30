// const {
//   SlashCommandBuilder,
//   PermissionFlagsBits,
//   MessageFlags,
// } = require('discord.js');

// module.exports = {
//   data: new SlashCommandBuilder()
//     .setName('close')
//     .setDescription('Closes the current ticket channel.')
//     .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
//     .addStringOption((option) =>
//       option
//         .setName('reason')
//         .setDescription('Optional reason for closing the ticket for logs.')
//     ),

//   async execute(interaction) {
//     const { client, channel } = interaction;

//     if (!client.openTickets.has(channel.id)) {
//       return interaction.editReply({
//         content: 'This command can only be used in a ticket channel.',
//         flags: [MessageFlags.Ephemeral],
//       });
//     }

//     const userId = client.openTickets.get(channel.id);
//     const reason =
//       interaction.options.getString('reason') || 'Ticket closed by staff.';

//     try {
//       const user = await client.users.fetch(userId).catch(() => null);
//       if (user) {
//         await user
//           .send(
//             `Your ticket in **${interaction.guild.name}** has been closed. Reason: ${reason}`
//           )
//           .catch(() => {
//             console.log(`Could not DM user ${user.tag} about ticket closure.`);
//           });
//       }

//       await interaction.editReply({
//         content: 'This ticket will be deleted in 3 seconds...',
//       });

//       setTimeout(() => {
//         channel
//           .delete(reason)
//           .catch((err) =>
//             console.error('Could not delete ticket channel:', err)
//           );
//       }, 3000);
//     } catch (error) {
//       console.error('Error during ticket closing:', error);
//       await interaction.editReply({
//         content: 'An error occurred while trying to close the ticket.',
//       });
//     } finally {
//       client.openTickets.delete(channel.id);
//       console.log(
//         `[INFO] Ticket ${channel.id} closed and removed from memory.`
//       );
//     }
//   },
// };
