# Start with the official Node.js image
FROM node:20-slim

# Install system packages: wget for downloading and unzip to extract
RUN apt-get update && apt-get install -y wget unzip

# Set the working directory for our app
WORKDIR /usr/src/app

# --- Download Stockfish from the CORRECT GitHub Releases URL ---
# This is the verified, direct link to the sf_16.1 asset.
RUN wget -O stockfish.zip "https://github.com/official-stockfish/Stockfish/releases/download/sf_16.1/stockfish-ubuntu-x86-64-avx2.zip" && \
  unzip stockfish.zip && \
  # The binary is inside a folder named 'stockfish' after unzipping
  mv stockfish/stockfish-ubuntu-x86-64-avx2 stockfish && \
  chmod +x stockfish && \
  # Clean up the downloaded zip and the now-empty folder
  rm stockfish.zip && \
  rm -rf stockfish
# --- End of Download Stage ---

# Copy package files for dependency installation
COPY package*.json ./
RUN npm install

# Copy the rest of our application code
COPY . .

# Set the command to start the bot
CMD ["npm", "start"]