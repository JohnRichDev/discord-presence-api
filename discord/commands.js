const { REST, Routes, SlashCommandBuilder } = require('discord.js');

const commands = [
    new SlashCommandBuilder().setName('opt-out').setDescription('Opt out of the Discord Presence API'),
    new SlashCommandBuilder().setName('opt-in').setDescription('Opt in to the Discord Presence API'),
];

async function registerCommands(clientId, guildId, botToken) {
    if (!botToken || !clientId) {
        console.error('Missing DISCORD_BOT_TOKEN or CLIENT_ID. Skipping slash commands registration.');
        return;
    }
    const rest = new REST({ version: '10' }).setToken(botToken);
    try {
        if (guildId) {
            await rest.put(
                Routes.applicationGuildCommands(clientId, guildId),
                { body: commands.map(cmd => cmd.toJSON()) }
            );
            console.log('Slash guild commands registered.');
        } else {
            await rest.put(
                Routes.applicationCommands(clientId),
                { body: commands.map(cmd => cmd.toJSON()) }
            );
            console.log('Global slash commands registered.');
        }
    } catch (err) {
        console.error('Failed to register slash commands:', err);
    }
}

module.exports = { commands, registerCommands };
