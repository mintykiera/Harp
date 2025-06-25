// File: commands/utility/google.js

const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
} = require('discord.js');
const axios = require('axios');

const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
const SEARCH_ENGINE_ID = process.env.SEARCH_ENGINE_ID;
const MAX_RESULTS = 50; // The total maximum results we'll allow paginating through.

module.exports = {
  // 1. Command is simplified, no more 'results' option.
  data: new SlashCommandBuilder()
    .setName('google')
    .setDescription(
      'Searches Google and shows up to 50 results in pages of 10.'
    )
    .addStringOption((option) =>
      option
        .setName('query')
        .setDescription('What you want to search for.')
        .setRequired(true)
    ),

  async execute(interaction) {
    if (!GOOGLE_API_KEY || !SEARCH_ENGINE_ID) {
      console.error(
        'ERROR: GOOGLE_API_KEY or SEARCH_ENGINE_ID is missing from your .env file.'
      );
      return interaction.reply({
        content:
          'Sorry, this command is not configured correctly by the bot owner.',
        ephemeral: true,
      });
    }

    const query = interaction.options.getString('query');
    await interaction.deferReply();

    try {
      let allResults = [];

      const initialResponse = await fetchGoogleResults(query, 1);
      if (!initialResponse || initialResponse.length === 0) {
        await interaction.editReply(`No results found for "${query}".`);
        return;
      }
      allResults = allResults.concat(initialResponse);

      let currentPage = 0;
      let totalPages = 1;

      const generateEmbedAndButtons = (page, results) => {
        const totalActualResults = results[0]?.searchInformation.totalResults
          ? parseInt(results[0].searchInformation.totalResults)
          : allResults.length;
        totalPages = Math.ceil(Math.min(totalActualResults, MAX_RESULTS) / 10);

        const startIndex = page * 10;
        const pageResults = allResults.slice(startIndex, startIndex + 10);

        const embed = new EmbedBuilder()
          .setColor('#4285F4')
          .setTitle(`Search results for: "${query}"`)
          .setFooter({ text: `Page ${page + 1} of ${totalPages}` })
          .setTimestamp();

        const description = pageResults
          .map((result, index) => {
            const overallIndex = startIndex + index + 1;
            return `**${overallIndex}. [${result.title}](${
              result.link
            })**\n${result.snippet.replace(/(\r\n|\n|\r)/gm, ' ')}`;
          })
          .join('\n\n');

        embed.setDescription(description || 'No results for this page.');

        const buttons = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId('prev_page')
            .setLabel('◀ Previous')
            .setStyle(ButtonStyle.Primary)
            .setDisabled(page === 0),
          new ButtonBuilder()
            .setCustomId('next_page')
            .setLabel('Next ▶')
            .setStyle(ButtonStyle.Primary)
            .setDisabled(
              page === totalPages - 1 ||
                (allResults.length < (page + 1) * 10 &&
                  allResults.length % 10 !== 0)
            )
        );

        return { embeds: [embed], components: [buttons] };
      };

      const messagePayload = generateEmbedAndButtons(
        currentPage,
        initialResponse
      );
      const message = await interaction.editReply(messagePayload);

      const collector = message.createMessageComponentCollector({
        componentType: ComponentType.Button,
        time: 90_000,
      });

      collector.on('collect', async (i) => {
        if (i.user.id !== interaction.user.id) {
          await i.reply({
            content:
              'Only the person who ran the command can use these buttons.',
            ephemeral: true,
          });
          return;
        }

        // We only need to check the customId once
        const isNext = i.customId === 'next_page';
        currentPage += isNext ? 1 : -1;

        // Check if we need to fetch new data
        const needsFetch =
          isNext &&
          currentPage * 10 >= allResults.length &&
          allResults.length < MAX_RESULTS;

        if (needsFetch) {
          // Acknowledge the button click with a loading message
          await i.update({
            content: 'Loading more results...',
            embeds: [],
            components: [],
          });

          const newResults = await fetchGoogleResults(
            query,
            allResults.length + 1
          );
          if (newResults && newResults.length > 0) {
            allResults = allResults.concat(newResults);
          }

          // Now, edit the original message with the final payload
          const newPayload = generateEmbedAndButtons(currentPage, allResults);
          await interaction.editReply(newPayload);
        } else {
          // If we don't need to fetch, we can just update the interaction directly
          const newPayload = generateEmbedAndButtons(currentPage, allResults);
          await i.update(newPayload);
        }
      });

      collector.on('end', () => {
        const finalPayload = generateEmbedAndButtons(currentPage, allResults);
        finalPayload.components.forEach((row) =>
          row.components.forEach((button) => button.setDisabled(true))
        );
        interaction.editReply(finalPayload).catch(console.error);
      });
    } catch (error) {
      console.error(
        'Error in Google command:',
        error.response ? error.response.data : error.message
      );
      await interaction.editReply(
        'Sorry, there was an error performing the search.'
      );
    }
  },
};

// Helper function to make the API calls cleaner
async function fetchGoogleResults(query, start) {
  try {
    const url = `https://www.googleapis.com/customsearch/v1`;
    const params = {
      key: GOOGLE_API_KEY,
      cx: SEARCH_ENGINE_ID,
      q: query,
      num: 10, // Always fetch in batches of 10
      start: start, // The starting index of the results
    };
    const response = await axios.get(url, { params });
    // Include searchInformation to get total result count
    if (response.data.items) {
      response.data.items.forEach(
        (item) => (item.searchInformation = response.data.searchInformation)
      );
      return response.data.items;
    }
    return null;
  } catch (err) {
    console.error(
      'Error fetching from Google API:',
      err.response ? err.response.data : err.message
    );
    return null;
  }
}
