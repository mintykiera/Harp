const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  MessageFlags,
  AttachmentBuilder, // --- ADDED: Make sure this is imported ---
} = require('discord.js');
const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const chatSessions = new Map();

// --- NEW: A list of models to try, in order of preference ---
const GEMINI_MODELS = [
  'gemini-2.5-flash',
  'gemini-1.5-flash-latest', // Preferred, new and fast
  'gemini-1.5-pro-latest',
  'gemini-pro',
];

const generationConfig = {
  temperature: 0.9,
  maxOutputTokens: 8192,
};

// --- NEW: A robust function to generate content with model fallbacks ---
async function generateWithFallback(prompt, history = []) {
  for (const modelName of GEMINI_MODELS) {
    try {
      const model = genAI.getGenerativeModel({
        model: modelName,
        generationConfig,
      });

      let response;
      let chat = null; // We only need to return the chat object for conversations

      // If history is provided, it's a conversational chat
      if (history.length > 0) {
        chat = model.startChat({ history });
        const result = await chat.sendMessage(prompt);
        response = result.response;
      } else {
        // Otherwise, it's a one-off generation (like for the title)
        const result = await model.generateContent(prompt);
        response = result.response;
      }

      // If we get a successful response, return everything we need and stop trying.
      console.log(`Successfully generated content with model: ${modelName}`);
      return { response, chat, modelName };
    } catch (error) {
      console.warn(
        `Model ${modelName} failed. Trying next model. Error:`,
        error.message
      );
    }
  }

  throw new Error('All available Gemini models failed to generate a response.');
}

function splitText(text, { maxLength = 4096 } = {}) {
  if (text.length <= maxLength) return [text];
  const chunks = [];
  let currentChunk = '';
  const lines = text.split('\n');
  for (const line of lines) {
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
      if (currentChunk.length + line.length + 1 > maxLength) {
        chunks.push(currentChunk.trim());
        currentChunk = '';
      }
      currentChunk += `${line}\n`;
    }
  }
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
        return interaction.reply({
          content:
            '✅ Your conversation has ended and its memory has been cleared.',
          flags: [MessageFlags.Ephemeral],
        });
      } else {
        return interaction.reply({
          content: "You don't have an active conversation to end.",
          flags: [MessageFlags.Ephemeral],
        });
      }
    }

    const prompt = interaction.options.getString('prompt');
    await interaction.deferReply();

    try {
      let chatHistory = [];
      const isNewChat = subcommand === 'start';

      if (!isNewChat) {
        if (!chatSessions.has(user.id)) {
          return interaction.editReply(
            "You don't have an active conversation. Please start one with `/gemini start <prompt>`."
          );
        }
        // Get the history from the existing session to pass to the fallback function
        chatHistory = (await chatSessions.get(user.id).getHistory()) || [];
      }

      let title = `> ${prompt.slice(0, 250)}${
        prompt.length > 250 ? '...' : ''
      }`;

      try {
        const titlePrompt = `Generate a very short, 3-5 word title for the following user prompt. Return only the title text, nothing else. Prompt: "${prompt}"`;
        const titleResult = await generateWithFallback(titlePrompt);
        const potentialTitle = titleResult.response
          .text()
          .trim()
          .replace(/["*]/g, '');

        if (potentialTitle) {
          title = potentialTitle;
        }
      } catch (titleError) {
        console.log(
          'Could not generate AI title, using prompt as fallback. Error:',
          titleError.message
        );
      }

      // --- MODIFIED: Use the fallback function to get the main response ---
      const {
        response,
        chat: updatedChat,
        modelName,
      } = await generateWithFallback(prompt, chatHistory);

      // If it was a conversation, save the updated chat session
      if (updatedChat) {
        chatSessions.set(user.id, updatedChat);
      }

      const text = response.text();

      if (!text) {
        return interaction.editReply(
          'The AI did not provide a response. This could be due to safety filters.'
        );
      }

      const attachments = [];
      const codeBlockRegex = /```([\s\S]*?)```/g;
      let processedText = text;
      const largeCodeBlocks = processedText
        .match(codeBlockRegex)
        ?.filter((block) => block.length > 4000);

      if (largeCodeBlocks) {
        for (let i = 0; i < largeCodeBlocks.length; i++) {
          const block = largeCodeBlocks[i];
          processedText = processedText.replace(
            block,
            `\n[--- A large code block was sent as a file: code_block_${
              i + 1
            }.md ---]\n`
          );
          attachments.push(
            new AttachmentBuilder(Buffer.from(block), {
              name: `code_block_${i + 1}.md`,
            })
          );
        }
      }

      const responseChunks = splitText(processedText);

      const temperatureToDisplay = generationConfig.temperature.toFixed(1);
      const tokenCount = response.usageMetadata?.totalTokenCount ?? 'N/A';
      // --- MODIFIED: Use the actual model name that succeeded ---
      const baseFooterText = `Model: ${modelName} | Temp: ${temperatureToDisplay} | Tokens: ${tokenCount}`;

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

      await interaction.editReply({
        embeds: [initialEmbed],
        components: initialComponents,
        files: attachments,
      });

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
      console.error('Error with Gemini API:', error);
      const status = error.status || error.code;
      let errorMessage =
        'Sorry, all available AI models failed to respond. Please try again later.';

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
