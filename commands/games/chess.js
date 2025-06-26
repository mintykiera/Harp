const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} = require('discord.js');
const { Chess } = require('chess.js');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const activePlayers = new Set();
const activeGames = new Map();
const stockfishFile = os.platform() === 'win32' ? 'stockfish.exe' : 'stockfish';
const stockfishPath = path.join(process.cwd(), stockfishFile);
const difficultyLevels = {
  rookie: 1,
  intermediate: 5,
  experienced: 10,
  professional: 15,
  grandmaster: 20,
};
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function getBoardImageUrl(fen) {
  const boardOnly = fen.split(' ')[0];
  return `https://chessboardimage.com/${boardOnly}.png?theme=wood`;
}

function isChessMove(str) {
  const chessMoveRegex =
    /^(?:[NBRQK]?[a-h]?[1-8]?x?[a-h][1-8](?:=[NBRQK])?|[O-O](?:-O)?)[+#]?$/i;
  return chessMoveRegex.test(str);
}

function formatLastMove(game) {
  const history = game.history({ verbose: true });
  if (history.length === 0) {
    return 'None';
  }

  // Get the last move
  const lastMove = history[history.length - 1];

  // If it was white's move, we have a full pair
  if (lastMove.color === 'w' && history.length > 1) {
    const whiteMove = history[history.length - 2];
    const blackMove = lastMove;
    return `${whiteMove.lan.split('.')[0]}. ${whiteMove.san} ${blackMove.san}`;
  }

  // If it's the first move or an odd number of moves, just show white's move
  return `${lastMove.lan.split('.')[0]}. ${lastMove.san}`;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('chess')
    .setDescription('Start a game of chess against the bot or another player.')
    .addUserOption((option) =>
      option
        .setName('opponent')
        .setDescription('Select a player to challenge to a match.')
        .setRequired(false)
    )
    .addStringOption((option) =>
      option
        .setName('difficulty')
        .setDescription('If playing the bot, choose its difficulty.')
        .setRequired(false)
        .addChoices(
          { name: 'Rookie', value: 'rookie' },
          { name: 'Intermediate', value: 'intermediate' },
          { name: 'Experienced', value: 'experienced' },
          { name: 'Professional', value: 'professional' },
          { name: 'Grandmaster', value: 'grandmaster' }
        )
    )
    .addStringOption((option) =>
      option
        .setName('color')
        .setDescription('Choose which color you want to play as.')
        .setRequired(false)
        .addChoices(
          { name: 'White', value: 'white' },
          { name: 'Black', value: 'black' },
          { name: 'Random', value: 'random' }
        )
    ),

  async execute(interaction) {
    if (activeGames.has(interaction.channelId)) {
      return interaction.reply({
        content: 'A game is already in progress in this channel!',
        flags: [MessageFlags.Ephemeral],
      });
    }
    if (activePlayers.has(interaction.user.id)) {
      return interaction.reply({
        content: 'You are already in a game in another channel!',
        flags: [MessageFlags.Ephemeral],
      });
    }

    const challenger = interaction.user;
    const opponent = interaction.options.getUser('opponent');
    const difficulty = interaction.options.getString('difficulty');

    if (opponent && difficulty) {
      return interaction.reply({
        content:
          'You cannot select a difficulty when challenging a player. Please choose one or the other.',
        flags: [MessageFlags.Ephemeral],
      });
    }

    if (opponent) {
      if (opponent.bot) {
        return interaction.reply({
          content: "You can't challenge a bot.",
          flags: [MessageFlags.Ephemeral],
        });
      }
      if (opponent.id === challenger.id) {
        return interaction.reply({
          content: "You can't challenge yourself!",
          flags: [MessageFlags.Ephemeral],
        });
      }
      if (activePlayers.has(opponent.id)) {
        return interaction.reply({
          content: `${opponent.username} is already in a game!`,
          flags: [MessageFlags.Ephemeral],
        });
      }

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('accept_chess')
          .setLabel('Accept')
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId('decline_chess')
          .setLabel('Decline')
          .setStyle(ButtonStyle.Danger)
      );

      await interaction.reply({
        content: `${opponent}`,
        embeds: [
          new EmbedBuilder()
            .setTitle('♟️ Chess Challenge!')
            .setDescription(
              `${opponent}, you have been challenged by ${challenger}.`
            )
            .setColor('#744c2c'),
        ],
        components: [row],
      });

      try {
        const response = await interaction.channel.awaitMessageComponent({
          filter: (i) =>
            i.user.id === opponent.id &&
            (i.customId === 'accept_chess' || i.customId === 'decline_chess'),
          time: 60000,
        });

        if (response.customId === 'decline_chess') {
          return response.update({
            content: 'The challenge was declined.',
            embeds: [],
            components: [],
          });
        }

        await response.deferUpdate();
        startGame(interaction, 'pvp', { challenger, opponent });
      } catch (err) {
        try {
          await interaction.editReply({
            content: 'The challenge expired.',
            embeds: [],
            components: [],
          });
        } catch (error) {
          if (error.code !== 10008)
            console.error('Error editing expired challenge:', error);
        }
      }
    } else {
      if (!difficulty) {
        return interaction.reply({
          content: 'You must select a difficulty when playing against the bot.',
          flags: [MessageFlags.Ephemeral],
        });
      }
      if (!stockfishPath || !fs.existsSync(stockfishPath)) {
        console.error(
          `FATAL: stockfish.exe not found at path: ${stockfishPath}`
        );
        return interaction.reply({
          content: 'Error: The chess engine is not configured correctly.',
          flags: [MessageFlags.Ephemeral],
        });
      }

      await interaction.deferReply();
      startGame(interaction, 'pve', { difficulty });
    }
  },
};

async function startGame(interaction, gameType, options) {
  const channelId = interaction.channelId;
  const game = new Chess();
  const chosenColor = interaction.options.getString('color') || 'random';

  let gameData = {
    game,
    gameType,
    // --- CHANGE: Use the new formatting function here as well ---
    lastMove: formatLastMove(game),
    playerWhite: null,
    playerBlack: null,
  };

  if (gameType === 'pvp') {
    const { challenger, opponent } = options;
    if (chosenColor === 'white')
      [gameData.playerWhite, gameData.playerBlack] = [challenger, opponent];
    else if (chosenColor === 'black')
      [gameData.playerWhite, gameData.playerBlack] = [opponent, challenger];
    else
      [gameData.playerWhite, gameData.playerBlack] =
        Math.random() > 0.5 ? [challenger, opponent] : [opponent, challenger];

    activePlayers.add(challenger.id);
    activePlayers.add(opponent.id);
  } else {
    // PVE
    const player = interaction.user;
    const botUser = {
      username: `Bot (${options.difficulty})`,
      id: interaction.client.user.id,
    };
    if (chosenColor === 'white')
      [gameData.playerWhite, gameData.playerBlack] = [player, botUser];
    else if (chosenColor === 'black')
      [gameData.playerWhite, gameData.playerBlack] = [botUser, player];
    else
      [gameData.playerWhite, gameData.playerBlack] =
        Math.random() > 0.5 ? [player, botUser] : [botUser, player];

    activePlayers.add(player.id);

    gameData.engine = spawn(stockfishPath);

    // --- CHANGE: Remove the noisy debug listener ---
    // gameData.engine.stdout.on('data', (data) => {
    //   console.log(`[DEBUG] Stockfish says: ${data}`);
    // });

    gameData.engine.stdin.write('uci\n');
    gameData.engine.stdin.write(
      `setoption name Skill Level value ${
        difficultyLevels[options.difficulty]
      }\n`
    );
    gameData.engine.on('error', (err) =>
      console.error('Stockfish engine error:', err)
    );
  }

  activeGames.set(channelId, gameData);

  const createEmbed = (endReason = null) => {
    const turn = game.turn();
    const currentPlayer =
      turn === 'w' ? gameData.playerWhite : gameData.playerBlack;
    let description, status;

    if (endReason) {
      const winner = turn === 'w' ? gameData.playerBlack : gameData.playerWhite;
      switch (endReason) {
        case 'checkmate':
          description = `**Checkmate!** ${winner.username} wins.`;
          status = 'Checkmate!';
          break;
        case 'stalemate':
          description = '**Stalemate!** The game is a draw.';
          status = 'Draw';
          break;
        case 'repetition':
          description = '**Draw** by threefold repetition.';
          status = 'Draw';
          break;
        case 'draw_accepted':
          description = '**Game drawn by agreement.**';
          status = 'Draw';
          break;
        case 'insufficient':
          description = '**Draw** due to insufficient material.';
          status = 'Draw';
          break;
        case 'idle':
          description = '**Game ended due to inactivity.**';
          status = 'Timed Out';
          break;
        default:
          description = `**${endReason} has resigned.** ${winner.username} wins!`;
          status = 'Resigned';
      }
    } else {
      description = `It's **${currentPlayer.username}**'s turn (${
        turn === 'w' ? 'White' : 'Black'
      }).\nMake a move (e.g., \`e4\`), or type \`resign\`, \`draw\`, or \`takeback\`.`;
      status = game.inCheck() ? 'Check!' : 'In Progress';
    }

    return new EmbedBuilder()
      .setColor('#744c2c')
      .setTitle(
        `${gameData.playerWhite.username} (White) vs. ${gameData.playerBlack.username} (Black)`
      )
      .setDescription(description)
      .setImage(getBoardImageUrl(game.fen()))
      .addFields(
        { name: 'Last Move', value: gameData.lastMove, inline: true },
        { name: 'Status', value: status, inline: true }
      )
      .setFooter({ text: `FEN: ${game.fen()}` });
  };

  await wait(2000);

  if (gameType === 'pvp') {
    await interaction.editReply({
      content: `Game started! ${gameData.playerWhite.username} is White.`,
      embeds: [createEmbed()],
      components: [],
    });
  } else {
    await interaction.editReply({ embeds: [createEmbed()] });
  }

  const makeBotMove = () => {
    return new Promise((resolve) => {
      gameData.engine.stdin.write(`position fen ${game.fen()}\n`);
      gameData.engine.stdin.write(`go movetime 1500\n`);

      const onData = (data) => {
        const lines = data.toString().split('\n');
        const bestMoveLine = lines.find((line) => line.startsWith('bestmove'));
        if (bestMoveLine) {
          const bestMove = bestMoveLine.split(' ')[1];
          if (bestMove && bestMove !== '(none)') {
            // --- CHANGE: Log the best move clearly ---
            console.log(`Stockfish calculated best move: ${bestMove}`);
            game.move(bestMove, { sloppy: true });
            // --- CHANGE: Use the new formatting function ---
            gameData.lastMove = formatLastMove(game);
          }
          gameData.engine.stdout.removeListener('data', onData);
          resolve();
        }
      };
      gameData.engine.stdout.on('data', onData);
    });
  };

  if (
    gameType === 'pve' &&
    game.turn() === 'w' &&
    gameData.playerWhite.id === interaction.client.user.id
  ) {
    await makeBotMove();
    await wait(2000);
    await interaction.editReply({
      embeds: [createEmbed(game.isGameOver() ? 'checkmate' : null)],
    });
  }

  const messageCollector = interaction.channel.createMessageCollector({
    filter: (m) => !m.author.bot && activePlayers.has(m.author.id),
    time: 900000,
  });

  messageCollector.on('collect', async (message) => {
    const turn = game.turn();
    const currentPlayer =
      turn === 'w' ? gameData.playerWhite : gameData.playerBlack;
    if (message.author.id !== currentPlayer.id) return;

    const userInput = message.content.trim();
    const command = userInput.toLowerCase();

    if (
      command === 'resign' ||
      command === 'draw' ||
      command === 'takeback' ||
      isChessMove(userInput)
    ) {
      if (message.deletable) await message.delete().catch(() => {});
    }

    if (command === 'resign')
      return messageCollector.stop(message.author.username);

    if (command === 'draw') {
      if (gameType === 'pve') {
        return interaction.followUp({
          content: 'The bot declines your draw offer. The fight must continue!',
          flags: [MessageFlags.Ephemeral],
        });
      }
      const opponent =
        player.id === gameData.playerWhite.id
          ? gameData.playerBlack
          : gameData.playerWhite;
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('accept_draw')
          .setLabel('Accept Draw')
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId('decline_draw')
          .setLabel('Decline')
          .setStyle(ButtonStyle.Danger)
      );
      const msg = await interaction.followUp({
        content: `${opponent}, ${message.author.username} offers a draw.`,
        components: [row],
      });
      try {
        const res = await msg.awaitMessageComponent({
          filter: (i) => i.user.id === opponent.id,
          time: 60000,
        });
        if (res.customId === 'accept_draw') {
          messageCollector.stop('draw_accepted');
        } else {
          await res.update({ content: 'Draw offer declined.', components: [] });
        }
      } catch (err) {
        await msg.edit({ content: 'Draw offer expired.', components: [] });
      }
      return;
    }

    if (command === 'takeback') {
      if (gameType === 'pve') {
        return interaction.followUp({
          content: 'You cannot take back a move against the bot.',
          flags: [MessageFlags.Ephemeral],
        });
      }
      if (game.history().length < 2) {
        return interaction.followUp({
          content: 'Not enough moves have been made to take back.',
          flags: [MessageFlags.Ephemeral],
        });
      }
      const opponent =
        player.id === gameData.playerWhite.id
          ? gameData.playerBlack
          : gameData.playerWhite;
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('accept_takeback')
          .setLabel('Accept Takeback')
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId('decline_takeback')
          .setLabel('Decline')
          .setStyle(ButtonStyle.Danger)
      );
      const msg = await interaction.followUp({
        content: `${opponent}, ${message.author.username} wants to take back the last move.`,
        components: [row],
      });
      try {
        const res = await msg.awaitMessageComponent({
          filter: (i) => i.user.id === opponent.id,
          time: 60000,
        });
        if (res.customId === 'accept_takeback') {
          game.undo();
          game.undo();
          // --- CHANGE: Use the new formatting function ---
          gameData.lastMove = formatLastMove(game);
          await interaction.editReply({ embeds: [createEmbed()] });
          await res.update({ content: 'Takeback accepted.', components: [] });
        } else {
          await res.update({
            content: 'Takeback request declined.',
            components: [],
          });
        }
      } catch (err) {
        await msg.edit({
          content: 'Takeback request expired.',
          components: [],
        });
      }
      return;
    }

    if (isChessMove(userInput)) {
      try {
        game.move(userInput, { sloppy: true });
      } catch (e1) {
        try {
          const capitalizedMove =
            userInput.charAt(0).toUpperCase() + userInput.slice(1);
          game.move(capitalizedMove, { sloppy: true });
        } catch (e2) {
          return interaction.followUp({
            content: `\`${userInput}\` is not a valid move.`,
            flags: [MessageFlags.Ephemeral],
          });
        }
      }

      // --- CHANGE: Use the new formatting function ---
      gameData.lastMove = formatLastMove(game);

      if (game.isGameOver()) return messageCollector.stop('gameover');

      await interaction.editReply({ embeds: [createEmbed()] });

      if (gameType === 'pve') {
        await makeBotMove();
        if (game.isGameOver()) return messageCollector.stop('gameover');

        await wait(2000);
        await interaction.editReply({ embeds: [createEmbed()] });
      }
    }
  });

  messageCollector.on('end', async (collected, reason) => {
    activePlayers.delete(gameData.playerWhite.id);
    activePlayers.delete(gameData.playerBlack.id);
    activeGames.delete(channelId);
    if (gameData.engine) gameData.engine.kill();

    let endReason = reason;
    if (reason === 'gameover') {
      if (game.isCheckmate()) endReason = 'checkmate';
      else if (game.isStalemate()) endReason = 'stalemate';
      else if (game.isThreefoldRepetition()) endReason = 'repetition';
      else if (game.isInsufficientMaterial()) endReason = 'insufficient';
    }

    const finalEmbed = createEmbed(endReason);

    await wait(2000);
    interaction
      .editReply({ embeds: [finalEmbed], components: [] })
      .catch(() => {});
  });
}
