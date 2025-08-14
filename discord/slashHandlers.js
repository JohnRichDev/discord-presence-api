const { InteractionType } = require('discord.js');

function setupSlashCommandHandlers(client, optOutUser, optInUser) {
    client.on('interactionCreate', async (interaction) => {
        if (interaction.type !== InteractionType.ApplicationCommand) return;
        
        if (interaction.commandName === 'opt-out') {
            optOutUser(interaction.user.id);
            await interaction.reply({ content: 'You have opted out of the Discord Presence API. Your presence/activity will no longer be shared.', ephemeral: true });
        } else if (interaction.commandName === 'opt-in') {
            optInUser(interaction.user.id);
            await interaction.reply({ content: 'You have opted in to the Discord Presence API. Your presence/activity will be shared again.', ephemeral: true });
        }
    });
}

module.exports = { setupSlashCommandHandlers };
