const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionFlagsBits,
} = require('discord.js');
const { Chess } = require('chess.js');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const Game = require('../../models/Game');
const User = require('../../models/User');
const PGN_DIR = path.join(__dirname, '..', '..', 'chess_pgns');
const config = require('../../config.js');

// --- Configuration ---
const isWindows = os.platform() === 'win32';

const stockfishPath =
  config.stockfishExe ||
  (isWindows
    ? path.join(__dirname, '..', '..', 'stockfish.exe')
    : path.join(__dirname, '..', '..', 'stockfish_bin'));
const MOVE_TIMEOUT = 120_000; // 2 minutes per move
const GAME_TIMEOUT = 1_800_000; // 30 minutes total

const difficultyLevels = {
  rookie: 1,
  intermediate: 5,
  experienced: 10,
  professional: 15,
  grandmaster: 20,
};

// --- State Management ---
const activePveEngines = new Map();
const gameCollectors = new Map();
const processingLocks = new Map();
const rateLimit = new Map();

// --- Helper Functions ---
function getBoardImageUrl(fen) {
  const boardOnly = fen.split(' ')[0];
  return `https://chessboardimage.com/${boardOnly}.png?theme=wood`;
}

function sanitizeInput(input) {
  return input.replace(/[^a-h1-8OoKQRBNx=+#-]/gi, '').substring(0, 10);
}

function formatLastMove(game) {
  const history = game.history({ verbose: true });
  if (history.length === 0) return 'None';
  const lastMove = history[history.length - 1];
  const moveCount = Math.ceil(history.length / 2);

  if (lastMove.color === 'b' && history.length > 1) {
    const whiteMove = history[history.length - 2];
    return `${moveCount}. ${whiteMove.san} : ${lastMove.san}`;
  }
  return `${moveCount}. ${lastMove.san}`;
}

async function updateUserProfile(user) {
  return User.findOneAndUpdate(
    { userId: user.id },
    { username: user.username },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
}

async function calculateElo(white, black, result) {
  const K = 32;
  const whiteExpected = 1 / (1 + 10 ** ((black.elo - white.elo) / 400));
  const blackExpected = 1 - whiteExpected;

  let whiteScore, blackScore;
  if (result === 'white') [whiteScore, blackScore] = [1, 0];
  else if (result === 'black') [whiteScore, blackScore] = [0, 1];
  else [whiteScore, blackScore] = [0.5, 0.5];

  return {
    newWhiteElo: Math.round(white.elo + K * (whiteScore - whiteExpected)),
    newBlackElo: Math.round(black.elo + K * (blackScore - blackExpected)),
  };
}

function createEmbed(game, gameDoc, endReason = null) {
  const turn = game.turn();
  const { playerWhiteUsername, playerBlackUsername } = gameDoc;
  const currentPlayerUsername =
    turn === 'w' ? playerWhiteUsername : playerBlackUsername;
  let description, status;

  if (endReason) {
    const winnerUsername =
      turn === 'w' ? playerBlackUsername : playerWhiteUsername;

    switch (endReason.result) {
      case 'checkmate':
        description = `**Checkmate!** ${winnerUsername} wins.`;
        status = 'Checkmate!';
        break;
      case 'stalemate':
        description = `**Draw** by stalemate.`;
        status = 'Draw';
        break;
      case 'repetition':
        description = `**Draw** by threefold repetition.`;
        status = 'Draw';
        break;
      case 'insufficient':
        description = `**Draw** by insufficient material.`;
        status = 'Draw';
        break;
      case 'idle':
        description = '**Game ended due to inactivity.**';
        status = 'Timed Out';
        break;
      case 'resign':
        description = `**${endReason.user} has resigned.** ${winnerUsername} wins!`;
        status = 'Resigned';
        break;
      case 'timeout':
        description = `**${currentPlayerUsername} ran out of time!** ${winnerUsername} wins.`;
        status = 'Timeout';
        break;
      case 'error':
        description = `**Game ended due to an error.**`;
        status = 'Error';
        break;
      default:
        if (game.isCheckmate()) {
          description = `**Checkmate!** ${winnerUsername} wins.`;
          status = 'Checkmate!';
        } else if (game.isStalemate()) {
          description = `**Draw** by stalemate.`;
          status = 'Draw';
        } else if (game.isThreefoldRepetition()) {
          description = `**Draw** by threefold repetition.`;
          status = 'Draw';
        } else if (game.isInsufficientMaterial()) {
          description = `**Draw** by insufficient material.`;
          status = 'Draw';
        } else if (game.isDraw()) {
          description = `**Game ended in a draw.**`;
          status = 'Draw';
        } else {
          description = `Game ended: ${endReason.result || 'unknown reason'}`;
          status = 'Game Over';
        }
    }
  } else {
    description = `It's **${currentPlayerUsername}**'s turn (${
      turn === 'w' ? 'White' : 'Black'
    }).\nMake a move (e.g., \`e4\`), or type \`resign\`.`;
    status = game.inCheck() ? 'Check!' : 'In Progress';
  }

  return new EmbedBuilder()
    .setColor('#744c2c')
    .setTitle(
      `${playerWhiteUsername} (White) vs. ${playerBlackUsername} (Black)`
    )
    .setDescription(description)
    .setImage(getBoardImageUrl(game.fen()))
    .addFields(
      { name: 'Last Move', value: formatLastMove(game), inline: true },
      { name: 'Status', value: status, inline: true }
    )
    .setFooter({ text: `FEN: ${game.fen()}` });
}

// --- Engine Management ---
async function initEngine(difficulty) {
  if (!fs.existsSync(stockfishPath)) {
    console.error(`Stockfish not found at: ${stockfishPath}`);
    return null;
  }

  const engine = spawn(stockfishPath);
  let initialized = false;

  return new Promise((resolve, reject) => {
    const initTimeout = setTimeout(() => {
      engine.kill();
      reject(new Error('Engine initialization timeout'));
    }, 5000);

    const dataHandler = (data) => {
      if (data.includes('uciok') && !initialized) {
        clearTimeout(initTimeout);
        initialized = true;
        engine.stdin.write(
          `setoption name Skill Level value ${difficultyLevels[difficulty]}\n`
        );
        resolve(engine);
      }
    };

    engine.stdout.on('data', dataHandler);
    engine.stdin.write('uci\n');
    engine.on('error', reject);
  });
}

async function makeBotMove(game, engine) {
  return new Promise((resolve, reject) => {
    let output = '';
    const moveTimeout = setTimeout(() => {
      engine.stdout.removeListener('data', dataHandler);
      reject(new Error('Bot move timed out'));
    }, 5000);

    const dataHandler = (data) => {
      output += data.toString();
      const bestMove = output.match(/bestmove\s+(\S+)/)?.[1];
      if (bestMove && bestMove !== '(none)') {
        clearTimeout(moveTimeout);
        engine.stdout.removeListener('data', dataHandler);
        try {
          const move = game.move(bestMove, { sloppy: true });
          resolve(move);
        } catch (err) {
          reject(new Error(`Invalid bot move: ${bestMove}`));
        }
      }
    };

    engine.stdin.write(
      `position fen ${game.fen().replace(/[^a-z0-9\/ ]/gi, '')}\n`
    );
    engine.stdin.write(`go movetime 1500\n`);
    engine.stdout.on('data', dataHandler);
  });
}

// --- Game Management ---
async function setupGameData(interaction, gameType, options) {
  const { channelId, client } = interaction;
  const chosenColor = interaction.options.getString('color') || 'random';
  let playerWhite, playerBlack;

  if (gameType === 'pvp') {
    const { challenger, opponent } = options;
    await Promise.all([
      updateUserProfile(challenger),
      updateUserProfile(opponent),
    ]);

    if (chosenColor === 'white')
      [playerWhite, playerBlack] = [challenger, opponent];
    else if (chosenColor === 'black')
      [playerWhite, playerBlack] = [opponent, challenger];
    else
      [playerWhite, playerBlack] =
        Math.random() > 0.5 ? [challenger, opponent] : [opponent, challenger];
  } else {
    const player = interaction.user;
    await updateUserProfile(player);
    const botUser = {
      username: `Harp (${options.difficulty})`,
      id: client.user.id,
    };

    if (chosenColor === 'white') [playerWhite, playerBlack] = [player, botUser];
    else if (chosenColor === 'black')
      [playerWhite, playerBlack] = [botUser, player];
    else
      [playerWhite, playerBlack] =
        Math.random() > 0.5 ? [player, botUser] : [botUser, player];
  }

  return Game.create({
    channelId,
    gameType,
    playerWhiteId: playerWhite.id,
    playerWhiteUsername: playerWhite.username,
    playerBlackId: playerBlack.id,
    playerBlackUsername: playerBlack.username,
    messageId: 'pending',
    fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
  });
}

async function endGame(interaction, reason) {
  const channelId = interaction.channelId;
  const gameDoc = await Game.findOneAndDelete({ channelId });
  if (!gameDoc) return;

  // Clean up resources
  if (activePveEngines.has(channelId)) {
    const engine = activePveEngines.get(channelId);
    engine.stdin.write('quit\n');
    setTimeout(() => {
      if (!engine.killed) engine.kill('SIGTERM');
    }, 1000);
    activePveEngines.delete(channelId);
  }

  if (gameCollectors.has(channelId)) {
    gameCollectors.get(channelId).stop();
    gameCollectors.delete(channelId);
  }

  processingLocks.delete(channelId);

  // Update game message
  let game;
  try {
    game = new Chess(gameDoc.fen);
  } catch (e) {
    game = new Chess();
  }

  const gameMessage = await interaction.channel.messages
    .fetch(gameDoc.messageId)
    .catch(() => null);
  if (gameMessage) {
    await gameMessage.edit({
      embeds: [createEmbed(game, gameDoc, reason)],
      components: [],
    });
  }

  // Handle Elo updates for PvP
  if (gameDoc.gameType === 'pvp' && reason?.result) {
    await updateEloRatings(gameDoc, game, reason);
  }

  // Save PGN for both PvP and PvE
  saveGamePGN(interaction, game, gameDoc, reason);
}

async function updateEloRatings(gameDoc, game, reason) {
  const session = await User.startSession();
  session.startTransaction();

  try {
    const white = await User.findOne({ userId: gameDoc.playerWhiteId }).session(
      session
    );
    const black = await User.findOne({ userId: gameDoc.playerBlackId }).session(
      session
    );
    if (!white || !black) return;

    let resultType;
    if (reason.result === 'checkmate') {
      resultType = game.turn() === 'b' ? 'white' : 'black';
    } else if (reason.result === 'resign') {
      resultType = reason.user === white.username ? 'black' : 'white';
    } else if (reason.result === 'timeout') {
      resultType = game.turn() === 'w' ? 'black' : 'white';
    } else {
      resultType = 'draw';
    }

    const { newWhiteElo, newBlackElo } = await calculateElo(
      white,
      black,
      resultType
    );

    // Prepare recent game data
    const recentGameData = {
      opponentId: '',
      opponentUsername: '',
      result: '',
      eloChange: 0,
      timestamp: new Date(),
    };

    // Update white player
    const whiteUpdate = {
      elo: newWhiteElo,
      $inc: {
        'stats.wins': resultType === 'white' ? 1 : 0,
        'stats.losses': resultType === 'black' ? 1 : 0,
        'stats.draws': resultType === 'draw' ? 1 : 0,
      },
      $push: {
        recentGames: {
          $each: [
            {
              ...recentGameData,
              opponentId: black.userId,
              opponentUsername: black.username,
              result:
                resultType === 'white'
                  ? 'win'
                  : resultType === 'black'
                  ? 'loss'
                  : 'draw',
              eloChange: newWhiteElo - white.elo,
            },
          ],
          $slice: -10,
        },
      },
    };

    // Update black player
    const blackUpdate = {
      elo: newBlackElo,
      $inc: {
        'stats.wins': resultType === 'black' ? 1 : 0,
        'stats.losses': resultType === 'white' ? 1 : 0,
        'stats.draws': resultType === 'draw' ? 1 : 0,
      },
      $push: {
        recentGames: {
          $each: [
            {
              ...recentGameData,
              opponentId: white.userId,
              opponentUsername: white.username,
              result:
                resultType === 'black'
                  ? 'win'
                  : resultType === 'white'
                  ? 'loss'
                  : 'draw',
              eloChange: newBlackElo - black.elo,
            },
          ],
          $slice: -10,
        },
      },
    };

    await User.updateOne({ _id: white._id }, whiteUpdate, { session });
    await User.updateOne({ _id: black._id }, blackUpdate, { session });

    await session.commitTransaction();
  } catch (err) {
    await session.abortTransaction();
    console.error('Elo update failed:', err);
  } finally {
    session.endSession();
  }
}

function saveGamePGN(interaction, game, gameDoc, reason) {
  if (!fs.existsSync(PGN_DIR)) {
    try {
      fs.mkdirSync(PGN_DIR, { recursive: true });
    } catch (err) {
      console.error('Failed to create PGN directory:', err);
      return;
    }
  }

  let result = '*';
  if (reason?.result === 'checkmate') {
    result = game.turn() === 'w' ? '0-1' : '1-0';
  } else if (reason?.result === 'timeout') {
    result = game.turn() === 'w' ? '0-1' : '1-0';
  } else if (reason?.result === 'resign') {
    result = reason.user === gameDoc.playerWhiteUsername ? '0-1' : '1-0';
  } else if (reason?.result === 'draw' || game.isDraw()) {
    result = '1/2-1/2';
  }

  const guildName = interaction.guild?.name || 'DM';

  const pgn = `[Event "Discord Chess"]
[Site "${guildName}"]
[Date "${new Date().toISOString()}"]
[White "${gameDoc.playerWhiteUsername}"]
[Black "${gameDoc.playerBlackUsername}"]
[Result "${result}"]
[Termination "${reason?.result || 'unknown'}"]
[TimeControl "${Math.floor(GAME_TIMEOUT / 60000)} min"]

${game.pgn()}`;

  const safeFileName = `${gameDoc._id}-${Date.now()}.pgn`;
  fs.writeFileSync(path.join(PGN_DIR, safeFileName), pgn);
}

// --- Command Implementation ---
module.exports = {
  data: new SlashCommandBuilder()
    .setName('chess')
    .setDescription('Start a game of chess against a player or the bot.')
    .addUserOption((option) =>
      option.setName('opponent').setDescription('Challenge another player.')
    )
    .addStringOption((option) =>
      option
        .setName('difficulty')
        .setDescription('Choose bot difficulty.')
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
        .setDescription('Choose your color.')
        .addChoices(
          { name: 'White', value: 'white' },
          { name: 'Black', value: 'black' },
          { name: 'Random', value: 'random' }
        )
    ),

  async execute(interaction) {
    // Rate limiting (5 seconds cooldown)
    if (rateLimit.has(interaction.user.id)) {
      const lastTime = rateLimit.get(interaction.user.id);
      if (Date.now() - lastTime < 5000) {
        return interaction.reply({
          content: '⏱️ Please wait a few seconds before starting another game',
          ephemeral: true,
        });
      }
    }
    rateLimit.set(interaction.user.id, Date.now());

    // Check existing channel game
    const existingChannelGame = await Game.findOne({
      channelId: interaction.channelId,
    });
    if (existingChannelGame) {
      return interaction.reply({
        content: '🚫 A game is already in progress in this channel!',
        ephemeral: true,
      });
    }

    // Check existing player game
    const existingPlayerGame = await Game.findOne({
      $or: [
        { playerWhiteId: interaction.user.id },
        { playerBlackId: interaction.user.id },
      ],
    });
    if (existingPlayerGame) {
      return interaction.reply({
        content: `⚠️ You're already in a game in <#${existingPlayerGame.channelId}>!`,
        ephemeral: true,
      });
    }

    // Determine game type
    const opponent = interaction.options.getUser('opponent');
    const isPvP = Boolean(opponent);
    await interaction.deferReply({ ephemeral: !isPvP });

    // PvP Game Flow
    if (isPvP) {
      if (opponent.bot || opponent.id === interaction.user.id) {
        return interaction.editReply({
          content: "❌ You can't challenge bots or yourself.",
        });
      }

      const opponentInGame = await Game.findOne({
        $or: [{ playerWhiteId: opponent.id }, { playerBlackId: opponent.id }],
      });
      if (opponentInGame) {
        return interaction.editReply({
          content: `⚠️ ${opponent.username} is already in a game!`,
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

      const challengeEmbed = new EmbedBuilder()
        .setTitle('♟️ Chess Challenge!')
        .setDescription(
          `${opponent}, you have been challenged to a game of chess by ${interaction.user}.`
        )
        .setColor('#744c2c');

      const challengeMessage = await interaction.editReply({
        content: `${opponent}`,
        embeds: [challengeEmbed],
        components: [row],
      });

      try {
        const response = await challengeMessage.awaitMessageComponent({
          filter: (i) => i.user.id === opponent.id,
          time: 60000,
        });

        if (response.customId === 'decline_chess') {
          return response.update({
            content: '❌ Challenge declined.',
            embeds: [],
            components: [],
          });
        }

        await response.update({
          content: '✅ Challenge accepted! Setting up the game...',
          embeds: [],
          components: [],
        });

        const gameDoc = await setupGameData(interaction, 'pvp', {
          challenger: interaction.user,
          opponent,
        });
        const game = new Chess(gameDoc.fen);

        await challengeMessage.edit({
          content: `🎮 Game started! ${gameDoc.playerWhiteUsername} is White.`,
          embeds: [createEmbed(game, gameDoc)],
          components: [],
        });

        await Game.updateOne(
          { _id: gameDoc._id },
          { messageId: challengeMessage.id }
        );
        this.initGameCollector(interaction);
      } catch (err) {
        await challengeMessage
          .edit({
            content: '⏱️ Challenge expired.',
            embeds: [],
            components: [],
          })
          .catch(console.error);
      }
    }
    // PvE Game Flow
    else {
      const difficulty =
        interaction.options.getString('difficulty') || 'intermediate';

      try {
        const engine = await initEngine(difficulty);
        if (!engine) {
          return interaction.editReply({
            content: '❌ Chess engine is unavailable. Please contact support.',
          });
        }
        activePveEngines.set(interaction.channelId, engine);
      } catch (err) {
        console.error('Engine init failed:', err);
        return interaction.editReply({
          content: '❌ Failed to start chess engine. Please try again later.',
        });
      }

      await interaction.editReply({
        content: '⚙️ Setting up your game against Harp...',
      });

      const gameDoc = await setupGameData(interaction, 'pve', { difficulty });
      const game = new Chess(gameDoc.fen);

      const gameMessage = await interaction.followUp({
        embeds: [createEmbed(game, gameDoc)],
        fetchReply: true,
      });

      await Game.updateOne({ _id: gameDoc._id }, { messageId: gameMessage.id });
      this.initGameCollector(interaction);

      // Make first move if bot is white
      if (
        game.turn() === 'w' &&
        gameDoc.playerWhiteId === interaction.client.user.id
      ) {
        try {
          const engine = activePveEngines.get(interaction.channelId);
          await makeBotMove(game, engine);
          await Game.updateOne({ _id: gameDoc._id }, { fen: game.fen() });
          await gameMessage.edit({ embeds: [createEmbed(game, gameDoc)] });
        } catch (err) {
          console.error('Initial bot move failed:', err);
          await gameMessage.edit({
            content: '❌ Failed to make bot move. Game cancelled.',
            embeds: [],
          });
          await Game.deleteOne({ _id: gameDoc._id });
          activePveEngines.delete(interaction.channelId);
        }
      }
    }
  },

  initGameCollector(interaction) {
    // Clean up existing collector
    if (gameCollectors.has(interaction.channelId)) {
      const oldCollector = gameCollectors.get(interaction.channelId);
      if (!oldCollector.ended) oldCollector.stop();
      gameCollectors.delete(interaction.channelId);
    }

    // Create new collector with idle timeout
    const collector = interaction.channel.createMessageCollector({
      filter: (m) => !m.author.bot,
      time: GAME_TIMEOUT,
      idle: MOVE_TIMEOUT,
    });

    gameCollectors.set(interaction.channelId, collector);

    // Per-move processing
    collector.on('collect', async (message) => {
      const channelId = message.channelId;

      // Concurrency lock
      if (processingLocks.has(channelId)) return;
      processingLocks.set(channelId, true);

      try {
        const gameDoc = await Game.findOne({ channelId });
        if (!gameDoc) {
          collector.stop();
          return;
        }

        // Handle invalid FEN
        let game;
        try {
          game = new Chess(gameDoc.fen);
        } catch (e) {
          game = new Chess();
          await Game.updateOne({ _id: gameDoc._id }, { fen: game.fen() });
        }

        // Check if game is already over
        if (game.isGameOver()) {
          collector.stop({ result: 'game_over' });
          return;
        }

        const currentPlayerId =
          game.turn() === 'w' ? gameDoc.playerWhiteId : gameDoc.playerBlackId;

        // Ignore non-players
        if (message.author.id !== currentPlayerId) return;

        const userInput = sanitizeInput(message.content.trim());

        // Delete player's move message if possible
        if (
          message.deletable &&
          message.channel
            .permissionsFor(interaction.client.user)
            .has(PermissionFlagsBits.ManageMessages)
        ) {
          await message.delete().catch(() => {});
        }

        // Handle resignation
        if (userInput.toLowerCase() === 'resign') {
          return collector.stop({
            result: 'resign',
            user: message.author.username,
          });
        }

        // Process chess move
        try {
          const move = game.move(userInput, { sloppy: true });
          if (!move) {
            throw new Error('Invalid move');
          }

          // Update game state
          await Game.updateOne({ _id: gameDoc._id }, { fen: game.fen() });

          // Fetch game message
          const gameMessage = await interaction.channel.messages
            .fetch(gameDoc.messageId)
            .catch(() => null);

          // Check game over
          if (game.isGameOver()) {
            let result;
            if (game.isCheckmate()) result = 'checkmate';
            else if (game.isStalemate()) result = 'stalemate';
            else if (game.isThreefoldRepetition()) result = 'repetition';
            else if (game.isInsufficientMaterial()) result = 'insufficient';
            else if (game.isDraw()) result = 'draw';

            return collector.stop({ result });
          }

          // Update board
          if (gameMessage) {
            await gameMessage.edit({
              embeds: [createEmbed(game, gameDoc)],
            });
          }

          // Handle bot moves in PvE
          if (gameDoc.gameType === 'pve') {
            try {
              const engine = activePveEngines.get(channelId);
              await makeBotMove(game, engine);

              // Update game state
              await Game.updateOne({ _id: gameDoc._id }, { fen: game.fen() });

              // Check game over after bot move
              if (game.isGameOver()) {
                let result;
                if (game.isCheckmate()) result = 'checkmate';
                else if (game.isStalemate()) result = 'stalemate';
                else if (game.isThreefoldRepetition()) result = 'repetition';
                else if (game.isInsufficientMaterial()) result = 'insufficient';
                else if (game.isDraw()) result = 'draw';

                return collector.stop({ result });
              }

              // Update board
              if (gameMessage) {
                await gameMessage.edit({
                  embeds: [createEmbed(game, gameDoc)],
                });
              }
            } catch (err) {
              console.error('Bot move error:', err);
              collector.stop({ result: 'error', error: err.message });
            }
          }
        } catch (err) {
          // Invalid move
          if (
            message.channel
              .permissionsFor(interaction.client.user)
              .has(PermissionFlagsBits.SendMessages)
          ) {
            const ephemeralMsg = await message.channel.send({
              content: `❌ \`${userInput}\` is not a valid move.`,
              flags: [4096], // Ephemeral
            });
            setTimeout(() => ephemeralMsg.delete().catch(() => {}), 5000);
          }
        }
      } catch (err) {
        console.error('Move processing error:', err);
      } finally {
        processingLocks.delete(channelId);
      }
    });

    // Handle move timeout
    collector.on('idle', () => {
      if (!collector.ended) collector.stop('timeout');
    });

    // Handle collector end
    collector.on('end', async (_, reason) => {
      await endGame(interaction, reason);
    });
  },
};
