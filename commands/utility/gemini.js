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
  'gemini-1.5-flash-latest', // Preferred model first
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

async function generateWithFallback(prompt, history = null) {
  for (const apiKey of GEMINI_API_KEYS) {
    const genAI = new GoogleGenerativeAI(apiKey);
    for (const modelName of GEMINI_MODELS) {
      try {
        const model = genAI.getGenerativeModel({
          model: modelName,
          generationConfig,
        });

        if (!history || history.length === 0) {
          const result = await model.generateContent(prompt);
          return { response: result.response, chat: null, modelName, apiKey };
        } else {
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
        // If it's a safety error, stop trying other models as it's content-related
        if (error.message.includes('SAFETY')) {
          throw new Error(
            'The response was blocked due to safety settings. Please rephrase your prompt.'
          );
        }
      }
    }
  }

  throw new Error('All Gemini keys and models failed to generate a response.');
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
        ephemeral: true,
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
            'You already have an active conversation here. Use `/gemini reply` or end it with `/gemini end`.'
          );
        }
      } else {
        // This is the 'reply' subcommand
        session = await Gemini.findOne({ userId: user.id, channelId });
        if (!session) {
          return interaction.editReply(
            "You don't have an active conversation to reply to. Start one with `/gemini start`."
          );
        }
      }

      // ========================== THE FIX IS HERE ==========================
      // Manually construct a "clean" history object to pass to the API.
      // This prevents any extra Mongoose fields from causing issues.
      const chatHistory = session
        ? session.history.map((h) => ({
            role: h.role,
            // Ensure the 'parts' array is also clean
            parts: h.parts.map((p) => ({ text: p.text })),
          }))
        : [];
      // =====================================================================

      let title = session
        ? session.title
        : `> ${prompt.slice(0, 250)}${prompt.length > 250 ? '...' : ''}`;

      if (isNewChat) {
        try {
          const titlePrompt = `Generate a very short, 3-5 word title for this prompt. Return only the title text, nothing else. Prompt: "${prompt}"`;
          const titleResult = await generateWithFallback(titlePrompt, null); // No history for title gen
          const potentialTitle = titleResult.response
            .text()
            .trim()
            .replace(/["*]/g, '');
          if (potentialTitle) title = potentialTitle;
        } catch {
          console.warn('Failed to generate title. Using fallback.');
        }
      }

      const {
        response,
        chat: updatedChat, // This will be null for a new chat, and a chat object for a reply
        modelName,
      } = await generateWithFallback(prompt, chatHistory);

      const responseText = response.text();
      if (!responseText) {
        return interaction.editReply({
          content: 'The AI returned an empty response. Please try again.',
        });
      }

      if (isNewChat) {
        // For a new chat, we manually construct the history and create the document.
        const newHistory = [
          { role: 'user', parts: [{ text: prompt }] },
          { role: 'model', parts: [{ text: responseText }] },
        ];
        await Gemini.create({
          userId: user.id,
          channelId,
          title,
          history: newHistory,
        });
      } else {
        // For a reply, the `updatedChat` object will exist. We get its full history and save it.
        // The Google AI SDK automatically includes the new user prompt and model response.
        session.history = updatedChat.getHistory();
        await session.save();
      }

      const chunks = splitText(responseText);
      let currentPage = 0;

      const footerInfo = `Model: ${modelName} | Temp: ${generationConfig.temperature}`;

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
              ? { name: 'Your Prompt', value: `> ${prompt.slice(0, 1020)}...` }
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
            content: 'Only the original user can navigate this response.',
            ephemeral: true,
          });
        }
        currentPage += i.customId === 'next_page' ? 1 : -1;
        await i.update({
          embeds: [generateEmbed(currentPage)],
          components: [generateButtons(currentPage)],
        });
      });

      collector.on('end', () => {
        message.edit({ components: [] }).catch(() => {});
      });
    } catch (err) {
      console.error('Gemini command error:', err); // Better logging
      const failMsg = `Sorry, something went wrong. ${
        err.message.includes('SAFETY') ? err.message : 'Please try again later.'
      }`;
      await interaction
        .editReply({ content: failMsg })
        .catch(() => interaction.reply({ content: failMsg, ephemeral: true }));
    }
  },
};
