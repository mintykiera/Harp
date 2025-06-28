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
const Gemini = require('../../models/Gemini');
require('dotenv').config();

const GEMINI_API_KEYS =
  process.env.GEMINI_API_KEYS?.split(',').map((key) => key.trim()) || [];
const GEMINI_MODELS = [
  'gemini-2.5-flash',
  'gemini-1.5-flash-latest',
  'gemini-1.5-pro-latest',
  'gemini-pro',
];
const generationConfig = { temperature: 0.9, maxOutputTokens: 8192 };

function splitText(text, { maxLength = 4096 } = {}) {
  if (text.length <= maxLength) return [text];
  const chunks = [];
  const lines = text.split('\n');
  let currentChunk = '';
  for (const line of lines) {
    if (currentChunk.length + line.length + 1 > maxLength) {
      chunks.push(currentChunk.trim());
      currentChunk = '';
    }
    currentChunk += line + '\n';
  }
  if (currentChunk.trim()) chunks.push(currentChunk.trim());
  return chunks;
}

// Corrected generateWithFallback function
async function generateWithFallback(prompt, history = null) {
  // Changed default to null
  for (const apiKey of GEMINI_API_KEYS) {
    const genAI = new GoogleGenerativeAI(apiKey);
    for (const modelName of GEMINI_MODELS) {
      try {
        const model = genAI.getGenerativeModel({
          model: modelName,
          generationConfig,
        });

        // Use model.generateContent if no history is provided or if history is an empty array.
        // This is for single-turn prompts (like title generation) or the very first message of a new chat.
        if (
          history === null ||
          (Array.isArray(history) && history.length === 0)
        ) {
          const result = await model.generateContent({
            contents: [{ role: 'user', parts: [{ text: prompt }] }], // Explicitly define user role and parts
          });
          return { response: result.response, modelName, apiKey };
        } else {
          // Otherwise, start a chat with the provided history for multi-turn conversations.
          const chat = model.startChat({ history });
          const result = await chat.sendMessage(prompt);
          return { response: result.response, chat, modelName, apiKey };
        }
      } catch (error) {
        console.warn(
          `Failed on model ${modelName} with key ending in ...${apiKey.slice(
            -5
          )}: ${error.message}`
        );
      }
    }
  }

  throw new Error('All Gemini keys and models failed.');
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('gemini')
    .setDescription('Talk with Gemini AI with persistent conversation memory.')
    .addSubcommand((sub) =>
      sub
        .setName('start')
        .setDescription('Starts a new conversation.')
        .addStringOption((opt) =>
          opt
            .setName('prompt')
            .setDescription('The first message.')
            .setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('reply')
        .setDescription('Continues the conversation in this channel.')
        .addStringOption((opt) =>
          opt
            .setName('prompt')
            .setDescription('What you want to say.')
            .setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('end')
        .setDescription('Ends the current conversation in this channel.')
    ),

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();
    const user = interaction.user;
    const channelId = interaction.channelId;

    if (subcommand === 'end') {
      const deletedSession = await Gemini.findOneAndDelete({
        userId: user.id,
        channelId,
      });
      return interaction.reply({
        content: deletedSession
          ? '✅ Your conversation has ended and its memory has been cleared.'
          : "You don't have an active conversation to end.",
        flags: [MessageFlags.Ephemeral],
      });
    }

    const prompt = interaction.options.getString('prompt');
    await interaction.deferReply();

    try {
      let session;
      const isNewChat = subcommand === 'start';

      if (isNewChat) {
        session = await Gemini.findOne({ userId: user.id, channelId });
        if (session) {
          return interaction.editReply(
            'You already have a conversation here. Use `/gemini reply` or `/gemini end`.'
          );
        }
      } else {
        session = await Gemini.findOne({ userId: user.id, channelId });
        if (!session) {
          return interaction.editReply(
            "You don't have an active conversation. Start one with `/gemini start`."
          );
        }
      }

      const chatHistory = session
        ? session.history.map((entry) => {
            // Mongoose subdocuments can be tricky. Use toObject() if available.
            const entryObj = entry.toObject ? entry.toObject() : entry;

            // Clean the parts array first
            const cleanedParts = [];
            if (entryObj.parts && Array.isArray(entryObj.parts)) {
              for (const part of entryObj.parts) {
                const partObj = part.toObject ? part.toObject() : part;
                const { _id, __v, ...restOfPart } = partObj; // Destructure to exclude _id and __v
                cleanedParts.push(restOfPart);
              }
            }

            // Clean the overall history entry object itself
            const { _id, __v, ...restOfEntry } = entryObj; // Destructure to exclude _id and __v
            return { ...restOfEntry, parts: cleanedParts }; // Return the cleaned entry with its cleaned parts
          })
        : [];
      let title = session
        ? session.title
        : `> ${prompt.slice(0, 250)}${prompt.length > 250 ? '...' : ''}`;

      if (isNewChat) {
        try {
          const titlePrompt = `Generate a very short, 3-5 word title for this prompt. Return only the title text. Prompt: "${prompt}"`;
          // Explicitly pass null for history for this one-off title generation
          const titleResult = await generateWithFallback(titlePrompt, null);
          const potentialTitle = titleResult.response
            .text()
            .trim()
            .replace(/["*]/g, '');
          if (potentialTitle) title = potentialTitle;
        } catch {
          console.log('Failed to generate title. Using fallback.');
        }
      }

      // This call to generateWithFallback will now correctly use model.generateContent if chatHistory is empty,
      // or model.startChat if chatHistory has existing entries.
      const {
        response,
        chat: updatedChat,
        modelName,
      } = await generateWithFallback(prompt, chatHistory);

      if (isNewChat) {
        await Gemini.create({
          userId: user.id,
          channelId,
          title,
          // If updatedChat is null here, it means generateContent was used directly.
          // In that case, we need to manually create the history entry for the first turn.
          history: updatedChat
            ? updatedChat.getHistory()
            : [
                { role: 'user', parts: [{ text: prompt }] },
                { role: 'model', parts: [{ text: response.text() }] },
              ],
        });
      } else {
        // updatedChat will always be present if history was not null/empty for a reply
        session.history = updatedChat.getHistory();
        await session.save();
      }

      const text = response.text();
      if (!text)
        return interaction.editReply('The AI did not respond with text.');

      const chunks = splitText(text);
      let currentPage = 0;

      const footerInfo = `Model: ${modelName} | Temp: ${
        generationConfig.temperature
      } | Tokens: ${response.usageMetadata?.totalTokenCount || 'N/A'}`;

      const generateEmbed = (page) =>
        new EmbedBuilder()
          .setColor(isNewChat ? '#00FF00' : '#0099FF')
          .setTitle(title)
          .setAuthor({ name: user.username, iconURL: user.displayAvatarURL() })
          .setDescription(chunks[page])
          .setTimestamp()
          .setFooter({
            text: `${footerInfo} | Page ${page + 1}/${chunks.length}`,
          })
          .addFields(
            page === 0
              ? { name: 'Your Prompt', value: `> ${prompt.slice(0, 1020)}` }
              : []
          );

      const generateButtons = (page) =>
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId('prev_page')
            .setLabel('⬅️')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(page === 0),
          new ButtonBuilder()
            .setCustomId('next_page')
            .setLabel('➡️')
            .setStyle(ButtonStyle.Primary)
            .setDisabled(page === chunks.length - 1)
        );

      const message = await interaction.editReply({
        embeds: [generateEmbed(currentPage)],
        components: chunks.length > 1 ? [generateButtons(currentPage)] : [],
      });

      if (chunks.length <= 1) return;

      const collector = message.createMessageComponentCollector({
        componentType: ComponentType.Button,
        time: 5 * 60 * 1000,
      });

      collector.on('collect', async (i) => {
        if (i.user.id !== interaction.user.id) {
          return i.reply({
            content: 'Only the original user can navigate this conversation.',
            flags: [MessageFlags.Ephemeral],
          });
        }
        currentPage += i.customId === 'next_page' ? 1 : -1;
        await i.update({
          embeds: [generateEmbed(currentPage)],
          components: [generateButtons(currentPage)],
        });
      });

      collector.on('end', () => {
        const disabledRow = new ActionRowBuilder().addComponents(
          generateButtons(currentPage).components.map((btn) =>
            btn.setDisabled(true)
          )
        );
        message
          .edit({
            embeds: [generateEmbed(currentPage)],
            components: [disabledRow],
          })
          .catch(() => {});
      });
    } catch (err) {
      console.error('Gemini API error:', err);
      const failMsg = 'Sorry, something went wrong. Please try again later.';
      await interaction.editReply(failMsg).catch(() =>
        interaction.reply({
          content: failMsg,
          flags: [MessageFlags.Ephemeral],
        })
      );
    }
  },
};
