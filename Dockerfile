# Start with the official Node.js image
FROM node:20-slim

# Install system packages we need: curl to download and unzip to extract
RUN apt-get update && apt-get install -y curl unzip

# Set the working directory for our app
WORKDIR /usr/src/app

# --- This is the new "Download Binaries" stage ---
# Download and set up the Linux version of Stockfish
RUN curl -L -o stockfish.zip "https://stockfishchess.org/files/stockfish-windows-x86-64-avx2.zip" && \
  unzip stockfish.zip && \
  mv stockfish/stockfish-windows-x86-64-avx2.exe stockfish.exe && \
  rm -rf stockfish stockfish.zip

RUN curl -L -o stockfish_linux.zip "https://stockfishchess.org/files/stockfish-ubuntu-x86-64-avx2.zip" && \
  unzip stockfish_linux.zip && \
  mv stockfish/stockfish-ubuntu-x86-64-avx2 stockfish && \
  chmod +x stockfish && \
  rm -rf stockfish stockfish_linux.zip
# --- End of Download Stage ---


# Copy package files for dependency installation
COPY package*.json ./
RUN npm install

# Copy the rest of our application code
COPY . .

# Set the command to start the bot
CMD ["npm", "start"]