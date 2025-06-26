# Start with an official Node.js image. This includes Linux, Node, and npm.
FROM node:20-slim

# Install the git-lfs package using the system's package manager.
# This runs as a root user, so it has permission.
RUN apt-get update && apt-get install -y git-lfs

# Set the working directory inside our container
WORKDIR /usr/src/app

# Copy the package.json and package-lock.json files
COPY package*.json ./

# Install the Node.js dependencies for our project
RUN npm install

# Copy the rest of our project files (like index.js, commands/, etc.)
COPY . .

# Tell Render what command to run to start the bot.
# The command in the Render UI will override this, but it's good practice.
CMD ["npm", "start"]