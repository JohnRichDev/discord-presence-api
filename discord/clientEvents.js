function setupClientEventHandlers(client, registerCommands, clientId, guildId, botToken) {
    client.once('ready', async () => {
        await registerCommands(clientId, guildId, botToken);
        console.log(`Bot logged in as ${client.user.tag}`);
        console.log(`Connected to ${client.guilds.cache.size} guild(s)`);
        console.log(`Cached ${client.users.cache.size} user(s)`);
        console.log('Bot is ready!');
    });

    client.on('error', error => {
        console.error('Discord client error:', error);
    });

    client.on('invalidated', () => {
        console.error('Session invalidated! Bot token may be invalid.');
    });

    client.on('disconnect', () => {
        console.warn('Disconnected from Discord');
    });

    client.on('reconnecting', () => {
        console.log('Reconnecting to Discord...');
    });
}

module.exports = { setupClientEventHandlers };
