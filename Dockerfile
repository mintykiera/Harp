# Start with the official Node.js image
FROM node:20-slim

# Install system packages we need: curl to download and unzip to extract
RUN apt-get update && apt-get install -y curl unzip

# Set the working directory for our app
WORKDIR /usr/src/app

# --- Download ONLY the Linux Stockfish ---
# We only need the Linux version for our Linux container.
RUN curl -L -A "Mozilla/5.0" -o stockfish.zip "https://stockfishchess.org/files/stockfish-ubuntu-x86-64-avx2.zip" && \
  unzip stockfish.zip && \
  mv stockfish-ubuntu-x86-64-avx2/stockfish-ubuntu-x86-64-avx2 stockfish && \
  chmod +x stockfish && \
  rm stockfish.zip && \
  rm -rf stockfish-ubuntu-x86-64-avx2
# --- End of Download Stage ---

# Copy package files for dependency installation
COPY package*.json ./
RUN npm install

# Copy the rest of our application code
COPY . .

# Set the command to start the bot
CMD ["npm", "start"]