const { setupDiscordHandlers } = require('./discord');

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
const { Server } = require('socket.io');

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

const io = new Server(server, {
    cors: {
        origin: corsOriginCheck,
        methods: ["GET", "POST"]
    }
});

app.use(cors({
    origin: corsOriginCheck,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    credentials: true
}));

const clientSubscriptions = new Map();
const clientUpdateFilters = new Map();

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

io.on('connection', (socket) => {
    console.log(`Client connected: ${socket.id}`);

    socket.on('subscribe', async (data) => {
        let userId, updateTypes;

        if (typeof data === 'string') {
            userId = data;
            updateTypes = ['all'];
        } else if (typeof data === 'object' && data.userId) {
            userId = data.userId;
            updateTypes = data.updateTypes || ['all'];
        } else {
            socket.emit('error', {
                message: 'Invalid subscription data format',
                code: 'INVALID_FORMAT'
            });
            return;
        }

        if (!/^\d{17,19}$/.test(userId)) {
            socket.emit('error', {
                message: 'Invalid user ID format',
                code: 'INVALID_FORMAT',
                userId: userId
            });
            return;
        }

        if (isOptedOut(userId)) {
            socket.emit('error', {
                message: 'This user has opted out of API exposure.',
                code: 'USER_OPTED_OUT',
                userId: userId
            });
            return;
        }

        const validUpdateTypes = ['all', 'status', 'avatar', 'username', 'activities', 'customStatus', 'displayName'];
        const invalidTypes = updateTypes.filter(type => !validUpdateTypes.includes(type));
        if (invalidTypes.length > 0) {
            socket.emit('error', {
                message: `Invalid update types: ${invalidTypes.join(', ')}`,
                code: 'INVALID_UPDATE_TYPES',
                validTypes: validUpdateTypes
            });
            return;
        }

        try {
            const guild = await getGuild();
            const member = await getMember(guild, userId);

            clientSubscriptions.set(socket.id, userId);
            clientUpdateFilters.set(socket.id, updateTypes);
            socket.join(`user:${userId}`);
            console.log(`Client ${socket.id} subscribed to user ${userId} with filters: ${updateTypes.join(', ')}`);

            sendUserData(userId, socket);
        } catch (error) {
            if (error.message === 'USER_NOT_FOUND') {
                socket.emit('error', {
                    message: 'User not found in this guild',
                    code: 'USER_NOT_FOUND',
                    userId: userId
                });
            } else {
                socket.emit('error', {
                    message: 'Failed to validate user',
                    code: 'VALIDATION_ERROR',
                    userId: userId
                });
            }
            console.error(`Failed to subscribe client ${socket.id} to user ${userId}:`, error.message);
        }
    });

    socket.on('subscribeActivity', async (data) => {
        const { userId, activityName, activityType } = data;

        if (!userId || !/^\d{17,19}$/.test(userId)) {
            socket.emit('error', {
                message: 'Invalid user ID format',
                code: 'INVALID_FORMAT',
                userId: userId
            });
            return;
        }

        if (!activityName && activityType === undefined) {
            socket.emit('error', {
                message: 'Either activityName or activityType must be specified',
                code: 'INVALID_ACTIVITY_FILTER'
            });
            return;
        }

        try {
            const subscriptionKey = `${userId}:${activityName || `type:${activityType}`}`;
            clientSubscriptions.set(socket.id, subscriptionKey);
            clientUpdateFilters.set(socket.id, {
                userId,
                activityName,
                activityType,
                type: 'activity'
            });

            socket.join(`activity:${subscriptionKey}`);
            console.log(`Client ${socket.id} subscribed to activity updates for user ${userId} - ${activityName || `type ${activityType}`}`);

            sendActivityData(userId, socket, activityName, activityType);
        } catch (error) {
            if (error.message === 'USER_NOT_FOUND') {
                socket.emit('error', {
                    message: 'User not found in this guild',
                    code: 'USER_NOT_FOUND',
                    userId: userId
                });
            } else {
                socket.emit('error', {
                    message: 'Failed to validate user',
                    code: 'VALIDATION_ERROR',
                    userId: userId
                });
            }
            console.error(`Failed to subscribe client ${socket.id} to activity updates for user ${userId}:`, error.message);
        }
    });

    socket.on('unsubscribe', () => {
        const userId = clientSubscriptions.get(socket.id);
        if (userId) {
            socket.leave(`user:${userId}`);
            clientSubscriptions.delete(socket.id);
            clientUpdateFilters.delete(socket.id);
            console.log(`Client ${socket.id} unsubscribed from user ${userId}`);
        }
    });

    socket.on('disconnect', () => {
        const subscription = clientSubscriptions.get(socket.id);
        const filter = clientUpdateFilters.get(socket.id);

        if (subscription) {
            if (filter && filter.type === 'activity') {
                console.log(`Client disconnected: ${socket.id} (was subscribed to activity updates)`);
            } else {
                console.log(`Client disconnected: ${socket.id}`);
            }
            clientSubscriptions.delete(socket.id);
            clientUpdateFilters.delete(socket.id);
        } else {
            console.log(`Client disconnected: ${socket.id}`);
        }
    });
});

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

const emitToSubscribedClients = (userId, userData, updateType = null) => {
    if (isOptedOut(userId)) return;
    const room = io.sockets.adapter.rooms.get(`user:${userId}`);
    if (room) {
        room.forEach(socketId => {
            const clientSocket = io.sockets.sockets.get(socketId);
            const updateFilters = clientUpdateFilters.get(socketId);
            if (clientSocket && updateFilters) {
                if (updateFilters.includes('all') || (updateType && updateFilters.includes(updateType))) {
                    clientSocket.emit('userUpdate', {
                        ...userData,
                        updateType: updateType || 'all'
                    });
                }
            }
        });
    }
};

const sendActivityData = async (userId, socket = null, activityName = null, activityType = null) => {
    try {
        const cacheKey = `user:${userId}`;
        const now = Date.now();
        const cached = userDataCache.get(cacheKey);

        let userData;
        if (cached && (now - cached.timestamp) < CACHE_TTL) {
            userData = cached.data;
        } else {
            const guild = await getGuild();
            const member = await getMember(guild, userId);
            const user = member.user;
            const presence = guild.presences.cache.get(userId);
            userData = formatUserData(user, member, presence);
        }

        let filteredActivities = userData.activities;
        if (activityName) {
            filteredActivities = userData.activities.filter(activity =>
                activity.name.toLowerCase() === activityName.toLowerCase()
            );
        } else if (activityType !== undefined) {
            filteredActivities = userData.activities.filter(activity =>
                activity.type === activityType
            );
        }

        const activityData = {
            userId: userData.id,
            username: userData.username,
            displayName: userData.displayName,
            status: userData.status,
            activities: filteredActivities,
            timestamp: Date.now()
        };

        if (socket) {
            socket.emit('activityUpdate', activityData);
        } else {
            emitToActivitySubscribers(userId, activityData, activityName, activityType);
        }
    } catch (error) {
        console.error(`Error sending activity data for ${userId}:`, error.message);

        if (socket) {
            if (error.message === 'USER_NOT_FOUND') {
                socket.emit('error', {
                    message: 'User not found in this guild',
                    code: 'USER_NOT_FOUND',
                    userId: userId
                });
            } else {
                socket.emit('error', {
                    message: 'Failed to fetch activity data',
                    code: 'FETCH_ERROR',
                    userId: userId
                });
            }
        }
    }
};

const emitToActivitySubscribers = (userId, activityData, activityName = null, activityType = null) => {
    const subscriptionKey = `${userId}:${activityName || `type:${activityType}`}`;
    const room = io.sockets.adapter.rooms.get(`activity:${subscriptionKey}`);

    if (room) {
        room.forEach(socketId => {
            const clientSocket = io.sockets.sockets.get(socketId);
            if (clientSocket) {
                clientSocket.emit('activityUpdate', activityData);
            }
        });
    }
};

const sendUserData = async (userId, socket = null, updateType = null) => {
    try {
        const cacheKey = `user:${userId}`;
        const now = Date.now();
        const cached = userDataCache.get(cacheKey);

        if (cached && (now - cached.timestamp) < CACHE_TTL) {
            if (socket) {
                socket.emit('userUpdate', cached.data);
            } else {
                emitToSubscribedClients(userId, cached.data, updateType);
            }
            return;
        }

        const guild = await getGuild();
        const member = await getMember(guild, userId);
        const user = member.user;
        const presence = guild.presences.cache.get(userId);

        const userData = formatUserData(user, member, presence);

        userDataCache.set(cacheKey, {
            data: userData,
            timestamp: now
        });

        if (socket) {
            socket.emit('userUpdate', userData);
        } else {
            emitToSubscribedClients(userId, userData, updateType);
        }
    } catch (error) {
        console.error(`Error sending user data for ${userId}:`, error.message);

        if (socket) {
            if (error.message === 'USER_NOT_FOUND') {
                socket.emit('error', {
                    message: 'User not found in this guild',
                    code: 'USER_NOT_FOUND',
                    userId: userId
                });
            } else {
                socket.emit('error', {
                    message: 'Failed to fetch user data',
                    code: 'FETCH_ERROR',
                    userId: userId
                });
            }
        }
    }
};

const updateDebounceMap = new Map();
const DEBOUNCE_DELAY = 1000;

const debouncedSendUserData = (userId, updateType = null) => {
    const key = `${userId}:${updateType || 'all'}`;
    if (updateDebounceMap.has(key)) {
        clearTimeout(updateDebounceMap.get(key));
    }

    const timeoutId = setTimeout(() => {
        sendUserData(userId, null, updateType);
        updateDebounceMap.delete(key);
    }, DEBOUNCE_DELAY);

    updateDebounceMap.set(key, timeoutId);
};

const debouncedSendActivityData = (userId, activityName = null, activityType = null) => {
    const key = `activity:${userId}:${activityName || `type:${activityType}`}`;
    if (updateDebounceMap.has(key)) {
        clearTimeout(updateDebounceMap.get(key));
    }

    const timeoutId = setTimeout(() => {
        sendActivityData(userId, null, activityName, activityType);
        updateDebounceMap.delete(key);
    }, DEBOUNCE_DELAY);

    updateDebounceMap.set(key, timeoutId);
};

const getActivityTypeName = (type) => ACTIVITY_TYPES[type] || 'Unknown';

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

setupDiscordHandlers(client, {
    clientId: process.env.CLIENT_ID,
    guildId: GUILD_ID,
    botToken: process.env.DISCORD_BOT_TOKEN,
    optOutUser,
    optInUser,
    userDataCache,
    debouncedSendUserData,
    debouncedSendActivityData,
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