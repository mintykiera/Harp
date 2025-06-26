# Start with the official Node.js image, which has git pre-installed
FROM node:20-slim

# Install the git-lfs package
RUN apt-get update && apt-get install -y git-lfs

# Set the working directory for our app
WORKDIR /usr/src/app

# --- The "Build" Stage ---
# Copy ONLY the files needed to install dependencies first. This is a Docker optimization.
COPY package*.json ./
RUN npm install

# Now, copy ALL project files into the container. This includes your code,
# the .git folder, the .gitattributes, and the LFS pointer files.
COPY . .

# Run the LFS pull and chmod command INSIDE the Docker build.
# This downloads the large binary and sets its permission.
RUN git lfs pull && chmod +x stockfish

# --- The "Run" Stage ---
# Expose the port your UptimeRobot pings (if you have one)
EXPOSE 3000

# Set the command to start the bot
CMD ["npm", "start"]