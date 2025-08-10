require('dotenv').config();
const express = require('express');
const compression = require('compression');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
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

const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: {
        error: 'Too many requests',
        details: 'Please try again later'
    },
    standardHeaders: true,
    legacyHeaders: false,
});

app.use('/user', limiter);

if (process.env.NODE_ENV !== 'production') {
    app.use((req, res, next) => {
        console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
        next();
    });
}

client.once('ready', () => {
    console.log(`Bot logged in as ${client.user.tag}`);
    console.log(`Connected to ${client.guilds.cache.size} guild(s)`);
    console.log(`Cached ${client.users.cache.size} user(s)`);
    console.log('Bot is ready!');
});

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

client.on('presenceUpdate', (oldPresence, newPresence) => {
    if (!newPresence || newPresence.guild.id !== GUILD_ID) return;

    const userId = newPresence.userId;
    userDataCache.delete(`user:${userId}`);

    const changes = [];

    if (oldPresence?.status !== newPresence.status) {
        changes.push('status');
    }

    const oldActivities = oldPresence?.activities || [];
    const newActivities = newPresence?.activities || [];

    const oldCustomStatus = oldActivities.find(a => a.type === 4);
    const newCustomStatus = newActivities.find(a => a.type === 4);

    if (!deepEqual(oldCustomStatus, newCustomStatus)) {
        changes.push('customStatus');
    }

    const oldNonCustom = oldActivities.filter(a => a.type !== 4);
    const newNonCustom = newActivities.filter(a => a.type !== 4);

    if (!deepEqual(oldNonCustom, newNonCustom)) {
        changes.push('activities');
    }

    if (changes.length > 0) {
        changes.forEach(changeType => {
            debouncedSendUserData(userId, changeType);
        });
    } else {
        debouncedSendUserData(userId);
    }

    if (!deepEqual(oldPresence?.activities || [], newPresence?.activities || [])) {
        const nonCustomOldActivities = (oldPresence?.activities || []).filter(a => a.type !== 4);
        const nonCustomNewActivities = (newPresence?.activities || []).filter(a => a.type !== 4);

        const oldSpotify = nonCustomOldActivities.find(a => a.name === 'Spotify');
        const newSpotify = nonCustomNewActivities.find(a => a.name === 'Spotify');

        if (!deepEqual(oldSpotify, newSpotify)) {
            debouncedSendActivityData(userId, 'Spotify');
        }

        const allActivityNames = new Set([
            ...nonCustomOldActivities.map(a => a.name),
            ...nonCustomNewActivities.map(a => a.name)
        ]);

        allActivityNames.forEach(activityName => {
            if (activityName !== 'Spotify') {
                const oldActivity = nonCustomOldActivities.find(a => a.name === activityName);
                const newActivity = nonCustomNewActivities.find(a => a.name === activityName);

                if (!deepEqual(oldActivity, newActivity)) {
                    debouncedSendActivityData(userId, activityName);
                }
            }
        });

        const allActivityTypes = new Set([
            ...nonCustomOldActivities.map(a => a.type),
            ...nonCustomNewActivities.map(a => a.type)
        ]);

        allActivityTypes.forEach(activityType => {
            const oldActivitiesOfType = nonCustomOldActivities.filter(a => a.type === activityType);
            const newActivitiesOfType = nonCustomNewActivities.filter(a => a.type === activityType);

            if (!deepEqual(oldActivitiesOfType, newActivitiesOfType)) {
                debouncedSendActivityData(userId, null, activityType);
            }
        });
    }
});

client.on('userUpdate', (oldUser, newUser) => {
    const userId = newUser.id;
    userDataCache.delete(`user:${userId}`);

    const changes = [];

    if (oldUser.username !== newUser.username) {
        changes.push('username');
    }

    if (oldUser.avatar !== newUser.avatar) {
        changes.push('avatar');
    }

    if (oldUser.globalName !== newUser.globalName) {
        changes.push('displayName');
    }

    if (changes.length > 0) {
        changes.forEach(changeType => {
            debouncedSendUserData(userId, changeType);
        });
    } else {
        debouncedSendUserData(userId, 'all');
    }
});

const getActivityTypeName = (type) => ACTIVITY_TYPES[type] || 'Unknown';

app.get('/', (req, res) => {
    res.json({
        name: 'Discord Presence API',
        version: '1.0.0',
        description: 'Discord bot API server that provides user status and activity information',
        endpoints: {
            health: '/health',
            user: '/user/:userId'
        },
        websocket: {
            events: {
                subscribe: 'Subscribe to user updates with optional filters',
                subscribeActivity: 'Subscribe to specific activity updates (e.g., Spotify)',
                unsubscribe: 'Unsubscribe from user updates',
                userUpdate: 'Receive user data updates',
                activityUpdate: 'Receive activity-specific updates',
                error: 'Receive error messages'
            },
            updateTypes: ['all', 'status', 'avatar', 'username', 'activities', 'customStatus', 'displayName'],
            activitySubscription: {
                description: 'Subscribe to specific activity updates',
                parameters: {
                    userId: 'Discord user ID (required)',
                    activityName: 'Name of the activity to monitor (e.g., "Spotify")',
                    activityType: 'Type of activity to monitor (0=Playing, 1=Streaming, 2=Listening, 3=Watching, 5=Competing)'
                },
                examples: [
                    {
                        description: 'Subscribe to Spotify updates',
                        data: { userId: '123456789012345678', activityName: 'Spotify' }
                    },
                    {
                        description: 'Subscribe to all listening activities',
                        data: { userId: '123456789012345678', activityType: 2 }
                    }
                ]
            }
        }
    });
});

app.get('/user/:userId', async (req, res) => {
    const { userId } = req.params;

    if (!/^\d{17,19}$/.test(userId)) {
        return res.status(400).json({
            error: 'Invalid user ID format',
            details: 'User ID must be a valid Discord snowflake (17-19 digits)'
        });
    }

    if (!client.isReady()) {
        return res.status(503).json({
            error: 'Bot is not ready yet',
            details: 'Please wait for the bot to connect to Discord'
        });
    }

    try {
        const cacheKey = `user:${userId}`;
        const now = Date.now();
        const cached = userDataCache.get(cacheKey);

        if (cached && (now - cached.timestamp) < CACHE_TTL) {
            return res.json(cached.data);
        }

        const guild = await getGuild();
        const member = await getMember(guild, userId);
        const user = member.user;
        const presence = guild.presences.cache.get(userId);

        const response = formatUserData(user, member, presence);

        userDataCache.set(cacheKey, {
            data: response,
            timestamp: now
        });

        res.json(response);

    } catch (error) {
        console.error('Error fetching user:', error);

        if (error.message === 'USER_NOT_FOUND') {
            return res.status(404).json({
                error: 'Member not found in this guild',
                details: 'User may not be a member of the specified guild'
            });
        }

        res.status(500).json({
            error: 'User not found or error occurred',
            details: error.message
        });
    }
});

let healthDataCache = null;
let healthCacheTimestamp = 0;
const HEALTH_CACHE_TTL = 30 * 1000;

app.get('/health', (req, res) => {
    const now = Date.now();

    if (healthDataCache && (now - healthCacheTimestamp) < HEALTH_CACHE_TTL) {
        return res.json(healthDataCache);
    }

    const healthData = {
        status: 'online',
        botStatus: client.user?.presence?.status || 'offline',
        uptime: Math.floor(process.uptime()),
        guilds: client.guilds.cache.size,
        users: client.users.cache.size,
        version: require('discord.js').version,
        readyAt: client.readyAt,
        ping: client.ws.ping,
        memory: {
            used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
            total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024)
        }
    };

    healthDataCache = healthData;
    healthCacheTimestamp = now;

    res.json(healthData);
});

app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({
        error: 'Internal server error',
        details: process.env.NODE_ENV === 'development' ? err.message : 'An unexpected error occurred'
    });
});

app.use((req, res) => {
    res.status(404).json({
        error: 'Endpoint not found',
        details: `The endpoint ${req.method} ${req.path} does not exist`
    });
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