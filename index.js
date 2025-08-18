const { setupDiscordHandlers } = require('./discord');
const { initializeWebSocketServer } = require('./websocket');
const { isOptedOut, optOutUser, optInUser, deepEqual, corsOriginCheck, getMember, formatUserData } = require('./utils');

require('dotenv').config();
const express = require('express');
const compression = require('compression');
const cors = require('cors');
const { Client, GatewayIntentBits, Partials } = require('discord.js');
const { createServer } = require('http');

const GUILD_ID = process.env.GUILD_ID;
const PORT = process.env.PORT || 3000;

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildPresences,
    ],
    partials: [
        Partials.User,
        Partials.GuildMember
    ]
});

const app = express();

const server = createServer(app);

app.use(cors({
    origin: corsOriginCheck,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    credentials: true
}));

const guildCache = new Map();
const userDataCache = new Map();
const CACHE_TTL = 5 * 60 * 1000;

setInterval(() => {
    const now = Date.now();
    for (const [key, value] of userDataCache.entries()) {
        if (now - value.timestamp > CACHE_TTL) {
            userDataCache.delete(key);
        }
    }
}, 60 * 1000);

app.use(compression());
app.use(express.json({ limit: '10mb' }));

if (process.env.NODE_ENV !== 'production') {
    app.use((req, res, next) => {
        console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
        next();
    });
}

const getGuild = async () => {
    if (guildCache.has(GUILD_ID)) {
        return guildCache.get(GUILD_ID);
    }

    const guild = client.guilds.cache.get(GUILD_ID) || await client.guilds.fetch(GUILD_ID);
    guildCache.set(GUILD_ID, guild);
    return guild;
};

const initializeRoutes = require('./routes');

const routesDeps = {
    client,
    isOptedOut,
    getGuild,
    getMember,
    formatUserData,
    userDataCache,
    CACHE_TTL
};

app.use(initializeRoutes(routesDeps));

const webSocketHandlers = initializeWebSocketServer(server, {
    isOptedOut,
    getGuild,
    getMember,
    formatUserData,
    userDataCache,
    CACHE_TTL,
    deepEqual
});

setupDiscordHandlers(client, {
    clientId: process.env.CLIENT_ID,
    guildId: GUILD_ID,
    botToken: process.env.DISCORD_BOT_TOKEN,
    optOutUser,
    optInUser,
    userDataCache,
    debouncedSendUserData: webSocketHandlers.debouncedSendUserData,
    debouncedSendActivityData: webSocketHandlers.debouncedSendActivityData,
    deepEqual
});

const gracefulShutdown = () => {
    console.log('Received shutdown signal, cleaning up...');

    server.close(() => {
        console.log('HTTP server closed');

        client.destroy();
        console.log('Discord client destroyed');

        process.exit(0);
    });
};

process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);

process.on('unhandledRejection', (error) => {
    console.error('Unhandled promise rejection:', error);
});

process.on('uncaughtException', (error) => {
    console.error('Uncaught exception:', error);
    gracefulShutdown();
});

server.listen(PORT, () => {
    console.log(`Discord Bot API server is running on port ${PORT}`);
    console.log(`Health check available at: http://localhost:${PORT}/health`);
    console.log(`User endpoint available at: http://localhost:${PORT}/user/:userId`);
    console.log(`WebSocket server is running on the same port`);
});

client.login(process.env.DISCORD_BOT_TOKEN).catch(error => {
    console.error('Failed to login to Discord:', error);
    process.exit(1);
});