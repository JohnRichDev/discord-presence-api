const { registerCommands } = require('./commands');
const { setupSlashCommandHandlers } = require('./slashHandlers');
const { setupClientEventHandlers } = require('./clientEvents');
const { setupPresenceHandlers } = require('./presenceHandlers');

function setupDiscordHandlers(client, {
    clientId,
    guildId,
    botToken,
    optOutUser,
    optInUser,
    userDataCache,
    debouncedSendUserData,
    debouncedSendActivityData,
    deepEqual
}) {
    setupClientEventHandlers(client, registerCommands, clientId, guildId, botToken);
    setupSlashCommandHandlers(client, optOutUser, optInUser);
    setupPresenceHandlers(client, guildId, userDataCache, debouncedSendUserData, debouncedSendActivityData, deepEqual);
}

module.exports = { setupDiscordHandlers };
