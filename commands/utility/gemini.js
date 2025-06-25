const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  MessageFlags,
} = require('discord.js');
const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const MODEL_NAME = 'gemini-2.5-flash';
const generationConfig = {
  temperature: 0.9,
  maxOutputTokens: 8192,
};
const chatSessions = new Map();

// --- REPLACED WITH THE FOOLPROOF SPLITTER ---
function splitText(text, { maxLength = 4096 } = {}) {
  if (text.length <= maxLength) return [text];

  const chunks = [];
  let currentChunk = '';

  // Split by newlines to keep paragraphs and list items together
  const lines = text.split('\n');

  for (const line of lines) {
    // If the current line itself is too long, we must split it by words
    if (line.length > maxLength) {
      const words = line.split(' ');
      for (const word of words) {
        if (currentChunk.length + word.length + 1 > maxLength) {
          chunks.push(currentChunk.trim());
          currentChunk = '';
        }
        currentChunk += `${word} `;
      }
    } else {
      // If adding the next line would make the chunk too long, push the current chunk
      if (currentChunk.length + line.length + 1 > maxLength) {
        chunks.push(currentChunk.trim());
        currentChunk = '';
      }
      currentChunk += `${line}\n`;
    }
  }

  // Push the final remaining chunk
  if (currentChunk.trim() !== '') {
    chunks.push(currentChunk.trim());
  }

  return chunks;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('gemini')
    .setDescription('Talk with the Gemini AI with conversation memory.')
    .addSubcommand((subcommand) =>
      subcommand
        .setName('start')
        .setDescription('Starts a new conversation with the AI.')
        .addStringOption((option) =>
          option
            .setName('prompt')
            .setDescription('The first message to start the conversation.')
            .setRequired(true)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('reply')
        .setDescription('Continues the conversation with the AI.')
        .addStringOption((option) =>
          option
            .setName('prompt')
            .setDescription('What you want to say.')
            .setRequired(true)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('end')
        .setDescription('Ends the current conversation and clears its memory.')
    ),

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();
    const user = interaction.user;

    if (subcommand === 'end') {
      if (chatSessions.has(user.id)) {
        chatSessions.delete(user.id);
        return interaction.reply(
          '✅ Your conversation has ended and its memory has been cleared.'
        );
      } else {
        return interaction.reply(
          "You don't have an active conversation to end."
        );
      }
    }

    const prompt = interaction.options.getString('prompt');
    await interaction.deferReply();

    try {
      let chat;
      let isNewChat = subcommand === 'start';

      if (isNewChat) {
        const model = genAI.getGenerativeModel({
          model: MODEL_NAME,
          generationConfig,
        });
        chat = model.startChat({ history: [] });
        chatSessions.set(user.id, chat);
      } else {
        if (!chatSessions.has(user.id)) {
          return interaction.editReply(
            "You don't have an active conversation. Please start one with `/gemini start <prompt>`."
          );
        }
        chat = chatSessions.get(user.id);
      }

      let title = `> ${prompt.slice(0, 250)}${
        prompt.length > 250 ? '...' : ''
      }`;

      try {
        // This block now runs for both 'start' and 'reply'
        const titleGenModel = genAI.getGenerativeModel({ model: MODEL_NAME });
        const titlePrompt = `Generate a very short, 3-5 word title for the following user prompt. Return only the title text, nothing else. Prompt: "${prompt}"`;
        const titleResult = await titleGenModel.generateContent(titlePrompt);
        const potentialTitle = titleResult.response
          .text()
          .trim()
          .replace(/["*]/g, ''); // Clean up any quotes or asterisks

        // If we got a valid title from the AI, use it.
        if (potentialTitle) {
          title = potentialTitle;
        }
      } catch (titleError) {
        console.log(
          'Could not generate AI title, using prompt as fallback. Error:',
          titleError
        );
      }

      const result = await chat.sendMessage(prompt);
      const response = await result.response;
      const text = response.text();

      if (!text) {
        return interaction.editReply(
          'The AI did not provide a response. This could be due to safety filters.'
        );
      }

      const attachments = [];
      const codeBlockRegex = /```([\s\S]*?)```/g;
      const largeCodeBlocks = text
        .match(codeBlockRegex)
        ?.filter((block) => block.length > 4000);

      if (largeCodeBlocks) {
        for (let i = 0; i < largeCodeBlocks.length; i++) {
          const block = largeCodeBlocks[i];
          // Remove the block from the main text to be sent in embeds
          text = text.replace(
            block,
            `\n[--- A large code block was sent as a file: code_block_${
              i + 1
            }.md ---]\n`
          );
          // Add it as a file attachment
          attachments.push(
            new AttachmentBuilder(Buffer.from(block), {
              name: `code_block_${i + 1}.md`,
            })
          );
        }
      }

      // This will now work correctly!
      const responseChunks = splitText(text);

      const temperatureToDisplay = generationConfig.temperature.toFixed(1);
      const tokenCount = response.usageMetadata?.totalTokenCount ?? 'N/A';
      const baseFooterText = `Model: ${MODEL_NAME} | Temp: ${temperatureToDisplay} | Tokens: ${tokenCount}`;

      let currentPage = 0;

      const generateEmbed = (page) => {
        return new EmbedBuilder()
          .setColor(isNewChat ? '#00FF00' : '#0099FF')
          .setTitle(title)
          .setAuthor({ name: user.username, iconURL: user.displayAvatarURL() })
          .setDescription(responseChunks[page])
          .setTimestamp()
          .setFooter({
            text: `${baseFooterText} | Page ${page + 1}/${
              responseChunks.length
            }`,
          });
      };

      const generateButtons = (page) => {
        return new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId('prev_page')
            .setLabel('⬅️ Previous')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(page === 0),
          new ButtonBuilder()
            .setCustomId('next_page')
            .setLabel('Next ➡️')
            .setStyle(ButtonStyle.Primary)
            .setDisabled(page === responseChunks.length - 1)
        );
      };

      const initialEmbed = generateEmbed(currentPage);
      const initialComponents =
        responseChunks.length > 1 ? [generateButtons(currentPage)] : [];

      initialEmbed.addFields({
        name: 'Your Prompt',
        value: `> ${prompt.slice(0, 1020)}`,
      });

      const message = await interaction.editReply({
        embeds: [initialEmbed],
        components: initialComponents,
      });

      // The rest of your pagination logic is perfect and will now be triggered correctly.
      if (responseChunks.length <= 1) return;

      const collector = message.createMessageComponentCollector({
        componentType: ComponentType.Button,
        time: 300000,
      });

      collector.on('collect', async (i) => {
        if (i.user.id !== interaction.user.id) {
          return i.reply({
            content: 'Only the person who ran the command can change pages.',
            flags: [MessageFlags.Ephemeral],
          });
        }

        if (i.customId === 'prev_page') currentPage--;
        else if (i.customId === 'next_page') currentPage++;

        await i.update({
          embeds: [generateEmbed(currentPage)],
          components: [generateButtons(currentPage)],
        });
      });

      collector.on('end', () => {
        const finalEmbed = generateEmbed(currentPage);
        const finalComponents = generateButtons(currentPage).components.map(
          (button) => button.setDisabled(true)
        );
        message
          .edit({
            embeds: [finalEmbed],
            components: [new ActionRowBuilder().addComponents(finalComponents)],
          })
          .catch(() => {});
      });
    } catch (error) {
      // ... (Your error handling is perfect) ...
      console.error('Error with Gemini API:', error);
      const status = error.status || error.code;
      let errorMessage =
        'Sorry, something went wrong while talking to the AI. Please try again later.';

      if (status === 503) {
        errorMessage =
          "I'm sorry, the AI service is currently very busy. Please try again in a few moments.";
      } else if (status === 429) {
        errorMessage =
          'Whoa, slow down! The bot has hit its rate limit with the AI. Please try again in a minute.';
      }

      if (interaction.replied || interaction.deferred) {
        await interaction.editReply(errorMessage);
      } else {
        await interaction.reply({
          content: errorMessage,
          flags: [MessageFlags.Ephemeral],
        });
      }
    }
  },
};
