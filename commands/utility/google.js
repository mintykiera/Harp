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

const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
const SEARCH_ENGINE_ID = process.env.SEARCH_ENGINE_ID;
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
    // --- THE FIX: Defer first, think later ---
    await interaction.deferReply();

    if (!GOOGLE_API_KEY || !SEARCH_ENGINE_ID) {
      console.error('ERROR: Google API keys are missing from .env file.');
      return interaction.editReply({
        content: 'Sorry, this command is not configured correctly.',
      });
    }

    const query = interaction.options.getString('query');

    // Now it's safe for this to take time
    try {
      await User.findOneAndUpdate(
        { userId: interaction.user.id },
        {
          $push: { searchHistory: { $each: [{ query }], $slice: -25 } },
          $setOnInsert: { username: interaction.user.username },
        },
        { upsert: true }
      );
    } catch (dbError) {
      console.error('Failed to log Google search to DB:', dbError);
    }

    try {
      let allResults = [];
      const initialResponse = await fetchGoogleResults(query, 1);

      if (!initialResponse || initialResponse.length === 0) {
        return interaction.editReply(`No results found for "${query}".`);
      }
      allResults = allResults.concat(initialResponse);

      let currentPage = 0;

      const generatePayload = (page) => {
        const totalResults = initialResponse[0]?.searchInformation.totalResults
          ? parseInt(initialResponse[0].searchInformation.totalResults)
          : allResults.length;
        const totalPages = Math.ceil(Math.min(totalResults, MAX_RESULTS) / 10);
        const startIndex = page * 10;
        const pageResults = allResults.slice(startIndex, startIndex + 10);

        const embed = new EmbedBuilder()
          .setColor('#4285F4')
          .setTitle(`Search results for: "${query}"`)
          .setFooter({ text: `Page ${page + 1} of ${totalPages}` })
          .setTimestamp()
          .setDescription(
            pageResults
              .map(
                (result, index) =>
                  `**${startIndex + index + 1}. [${result.title}](${
                    result.link
                  })**\n${result.snippet.replace(/\n/g, ' ')}`
              )
              .join('\n\n') || 'No more results.'
          );

        const buttons = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId('prev_page')
            .setLabel('◀')
            .setStyle(ButtonStyle.Primary)
            .setDisabled(page === 0),
          new ButtonBuilder()
            .setCustomId('next_page')
            .setLabel('▶')
            .setStyle(ButtonStyle.Primary)
            .setDisabled(page === totalPages - 1)
        );

        return { embeds: [embed], components: totalPages > 1 ? [buttons] : [] };
      };

      const message = await interaction.editReply(generatePayload(currentPage));

      if (allResults.length <= 10) return;

      const collector = message.createMessageComponentCollector({
        componentType: ComponentType.Button,
        time: 90_000,
      });

      collector.on('collect', async (i) => {
        if (i.user.id !== interaction.user.id) {
          return i.reply({
            content: 'Only the command user can use these buttons.',
            flags: [MessageFlags.Ephemeral],
          });
        }
        await i.deferUpdate();
        const isNext = i.customId === 'next_page';
        currentPage += isNext ? 1 : -1;
        const needsFetch =
          isNext &&
          currentPage * 10 >= allResults.length &&
          allResults.length < MAX_RESULTS;
        if (needsFetch) {
          const newResults = await fetchGoogleResults(
            query,
            allResults.length + 1
          );
          if (newResults) {
            allResults.push(...newResults);
          }
        }
        await i.editReply(generatePayload(currentPage));
      });

      collector.on('end', () => {
        const finalPayload = generatePayload(currentPage);
        finalPayload.components.forEach((row) =>
          row.components.forEach((btn) => btn.setDisabled(true))
        );
        message.edit(finalPayload).catch(() => {});
      });
    } catch (error) {
      console.error('Error in Google command:', error.message);
      await interaction.editReply(
        'Sorry, there was an error performing the search.'
      );
    }
  },
};
