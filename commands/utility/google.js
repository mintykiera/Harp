const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  MessageFlags,
} = require('discord.js');
const axios = require('axios');
const User = require('../../models/User');
const config = require('../../config.js');

const GOOGLE_API_KEY = config.googleApiKey;
const SEARCH_ENGINE_ID = config.searchEngineId;
const MAX_RESULTS = 50;

async function fetchGoogleResults(query, start) {
  try {
    const url = `https://www.googleapis.com/customsearch/v1`;
    const params = {
      key: GOOGLE_API_KEY,
      cx: SEARCH_ENGINE_ID,
      q: query,
      num: 10,
      start,
    };
    const response = await axios.get(url, { params });
    return response.data.items || [];
  } catch (err) {
    console.error(
      'Error fetching from Google API:',
      err.response ? err.response.data : err.message
    );
    return [];
  }
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('google')
    .setDescription('Searches Google and shows up to 50 results.')
    .addStringOption((option) =>
      option
        .setName('query')
        .setDescription('What you want to search for.')
        .setRequired(true)
    ),

  async execute(interaction) {
    if (!GOOGLE_API_KEY || !SEARCH_ENGINE_ID) {
      console.error('ERROR: Google API keys are missing from config.');
      return interaction.reply({
        content: 'Sorry, this command is not configured correctly.',
        flags: MessageFlags.Ephemeral,
      });
    }

    await interaction.deferReply();

    const query = interaction.options.getString('query');

    try {
      await User.findOneAndUpdate(
        { userId: interaction.user.id },
        {
          $push: {
            searchHistory: {
              $each: [{ query, timestamp: new Date() }],
              $slice: -25,
            },
          },
          $setOnInsert: { username: interaction.user.username },
        },
        { upsert: true }
      );
    } catch (dbError) {
      console.error('Failed to log Google search to DB:', dbError);
    }

    const allResults = [];
    for (let start = 1; start <= MAX_RESULTS; start += 10) {
      const batch = await fetchGoogleResults(query, start);
      if (!batch.length) break;
      allResults.push(...batch);
    }

    if (allResults.length === 0) {
      return interaction.editReply(`No results found for **${query}**.`);
    }

    let currentPage = 0;
    const totalPages = Math.ceil(allResults.length / 10);

    const generatePayload = (page) => {
      const startIndex = page * 10;
      const pageResults = allResults.slice(startIndex, startIndex + 10);
      const embed = new EmbedBuilder()
        .setColor('#4285F4')
        .setTitle(`🔍 Search results for: "${query}"`)
        .setDescription(
          pageResults
            .map(
              (result, i) =>
                `**${startIndex + i + 1}. [${result.title}](${
                  result.link
                })**\n${result.snippet}`
            )
            .join('\n\n')
        )
        .setFooter({ text: `Page ${page + 1} of ${totalPages}` })
        .setTimestamp();

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('prev_page')
          .setLabel('◀')
          .setStyle(ButtonStyle.Primary)
          .setDisabled(page === 0),
        new ButtonBuilder()
          .setCustomId('next_page')
          .setLabel('▶')
          .setStyle(ButtonStyle.Primary)
          .setDisabled(page >= totalPages - 1)
      );
      return { embeds: [embed], components: totalPages > 1 ? [row] : [] };
    };

    const message = await interaction.editReply(generatePayload(currentPage));
    if (totalPages <= 1) return;

    const collector = message.createMessageComponentCollector({
      componentType: ComponentType.Button,
      time: 90_000,
    });

    collector.on('collect', async (i) => {
      if (i.user.id !== interaction.user.id) {
        return i.reply({
          content:
            'Only the person who used the command can interact with these buttons.',
          flags: MessageFlags.Ephemeral,
        });
      }
      currentPage += i.customId === 'next_page' ? 1 : -1;
      await i.update(generatePayload(currentPage));
    });

    collector.on('end', async () => {
      try {
        const finalPayload = generatePayload(currentPage);
        finalPayload.components.forEach((row) =>
          row.components.forEach((btn) => btn.setDisabled(true))
        );
        await message.edit(finalPayload);
      } catch (err) {
        console.error('Failed to disable buttons after collector end:', err);
      }
    });
  },
};
