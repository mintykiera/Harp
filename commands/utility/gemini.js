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

const config = require('../../config.js');
const GEMINI_API_KEYS =
  config.geminiApiKeys?.split(',').map((key) => key.trim()) || [];
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

async function generateWithFallback(prompt, history = null) {
  for (const apiKey of GEMINI_API_KEYS) {
    const genAI = new GoogleGenerativeAI(apiKey);
    for (const modelName of GEMINI_MODELS) {
      try {
        const model = genAI.getGenerativeModel({
          model: modelName,
          generationConfig,
        });
        const chat = model.startChat({ history: history || [] });
        const result = await chat.sendMessage(prompt);
        return { response: result.response, chat, modelName };
      } catch (error) {
        console.warn(
          `Model ${modelName} with key ending in ${apiKey.slice(-4)} failed: ${
            error.message
          }`
        );
        if (error.message.includes('SAFETY')) {
          throw new Error('Response blocked due to safety settings.');
        }
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
      await Gemini.findOneAndDelete({ userId: user.id, channelId });
      return interaction.editReply({
        content:
          '✅ Your conversation has ended and its memory has been cleared.',
      });
    }

    const prompt = interaction.options.getString('prompt');

    try {
      const isNewChat = subcommand === 'start';
      const session = await Gemini.findOne({ userId: user.id, channelId });

      if (isNewChat && session) {
        return interaction.editReply(
          'You already have a conversation here. Use `/gemini reply` or `/gemini end`.'
        );
      }
      if (!isNewChat && !session) {
        return interaction.editReply(
          "You don't have an active conversation. Start one with `/gemini start`."
        );
      }

      const chatHistory =
        session?.history?.map((entry) => ({
          role: entry.role,
          parts: entry.parts.map((part) => ({ text: part.text })),
        })) || [];

      let title = session?.title || `> ${prompt.slice(0, 250)}...`;
      if (isNewChat) {
        try {
          const titlePrompt = `Generate a very short, 3-5 word title for this prompt. Return only the title text. Prompt: "${prompt}"`;
          const titleGen = await generateWithFallback(titlePrompt);
          const potentialTitle = titleGen.response
            .text()
            .trim()
            .replace(/["*]/g, '');
          if (potentialTitle) title = potentialTitle;
        } catch {
          console.warn('Failed to generate title. Using fallback.');
        }
      }

      const { response, chat, modelName } = await generateWithFallback(
        prompt,
        chatHistory
      );
      const responseText = response.text();

      if (!responseText) {
        return interaction.editReply({
          content: 'The AI returned an empty response.',
        });
      }

      const newHistory = await chat.getHistory();
      const updatedHistory = Array.isArray(newHistory)
        ? newHistory.map((entry) => ({
            role: entry.role,
            parts: entry.parts.map((part) => ({ text: part.text })),
          }))
        : [];

      if (isNewChat) {
        await Gemini.create({
          userId: user.id,
          channelId,
          title,
          history: updatedHistory,
        });
      } else {
        session.history = updatedHistory;
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
          .setFields(
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
      console.error('Gemini command error:', err);
      const failMsg = `Sorry, something went wrong. ${
        err.message.includes('SAFETY') ? err.message : 'Please try again later.'
      }`;
      await interaction.editReply({ content: failMsg });
    }
  },
};
