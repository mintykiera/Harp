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

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const GEMINI_MODELS = [
  'gemini-1.5-flash-latest',
  'gemini-1.5-pro-latest',
  'gemini-pro',
];
const generationConfig = { temperature: 0.9, maxOutputTokens: 8192 };

async function generateWithFallback(prompt, history = []) {
  for (const modelName of GEMINI_MODELS) {
    try {
      const model = genAI.getGenerativeModel({
        model: modelName,
        generationConfig,
      });
      if (!Array.isArray(history)) {
        const result = await model.generateContent(prompt);
        return { response: result.response };
      }
      const chat = model.startChat({ history });
      const result = await chat.sendMessage(prompt);
      return { response: result.response, chat, modelName };
    } catch (error) {
      console.warn(`Model ${modelName} failed: ${error.message}`);
    }
  }
  throw new Error('All Gemini models failed.');
}

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
  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim());
  }
  return chunks;
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
      if (deletedSession) {
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

      const chatHistory = session ? session.history : [];
      let title = session
        ? session.title
        : `> ${prompt.slice(0, 250)}${prompt.length > 250 ? '...' : ''}`;

      if (isNewChat) {
        try {
          const titlePrompt = `Generate a very short, 3-5 word title for this prompt. Return only the title text. Prompt: "${prompt}"`;
          const titleResult = await generateWithFallback(titlePrompt);
          const potentialTitle = titleResult.response
            .text()
            .trim()
            .replace(/["*]/g, '');
          if (potentialTitle) title = potentialTitle;
        } catch (titleError) {
          console.log('Could not generate AI title, using prompt as fallback.');
        }
      }

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
          history: updatedChat.getHistory(),
        });
      } else {
        session.history = updatedChat.getHistory();
        await session.save();
      }

      const text = response.text();
      if (!text) {
        return interaction.editReply('The AI did not provide a text response.');
      }

      const responseChunks = splitText(text);
      const baseFooterText = `Model: ${modelName} | Temp: ${generationConfig.temperature.toFixed(
        1
      )} | Tokens: ${response.usageMetadata?.totalTokenCount ?? 'N/A'}`;
      let currentPage = 0;

      const generateEmbed = (page) =>
        new EmbedBuilder()
          .setColor(isNewChat ? '#00FF00' : '#0099FF')
          .setTitle(title)
          .setAuthor({ name: user.username, iconURL: user.displayAvatarURL() })
          .setDescription(responseChunks[page])
          .setTimestamp()
          .setFooter({
            text: `${baseFooterText} | Page ${page + 1}/${
              responseChunks.length
            }`,
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
            .setDisabled(page === responseChunks.length - 1)
        );

      const message = await interaction.editReply({
        embeds: [generateEmbed(currentPage)],
        components:
          responseChunks.length > 1 ? [generateButtons(currentPage)] : [],
      });

      if (responseChunks.length <= 1) return;

      const collector = message.createMessageComponentCollector({
        componentType: ComponentType.Button,
        time: 300000,
      });
      collector.on('collect', async (i) => {
        if (i.user.id !== interaction.user.id) {
          return i.reply({
            content: 'Only the command user can change pages.',
            flags: [MessageFlags.Ephemeral],
          });
        }
        i.customId === 'prev_page' ? currentPage-- : currentPage++;
        await i.update({
          embeds: [generateEmbed(currentPage)],
          components: [generateButtons(currentPage)],
        });
      });

      collector.on('end', () => {
        const finalComponents = generateButtons(currentPage).components.map(
          (b) => b.setDisabled(true)
        );
        message
          .edit({
            embeds: [generateEmbed(currentPage)],
            components: [new ActionRowBuilder().addComponents(finalComponents)],
          })
          .catch(() => {});
      });
    } catch (error) {
      console.error('Error with Gemini API:', error);
      const errorMessage =
        'Sorry, an error occurred while contacting the AI. Please try again later.';
      await interaction
        .editReply(errorMessage)
        .catch(() =>
          interaction.reply({
            content: errorMessage,
            flags: [MessageFlags.Ephemeral],
          })
        );
    }
  },
};
