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
const Game = require('../../models/Game');
const User = require('../../models/User');

// --- Engine and State Management ---
const isWindows = os.platform() === 'win32';
const stockfishPath = isWindows
  ? path.join(__dirname, '..', '..', 'stockfish.exe')
  : '/usr/src/app/stockfish_bin';

// Validate Stockfish exists
if (!fs.existsSync(stockfishPath)) {
  console.error(`Stockfish not found at path: ${stockfishPath}`);
}

const difficultyLevels = {
  rookie: 1,
  intermediate: 5,
  experienced: 10,
  professional: 15,
  grandmaster: 20,
};
const activePveEngines = new Map();
const gameCollectors = new Map();

// --- Helper Functions ---
function getBoardImageUrl(fen) {
  const boardOnly = fen.split(' ')[0];
  return `https://chessboardimage.com/${boardOnly}.png?theme=wood`;
}

function isChessMove(str) {
  const chessMoveRegex =
    /^(?:[NBRQK]?[a-h]?[1-8]?x?[a-h][1-8](?:=[NBRQK])?|O-O(?:-O)?)[+#]?$/i;
  return chessMoveRegex.test(str.trim());
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

  const newWhiteElo = Math.round(white.elo + K * (whiteScore - whiteExpected));
  const newBlackElo = Math.round(black.elo + K * (blackScore - blackExpected));
  return { newWhiteElo, newBlackElo };
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
      case 'repetition':
      case 'insufficient':
        description = `**Draw** by ${endReason.result}.`;
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
      default:
        description = `Game ended: ${endReason.result}`;
        status = 'Game Over';
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

function makeBotMove(game, channelId) {
  return new Promise((resolve, reject) => {
    try {
      const engine = activePveEngines.get(channelId);
      if (!engine)
        return reject(new Error('Engine not found for this channel.'));

      engine.stdin.write(`position fen ${game.fen()}\n`);
      engine.stdin.write(`go movetime 1500\n`);

      const onData = (data) => {
        const bestMove = data.toString().match(/bestmove\s+(\S+)/)?.[1];
        if (bestMove && bestMove !== '(none)') {
          try {
            game.move(bestMove, { sloppy: true });
            engine.stdout.removeListener('data', onData);
            resolve();
          } catch (err) {
            engine.stdout.removeListener('data', onData);
            reject(new Error(`Invalid bot move: ${bestMove}`));
          }
        }
      };

      engine.stdout.on('data', onData);

      // Timeout in case engine hangs
      setTimeout(() => {
        engine.stdout.removeListener('data', onData);
        reject(new Error('Bot move timed out'));
      }, 5000);
    } catch (err) {
      reject(err);
    }
  });
}

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
    // pve
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

    // Start Stockfish engine
    if (fs.existsSync(stockfishPath)) {
      const engine = spawn(stockfishPath);
      engine.stdin.write('uci\n');
      engine.stdin.write(
        `setoption name Skill Level value ${
          difficultyLevels[options.difficulty]
        }\n`
      );
      engine.on('error', (err) =>
        console.error('Stockfish engine error:', err)
      );
      activePveEngines.set(channelId, engine);
    } else {
      console.error(`Stockfish not found at: ${stockfishPath}`);
    }
  }

  return Game.create({
    channelId,
    gameType,
    playerWhiteId: playerWhite.id,
    playerWhiteUsername: playerWhite.username,
    playerBlackId: playerBlack.id,
    playerBlackUsername: playerBlack.username,
    messageId: 'pending', // Temporary placeholder
    fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
  });
}

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
    await interaction.deferReply({ ephemeral: true });

    // Check for existing game in channel
    const existingGame = await Game.findOne({
      channelId: interaction.channelId,
    });
    if (existingGame) {
      return interaction.editReply({
        content: 'A game is already in progress in this channel!',
      });
    }

    // Check if user is in another game
    const playerInGame = await Game.findOne({
      $or: [
        { playerWhiteId: interaction.user.id },
        { playerBlackId: interaction.user.id },
      ],
    });
    if (playerInGame) {
      return interaction.editReply({
        content: `You are already in a game in <#${playerInGame.channelId}>!`,
      });
    }

    const challenger = interaction.user;
    const opponent = interaction.options.getUser('opponent');

    if (opponent) {
      // PvP Game Flow
      if (opponent.bot || opponent.id === challenger.id) {
        return interaction.editReply({
          content: "You can't challenge bots or yourself.",
        });
      }

      // Check if opponent is in another game
      const opponentInGame = await Game.findOne({
        $or: [{ playerWhiteId: opponent.id }, { playerBlackId: opponent.id }],
      });
      if (opponentInGame) {
        return interaction.editReply({
          content: `${opponent.username} is already in a game!`,
        });
      }

      // Create challenge message with buttons
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
          `${opponent}, you have been challenged to a game of chess by ${challenger}.`
        )
        .setColor('#744c2c');

      const challengeMessage = await interaction.editReply({
        content: `${opponent}`,
        embeds: [challengeEmbed],
        components: [row],
      });

      try {
        // Wait for opponent response
        const response = await challengeMessage.awaitMessageComponent({
          filter: (i) => i.user.id === opponent.id,
          time: 60000,
        });

        if (response.customId === 'decline_chess') {
          return response.update({
            content: 'The challenge was declined.',
            embeds: [],
            components: [],
          });
        }

        // Accepted challenge
        await response.update({
          content: 'Challenge accepted! Setting up the game...',
          embeds: [],
          components: [],
        });

        // Create game data
        const gameDoc = await setupGameData(interaction, 'pvp', {
          challenger,
          opponent,
        });
        const game = new Chess(gameDoc.fen);

        // Update challenge message to game board
        await challengeMessage.edit({
          content: `Game started! ${gameDoc.playerWhiteUsername} is White.`,
          embeds: [createEmbed(game, gameDoc)],
          components: [],
        });

        // Update game with actual message ID
        await Game.updateOne(
          { _id: gameDoc._id },
          { messageId: challengeMessage.id }
        );

        // Initialize game collector
        this.initGameCollector(interaction);
      } catch (err) {
        // Handle challenge timeout
        await challengeMessage
          .edit({
            content: 'The challenge expired.',
            embeds: [],
            components: [],
          })
          .catch(console.error);
      }
    } else {
      // PvE Game Flow
      const difficulty = interaction.options.getString('difficulty');
      if (!difficulty) {
        return interaction.editReply({
          content: 'You must select a difficulty when playing against the bot.',
        });
      }

      // Validate Stockfish exists
      if (!fs.existsSync(stockfishPath)) {
        return interaction.editReply({
          content: 'Chess engine is not available. Please contact support.',
        });
      }

      await interaction.editReply({
        content: 'Setting up your game against Harp...',
      });

      // Create game data
      const gameDoc = await setupGameData(interaction, 'pve', { difficulty });
      const game = new Chess(gameDoc.fen);

      // Send game board
      const gameMessage = await interaction.followUp({
        embeds: [createEmbed(game, gameDoc)],
        fetchReply: true,
      });

      // Update game with actual message ID
      await Game.updateOne({ _id: gameDoc._id }, { messageId: gameMessage.id });

      // Initialize game collector
      this.initGameCollector(interaction);

      // Make first bot move if bot is white
      if (
        game.turn() === 'w' &&
        gameDoc.playerWhiteId === interaction.client.user.id
      ) {
        try {
          await makeBotMove(game, interaction.channelId);
          await Game.updateOne({ _id: gameDoc._id }, { fen: game.fen() });
          await gameMessage.edit({ embeds: [createEmbed(game, gameDoc)] });
        } catch (err) {
          console.error('Initial bot move failed:', err);
          // Handle error gracefully
          await gameMessage.edit({
            content: 'Failed to make bot move. Game cancelled.',
            embeds: [],
          });
          await Game.deleteOne({ _id: gameDoc._id });
        }
      }
    }
  },

  initGameCollector(interaction) {
    // Clean up any existing collector
    if (gameCollectors.has(interaction.channelId)) {
      gameCollectors.get(interaction.channelId).stop();
    }

    // Create new collector
    const collector = interaction.channel.createMessageCollector({
      filter: (m) => !m.author.bot,
      time: 1_800_000, // 30 minutes
    });

    gameCollectors.set(interaction.channelId, collector);

    collector.on('collect', async (message) => {
      try {
        const gameDoc = await Game.findOne({ channelId: message.channelId });
        if (!gameDoc) return collector.stop();

        const game = new Chess(gameDoc.fen);
        const currentPlayerId =
          game.turn() === 'w' ? gameDoc.playerWhiteId : gameDoc.playerBlackId;

        // Ignore non-players
        if (message.author.id !== currentPlayerId) return;

        let userInput = message.content.trim();

        // Delete player's move message
        if (message.deletable) await message.delete().catch(() => {});

        // Handle resignation
        if (userInput.toLowerCase() === 'resign') {
          return collector.stop({
            result: 'resign',
            user: message.author.username,
          });
        }

        // Process chess move
        if (isChessMove(userInput)) {
          const move = game.move(userInput, { sloppy: true });

          // Validate move
          if (move === null) {
            const ephemeralMsg = await message.channel.send({
              content: `\`${userInput}\` is not a valid move.`,
              flags: [MessageFlags.Ephemeral],
            });
            setTimeout(() => ephemeralMsg.delete().catch(() => {}), 5000);
            return;
          }

          // Update game state
          await Game.updateOne(
            { channelId: message.channel.id },
            { fen: game.fen() }
          );

          // Fetch game message
          const gameMessage = await message.channel.messages
            .fetch(gameDoc.messageId)
            .catch(() => null);

          // Check game over conditions
          if (game.isGameOver()) {
            let result = 'unknown';
            if (game.isCheckmate()) result = 'checkmate';
            else if (game.isStalemate()) result = 'stalemate';
            else if (game.isThreefoldRepetition()) result = 'repetition';
            else if (game.isInsufficientMaterial()) result = 'insufficient';

            return collector.stop({ result });
          }

          // Update game board
          if (gameMessage) {
            await gameMessage.edit({ embeds: [createEmbed(game, gameDoc)] });
          }

          // Handle bot moves in PvE
          if (gameDoc.gameType === 'pve') {
            try {
              await makeBotMove(game, message.channel.id);

              // Update game state after bot move
              await Game.updateOne(
                { channelId: message.channel.id },
                { fen: game.fen() }
              );

              // Check game over after bot move
              if (game.isGameOver()) {
                let result = 'unknown';
                if (game.isCheckmate()) result = 'checkmate';
                else if (game.isStalemate()) result = 'stalemate';
                else if (game.isThreefoldRepetition()) result = 'repetition';
                else if (game.isInsufficientMaterial()) result = 'insufficient';

                return collector.stop({ result });
              }

              // Update game board with bot's move
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
        }
      } catch (err) {
        console.error('Error processing move:', err);
      }
    });

    collector.on('end', async (collected, reason) => {
      try {
        // Clean up collector
        gameCollectors.delete(interaction.channelId);

        // Retrieve and delete game
        const gameDoc = await Game.findOneAndDelete({
          channelId: interaction.channelId,
        });
        if (!gameDoc) return;

        // Clean up bot engine
        if (activePveEngines.has(interaction.channelId)) {
          activePveEngines.get(interaction.channelId).kill();
          activePveEngines.delete(interaction.channelId);
        }

        // Create final embed
        const game = new Chess(gameDoc.fen);
        const finalEmbed = createEmbed(
          game,
          gameDoc,
          reason || { result: 'idle' }
        );

        // Update game message
        const gameMessage = await interaction.channel.messages
          .fetch(gameDoc.messageId)
          .catch(() => null);

        if (gameMessage) {
          await gameMessage.edit({
            embeds: [finalEmbed],
            components: [],
          });
        }

        // Update ELO for PvP games
        if (gameDoc.gameType === 'pvp' && reason && reason.result) {
          const white = await User.findOne({ userId: gameDoc.playerWhiteId });
          const black = await User.findOne({ userId: gameDoc.playerBlackId });
          if (!white || !black) return;

          let resultType;
          if (reason.result === 'checkmate') {
            resultType = game.turn() === 'b' ? 'white' : 'black';
          } else if (reason.result === 'resign') {
            resultType = reason.user === white.username ? 'black' : 'white';
          } else {
            resultType = 'draw';
          }

          if (resultType !== 'draw') {
            const { newWhiteElo, newBlackElo } = await calculateElo(
              white,
              black,
              resultType
            );

            const [winner, loser, winnerElo, loserElo] =
              resultType === 'white'
                ? [white, black, newWhiteElo, newBlackElo]
                : [black, white, newBlackElo, newWhiteElo];

            // Update winner stats
            await User.updateOne(
              { userId: winner.userId },
              {
                elo: winnerElo,
                $inc: { 'stats.wins': 1 },
                $push: {
                  recentGames: {
                    $each: [
                      {
                        opponentId: loser.userId,
                        opponentUsername: loser.username,
                        result: 'win',
                        eloChange: winnerElo - winner.elo,
                      },
                    ],
                    $slice: -10,
                  },
                },
              }
            );

            // Update loser stats
            await User.updateOne(
              { userId: loser.userId },
              {
                elo: loserElo,
                $inc: { 'stats.losses': 1 },
                $push: {
                  recentGames: {
                    $each: [
                      {
                        opponentId: winner.userId,
                        opponentUsername: winner.username,
                        result: 'loss',
                        eloChange: loserElo - loser.elo,
                      },
                    ],
                    $slice: -10,
                  },
                },
              }
            );
          } else {
            // Handle draw
            const updateDraw = (user, opponent) =>
              User.updateOne(
                { userId: user.userId },
                {
                  $inc: { 'stats.draws': 1 },
                  $push: {
                    recentGames: {
                      $each: [
                        {
                          opponentId: opponent.userId,
                          opponentUsername: opponent.username,
                          result: 'draw',
                          eloChange: 0,
                        },
                      ],
                      $slice: -10,
                    },
                  },
                }
              );

            await Promise.all([
              updateDraw(white, black),
              updateDraw(black, white),
            ]);
          }
        }
      } catch (err) {
        console.error('Error ending game:', err);
      }
    });
  },
};
