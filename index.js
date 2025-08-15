const { setupDiscordHandlers } = require('./discord');
const { initializeWebSocketServer } = require('./websocket');

const fs = require('fs');
const path = require('path');

const OPTOUT_PATH = path.join(__dirname, 'optout.json');

function ensureOptOutFile() {
    if (!fs.existsSync(OPTOUT_PATH)) {
        fs.writeFileSync(OPTOUT_PATH, '[]');
    }
}

function loadOptOutList() {
    ensureOptOutFile();
    try {
        return new Set(JSON.parse(fs.readFileSync(OPTOUT_PATH, 'utf8')));
    } catch (e) {
        return new Set();
    }
}

function saveOptOutList(optOutSet) {
    ensureOptOutFile();
    fs.writeFileSync(OPTOUT_PATH, JSON.stringify([...optOutSet], null, 2));
}

let optOutSet = loadOptOutList();

function isOptedOut(userId) {
    return optOutSet.has(userId);
}

function optOutUser(userId) {
    optOutSet.add(userId);
    saveOptOutList(optOutSet);
}

function optInUser(userId) {
    optOutSet.delete(userId);
    saveOptOutList(optOutSet);
}

require('dotenv').config();
const express = require('express');
const compression = require('compression');
const cors = require('cors');
const { Client, GatewayIntentBits, Partials } = require('discord.js');
const { createServer } = require('http');

const GUILD_ID = process.env.GUILD_ID;
const PORT = process.env.PORT || 3000;

const DISCORD_UNKNOWN_USER_ERROR_CODE = 10013;

const ACTIVITY_TYPES = {
    0: 'Playing',
    1: 'Streaming',
    2: 'Listening to',
    3: 'Watching',
    4: 'Custom',
    5: 'Competing in'
};

const deepEqual = (obj1, obj2) => {
    if (obj1 === obj2) return true;

    if (obj1 == null || obj2 == null) return obj1 === obj2;

    if (typeof obj1 !== typeof obj2) return false;

    if (typeof obj1 !== 'object') return obj1 === obj2;

    if (Array.isArray(obj1) !== Array.isArray(obj2)) return false;

    const keys1 = Object.keys(obj1);
    const keys2 = Object.keys(obj2);

    if (keys1.length !== keys2.length) return false;

    for (const key of keys1) {
        if (!keys2.includes(key)) return false;
        if (!deepEqual(obj1[key], obj2[key])) return false;
    }

    return true;
};

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

const corsOriginCheck = (origin, callback) => {
    callback(null, true);
};

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

const getMember = async (guild, userId) => {
    try {
        return guild.members.cache.get(userId) || await guild.members.fetch(userId);
    } catch (error) {
        if (error.code === DISCORD_UNKNOWN_USER_ERROR_CODE || error.status === 404) {
            throw new Error('USER_NOT_FOUND');
        }
        throw error;
    }
};

const formatUserData = (user, member, presence) => {
    const userData = {
        username: user.username,
        displayName: user.globalName,
        tag: user.tag,
        id: user.id,
        status: presence?.status || 'offline',
        avatarUrl: user.displayAvatarURL({ dynamic: true, size: 512 }),
        customStatus: null,
        activities: [],
        createdAt: user.createdTimestamp,
        flags: user.flags?.toArray() || [],
        premiumSince: member.premiumSinceTimestamp,
    };

    if (presence?.activities?.length > 0) {
        const customStatusActivity = presence.activities.find(a => a.type === 4);
        if (customStatusActivity && !userData.customStatus) {
            userData.customStatus = {
                emoji: customStatusActivity.emoji ? {
                    name: customStatusActivity.emoji.name,
                    id: customStatusActivity.emoji.id,
                    animated: customStatusActivity.emoji.animated || false
                } : null,
                state: customStatusActivity.state
            };
        }

        userData.activities = presence.activities
            .filter(activity => activity.type !== 4)
            .map(activity => {
                const baseActivity = {
                    name: activity.name,
                    type: activity.type,
                    typeName: getActivityTypeName(activity.type),
                    details: activity.details || null,
                    state: activity.state || null,
                    timestamps: activity.timestamps ? {
                        start: activity.timestamps.start,
                        end: activity.timestamps.end
                    } : null,
                    applicationId: activity.applicationId || null,
                    url: activity.url || null
                };

                if (activity.name === 'Spotify' && activity.type === 2) {
                    baseActivity.artist = activity.state;
                    baseActivity.song = activity.details;
                    baseActivity.album = activity.assets?.largeText || null;
                    baseActivity.albumArt = activity.assets?.largeImage ?
                        `https://i.scdn.co/image/${activity.assets.largeImage.replace('spotify:', '')}` : null;
                }

                return baseActivity;
            });
    }

    return userData;
};

const getActivityTypeName = (type) => {
    const ACTIVITY_TYPES = {
        0: 'Playing',
        1: 'Streaming',
        2: 'Listening to',
        3: 'Watching',
        4: 'Custom',
        5: 'Competing in'
    };
    return ACTIVITY_TYPES[type] || 'Unknown';
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